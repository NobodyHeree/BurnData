import { BrowserWindow, ipcMain } from 'electron';
import crypto from 'crypto';
import Store from 'electron-store';
import { PSNService } from '@services/psn';
import { encryptString, decryptString } from '../services/encryption';
import { z } from 'zod';
import { validateIPC, schemas } from '../utils/validate';

// Constants
const PSN_RATE_LIMIT_MS = 500;

/**
 * Get a PSNService instance from the stored access token.
 */
async function getPSNService(store: Store): Promise<PSNService> {
    const encrypted = store.get('tokens.psn') as string;
    if (!encrypted) throw new Error('No PSN token found. Please log in again.');
    const token = decryptString(encrypted);
    return new PSNService(token);
}

/**
 * Get a PSNService instance, automatically refreshing the token if it's expired or about to expire.
 */
async function getPSNServiceWithRefresh(store: Store): Promise<PSNService> {
    // Check if access token is expired
    const expiresAt = store.get('tokens.psn_expires_at') as number | undefined;
    if (expiresAt && Date.now() >= expiresAt - 60000) { // Refresh 1 min before expiry
        const refreshToken = store.get('tokens.psn_refresh') as string;
        if (refreshToken) {
            try {
                const decryptedRefresh = decryptString(refreshToken);
                const result = await PSNService.refreshAccessToken(decryptedRefresh);
                store.set('tokens.psn', encryptString(result.accessToken));
                if (result.refreshToken) {
                    store.set('tokens.psn_refresh', encryptString(result.refreshToken));
                }
                if (result.expiresIn) {
                    store.set('tokens.psn_expires_at', Date.now() + result.expiresIn * 1000);
                }
                return new PSNService(result.accessToken);
            } catch (err) {
                console.error('[PSN] Token refresh failed:', (err as Error).message);
                // Fall through to try existing token
            }
        }
    }
    return getPSNService(store);
}

