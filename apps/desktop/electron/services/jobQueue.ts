import { BrowserWindow } from 'electron';
import Store from 'electron-store';
import { DiscordService, RateLimitInfo } from '@services/discord';
import { decryptString } from './encryption';

// Speed presets: [baseDelayMs, maxParallelChannels, jitterPercent]
const SPEED_PRESETS = {
    conservative: { baseDelayMs: 800, maxParallel: 1, jitterPct: 0.3 },
    balanced:     { baseDelayMs: 400, maxParallel: 2, jitterPct: 0.25 },
    aggressive:   { baseDelayMs: 200, maxParallel: 3, jitterPct: 0.2 },
} as const;

export type SpeedPreset = keyof typeof SPEED_PRESETS;

export interface PersistedJob {
    jobId: string;
    config: any;
    status: 'running' | 'paused' | 'queued';
    progress: {
        deletedCount: number;
        currentTargetIndex: number;
        lastMessageId?: string;
    };
    createdAt: string;
}

export interface DeletionController {
    active: boolean;
    cancelled: boolean;
    paused: boolean;
    currentJobId?: string;
    target?: string;
}

export interface QueuedJob {
    jobId: string;
    config: any;
    token: string;
}

export class JobQueueManager {
    private mainWindow: BrowserWindow | null = null;
    private store: Store;
    private deletionController: DeletionController;
    private jobQueue: QueuedJob[];

    constructor(store: Store) {
        this.store = store;
        this.deletionController = {
            active: false,
            cancelled: false,
            paused: false,
        };
        this.jobQueue = [];
    }

    setMainWindow(win: BrowserWindow): void {
        this.mainWindow = win;
    }

    // Deletion controller methods
    pause(): boolean {
        if (this.deletionController.active) {
            this.deletionController.paused = true;
            return true;
        }
        return false;
    }

    resume(): boolean {
        if (this.deletionController.active) {
            this.deletionController.paused = false;
            return true;
        }
        return false;
    }

    stop(): boolean {
        this.deletionController.cancelled = true;
        this.deletionController.paused = false; // Unpause to let it exit
        return true;
    }

    isActive(): boolean {
        return this.deletionController.active;
    }

    getCurrentJobId(): string | undefined {
        return this.deletionController.currentJobId;
    }

    getQueueStatus(): {
        queueLength: number;
        queuedJobs: { jobId: string; position: number }[];
        currentJobId: string | undefined;
        isActive: boolean;
    } {
        return {
            queueLength: this.jobQueue.length,
            queuedJobs: this.jobQueue.map((job, index) => ({
                jobId: job.jobId,
                position: index + 1,
            })),
            currentJobId: this.deletionController.currentJobId,
            isActive: this.deletionController.active,
        };
    }

    cancelQueuedJob(jobId: string): { success: boolean; removed: boolean; error?: string } {
        const index = this.jobQueue.findIndex(job => job.jobId === jobId);
        if (index !== -1) {
            this.jobQueue.splice(index, 1);
            console.log(`[JobQueue] Cancelled queued job ${jobId}. Queue size: ${this.jobQueue.length}`);
            return { success: true, removed: true };
        }
        return { success: false, removed: false, error: 'Job not found in queue' };
    }

    clearQueue(): { success: boolean; removed: number } {
        const count = this.jobQueue.length;
        this.jobQueue = [];
        this.saveJobState();
        console.log(`[JobQueue] Queue cleared. Removed ${count} jobs.`);
        return { success: true, removed: count };
    }

    addToQueue(jobId: string, config: any, token: string): number {
        this.jobQueue.push({ jobId, config, token });
        console.log(`[JobQueue] Job ${jobId} added to queue. Queue size: ${this.jobQueue.length}`);
        return this.jobQueue.length;
    }

    startJob(jobId: string, token: string, config: any, resumeProgress?: PersistedJob['progress']): void {
        this.deletionController.active = true;
        this.deletionController.cancelled = false;
        this.deletionController.paused = false;
        this.deletionController.currentJobId = jobId;
        this.deletionController.target = 'discord';

        this.runDeletionTask(jobId, token, config, resumeProgress);
    }

    // Save jobs and queue to electron-store
    saveJobState(): void {
        const persistedJobs = this.store.get('persistedJobs') as PersistedJob[] || [];
        const persistedQueue = this.jobQueue.map(q => ({
            jobId: q.jobId,
            config: q.config,
            // Don't save token, will fetch fresh on resume
        }));
        this.store.set('persistedQueue', persistedQueue);
        console.log(`[Persistence] Saved ${persistedJobs.length} jobs, ${persistedQueue.length} queued`);
    }

