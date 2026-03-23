import { motion } from 'framer-motion';
import {
    Flame,
    Clock,
    CheckCircle,
    Zap,
    BarChart3,
    History
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { DiscordLogo, PlayStationLogo } from '../components/logos';

const platformMeta = {
    discord: {
        icon: DiscordLogo,
        color: '#5865F2',
        gradient: 'from-[#5865F2] to-[#7289DA]',
        description: 'Burn messages, DMs, and server content',
        statsLabel: 'messages burned',
    },
    psn: {
        icon: PlayStationLogo,
        color: '#003791',
        gradient: 'from-[#003791] to-[#0070D1]',
        description: 'Mass unfriend your PSN friends list',
        statsLabel: 'friends removed',
    },
};

const container = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.1 }
    }
};

const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
};

export function Dashboard() {
    const platforms = useAppStore((state) => state.platforms);
    const jobs = useAppStore((state) => state.jobs);
    const getConnectedPlatforms = useAppStore((state) => state.getConnectedPlatforms);
    const getTotalDeleted = useAppStore((state) => state.getTotalDeleted);

    const connectedPlatforms = getConnectedPlatforms();
    const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending' || j.status === 'queued');
    const completedJobs = jobs.filter(j => j.status === 'completed');
    const recentJobs = jobs.slice(0, 5);
    const totalDeleted = getTotalDeleted();

    const activePlatforms = ['discord', 'psn']
        .map(id => {
            const platform = platforms[id];
            if (platform && !platform.id) {
                return { ...platform, id };
            }
            return platform;
        })
        .filter(Boolean);

    return (
        <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="space-y-8"
        >
            {/* Header */}
            <motion.div variants={item}>
                <div className="flex items-center gap-3 mb-2">
                    <h1 className="font-display text-5xl text-burn-cream tracking-wide">
                        Burn<span className="text-fire">Data</span>
                    </h1>
                </div>
                <p className="text-burn-muted font-medium">
                    Erase your digital footprint. Connect a platform and start burning.
                </p>
            </motion.div>

            {/* Stats Overview */}
            <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5" style={{ background: 'rgba(255,59,0,0.1)' }}>
                            <Flame className="w-5 h-5 text-fire" />
                        </div>
                        <div>
                            <p className="text-2xl font-display text-burn-cream tracking-wide">{totalDeleted.toLocaleString()}</p>
                            <p className="text-xs font-bold text-burn-muted uppercase tracking-wider">Total Burned</p>
                        </div>
                    </div>
                </div>
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5" style={{ background: 'rgba(255,184,0,0.1)' }}>
                            <Clock className="w-5 h-5 text-gold" />
                        </div>
                        <div>
                            <p className="text-2xl font-display text-burn-cream tracking-wide">{activeJobs.length}</p>
                            <p className="text-xs font-bold text-burn-muted uppercase tracking-wider">Active</p>
                        </div>
                    </div>
                </div>
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5" style={{ background: 'rgba(0,255,136,0.1)' }}>
                            <Zap className="w-5 h-5 text-burn-green" />
                        </div>
                        <div>
                            <p className="text-2xl font-display text-burn-cream tracking-wide">{connectedPlatforms.length}</p>
                            <p className="text-xs font-bold text-burn-muted uppercase tracking-wider">Connected</p>
                        </div>
                    </div>
                </div>
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5" style={{ background: 'rgba(255,59,0,0.1)' }}>
                            <CheckCircle className="w-5 h-5 text-fire" />
                        </div>
                        <div>
                            <p className="text-2xl font-display text-burn-cream tracking-wide">{completedJobs.length}</p>
                            <p className="text-xs font-bold text-burn-muted uppercase tracking-wider">Completed</p>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Platform Cards */}
            <motion.div variants={item}>
                <h2 className="font-heading text-xl font-black text-burn-cream uppercase tracking-wider mb-4">Platforms</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activePlatforms.map((platform) => {
                        const meta = platformMeta[platform.id as keyof typeof platformMeta];
                        if (!meta) return null;
                        const Icon = meta.icon;
                        const platformActiveJobs = activeJobs.filter(j => j.platformId === platform.id);

                        return (
                            <motion.div
                                key={platform.id}
                                whileHover={{ scale: 1.01 }}
                                className="platform-card relative"
                            >
                                {/* Connected badge + Active jobs indicator */}
                                <div className="absolute top-4 right-4 flex items-center gap-2">
                                    {platformActiveJobs.length > 0 && (
                                        <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'rgba(255,184,0,0.1)' }}>
                                            <Clock className="w-3 h-3 text-gold" />
                                            <span className="text-xs text-gold font-bold uppercase tracking-wider">{platformActiveJobs.length} active</span>
                                        </div>
                                    )}
                                    {platform.connected && (
                                        <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'rgba(0,255,136,0.1)' }}>
                                            <span className="w-2 h-2 rounded-full bg-burn-green" />
                                            <span className="text-xs text-burn-green font-bold uppercase tracking-wider">Connected</span>
                                        </div>
                                    )}
                                </div>

                                {/* Platform Header */}
                                <div className="flex items-center gap-4 mb-4">
                                    <div className={`p-3 rounded-xl bg-gradient-to-br ${meta.gradient}`}>
                                        <Icon className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider">
                                            {platform.name}
                                        </h3>
                                        <p className="text-sm text-burn-muted">{meta.description}</p>
                                    </div>
                                </div>

                                {/* User info if connected */}
                                {platform.connected && platform.user && (
                                    <div className="flex items-center gap-2 mb-4 p-2 bg-dark-900 border border-dark-700">
                                        <div className="w-6 h-6 flex items-center justify-center text-xs font-black text-fire"
                                            style={{ background: 'rgba(255,59,0,0.15)' }}>
                                            {platform.user.username.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-sm text-burn-text font-mono">{platform.user.username}</span>
                                    </div>
                                )}

                                {/* Stats */}
                                <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid rgba(255,59,0,0.1)' }}>
                                    <div className="flex items-center gap-2">
                                        <BarChart3 className="w-4 h-4 text-burn-muted" />
                                        <span className="text-sm text-burn-muted font-mono">
                                            {(platform.stats?.totalDeleted || 0).toLocaleString()} {meta.statsLabel}
                                        </span>
                                    </div>
                                    {platform.stats?.lastDeletionAt && (
                                        <span className="text-xs text-burn-muted font-mono">
                                            Last: {new Date(platform.stats.lastDeletionAt).toLocaleDateString()}
                                        </span>
                                    )}
                                </div>

                                {/* Action Buttons */}
                                <div className="mt-4 flex items-center gap-2">
                                    <Link
                                        to={`/platform/${platform.id}`}
                                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-black uppercase tracking-wider transition-all hover:scale-105"
                                        style={{
                                            backgroundColor: `${meta.color}15`,
                                            color: meta.color,
                                        }}
                                    >
                                        {platform.connected ? 'Manage' : 'Connect'}
                                        <span>→</span>
                                    </Link>

                                    {platform.connected && (
                                        <Link
                                            to="/jobs"
                                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold bg-dark-800 text-burn-muted hover:text-burn-cream hover:bg-dark-700 transition-all border border-dark-700"
                                        >
                                            <History className="w-4 h-4" />
                                            History
                                        </Link>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            </motion.div>

            {/* Recent Activity */}
            <motion.div variants={item}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-heading text-xl font-black text-burn-cream uppercase tracking-wider">Recent Activity</h2>
                    {recentJobs.length > 0 && (
                        <Link to="/jobs" className="text-sm text-burn-muted hover:text-fire transition-colors font-bold uppercase tracking-wider">
                            View all →
                        </Link>
                    )}
                </div>
                {recentJobs.length > 0 ? (
                    <div className="glass-card divide-y divide-dark-700">
                        {recentJobs.map((job) => {
                            const platform = platforms[job.platformId];
                            const meta = platformMeta[job.platformId as keyof typeof platformMeta];

                            return (
                                <div key={job.id} className="flex items-center justify-between p-4">
                                    <div className="flex items-center gap-4">
                                        <div
                                            className="w-10 h-10 flex items-center justify-center"
                                            style={{ backgroundColor: `${meta?.color || '#666'}15` }}
                                        >
                                            {job.status === 'completed' ? (
                                                <CheckCircle className="w-5 h-5 text-burn-green" />
                                            ) : job.status === 'running' ? (
                                                <Flame className="w-5 h-5 text-fire animate-pulse" />
                                            ) : job.status === 'queued' ? (
                                                <Clock className="w-5 h-5 text-burn-muted" />
                                            ) : (
                                                <Flame className="w-5 h-5" style={{ color: meta?.color }} />
                                            )}
                                        </div>
                                        <div>
                                            <p className="font-bold text-burn-cream">
                                                {job.status === 'completed'
                                                    ? job.platformId === 'psn'
                                                        ? `Removed ${job.deletedItems} friend${job.deletedItems !== 1 ? 's' : ''}`
                                                        : `Burned ${job.deletedItems} item${job.deletedItems !== 1 ? 's' : ''}`
                                                    : job.status === 'running'
                                                        ? job.platformId === 'psn'
                                                            ? `Unfriending... ${job.deletedItems}/${job.totalItems}`
                                                            : `Burning... ${job.deletedItems}/${job.totalItems}`
                                                        : job.status === 'queued'
                                                            ? 'Waiting in queue'
                                                            : job.platformId === 'psn'
                                                                ? `${job.totalItems} friend${job.totalItems !== 1 ? 's' : ''} pending`
                                                                : `${job.totalItems} item${job.totalItems !== 1 ? 's' : ''} pending`
                                                }
                                            </p>
                                            <p className="text-sm text-burn-muted font-mono">
                                                {platform?.name || job.platformId}
                                                {job.status === 'completed' && job.completedAt && (
                                                    <> · {new Date(job.completedAt).toLocaleTimeString()}</>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="text-sm text-burn-muted font-mono">
                                        {new Date(job.startedAt).toLocaleDateString()}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="glass-card p-8 text-center">
                        <Flame className="w-12 h-12 text-dark-600 mx-auto mb-4" />
                        <h3 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider mb-2">No Activity Yet</h3>
                        <p className="text-burn-muted">
                            Connect a platform and start burning to see your activity here.
                        </p>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
}
