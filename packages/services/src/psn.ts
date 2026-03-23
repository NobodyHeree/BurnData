import axios, { AxiosInstance } from 'axios';

const PSN_AUTH_BASE = 'https://ca.account.sony.com/api/authz/v3/oauth';
const PSN_API_BASE = 'https://m.np.playstation.com/api/userProfile/v1/internal';
const PSN_REQUEST_TIMEOUT_MS = 30000;
const PSN_BATCH_SIZE = 100;

/**
 * PSN OAuth client credentials — extracted from Sony's official PlayStation Android app.
 * These are intentionally public constants (embedded in a published mobile app binary).
 * They are NOT secret credentials that need protection.
 * See: https://ca.account.sony.com/api/authz/v3/oauth
 */
const PSN_CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const PSN_CLIENT_SECRET = 'ucPjka5tntB2KqsP';
const PSN_REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
const PSN_SCOPES = 'psn:mobile.v2.core psn:clientapp';

export interface PSNAuthResult {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
}

export interface PSNFriend {
    accountId: string;
    onlineId: string; // PSN username
    avatarUrl?: string;
    isPlus?: boolean;
    languages?: string[];
    aboutMe?: string;
    // Presence data (loaded separately)
    onlineStatus?: 'online' | 'offline';
    lastOnlineDate?: string;
    platform?: string; // 'PS4', 'PS5', etc.
    currentGame?: string;
}

export interface PSNPresence {
    onlineStatus: 'online' | 'offline';
    lastOnlineDate?: string;
    platform?: string;
    currentGame?: string;
}

export class PSNService {
    private client: AxiosInstance;
    private accessToken: string;