    saveJobProgress(jobId: string, config: any, status: 'running' | 'paused' | 'queued', progress: PersistedJob['progress']): void {
        let jobs = this.store.get('persistedJobs') as PersistedJob[] || [];
        const existingIndex = jobs.findIndex(j => j.jobId === jobId);

        const job: PersistedJob = {
            jobId,
            config,
            status,
            progress,
            createdAt: existingIndex >= 0 ? jobs[existingIndex].createdAt : new Date().toISOString(),
        };

        if (existingIndex >= 0) {
            jobs[existingIndex] = job;
        } else {
            jobs.push(job);
        }

        this.store.set('persistedJobs', jobs);
        console.log(`[Persistence] Saved job ${jobId} with status ${status}, deleted: ${progress.deletedCount}`);
    }

    removePersistedJob(jobId: string): void {
        let jobs = this.store.get('persistedJobs') as PersistedJob[] || [];
        jobs = jobs.filter(j => j.jobId !== jobId);
        this.store.set('persistedJobs', jobs);
        console.log(`[Persistence] Removed job ${jobId}`);

        // Also remove from in-memory queue if present
        const index = this.jobQueue.findIndex(job => job.jobId === jobId);
        if (index !== -1) {
            this.jobQueue.splice(index, 1);
            this.saveJobState();
        }
    }

    loadPersistedJobs(): PersistedJob[] {
        const jobs = this.store.get('persistedJobs') as PersistedJob[] || [];
        // Mark any 'running' jobs as 'paused' (app crashed or closed during execution)
        jobs.forEach(job => {
            if (job.status === 'running') {
                job.status = 'paused';
                console.log(`[Persistence] Marked orphaned job ${job.jobId} as paused`);
            }
        });
        this.store.set('persistedJobs', jobs);
        return jobs;
    }

    loadPersistedQueue(): { jobId: string; config: any }[] {
        return this.store.get('persistedQueue') as { jobId: string; config: any }[] || [];
    }

    recoverOrphanedJobs(): void {
        const jobs = this.loadPersistedJobs();
        if (jobs.length > 0) {
            console.log(`[Persistence] Found ${jobs.length} persisted jobs on startup`);
        }
    }

    // Process next job in queue
    async processNextQueuedJob(): Promise<void> {
        if (this.deletionController.active || this.jobQueue.length === 0) return;

        const nextJob = this.jobQueue.shift()!;
        console.log(`[JobQueue] Starting queued job ${nextJob.jobId}. Queue remaining: ${this.jobQueue.length}`);

        this.deletionController.active = true;
        this.deletionController.cancelled = false;
        this.deletionController.paused = false;
        this.deletionController.currentJobId = nextJob.jobId;
        this.deletionController.target = 'discord';

        // Notify frontend that queued job is starting
        this.mainWindow?.webContents.send('discord:deletionProgress', {
            jobId: nextJob.jobId,
            status: 'Starting',
            progress: 0,
            stats: { deleted: 0, checked: 0 },
            details: 'Job starting from queue...',
        });

        this.runDeletionTask(nextJob.jobId, nextJob.token, nextJob.config);
    }

    /**
     * Calculate the optimal delay based on rate limit headers + jitter.
     * Falls back to baseDelayMs if no header info available.
     */
    private calculateDynamicDelay(rateLimits: RateLimitInfo, preset: typeof SPEED_PRESETS[SpeedPreset]): number {
        let delayMs: number;

        if (rateLimits.remaining !== null && rateLimits.resetAfterMs !== null && rateLimits.remaining >= 0) {
            if (rateLimits.remaining === 0) {
                // Bucket exhausted — wait for reset + small buffer
                delayMs = rateLimits.resetAfterMs + 100;
            } else {
                // Spread remaining requests over the reset window
                delayMs = Math.max(rateLimits.resetAfterMs / (rateLimits.remaining + 1), preset.baseDelayMs);
            }
        } else {
            delayMs = preset.baseDelayMs;
        }

        // Apply jitter: delay ± jitterPct (e.g. ±25%)
        const jitter = delayMs * preset.jitterPct * (Math.random() * 2 - 1);
        return Math.max(50, Math.round(delayMs + jitter));
    }

    /**
     * Get the speed preset from store settings.
     */
    private getSpeedPreset(): typeof SPEED_PRESETS[SpeedPreset] {
        const speed = (this.store.get('deletionSpeed') as SpeedPreset) || 'balanced';
        return SPEED_PRESETS[speed] || SPEED_PRESETS.balanced;
    }

