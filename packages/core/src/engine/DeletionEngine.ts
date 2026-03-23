import { EventEmitter } from 'events';
import {
    PlatformAdapter,
    ContentItem,
    DeletionResult,
    DeletionJob,
    DeletionOptions,
    JobProgress,
    JobStatus,
    ContentFilter,
} from '../types';
import { RateLimiter } from './RateLimiter';
import { Exporter, ExportStream } from './Exporter';

/**
 * Generic deletion orchestrator that works with any PlatformAdapter.
 * Implements the full lifecycle: scan -> filter -> optional export -> delete -> optional verify.
 * Supports pause/resume/cancel, progress tracking with moving-average ETA.
 */
export class DeletionEngine extends EventEmitter {
    private adapter: PlatformAdapter;
    private rateLimiter: RateLimiter;
    private paused: boolean = false;
    private cancelled: boolean = false;
    private pauseResolve: (() => void) | null = null;

    /** Ring buffer of recent deletion timestamps for moving average rate calculation. */
    private recentDeletionTimestamps: number[] = [];
    private static readonly MOVING_AVERAGE_WINDOW = 20;

    constructor(adapter: PlatformAdapter) {
        super();
        this.adapter = adapter;
        const rateLimitInfo = adapter.getRateLimitInfo();
        this.rateLimiter = new RateLimiter(rateLimitInfo.requestsPerSecond, rateLimitInfo.burstLimit);
    }

    /**
     * Run a deletion job across the given sources.
     * Returns a completed DeletionJob with final stats.
     */
    async run(
        sourceIds: string[],
        options: DeletionOptions,
        filter?: ContentFilter,
    ): Promise<DeletionJob> {
        this.paused = false;
        this.cancelled = false;
        this.recentDeletionTimestamps = [];

        const now = Date.now();
        const jobId = `job_${now}_${Math.random().toString(36).slice(2, 10)}`;

        const progress: JobProgress = {
            totalItems: 0,
            processedItems: 0,
            deletedItems: 0,
            failedItems: 0,
            verifiedItems: 0,
            startedAt: now,
        };

        const job: DeletionJob = {
            id: jobId,
            platformId: this.adapter.info.id,
            status: 'running',
            progress,
            filter,
            sourceIds,
            createdAt: now,
            updatedAt: now,
        };

        this.emit('job:start', job);

        try {
            // Count total items across all sources for progress tracking
            for (const sourceId of sourceIds) {
                await this.waitIfPaused();
                if (this.cancelled) break;
                const count = await this.adapter.getContentCount(sourceId, filter);
                progress.totalItems += count;
            }

            this.emitProgress(job, options);

            // Set up export stream if needed
            let exportStream: ExportStream | null = null;
            if (options.exportBeforeDelete && options.exportPath) {
                const format = options.exportFormat ?? 'json';
                exportStream = Exporter.createExportStream(options.exportPath, format);
            }

            // Process each source
            for (const sourceId of sourceIds) {
                if (this.cancelled) break;

                progress.currentSource = sourceId;
                this.emitProgress(job, options);

                const scanner = this.adapter.scanContent(sourceId, filter);

                for await (const batch of scanner) {
                    if (this.cancelled) break;

                    // Export batch before deleting if requested
                    if (exportStream) {
                        await exportStream.write(batch);
                    }

                    // Process each item in the batch
                    for (const item of batch) {
                        if (this.cancelled) break;

                        await this.waitIfPaused();
                        if (this.cancelled) break;

                        progress.currentItem = item.id;

                        // Acquire rate limit token
                        await this.rateLimiter.acquire();

                        // Delete the item
                        const result = await this.adapter.deleteItem(item);
                        progress.processedItems++;

                        if (result.success) {
                            progress.deletedItems++;

                            // Record timestamp for moving average
                            this.recordDeletion();

                            // Verify deletion based on verification mode
                            const shouldVerify = this.shouldVerify(options, progress.processedItems);
                            if (shouldVerify) {
                                await this.rateLimiter.acquire();
                                const verified = await this.adapter.verifyDeletion(item);
                                result.verified = verified;
                                if (verified) {
                                    progress.verifiedItems++;
                                }
                            }
                        } else {
                            progress.failedItems++;
                        }

                        // Update rate and ETA
                        progress.deletionRate = this.calculateRate();
                        progress.estimatedTimeRemaining = this.calculateETA(progress);

                        // Notify callbacks
                        if (options.onItemDeleted) {
                            options.onItemDeleted(result);
                        }
                        this.emit('item:deleted', result);
                        this.emitProgress(job, options);
                    }
                }
            }

            // Close export stream
            if (exportStream) {
                await exportStream.close();
            }

            // Finalize job status
            if (this.cancelled) {
                job.status = 'cancelled';
            } else if (progress.failedItems > 0 && progress.deletedItems === 0) {
                job.status = 'failed';
            } else {
                job.status = 'completed';
            }
        } catch (error) {
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : String(error);
            this.emit('job:error', job, error);
        }

        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        progress.currentSource = undefined;
        progress.currentItem = undefined;

        this.emit('job:complete', job);
        return job;
    }

