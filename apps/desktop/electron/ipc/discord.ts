import { BrowserWindow, ipcMain, session, dialog } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Store from 'electron-store';
import { DiscordService } from '@services/discord';
import { encryptString, decryptString } from '../services/encryption';
import { JobQueueManager } from '../services/jobQueue';
import { validateIPC, schemas } from '../utils/validate';

function getDiscordService(store: Store): DiscordService {
    const encrypted = store.get('tokens.discord') as string;
    if (!encrypted) throw new Error('No Discord token found. Please log in again.');
    const token = decryptString(encrypted);
    return new DiscordService(token);
}

export function registerDiscordHandlers(
    mainWindow: BrowserWindow,
    store: Store,
    jobManager: JobQueueManager
): void {
    // Login via network interception
    ipcMain.handle('discord:login', async () => {
        const partition = 'persist:discord_auth';
        const discordSession = session.fromPartition(partition);

        console.log('[Discord] Starting login flow...');

        return new Promise((resolve) => {
            let resolved = false;

            const loginWindow = new BrowserWindow({
                width: 450,
                height: 700,
                parent: mainWindow || undefined,
                modal: true,
                show: false,
                resizable: false,
                webPreferences: {
                    partition,
                    nodeIntegration: false,
                    contextIsolation: true,
                },
            });

            const cleanup = () => {
                resolved = true;
                if (!loginWindow.isDestroyed()) {
                    loginWindow.close();
                }
                discordSession.webRequest.onBeforeSendHeaders(null);
            };

            const filter = {
                urls: ['https://discord.com/api/*'],
            };

            discordSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
                if (resolved) {
                    callback({ cancel: false, requestHeaders: details.requestHeaders });
                    return;
                }

                const authHeader = details.requestHeaders['Authorization'];

                if (authHeader && typeof authHeader === 'string' && authHeader.length > 50) {
                    console.log('[Discord] Authorization header captured (encrypted in memory)');

                    resolved = true;
                    if (loginWindow.isVisible()) {
                        loginWindow.hide();
                    }

                    resolve({ success: true, token: authHeader });
                    setTimeout(cleanup, 100);
                }

                callback({ cancel: false, requestHeaders: details.requestHeaders });
            });

            loginWindow.loadURL('https://discord.com/login');

            loginWindow.once('ready-to-show', () => {
                if (!resolved) {
                    console.log('[Discord] Showing login window...');
                    loginWindow.show();
                }
            });

            loginWindow.on('closed', () => {
                if (!resolved) {
                    resolve({ success: false, error: 'Login cancelled' });
                }
            });

            // Timeout 5 minutes
            setTimeout(() => {
                if (!resolved) {
                    console.log('[Discord] Login timeout');
                    resolve({ success: false, error: 'Login timeout' });
                    cleanup();
                }
            }, 5 * 60 * 1000);
        });
    });

    // Logout
    ipcMain.handle('discord:logout', async () => {
        const discordSession = session.fromPartition('persist:discord_auth');
        await discordSession.clearStorageData();
        store.delete('tokens.discord');
        return true;
    });

    // Get Guilds
    ipcMain.handle('discord:getGuilds', async () => {
        try {
            const service = getDiscordService(store);
            const guilds = await service.getGuilds();
            console.log(`[Discord] Fetched ${guilds.length} guilds`);
            return guilds;
        } catch (err) {
            console.error('[Discord] Failed to fetch guilds:', err);
            throw err;
        }
    });

    // Get DMs
    ipcMain.handle('discord:getDMs', async () => {
        try {
            const service = getDiscordService(store);
            const dms = await service.getDMChannels();
            console.log(`[Discord] Fetched ${dms.length} DMs`);
            return dms;
        } catch (err) {
            console.error('[Discord] Failed to fetch DMs:', err);
            throw err;
        }
    });

    // Get Guild Channels
    ipcMain.handle('discord:getGuildChannels', async (_, guildId: unknown) => {
        const validGuildId = validateIPC(schemas.discordGuildId, guildId, 'discord:getGuildChannels');
        try {
            const service = getDiscordService(store);
            const channels = await service.getGuildChannels(validGuildId);
            console.log(`[Discord] Fetched ${channels.length} channels for guild ${validGuildId}`);
            return channels;
        } catch (err) {
            console.error(`[Discord] Failed to fetch channels for guild ${validGuildId}:`, err);
            throw err;
        }
    });

    // Create DM
    ipcMain.handle('discord:createDM', async (_, userId: unknown) => {
        const validUserId = validateIPC(schemas.discordUserId, userId, 'discord:createDM');
        try {
            const service = getDiscordService(store);

            const channel = await service.createDMChannel(validUserId);
            console.log(`[Discord] Created/Retrieved DM channel ${channel.id} for user ${validUserId}`);

            return {
                success: true,
                channel: {
                    id: channel.id,
                    name: channel.recipients?.[0]?.username || `User ${userId}`,
                    recipients: channel.recipients,
                },
            };
        } catch (err: any) {
            console.error(`[Discord] Failed to create DM with user ${validUserId}:`, err);
            return {
                success: false,
                error: err.response?.data?.message || err.message || 'Failed to create DM',
            };
        }
    });

    // Deletion control
    ipcMain.handle('discord:startDeletion', async (_, config: unknown) => {
        const validConfig = validateIPC(schemas.discordDeletionConfig, config, 'discord:startDeletion');
        const jobId = crypto.randomUUID();

        // Get token first
        const encrypted = store.get('tokens.discord') as string;
        if (!encrypted) {
            console.error('[BackgroundJob] Start failed: No token found in store');
            throw new Error('No authentication token found. Please log in again.');
        }

        let token: string;
        try {
            token = decryptString(encrypted);
        } catch (err) {
            console.error('[BackgroundJob] Token decryption failed:', err);
            throw new Error('Failed to decrypt authentication token. Please log out and back in.');
        }

        // If a job is already running, add to queue
        if (jobManager.isActive()) {
            const queuePosition = jobManager.addToQueue(jobId, validConfig, token);
            console.log(`[BackgroundJob] Queued Job ${jobId}`);
            return { success: true, jobId, queued: true, queuePosition };
        }

        // Start immediately
        console.log(`[BackgroundJob] Starting Job ${jobId}`);
        jobManager.startJob(jobId, token, validConfig);

        return { success: true, jobId, queued: false };
    });

    ipcMain.handle('discord:stopDeletion', async () => {
        return jobManager.stop();
    });

    ipcMain.handle('discord:pauseDeletion', async () => {
        return jobManager.pause();
    });

    ipcMain.handle('discord:resumeDeletion', async () => {
        return jobManager.resume();
    });

    // Queue management
    ipcMain.handle('discord:getQueueStatus', async () => {
        return jobManager.getQueueStatus();
    });

    ipcMain.handle('discord:cancelQueuedJob', async (_, jobId: string) => {
        return jobManager.cancelQueuedJob(jobId);
    });

    ipcMain.handle('discord:clearQueue', async () => {
        return jobManager.clearQueue();
    });

    // Persisted jobs (survive app restart)
    ipcMain.handle('discord:getPersistedJobs', async () => {
        const jobs = jobManager.loadPersistedJobs();
        const queue = jobManager.loadPersistedQueue();
        return { jobs, queue };
    });

    ipcMain.handle('discord:resumeJob', async (_, jobId: string) => {
        // Find the persisted job
        const jobs = store.get('persistedJobs') as any[] || [];
        const job = jobs.find((j: any) => j.jobId === jobId);

        if (!job) {
            return { success: false, error: 'Job not found' };
        }

        // Get token
        const encrypted = store.get('tokens.discord') as string;
        if (!encrypted) {
            return { success: false, error: 'No Discord token found' };
        }

        let token: string;
        try {
            token = decryptString(encrypted);
        } catch (err) {
            return { success: false, error: 'Failed to decrypt token' };
        }

        // If another job is running, queue this one
        if (jobManager.isActive()) {
            const queuePosition = jobManager.addToQueue(jobId, job.config, token);
            jobManager.saveJobProgress(jobId, job.config, 'queued', job.progress);
            jobManager.saveJobState();
            console.log(`[JobQueue] Resumed job ${jobId} added to queue. Queue size: ${queuePosition}`);
            return { success: true, queued: true, queuePosition };
        }

        // Start the job now
        jobManager.saveJobProgress(jobId, job.config, 'running', job.progress);

        console.log(`[JobQueue] Resuming job ${jobId} from progress: deleted=${job.progress.deletedCount}, target=${job.progress.currentTargetIndex}`);

        // Run with resume info
        jobManager.startJob(jobId, token, job.config, job.progress);

        return { success: true, queued: false };
    });

    ipcMain.handle('discord:cancelPersistedJob', async (_, jobId: string) => {
        jobManager.removePersistedJob(jobId);
        return { success: true };
    });

    // Data package import (ZIP)
    ipcMain.handle('discord:importDataPackage', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Import Discord Data Package',
            filters: [
                { name: 'ZIP files', extensions: ['zip'] },
            ],
            properties: ['openFile'],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Cancelled' };
        }

        const zipPath = result.filePaths[0];

        try {
            // Use yauzl (already a dependency via electron-builder) to read the zip
            const yauzl = require('yauzl');

            const entries = await new Promise<Map<string, string>>((resolve, reject) => {
                const fileContents = new Map<string, string>();
                yauzl.open(zipPath, { lazyEntries: true }, (err: Error, zipfile: any) => {
                    if (err) return reject(err);

                    zipfile.readEntry();
                    zipfile.on('entry', (entry: any) => {
                        const fileName: string = entry.fileName;

                        // Support both old (messages/c*/messages.csv) and new (Messages/c*/messages.json) formats
                        const isIndex = /[Mm]essages\/index\.json$/.test(fileName);
                        const isMsgCsv = /[Mm]essages\/c?\d+\/messages\.(csv|json)$/.test(fileName);

                        if (isIndex || isMsgCsv) {
                            zipfile.openReadStream(entry, (err2: Error, readStream: any) => {
                                if (err2) return reject(err2);
                                const chunks: Buffer[] = [];
                                readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
                                readStream.on('end', () => {
                                    fileContents.set(fileName, Buffer.concat(chunks).toString('utf-8'));
                                    zipfile.readEntry();
                                });
                            });
                        } else {
                            zipfile.readEntry();
                        }
                    });
                    zipfile.on('end', () => resolve(fileContents));
                    zipfile.on('error', reject);
                });
            });

            // Parse index.json to get channel names
            let indexData: Record<string, string> = {};
            for (const [name, content] of entries) {
                if (/[Mm]essages\/index\.json$/.test(name)) {
                    indexData = JSON.parse(content);
                    break;
                }
            }

            // Parse each messages.csv to extract message IDs per channel
            const channelMessages: Record<string, { channelId: string; name: string; messageIds: string[]; count: number }> = {};

            for (const [filePath, content] of entries) {
                const match = filePath.match(/[Mm]essages\/c?(\d+)\/messages\.(csv|json)$/);
                if (!match) continue;

                const channelId = match[1];
                const fileType = match[2];
                const channelName = indexData[channelId] || `Channel ${channelId}`;
                const messageIds: string[] = [];

                if (fileType === 'json') {
                    try {
                        const messages = JSON.parse(content);
                        if (Array.isArray(messages)) {
                            for (const msg of messages) {
                                const id = msg.ID || msg.id || msg.Id;
                                if (id && /^\d+$/.test(String(id))) {
                                    messageIds.push(String(id));
                                }
                            }
                        }
                    } catch { /* skip */ }
                } else {
                    const lines = content.split('\n');
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const firstComma = line.indexOf(',');
                        if (firstComma > 0) {
                            const id = line.substring(0, firstComma);
                            if (/^\d+$/.test(id)) messageIds.push(id);
                        }
                    }
                }

                if (messageIds.length > 0) {
                    channelMessages[channelId] = {
                        channelId,
                        name: channelName,
                        messageIds,
                        count: messageIds.length,
                    };
                }
            }

            const totalMessages = Object.values(channelMessages).reduce((sum, ch) => sum + ch.count, 0);
            const channelCount = Object.keys(channelMessages).length;

            console.log(`[DataPackage] Parsed ${totalMessages} messages across ${channelCount} channels`);

            return {
                success: true,
                channels: channelMessages,
                totalMessages,
                channelCount,
            };
        } catch (err: any) {
            console.error('[DataPackage] Import failed:', err);
            return { success: false, error: err.message || 'Failed to parse data package' };
        }
    });
}
