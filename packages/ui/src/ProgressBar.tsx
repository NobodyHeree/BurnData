import { motion } from 'framer-motion';
import { Loader2, CheckCircle, XCircle, PauseCircle } from 'lucide-react';

interface ProgressBarProps {
    total: number;
    current: number;
    failed?: number;
    status?: 'running' | 'paused' | 'completed' | 'failed';
    showStats?: boolean;
    color?: string;
    className?: string;
}

export function ProgressBar({
    total,
    current,
    failed = 0,
    status = 'running',
    showStats = true,
    color = '#FF3B00',
    className = '',
}: ProgressBarProps) {
    const progress = total > 0 ? Math.round((current / total) * 100) : 0;

    const statusConfig = {
        running: { icon: Loader2, text: 'Burning...', iconClass: 'animate-spin' },
        paused: { icon: PauseCircle, text: 'Paused', iconClass: '' },
        completed: { icon: CheckCircle, text: 'Completed', iconClass: '' },
        failed: { icon: XCircle, text: 'Failed', iconClass: '' },
    };

    const StatusIcon = statusConfig[status].icon;

    return (
        <div className={`space-y-3 ${className}`}>
            {/* Progress bar */}
            <div className="h-2 bg-dark-900 overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="h-full"
                    style={{
                        background: `linear-gradient(90deg, ${color}, #FFB800)`,
                    }}
                />
            </div>

            {/* Stats */}
            {showStats && (
                <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                        <StatusIcon
                            className={`w-4 h-4 ${statusConfig[status].iconClass}`}
                            style={{ color }}
                        />
                        <span className="text-burn-muted font-bold uppercase tracking-wider text-xs">{statusConfig[status].text}</span>
                    </div>
                    <div className="flex items-center gap-4 font-mono">
                        <span className="text-burn-cream font-bold">
                            {current} / {total}
                        </span>
                        {failed > 0 && (
                            <span className="text-burn-red">
                                {failed} failed
                            </span>
                        )}
                        <span className="text-burn-muted">{progress}%</span>
                    </div>
                </div>
            )}
        </div>
    );
}