    /**
     * Process a single channel: scan messages, filter, and delete.
     * Returns the number of messages deleted in this channel.
     */
    private async processChannel(
        service: DiscordService,
        userId: string,
        target: { channelId: string; name: string; guildName?: string },
        config: any,
        preset: typeof SPEED_PRESETS[SpeedPreset],
        sharedState: {
            totalDeleted: number;
            cancelled: () => boolean;
            paused: () => boolean;
            onDelete: (channelName: string) => void;
            onProgress: (channelName: string, checked: number, found: number, deleted: number) => void;
        },
        preloadedMessageIds?: string[],
    ): Promise<number> {
        let channelDeleted = 0;
        let channelChecked = 0;
        let channelFound = 0;

        // Data Package mode: we already have message IDs, skip scanning
        if (preloadedMessageIds && preloadedMessageIds.length > 0) {
            for (const messageId of preloadedMessageIds) {
                if (sharedState.cancelled()) break;

                // Pause check
                while (sharedState.paused() && !sharedState.cancelled()) {
                    await new Promise(r => setTimeout(r, 500));
                }
                if (sharedState.cancelled()) break;

                channelFound++;

                try {
                    const result = await service.deleteMessageWithRateInfo(target.channelId, messageId);
                    if (result.success) {
                        channelDeleted++;
                        sharedState.onDelete(target.name);
                    }
                    const delay = this.calculateDynamicDelay(result.rateLimits, preset);
                    await new Promise(r => setTimeout(r, delay));
                } catch (e) {
                    console.error(`[Channel ${target.name}] Delete failed for ${messageId}:`, e);
                }

                if (channelFound % 5 === 0) {
                    sharedState.onProgress(target.name, channelChecked, channelFound, channelDeleted);
                }
            }
            return channelDeleted;
        }

        // Search API mode: scan + filter + delete
        let lastMsgId: string | undefined = undefined;
        let keepScanning = true;

        while (keepScanning && !sharedState.cancelled()) {
            const batch = await service.getChannelMessages(target.channelId, 100, lastMsgId);
            if (batch.length === 0) break;

            channelChecked += batch.length;
            lastMsgId = batch[batch.length - 1].id;

            sharedState.onProgress(target.name, channelChecked, channelFound, channelDeleted);

            for (const msg of batch) {
                if (sharedState.cancelled()) break;

                const msgDate = new Date(msg.timestamp);

                if (config.dateFilter?.endDate && msgDate > new Date(config.dateFilter.endDate)) continue;
                if (config.dateFilter?.startDate && msgDate < new Date(config.dateFilter.startDate)) {
                    keepScanning = false;
                    break;
                }
                if (msg.author.id !== userId) continue;

                // Pause check
                while (sharedState.paused() && !sharedState.cancelled()) {
                    await new Promise(r => setTimeout(r, 500));
                }
                if (sharedState.cancelled()) break;

                channelFound++;

                try {
                    const result = await service.deleteMessageWithRateInfo(target.channelId, msg.id);
                    if (result.success) {
                        channelDeleted++;
                        sharedState.onDelete(target.name);
                    }

                    const delay = this.calculateDynamicDelay(result.rateLimits, preset);
                    await new Promise(r => setTimeout(r, delay));
                } catch (e) {
                    console.error(`[Channel ${target.name}] Delete failed:`, e);
                }
            }

            await new Promise(r => setTimeout(r, 200));
        }

        return channelDeleted;
    }