export function registerPSNHandlers(
    mainWindow: BrowserWindow,
    store: Store
): void {
    // PSN: Login with NPSSO token
    ipcMain.handle('psn:login', async (_, npssoToken: unknown) => {
        const validNpsso = validateIPC(schemas.psnNpsso, npssoToken, 'psn:login');
        try {
            console.log('[PSN] Authenticating with NPSSO token...');
            const authResult = await PSNService.authenticateWithNpsso(validNpsso);

            // Store encrypted tokens
            store.set('tokens.psn', encryptString(authResult.accessToken));
            store.set('tokens.psn_npsso', encryptString(validNpsso));
            if (authResult.refreshToken) {
                store.set('tokens.psn_refresh', encryptString(authResult.refreshToken));
            }
            if (authResult.expiresIn) {
                store.set('tokens.psn_expires_at', Date.now() + authResult.expiresIn * 1000);
            }

            // Get user info
            const service = new PSNService(authResult.accessToken);
            const [friends, profile] = await Promise.all([
                service.getFriendIds(),
                service.getMyProfile().catch(() => null),
            ]);

            const username = profile?.onlineId || 'PlayStation User';
            store.set('psn_username', username);
            console.log(`[PSN] Authenticated as ${username}. Found ${friends.length} friends.`);
            return { success: true, friendCount: friends.length, username };
        } catch (err) {
            console.error('[PSN] Authentication failed:', err);
            return { success: false, error: String(err) };
        }
    });

    // PSN: Check if authenticated
    ipcMain.handle('psn:isAuthenticated', async () => {
        const token = store.get('tokens.psn') as string;
        if (!token) return { authenticated: false };
        const username = (store.get('psn_username') as string) || 'PlayStation User';
        return { authenticated: true, username };
    });

    // PSN: Get friends list
    ipcMain.handle('psn:getFriends', async () => {
        try {
            const service = await getPSNServiceWithRefresh(store);
            const friends = await service.getFriendsWithProfiles();
            console.log(`[PSN] Fetched ${friends.length} friends with profiles`);
            return friends;
        } catch (err: any) {
            // Check for 401 Unauthorized (token expired)
            if (err.response?.status === 401) {
                console.error('[PSN] Token expired or invalid (401). Clearing tokens...');
                store.delete('tokens.psn');
                store.delete('tokens.psn_npsso');
                throw new Error('PSN_TOKEN_EXPIRED: Your session has expired. Please login again.');
            }
            console.error('[PSN] Failed to fetch friends:', err);
            throw err;
        }
    });

    // PSN: Remove a single friend
    ipcMain.handle('psn:removeFriend', async (_, accountId: unknown) => {
        const validAccountId = validateIPC(schemas.psnAccountId, accountId, 'psn:removeFriend');
        try {
            const service = await getPSNServiceWithRefresh(store);
            const success = await service.removeFriend(validAccountId);
            return { success };
        } catch (err) {
            console.error('[PSN] Failed to remove friend:', err);
            return { success: false, error: String(err) };
        }
    });

    // PSN: Start mass unfriend job
    ipcMain.handle('psn:startUnfriend', async (_, config: unknown) => {
        const validConfig = validateIPC(
            z.object({ accountIds: schemas.psnAccountIds }),
            config,
            'psn:startUnfriend'
        );
        try {
            const service = await getPSNServiceWithRefresh(store);
            const jobId = crypto.randomUUID();

            console.log(`[PSN] Starting unfriend job ${jobId} for ${validConfig.accountIds.length} friends`);

            // Run in background
            (async () => {
                let removed = 0;
                let failed = 0;

                for (let i = 0; i < validConfig.accountIds.length; i++) {
                    const accountId = validConfig.accountIds[i];
                    const success = await service.removeFriend(accountId);

                    if (success) {
                        removed++;
                    } else {
                        failed++;
                    }

                    // Send progress
                    mainWindow?.webContents.send('psn:unfriendProgress', {
                        jobId,
                        current: i + 1,
                        total: validConfig.accountIds.length,
                        removed,
                        failed,
                        progress: Math.round(((i + 1) / validConfig.accountIds.length) * 100),
                    });

                    // Rate limit
                    await new Promise(r => setTimeout(r, PSN_RATE_LIMIT_MS));
                }

                // Complete
                const finalMessage = {
                    jobId,
                    current: validConfig.accountIds.length,
                    total: validConfig.accountIds.length,
                    removed,
                    failed,
                    progress: 100,
                    completed: true,
                };
                console.log(`[PSN] Sending final completion message:`, finalMessage);
                mainWindow?.webContents.send('psn:unfriendProgress', finalMessage);

                console.log(`[PSN] Job ${jobId} completed. Removed: ${removed}, Failed: ${failed}`);
            })().catch(err => {
                console.error(`[PSN] Unfriend job ${jobId} failed:`, err);
                mainWindow?.webContents.send('psn:unfriendProgress', {
                    jobId,
                    current: 0,
                    total: validConfig.accountIds.length,
                    removed: 0,
                    failed: validConfig.accountIds.length,
                    progress: 100,
                    completed: true,
                });
            });

            return { success: true, jobId };
        } catch (err) {
            console.error('[PSN] Failed to start unfriend job:', err);
            return { success: false, error: String(err) };
        }
    });

    // PSN: Logout
    ipcMain.handle('psn:logout', async () => {
        store.delete('tokens.psn');
        store.delete('tokens.psn_npsso');
        store.delete('tokens.psn_refresh');
        store.delete('tokens.psn_expires_at');
        store.delete('psn_username');
        return true;
    });

    // PSN: Get presence for multiple accounts
    ipcMain.handle('psn:getPresences', async (_, accountIds: unknown) => {
        const validAccountIds = validateIPC(schemas.psnAccountIds, accountIds, 'psn:getPresences');
        try {
            const service = await getPSNServiceWithRefresh(store);

            console.log(`[PSN] Fetching presence for ${validAccountIds.length} accounts...`);
            const presences = await service.getPresences(validAccountIds, (current: number, total: number) => {
                // Send progress to renderer
                mainWindow?.webContents.send('psn:presenceProgress', {
                    current,
                    total,
                    progress: Math.round((current / total) * 100),
                });
            });

            // Convert Map to object for IPC
            const result: Record<string, unknown> = {};
            presences.forEach((presence: unknown, accountId: string) => {
                result[accountId] = presence;
            });

            return result;
        } catch (err: any) {
            // Check for 401 Unauthorized (token expired)
            if (err.response?.status === 401) {
                console.error('[PSN] Token expired or invalid (401). Clearing tokens...');
                store.delete('tokens.psn');
                store.delete('tokens.psn_npsso');
                throw new Error('PSN_TOKEN_EXPIRED: Your session has expired. Please login again.');
            }
            console.error('[PSN] Failed to fetch presences:', err);
            throw err;
        }
    });
}