    constructor(accessToken: string) {
        this.accessToken = accessToken;
        this.client = axios.create({
            baseURL: PSN_API_BASE,
            timeout: PSN_REQUEST_TIMEOUT_MS,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'accept-language': 'en-US',
                'user-agent': 'okhttp/4.9.2',
            },
        });
    }

    /**
     * Exchange NPSSO token for an access token (JWT)
     * User gets NPSSO from: https://ca.account.sony.com/api/v1/ssocookie
     */
    static async authenticateWithNpsso(npssoToken: string): Promise<PSNAuthResult> {
        // Step 1: Get authorization code
        const authUrl = `${PSN_AUTH_BASE}/authorize`;
        const authResponse = await axios.get(authUrl, {
            headers: {
                'Cookie': `npsso=${npssoToken}`,
            },
            params: {
                access_type: 'offline',
                client_id: PSN_CLIENT_ID,
                scope: PSN_SCOPES,
                redirect_uri: PSN_REDIRECT_URI,
                response_type: 'code',
            },
            maxRedirects: 0,
            validateStatus: (status) => status === 302 || status === 303,
        });

        // Extract code from redirect URL
        const locationUrl = authResponse.headers['location'];
        if (!locationUrl) {
            throw new Error('No redirect location in auth response');
        }

        const urlParams = new URL(locationUrl).searchParams;
        const code = urlParams.get('code');
        if (!code) {
            throw new Error('No authorization code in redirect URL');
        }

        // Step 2: Exchange code for access token
        const tokenUrl = `${PSN_AUTH_BASE}/token`;
        const tokenResponse = await axios.post(tokenUrl, new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            redirect_uri: PSN_REDIRECT_URI,
            scope: PSN_SCOPES,
            token_format: 'jwt',
        }), {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${PSN_CLIENT_ID}:${PSN_CLIENT_SECRET}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        return {
            accessToken: tokenResponse.data.access_token,
            refreshToken: tokenResponse.data.refresh_token,
            expiresIn: tokenResponse.data.expires_in,
        };
    }

    /**
     * Refresh an expired access token using a refresh token
     */
    static async refreshAccessToken(refreshToken: string): Promise<PSNAuthResult> {
        const response = await axios.post(
            `${PSN_AUTH_BASE}/token`,
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                scope: PSN_SCOPES,
                token_format: 'jwt',
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${PSN_CLIENT_ID}:${PSN_CLIENT_SECRET}`).toString('base64')}`,
                },
            }
        );
        return {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresIn: response.data.expires_in,
        };
    }

    /**
     * Get the current user's PSN profile (onlineId / username)
     */
    async getMyProfile(): Promise<{ accountId: string; onlineId: string; avatarUrl?: string }> {
        // Extract accountId from JWT access token
        const parts = this.accessToken.split('.');
        if (parts.length < 2) throw new Error('Invalid access token format');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        const accountId = payload.sub || payload.account_id;
        if (!accountId) throw new Error('No accountId in token');

        // Use getProfiles (which works) instead of /users/me/profile (which returns 403)
        const profiles = await this.getProfiles([accountId]);
        if (profiles.length > 0) {
            return { accountId, onlineId: profiles[0].onlineId, avatarUrl: profiles[0].avatarUrl };
        }
        return { accountId, onlineId: 'Unknown' };
    }

    /**
     * Get list of friend account IDs
     */
    async getFriendIds(): Promise<string[]> {
        const response = await this.client.get('/users/me/friends', {
            params: { limit: 1000 },
        });
        return response.data?.friends || [];
    }

    /**
     * Get profile info for account IDs (batched, max 100 per request)
     * Note: Profiles are returned in the same order as the accountIds passed in
     */
    async getProfiles(accountIds: string[]): Promise<PSNFriend[]> {
        const profiles: PSNFriend[] = [];
        const chunkSize = PSN_BATCH_SIZE;

        for (let i = 0; i < accountIds.length; i += chunkSize) {
            const chunk = accountIds.slice(i, i + chunkSize);
            try {
                console.log(`[PSN] Fetching profiles for ${chunk.length} accounts (batch ${Math.floor(i / chunkSize) + 1})`);
                const response = await this.client.get('/users/profiles', {
                    params: { accountIds: chunk.join(',') },
                });

                const profilesData = response.data?.profiles || [];
                // Profiles are returned in the same order as accountIds
                for (let j = 0; j < profilesData.length; j++) {
                    const profile = profilesData[j];
                    profiles.push({
                        accountId: chunk[j] || profile.accountId || 'unknown',
                        onlineId: profile.onlineId || 'Unknown',
                        avatarUrl: profile.avatars?.[0]?.url,
                        isPlus: profile.isPlus || false,
                        languages: profile.languages || [],
                        aboutMe: profile.aboutMe || '',
                    });
                }
            } catch (error: any) {
                console.error(`[PSN] Failed to fetch profiles batch:`, error.response?.status, error.response?.data || error.message);
                // Add placeholders for failed batch
                for (const id of chunk) {
                    profiles.push({ accountId: id, onlineId: 'Unknown' });
                }
            }

            // Small delay between batches
            if (i + chunkSize < accountIds.length) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        return profiles;
    }

    /**
     * Get all friends with their profile info
     */
    async getFriendsWithProfiles(): Promise<PSNFriend[]> {
        const friendIds = await this.getFriendIds();
        if (friendIds.length === 0) return [];

        const profiles = await this.getProfiles(friendIds);

        // Match friend IDs with profiles
        const profileMap = new Map(profiles.map(p => [p.accountId, p]));
        return friendIds.map(id => profileMap.get(id) || { accountId: id, onlineId: 'Unknown' });
    }

    /**
     * Remove a friend by account ID
     */
    async removeFriend(accountId: string): Promise<boolean> {
        try {
            await this.client.delete(`/users/me/friends/${accountId}`);
            return true;
        } catch (error: any) {
            // If 404, friend already removed - count as success
            if (error.response?.status === 404) {
                return true;
            }
            console.error(`[PSN] Failed to remove friend:`, error.response?.status, error.message);
            return false;
        }
    }

    /**
     * Remove multiple friends with progress callback
     */
    async removeFriends(
        accountIds: string[],
        onProgress?: (current: number, total: number, username?: string) => void
    ): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        for (let i = 0; i < accountIds.length; i++) {
            const accountId = accountIds[i];
            const removed = await this.removeFriend(accountId);

            if (removed) {
                success++;
            } else {
                failed++;
            }

            if (onProgress) {
                onProgress(i + 1, accountIds.length);
            }

            // Rate limiting - be gentle with Sony's servers
            await new Promise(r => setTimeout(r, 500));
        }

        return { success, failed };
    }

    /**
     * Get presence info for multiple accounts in batch (more efficient than individual requests)
     */
    async getPresenceBatch(accountIds: string[]): Promise<Map<string, PSNPresence>> {
        const presences = new Map<string, PSNPresence>();

        try {
            // Use the batch endpoint instead of individual requests
            const response = await this.client.get('/users/basicPresences', {
                params: {
                    accountIds: accountIds.join(','),
                    type: 'primary'
                },
            });

            const presenceList = response.data?.basicPresences || [];

            for (const presenceData of presenceList) {
                if (!presenceData?.accountId) continue;

                presences.set(presenceData.accountId, {
                    onlineStatus: presenceData.primaryPlatformInfo?.onlineStatus || presenceData.onlineStatus || 'offline',
                    lastOnlineDate: presenceData.primaryPlatformInfo?.lastOnlineDate || presenceData.lastOnlineDate,
                    platform: presenceData.primaryPlatformInfo?.platform || presenceData.platform,
                    currentGame: presenceData.gameTitleInfoList?.[0]?.titleName,
                });
            }
        } catch (error: any) {
            if (error.response) {
                console.error(`[PSN] Batch presence API error:`, error.response.status, error.response.data);
            } else {
                console.error(`[PSN] Batch presence request failed:`, error.message);
            }
        }

        return presences;
    }

    /**
     * Get presence for multiple accounts with progress callback
     * Optimized: Processes in batches using the batch API endpoint
     */
    async getPresences(
        accountIds: string[],
        onProgress?: (current: number, total: number) => void
    ): Promise<Map<string, PSNPresence>> {
        const allPresences = new Map<string, PSNPresence>();
        const batchSize = PSN_BATCH_SIZE;
        let completed = 0;

        for (let i = 0; i < accountIds.length; i += batchSize) {
            const batch = accountIds.slice(i, i + batchSize);

            try {
                // Use batch endpoint instead of individual requests
                const batchPresences = await this.getPresenceBatch(batch);

                // Merge results into main map
                batchPresences.forEach((presence, accountId) => {
                    allPresences.set(accountId, presence);
                });

                // Update progress for all accounts in this batch
                completed += batch.length;
                if (onProgress) {
                    onProgress(completed, accountIds.length);
                }

                console.log(`[PSN] Batch ${Math.floor(i / batchSize) + 1}: Fetched ${batchPresences.size}/${batch.length} presences`);
            } catch (error) {
                console.error(`[PSN] Failed to fetch batch ${Math.floor(i / batchSize) + 1}:`, error);

                // Still update progress even if batch failed
                completed += batch.length;
                if (onProgress) {
                    onProgress(completed, accountIds.length);
                }
            }

            // Small delay between batches to avoid rate limiting
            if (i + batchSize < accountIds.length) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        console.log(`[PSN] Fetched presence for ${allPresences.size}/${accountIds.length} accounts`);
        return allPresences;
    }
}