    // Main deletion task
    async runDeletionTask(jobId: string, token: string, config: any, resumeProgress?: PersistedJob['progress']): Promise<void> {
        const startTime = Date.now();
        const preset = this.getSpeedPreset();

        const sendProgress = (status: string, progress: number, stats: { deleted: number; checked: number; currentChannel?: string; eta?: string | null }, details: string) => {
            if (stats.deleted > 0) {
                const elapsedSec = (Date.now() - startTime) / 1000;
                const rate = stats.deleted / elapsedSec;
                stats.eta = rate > 0 ? `${rate.toFixed(1)} msg/s` : null;
            }
            this.mainWindow?.webContents.send('discord:deletionProgress', {
                jobId,
                status,
                progress,
                stats,
                details,
            });
        };

        try {
            const service = new DiscordService(token);
            const user = await service.getMe();

            // 1. Resolve Targets
            let targets: { channelId: string; name: string; guildName?: string }[] = [];

            // DMs
            if (config.dms?.length > 0) {
                sendProgress('Preparing', 0, { deleted: 0, checked: 0 }, 'Fetching DM channels...');
                for (const dmId of config.dms) {
                    if (this.deletionController.cancelled) break;
                    try {
                        const channel = await service.getChannel(dmId);
                        const recipientName = channel.recipients?.[0]?.username || channel.name || `DM ${dmId}`;
                        targets.push({ channelId: dmId, name: recipientName });
                    } catch (e) {
                        targets.push({ channelId: dmId, name: `DM (${dmId})` });
                    }
                }
            }

            // Guilds
            if (config.guilds?.length > 0) {
                for (const guildId of config.guilds) {
                    if (this.deletionController.cancelled) break;
                    sendProgress('Preparing', 0, { deleted: 0, checked: 0 }, `Fetching channels for ${guildId}...`);
                    const channels = await service.getGuildChannels(guildId);
                    const textChannels = channels.filter((c: any) => c.type === 0);
                    textChannels.forEach((c: any) => {
                        if (config.mode === 'advanced' && !config.selectedChannels?.includes(c.id)) return;
                        targets.push({ channelId: c.id, name: c.name || 'Unknown', guildName: `Guild ${guildId}` });
                    });
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            if (targets.length === 0) {
                sendProgress('Completed', 100, { deleted: 0, checked: 0 }, 'No targets found based on selection.');
                this.deletionController.active = false;
                this.removePersistedJob(jobId);
                return;
            }

            sendProgress('Starting', 0, { deleted: 0, checked: 0 }, `Found ${targets.length} channels to process (${preset.maxParallel} parallel, dynamic rate limiting)`);

            // Resume state
            let totalDeleted = resumeProgress?.deletedCount || 0;
            const startTargetIndex = resumeProgress?.currentTargetIndex || 0;

            // Build preloaded message IDs map if data package was imported
            const preloadedMap: Map<string, string[]> | undefined = config.dataPackageMessages
                ? new Map(Object.entries(config.dataPackageMessages as Record<string, string[]>))
                : undefined;

            // Shared mutable state for parallel workers
            const sharedState = {
                totalDeleted,
                cancelled: () => this.deletionController.cancelled,
                paused: () => this.deletionController.paused,
                onDelete: (channelName: string) => {
                    sharedState.totalDeleted++;
                    totalDeleted = sharedState.totalDeleted;

                    const elapsedSec = (Date.now() - startTime) / 1000;
                    const rate = totalDeleted / elapsedSec;
                    const etaStr = rate > 0 ? `${rate.toFixed(1)} msg/s` : null;

                    sendProgress('Deleting', -1, {
                        deleted: totalDeleted,
                        checked: 0,
                        currentChannel: channelName,
                        eta: etaStr,
                    }, `Deleting... (${totalDeleted} deleted @ ${rate.toFixed(1)}/s)`);

                    // Save progress periodically
                    if (totalDeleted % 10 === 0) {
                        this.saveJobProgress(jobId, config, 'running', {
                            deletedCount: totalDeleted,
                            currentTargetIndex: startTargetIndex,
                        });
                    }
                },
                onProgress: (channelName: string, checked: number, found: number, deleted: number) => {
                    sendProgress('Scanning', -1, {
                        deleted: totalDeleted,
                        checked,
                        currentChannel: channelName,
                    }, `Scanning #${channelName} (Found: ${found}, Deleted: ${deleted})`);
                },
            };

            // 2. Process channels in parallel batches
            const remainingTargets = targets.slice(startTargetIndex);
            const maxParallel = preset.maxParallel;

            for (let i = 0; i < remainingTargets.length; i += maxParallel) {
                if (this.deletionController.cancelled) break;

                // Pause check at batch level
                while (this.deletionController.paused && !this.deletionController.cancelled) {
                    this.saveJobProgress(jobId, config, 'paused', {
                        deletedCount: totalDeleted,
                        currentTargetIndex: startTargetIndex + i,
                    });
                    sendProgress('Paused', -1, { deleted: totalDeleted, checked: 0, eta: null }, 'Job Paused. Waiting...');
                    await new Promise(r => setTimeout(r, 1000));
                }

                const batch = remainingTargets.slice(i, i + maxParallel);
                const promises = batch.map(target => {
                    const preloadedIds = preloadedMap?.get(target.channelId);
                    return this.processChannel(service, user.id, target, config, preset, sharedState, preloadedIds);
                });

                await Promise.all(promises);
            }

            sendProgress('Completed', 100, { deleted: totalDeleted, checked: 0 }, `Done! Deleted ${totalDeleted} messages across ${targets.length} channels.`);
            this.removePersistedJob(jobId);

        } catch (err: any) {
            if (err?.config?.headers?.['Authorization']) {
                err.config.headers['Authorization'] = '[REDACTED]';
            }
            console.error('Deletion Exception:', err instanceof Error ? err.message : err);
            sendProgress('Error', 0, { deleted: 0, checked: 0 }, `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            this.deletionController.active = false;
            this.deletionController.currentJobId = undefined;

            if (this.jobQueue.length > 0) {
                console.log(`[JobQueue] Job completed. Processing next queued job...`);
                setTimeout(() => this.processNextQueuedJob(), 1000);
            }
        }
    }
}
