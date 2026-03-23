// Global controller for browser-mode deletion jobs
// Allows Pause/Resume/Stop from the Jobs page

interface JobControl {
    isPaused: boolean;
    isCancelled: boolean;
}

const jobControls = new Map<string, JobControl>();

// Only one browser job can run at a time (no queue in browser mode)
let activeJobId: string | null = null;

export function hasActiveJob(): boolean {
    return activeJobId !== null;
}

export function registerJob(jobId: string): JobControl {
    if (activeJobId !== null) {
        throw new Error('A deletion job is already running. Wait for it to finish or stop it first.');
    }
    const control = { isPaused: false, isCancelled: false };
    jobControls.set(jobId, control);
    activeJobId = jobId;
    return control;
}

export function pauseJob(jobId: string) {
    const control = jobControls.get(jobId);
    if (control) control.isPaused = true;
}

export function resumeJob(jobId: string) {
    const control = jobControls.get(jobId);
    if (control) control.isPaused = false;
}

export function stopJob(jobId: string) {
    const control = jobControls.get(jobId);
    if (control) {
        control.isCancelled = true;
        control.isPaused = false; // unblock if paused
    }
}

export function getJobControl(jobId: string): JobControl | undefined {
    return jobControls.get(jobId);
}

export function removeJobControl(jobId: string) {
    jobControls.delete(jobId);
    if (activeJobId === jobId) activeJobId = null;
}

// Auto-cleanup: remove controls for jobs that no longer exist
export function cleanupOrphanedControls(activeJobIds: Set<string>) {
    for (const jobId of jobControls.keys()) {
        if (!activeJobIds.has(jobId)) {
            jobControls.delete(jobId);
        }
    }
}

// Speed delays in ms per deletion
// Discord rate limit: ~5 DELETE/5s per channel
// Conservative: safe, no rate limits expected
// Balanced: occasional rate limits, auto-retry handles them
// Aggressive: frequent rate limits but faster overall, higher ban risk
export function getSpeedDelay(speed: 'conservative' | 'balanced' | 'aggressive'): number {
    switch (speed) {
        case 'conservative': return 1500;
        case 'balanced': return 1000;
        case 'aggressive': return 800;
        default: return 1000;
    }
}
