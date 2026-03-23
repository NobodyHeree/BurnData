// Global controller for browser-mode deletion jobs.
// Only one job runs at a time — no queue in browser mode.

interface JobControl {
    isPaused: boolean;
    isCancelled: boolean;
}

const jobControls = new Map<string, JobControl>();
let activeJobId: string | null = null;

export const hasActiveJob = () => activeJobId !== null;

export function registerJob(jobId: string): JobControl {
    if (activeJobId !== null) {
        throw new Error('A deletion job is already running. Wait for it to finish or stop it first.');
    }
    const control = { isPaused: false, isCancelled: false };
    jobControls.set(jobId, control);
    activeJobId = jobId;
    return control;
}

export const pauseJob = (jobId: string) => {
    const control = jobControls.get(jobId);
    if (control) control.isPaused = true;
};

export const resumeJob = (jobId: string) => {
    const control = jobControls.get(jobId);
    if (control) control.isPaused = false;
};

export function stopJob(jobId: string) {
    const control = jobControls.get(jobId);
    if (!control) return;
    control.isCancelled = true;
    control.isPaused = false;
}

export const getJobControl = (jobId: string) => jobControls.get(jobId);

export function removeJobControl(jobId: string) {
    jobControls.delete(jobId);
    if (activeJobId === jobId) activeJobId = null;
}

export function cleanupOrphanedControls(activeJobIds: Set<string>) {
    for (const jobId of jobControls.keys()) {
        if (!activeJobIds.has(jobId)) {
            jobControls.delete(jobId);
        }
    }
}

// Speed delays per deletion (ms). Discord bucket: ~5 DELETE/5s per channel.
const SPEED_DELAYS: Record<string, number> = {
    conservative: 1500,
    balanced: 1000,
    aggressive: 800,
};

export const getSpeedDelay = (speed: string) => SPEED_DELAYS[speed] ?? 1000;
