import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Clock, CheckCircle, XCircle, Loader2, Flame, AlertCircle, Pause, Play, Square } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { pauseJob, resumeJob as resumeBrowserJob, stopJob, removeJobControl, cleanupOrphanedControls } from '../store/browserJobController';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.discord;

const platformMeta: Record<string, { color: string; name: string }> = {
    discord: { color: '#5865F2', name: 'Discord' },
    psn: { color: '#003791', name: 'PlayStation Network' },
};

const statusConfig = {
    completed: {
        icon: CheckCircle,
        color: 'text-burn-green',
        bg: 'rgba(0,255,136,0.1)',
        label: 'Completed'
    },
    running: {
        icon: Loader2,
        color: 'text-fire',
        bg: 'rgba(255,59,0,0.1)',
        label: 'Burning'
    },
    failed: {
        icon: XCircle,
        color: 'text-burn-red',
        bg: 'rgba(255,59,59,0.1)',
        label: 'Failed'
    },
    pending: {
        icon: Clock,
        color: 'text-gold',
        bg: 'rgba(255,184,0,0.1)',
        label: 'Pending'
    },
    paused: {
        icon: AlertCircle,
        color: 'text-burn-muted',
        bg: 'rgba(140,122,80,0.1)',
        label: 'Paused'
    },
    queued: {
        icon: Clock,
        color: 'text-gold',
        bg: 'rgba(255,184,0,0.1)',
        label: 'Queued'
    }
};