    /**
     * Pause the deletion engine. Processing will halt at the next safe point.
     */
    pause(): void {
        this.paused = true;
        this.emit('job:paused');
    }

    /**
     * Resume the deletion engine after a pause.
     */
    resume(): void {
        this.paused = false;
        if (this.pauseResolve) {
            this.pauseResolve();
            this.pauseResolve = null;
        }
        this.emit('job:resumed');
    }

    /**
     * Cancel the current deletion job.
     */
    cancel(): void {
        this.cancelled = true;
        this.resume(); // Unblock if paused
        this.emit('job:cancelled');
    }

    /**
     * Block execution while the engine is paused.
     */
    private async waitIfPaused(): Promise<void> {
        if (this.paused) {
            return new Promise<void>((resolve) => {
                this.pauseResolve = resolve;
            });
        }
    }

    /**
     * Determine whether to verify a deletion based on the verification mode.
     * - off: never verify
     * - sample: verify every 10th item
     * - full: verify every item
     */
    private shouldVerify(options: DeletionOptions, itemIndex: number): boolean {
        switch (options.verificationMode) {
            case 'off':
                return false;
            case 'sample':
                return itemIndex % 10 === 0;
            case 'full':
                return true;
            default:
                return false;
        }
    }

    /**
     * Record a deletion timestamp for moving average rate calculation.
     */
    private recordDeletion(): void {
        this.recentDeletionTimestamps.push(Date.now());
        if (this.recentDeletionTimestamps.length > DeletionEngine.MOVING_AVERAGE_WINDOW) {
            this.recentDeletionTimestamps.shift();
        }
    }

    /**
     * Calculate the current deletion rate as items per second using a moving average
     * over the last MOVING_AVERAGE_WINDOW deletions.
     */
    private calculateRate(): number {
        const timestamps = this.recentDeletionTimestamps;
        if (timestamps.length < 2) {
            return 0;
        }
        const oldest = timestamps[0];
        const newest = timestamps[timestamps.length - 1];
        const elapsedSeconds = (newest - oldest) / 1000;
        if (elapsedSeconds <= 0) {
            return 0;
        }
        return (timestamps.length - 1) / elapsedSeconds;
    }

    /**
     * Calculate estimated time remaining in milliseconds.
     * Uses the moving average deletion rate.
     */
    private calculateETA(progress: JobProgress): number | undefined {
        const rate = this.calculateRate();
        if (rate <= 0 || progress.totalItems <= 0) {
            return undefined;
        }
        const remaining = progress.totalItems - progress.processedItems;
        if (remaining <= 0) {
            return 0;
        }
        return Math.round((remaining / rate) * 1000);
    }

    /**
     * Emit progress update via event and callback.
     */
    private emitProgress(job: DeletionJob, options: DeletionOptions): void {
        job.updatedAt = Date.now();
        if (options.onProgress) {
            options.onProgress({ ...job.progress });
        }
        this.emit('job:progress', { ...job.progress });
    }
}
