import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';

export const JobManager = () => {
    useEffect(() => {
        const removeDiscordListener = window.electronAPI?.discord.onProgress((data: any) => {
            // data matches the shape we send from main:
            // { jobId, status, progress, stats: { deleted, checked }, details }

            if (data.jobId) {
                // Determine job status based on event status string
                const jobStatus =
                    data.status === 'Completed' ? 'completed' :
                        data.status === 'Error' ? 'failed' :
                            data.status === 'Paused' ? 'paused' : 'running';

                // Check if we need to update Platform Stats (only on first transition to Completed/Failed)
                const currentJob = useAppStore.getState().jobs.find(j => j.id === data.jobId);
                const isJobFinished = jobStatus === 'completed' || jobStatus === 'failed';
                const wasJobAlreadyFinished = currentJob?.status === 'completed' || currentJob?.status === 'failed';

                if (isJobFinished && !wasJobAlreadyFinished) {
                    // Update Platform Stats
                    const currentPlatform = useAppStore.getState().platforms['discord']; // Hardcoded to discord for now, or match job.platformId
                    if (currentPlatform) {
                        const newTotal = currentPlatform.stats.totalDeleted + (data.stats?.deleted || 0);
                        useAppStore.getState().updatePlatformStats('discord', {
                            totalDeleted: newTotal,
                            lastDeletionAt: new Date().toISOString()
                        });
                    }
                }

                useAppStore.getState().updateJob(data.jobId, {
                    status: jobStatus,
                    progress: data.progress,
                    deletedItems: data.stats?.deleted || 0,
                    error: data.status === 'Error' ? data.details : undefined,
                    currentChannel: data.stats?.currentChannel,
                    speed: data.stats?.eta, // Speed from backend
                    completedAt: jobStatus === 'completed' || jobStatus === 'failed' ? new Date().toISOString() : undefined
                });
            }
        });

        // PSN unfriend progress listener
        const removePSNListener = window.electronAPI?.psn.onUnfriendProgress((data: any) => {
            // data: { jobId, current, total, removed, failed, progress, completed }
            if (data.jobId) {
                const jobStatus = data.completed ? 'completed' : 'running';

                // Check if we need to update Platform Stats (only on first transition to Completed)
                const currentJob = useAppStore.getState().jobs.find(j => j.id === data.jobId);
                const isJobFinished = jobStatus === 'completed';
                const wasJobAlreadyFinished = currentJob?.status === 'completed' || currentJob?.status === 'failed';

                if (isJobFinished && !wasJobAlreadyFinished) {
                    // Update Platform Stats
                    const currentPlatform = useAppStore.getState().platforms['psn'];
                    if (currentPlatform?.stats) {
                        const newTotal = (currentPlatform.stats.totalDeleted || 0) + data.removed;
                        useAppStore.getState().updatePlatformStats('psn', {
                            totalDeleted: newTotal,
                            lastDeletionAt: new Date().toISOString()
                        });
                    }
                }

                useAppStore.getState().updateJob(data.jobId, {
                    status: jobStatus,
                    progress: data.progress,
                    deletedItems: data.removed,
                    failedItems: data.failed,
                    completedAt: data.completed ? new Date().toISOString() : undefined
                });
            }
        });

        return () => {
            if (removeDiscordListener) removeDiscordListener();
            if (removePSNListener) removePSNListener();
        };
    }, []); // Empty deps - only mount once

    return null;
}
