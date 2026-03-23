import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Settings,
    History,
    Flame
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/appStore';
import { DiscordLogo, PlayStationLogo } from './logos';

const platformMeta = [
    { id: 'discord', name: 'Discord', icon: DiscordLogo, color: '#5865F2' },
    { id: 'psn', name: 'PlayStation', icon: PlayStationLogo, color: '#003791' },
];

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Jobs', href: '/jobs', icon: History },
    { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
    const location = useLocation();
    const platforms = useAppStore((state) => state.platforms);
    const jobs = useAppStore((state) => state.jobs);

    const activeJobsCount = jobs.filter(j => j.status === 'running').length;

    return (
        <aside className="w-64 bg-dark-900/50 border-r flex flex-col"
            style={{ borderRightColor: 'rgba(255,59,0,0.1)' }}>
            {/* Platforms Section */}
            <div className="p-4">
                <h2 className="text-xs font-black text-burn-muted uppercase tracking-[3px] mb-3">
                    Platforms
                </h2>
                <div className="space-y-1">
                    {platformMeta.map((meta) => {
                        const isActive = location.pathname === `/platform/${meta.id}`;
                        const platform = platforms[meta.id];

                        return (
                            <NavLink
                                key={meta.id}
                                to={`/platform/${meta.id}`}
                                className={`
                  relative flex items-center gap-3 px-3 py-2.5 transition-all duration-200
                  ${isActive
                                        ? 'bg-dark-800 text-burn-cream'
                                        : 'text-burn-muted hover:text-burn-cream hover:bg-dark-800/50'
                                    }
                `}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="activeIndicator"
                                        className="absolute left-0 w-1 h-6"
                                        style={{ backgroundColor: '#FF3B00' }}
                                        initial={false}
                                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    />
                                )}
                                <meta.icon
                                    className="w-5 h-5"
                                    style={{ color: isActive ? meta.color : undefined }}
                                />
                                <span className="font-semibold flex-1">{meta.name}</span>
                                {platform?.connected && (
                                    <span className="w-2 h-2 rounded-full bg-burn-green" />
                                )}
                            </NavLink>
                        );
                    })}
                </div>
            </div>

            {/* Divider */}
            <div className="mx-4" style={{ borderTop: '1px solid rgba(255,59,0,0.1)' }} />

            {/* Navigation Section */}
            <div className="p-4 flex-1">
                <h2 className="text-xs font-black text-burn-muted uppercase tracking-[3px] mb-3">
                    Navigation
                </h2>
                <div className="space-y-1">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.href;
                        const showBadge = item.href === '/jobs' && activeJobsCount > 0;

                        return (
                            <NavLink
                                key={item.name}
                                to={item.href}
                                className={`
                  relative flex items-center gap-3 px-3 py-2.5 transition-all duration-200
                  ${isActive
                                        ? 'bg-dark-800 text-burn-cream'
                                        : 'text-burn-muted hover:text-burn-cream hover:bg-dark-800/50'
                                    }
                `}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="navActiveIndicator"
                                        className="absolute left-0 w-1 h-6"
                                        style={{ backgroundColor: '#FF3B00' }}
                                        initial={false}
                                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    />
                                )}
                                <item.icon className="w-5 h-5" />
                                <span className="font-semibold flex-1">{item.name}</span>
                                {showBadge && (
                                    <span className="px-2 py-0.5 text-xs font-black tracking-wider bg-fire text-white"
                                        style={{ clipPath: 'polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)' }}>
                                        {activeJobsCount}
                                    </span>
                                )}
                            </NavLink>
                        );
                    })}
                </div>
            </div>

            {/* Open Source Banner */}
            <div className="p-4">
                <div className="p-4 border"
                    style={{
                        background: 'linear-gradient(135deg, rgba(255,59,0,0.08), rgba(255,184,0,0.08))',
                        borderColor: 'rgba(255,59,0,0.2)',
                    }}>
                    <div className="flex items-center gap-2 mb-2">
                        <Flame className="w-4 h-4 text-fire" />
                        <span className="text-sm font-black text-burn-cream uppercase tracking-wider">Open Source</span>
                    </div>
                    <p className="text-xs text-burn-muted">
                        Free forever. No trace left behind.
                    </p>
                </div>
            </div>
        </aside>
    );
}