export function Jobs() {
    const jobs = useAppStore((state) => state.jobs);

    const clearCompletedJobs = useAppStore((state) => state.clearCompletedJobs);
    const updateJob = useAppStore(state => state.updateJob);
    const removeJob = useAppStore(state => state.removeJob);

    const handlePause = async (jobId: string) => {
        if (isElectron) {
            await window.electronAPI!.discord.pauseDeletion();
        } else {
            pauseJob(jobId);
        }
        updateJob(jobId, { status: 'paused' });
    };

    const handleResume = async (jobId: string) => {
        if (isElectron) {
            const result = await window.electronAPI!.discord.resumeJob(jobId);
            if (result.success) {
                updateJob(jobId, { status: result.queued ? 'queued' : 'running' });
            }
        } else {
            resumeBrowserJob(jobId);
            updateJob(jobId, { status: 'running' });
        }
    };

    const handleStop = async (jobId: string) => {
        if (isElectron) {
            await window.electronAPI!.discord.stopDeletion();
        } else {
            stopJob(jobId);
            removeJobControl(jobId);
        }
        updateJob(jobId, { status: 'failed', error: 'Stopped by user' });
    };

    const handleCancelQueued = async (jobId: string) => {
        if (isElectron) {
            await window.electronAPI!.discord.cancelQueuedJob(jobId);
            await window.electronAPI!.discord.cancelPersistedJob(jobId);
        }
        removeJob(jobId);
    };

    const handleForceRemove = async (jobId: string) => {
        if (isElectron) {
            await window.electronAPI!.discord.cancelPersistedJob(jobId);
        } else {
            stopJob(jobId);
            removeJobControl(jobId);
        }
        removeJob(jobId);
    };

    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const location = useLocation();

    useEffect(() => {
        if (location.state?.jobStarted) {
            if (location.state?.queued) {
                setToastMessage(`Job added to queue (position #${location.state.queuePosition})`);
            } else {
                setToastMessage('Burn job started!');
            }
            const timer = setTimeout(() => setToastMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [location.state]);

    // Sweep orphaned browser job controls on mount
    useEffect(() => {
        const activeIds = new Set(jobs.map(j => j.id));
        cleanupOrphanedControls(activeIds);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const completedCount = jobs.filter(j => j.status === 'completed').length;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-display text-4xl text-burn-cream tracking-wide mb-2">Burn Jobs</h1>
                    <p className="text-burn-muted">Track the progress of your burn tasks</p>
                </div>
                {completedCount > 0 && (
                    <button
                        onClick={clearCompletedJobs}
                        className="btn-secondary text-sm"
                    >
                        Clear Completed ({completedCount})
                    </button>
                )}
            </div>

            {/* Jobs List */}
            {jobs.length > 0 ? (
                <div className="space-y-4">
                    {jobs.map((job) => {
                        const status = statusConfig[job.status as keyof typeof statusConfig];
                        const StatusIcon = status.icon;
                        const progress = job.progress !== undefined ? job.progress : (job.totalItems > 0
                            ? Math.round((job.deletedItems / job.totalItems) * 100)
                            : 0);
                        const platform = platformMeta[job.platformId];

                        return (
                            <motion.div
                                key={job.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="glass-card p-6"
                            >
                                {/* Job Header */}
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="p-2"
                                            style={{ backgroundColor: `${platform?.color}15` }}
                                        >
                                            <Flame className="w-5 h-5" style={{ color: platform?.color }} />
                                        </div>
                                        <div>
                                            <h3 className="font-heading font-black text-burn-cream uppercase tracking-wider">
                                                {platform?.name || job.platformId} {job.platformId === 'psn' ? 'Unfriend' : 'Burn'}
                                            </h3>
                                            <p className="text-sm text-burn-muted font-mono">
                                                Started {new Date(job.startedAt).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: status.bg }}>
                                        <StatusIcon
                                            className={`w-4 h-4 ${status.color} ${job.status === 'running' ? 'animate-spin' : ''}`}
                                        />
                                        <span className={`text-sm font-bold uppercase tracking-wider ${status.color}`}>
                                            {status.label}
                                            {job.status === 'running' && job.currentChannel && ` (${job.currentChannel})`}
                                        </span>
                                    </div>
                                </div>

                                {/* Phase indicator */}
                                {job.status === 'running' && job.currentChannel && (
                                    <div className={`mb-4 flex items-center gap-3 px-4 py-3 border ${
                                        job.currentChannel.toLowerCase().includes('scan') || job.currentChannel.toLowerCase().includes('loading')
                                            ? 'border-gold/20'
                                            : 'border-fire/20'
                                    }`} style={{
                                        background: job.currentChannel.toLowerCase().includes('scan') || job.currentChannel.toLowerCase().includes('loading')
                                            ? 'rgba(255,184,0,0.08)' : 'rgba(255,59,0,0.08)'
                                    }}>
                                        <Loader2 className={`w-4 h-4 animate-spin ${
                                            job.currentChannel.toLowerCase().includes('scan') || job.currentChannel.toLowerCase().includes('loading')
                                                ? 'text-gold'
                                                : 'text-fire'
                                        }`} />
                                        <span className={`text-sm font-bold ${
                                            job.currentChannel.toLowerCase().includes('scan') || job.currentChannel.toLowerCase().includes('loading')
                                                ? 'text-gold'
                                                : 'text-fire'
                                        }`}>
                                            {job.currentChannel}
                                            {job.currentChannel.toLowerCase().includes('scan') && job.totalItems > 0 && (
                                                <span className="text-burn-muted font-normal ml-2">
                                                    ({job.totalItems.toLocaleString()} messages found)
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                )}

                                {/* Progress Bar */}
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-burn-muted font-bold uppercase tracking-wider">
                                            {job.status === 'paused' ? 'Paused' : progress < 0 ? 'Burning...' : 'Progress'}
                                        </span>
                                        {job.status === 'paused' ? (
                                            <span className="text-sm font-bold text-burn-muted font-mono">
                                                {job.deletedItems} burned
                                            </span>
                                        ) : progress >= 0 ? (
                                            <span className="text-sm font-bold text-burn-cream font-mono">{progress}%</span>
                                        ) : (
                                            <span className="text-sm font-bold text-burn-green font-mono">
                                                {job.deletedItems} burned
                                            </span>
                                        )}
                                    </div>
                                    <div className="h-2 bg-dark-900 overflow-hidden">
                                        {job.status === 'paused' ? (
                                            <div
                                                className="h-full opacity-50"
                                                style={{
                                                    width: progress >= 0 ? `${progress}%` : '100%',
                                                    background: '#6b5a38'
                                                }}
                                            />
                                        ) : progress >= 0 ? (
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${progress}%` }}
                                                transition={{ duration: 0.5, ease: 'easeOut' }}
                                                className="h-full"
                                                style={{
                                                    background: `linear-gradient(90deg, #FF3B00, #FFB800)`
                                                }}
                                            />
                                        ) : (
                                            <div className="relative h-full w-full overflow-hidden">
                                                <motion.div
                                                    animate={{ x: ['0%', '100%'] }}
                                                    transition={{
                                                        duration: 1,
                                                        repeat: Infinity,
                                                        ease: 'linear',
                                                        repeatType: 'loop'
                                                    }}
                                                    className="absolute h-full w-full"
                                                    style={{
                                                        background: `linear-gradient(90deg, transparent 0%, rgba(255,59,0,0.4) 20%, #FF3B00 50%, rgba(255,59,0,0.4) 80%, transparent 100%)`
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="flex items-center gap-6 text-sm font-mono">
                                    <div>
                                        <span className="text-burn-muted">Targets: </span>
                                        <span className="text-burn-cream font-bold">{job.totalItems.toLocaleString()}</span>
                                    </div>
                                    <div>
                                        <span className="text-burn-muted">{job.platformId === 'psn' ? 'Removed: ' : 'Burned: '}</span>
                                        <span className="text-burn-green font-bold">{job.deletedItems.toLocaleString()}</span>
                                    </div>
                                    {job.failedItems > 0 && (
                                        <div>
                                            <span className="text-burn-muted">Failed: </span>
                                            <span className="text-burn-red font-bold">{job.failedItems}</span>
                                        </div>
                                    )}
                                    {job.status === 'running' && job.speed && (
                                        <div>
                                            <span className="text-burn-muted">Speed: </span>
                                            <span className="text-gold font-bold">{job.speed}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                {(job.status === 'running' || job.status === 'paused') && (
                                    <div className="mt-4 flex gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,59,0,0.1)' }}>
                                        {job.status === 'running' ? (
                                            <button
                                                onClick={() => handlePause(job.id)}
                                                className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-gold transition-colors"
                                                style={{ background: 'rgba(255,184,0,0.1)' }}
                                            >
                                                <Pause className="w-4 h-4" />
                                                Pause
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleResume(job.id)}
                                                className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-burn-green transition-colors"
                                                style={{ background: 'rgba(0,255,136,0.1)' }}
                                            >
                                                <Play className="w-4 h-4" />
                                                Resume
                                            </button>
                                        )}

                                        <button
                                            onClick={() => handleStop(job.id)}
                                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-burn-red transition-colors"
                                            style={{ background: 'rgba(255,59,59,0.1)' }}
                                        >
                                            <Square className="w-4 h-4" />
                                            Stop
                                        </button>
                                    </div>
                                )}

                                {job.status === 'queued' && (
                                    <div className="mt-4 flex gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,59,0,0.1)' }}>
                                        <button
                                            onClick={() => handleCancelQueued(job.id)}
                                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-burn-red transition-colors"
                                            style={{ background: 'rgba(255,59,59,0.1)' }}
                                        >
                                            <XCircle className="w-4 h-4" />
                                            Cancel
                                        </button>
                                    </div>
                                )}

                                {(job.status === 'running' || job.status === 'paused' || job.status === 'queued') && (
                                    <div className="mt-2 text-right">
                                        <button
                                            onClick={() => handleForceRemove(job.id)}
                                            className="text-xs text-burn-muted hover:text-burn-red underline font-mono"
                                        >
                                            Force Remove (Debug)
                                        </button>
                                    </div>
                                )}

                                {job.status === 'failed' && job.error && (
                                    <div className="mt-4 p-3 border" style={{ background: 'rgba(255,59,59,0.08)', borderColor: 'rgba(255,59,59,0.2)' }}>
                                        <p className="text-sm text-burn-red font-mono">{job.error}</p>
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            ) : (
                <div className="glass-card p-12 text-center">
                    <Flame className="w-12 h-12 text-dark-600 mx-auto mb-4" />
                    <h3 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider mb-2">No Jobs Yet</h3>
                    <p className="text-burn-muted">
                        Connect a platform and start a burn to see your jobs here.
                    </p>
                </div>
            )}

            {/* Success Toast */}
            <AnimatePresence>
                {toastMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.9 }}
                        className="fixed bottom-8 right-8 z-50 flex items-center gap-3 px-6 py-4 text-white shadow-2xl"
                        style={{ background: 'linear-gradient(135deg, #FF3B00, #FFB800)', boxShadow: '0 0 30px rgba(255,59,0,0.3)' }}
                    >
                        <div className="p-1 rounded-full bg-white/20">
                            <Flame className="w-5 h-5" />
                        </div>
                        <div>
                            <h4 className="font-black uppercase tracking-wider">{toastMessage.includes('queue') ? 'Job Queued' : 'Burn Started'}</h4>
                            <p className="text-xs text-white/90">{toastMessage}</p>
                        </div>
                        <button
                            onClick={() => setToastMessage(null)}
                            className="ml-2 hover:bg-white/10 p-1 transition-colors"
                        >
                            <XCircle className="w-5 h-5 opacity-80" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
