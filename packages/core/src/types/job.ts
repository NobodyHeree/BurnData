import { ContentFilter } from './filter';
import { DeletionResult } from './platform';

export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface JobProgress {
    totalItems: number;
    processedItems: number;
    deletedItems: number;
    failedItems: number;
    verifiedItems: number;
    currentSource?: string;
    currentItem?: string;
    startedAt: number;
    estimatedTimeRemaining?: number; // milliseconds
    deletionRate?: number; // items per second (moving average)
}

export interface DeletionJob {
    id: string;
    platformId: string;
    status: JobStatus;
    progress: JobProgress;
    filter?: ContentFilter;
    sourceIds: string[];
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    error?: string;
}

export type VerificationMode = 'off' | 'sample' | 'full';

export interface DeletionOptions {
    verificationMode: VerificationMode;
    exportBeforeDelete: boolean;
    exportPath?: string;
    exportFormat?: 'json' | 'csv';
    batchSize?: number;
    onProgress?: (progress: JobProgress) => void;
    onItemDeleted?: (result: DeletionResult) => void;
    signal?: AbortSignal; // For cancellation
}
