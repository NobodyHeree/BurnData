import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface PlatformCardProps {
    name: string;
    description: string;
    icon: LucideIcon;
    color: string;
    gradient: string;
    stats?: {
        deleted: number;
        pending: number;
    };
    connected?: boolean;
    onClick?: () => void;
    className?: string;
}

export function PlatformCard({
    name,
    description,
    icon: Icon,
    color,
    gradient,
    stats = { deleted: 0, pending: 0 },
    connected = false,
    onClick,
    className = '',
}: PlatformCardProps) {
    return (
        <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className={`
        relative p-6 rounded-xl cursor-pointer transition-all duration-300
        bg-zinc-900/50 backdrop-blur-lg border border-zinc-700/50
        hover:border-zinc-600 hover:shadow-lg hover:shadow-black/20
        ${className}
      `}
        >
            {/* Connected indicator */}
            {connected && (
                <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-green-500" />
            )}

            {/* Header */}
            <div className="flex items-center gap-4 mb-4">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient}`}>
                    <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-white">{name}</h3>
                    <p className="text-sm text-zinc-400">{description}</p>
                </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 pt-4 border-t border-zinc-700/50">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-400">
                        {stats.deleted.toLocaleString()} deleted
                    </span>
                </div>
                {stats.pending > 0 && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-400">
                            {stats.pending} pending
                        </span>
                    </div>
                )}
            </div>

            {/* Action button */}
            <div className="mt-4">
                <span
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{
                        backgroundColor: `${color}15`,
                        color: color,
                    }}
                >
                    {connected ? 'Manage' : 'Connect & Delete'}
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                </span>
            </div>
        </motion.div>
    );
}

export default PlatformCard;
