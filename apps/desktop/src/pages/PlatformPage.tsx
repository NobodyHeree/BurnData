import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft,
    Key,
    AlertTriangle,
    CheckCircle,
    MessageSquare,
    Loader2,
    LogOut,
    User,
    LogIn,
    Users,
    Search,
    UserPlus,
    Plus,
    Upload,
    Package
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { DiscordService, DiscordGuild, DiscordChannel } from '@services/index';
import { DiscordLogo } from '../components/logos';
import { registerJob, getSpeedDelay, hasActiveJob, removeJobControl } from '../store/browserJobController';
import { markDeleted, flushDeleted, getDeletedCount } from '../store/deletedTracker';

const platformConfig: Record<string, {
    name: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    color: string;
    gradient: string;
    supportsAutoLogin: boolean;
    tokenGuide: string[];
}> = {
    discord: {
        name: 'Discord',
        icon: DiscordLogo,
        color: '#5865F2',
        gradient: 'from-[#5865F2] to-[#7289DA]',
        supportsAutoLogin: true,
        tokenGuide: [
            'Open Discord in your web browser (discord.com/app)',
            'Press F12 to open Developer Tools',
            'Go to the "Console" tab',
            'Paste this code and press Enter:',
            '(webpackChunkdiscord_app.push([[\'\'...getToken()',
            'Copy the token that appears',
        ]
    }
};

export function PlatformPage() {
    const { platformId } = useParams<{ platformId: string }>();
    const navigate = useNavigate();

    const platform = useAppStore((state) => state.platforms[platformId || '']);
    const connectPlatform = useAppStore((state) => state.connectPlatform);
    const disconnectPlatform = useAppStore((state) => state.disconnectPlatform);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState('');
    const [showManualInput, setShowManualInput] = useState(false);
    const [manualToken, setManualToken] = useState('');

    const [activeTab, setActiveTab] = useState<'overview' | 'servers' | 'dms'>('overview');
    const [isLoadingData, setIsLoadingData] = useState(false);
    const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
    const [dms, setDms] = useState<DiscordChannel[]>([]);
    const [, setDiscordService] = useState<DiscordService | null>(null);

    const [serverSearch, setServerSearch] = useState('');
    const [dmSearch, setDmSearch] = useState('');

    const [dataPackage, setDataPackage] = useState<{
        channels: Record<string, { channelId: string; name: string; messageIds: string[]; count: number }>;
        totalMessages: number;
        channelCount: number;
    } | null>(null);
    const [isImportingPackage, setIsImportingPackage] = useState(false);
    const addToast = useAppStore((state) => state.addToast);

    const handleImportDataPackage = () => {
        if (isElectron) {
            // Electron mode (async IIFE to avoid making the handler async)
            setIsImportingPackage(true);
            (async () => {
                try {
                    const result = await (window.electronAPI!.discord as any).importDataPackage();
                    if (result.success) {
                        setDataPackage({
                            channels: result.channels,
                            totalMessages: result.totalMessages,
                            channelCount: result.channelCount,
                        });
                        addToast({ type: 'success', message: `Imported ${result.totalMessages.toLocaleString()} messages from ${result.channelCount} channels` });
                    } else if (result.error !== 'Cancelled') {
                        addToast({ type: 'error', message: result.error || 'Failed to import data package' });
                    }
                } catch (err: any) {
                    addToast({ type: 'error', message: err.message || 'Import failed' });
                } finally {
                    setIsImportingPackage(false);
                }
            })();
        } else {
            // Browser mode: trigger file input synchronously (required for user gesture)
            fileInputRef.current?.click();
        }
    };

    const [showAddDMModal, setShowAddDMModal] = useState(false);
    const [addDMUserId, setAddDMUserId] = useState('');
    const [isAddingDM, setIsAddingDM] = useState(false);
    const [addDMError, setAddDMError] = useState('');

    const handleAddDMByUserId = async () => {
        if (!addDMUserId.trim()) return;

        setIsAddingDM(true);
        setAddDMError('');

        try {
            let result: any;
            if (isElectron) {
                result = await window.electronAPI!.discord.createDM(addDMUserId.trim());
            } else {
                // Browser mode: use DiscordService directly
                const token = platform?.token || sessionStorage.getItem(`burndata-token-${platformId}`) || '';
                if (!token) { setAddDMError('No token available'); setIsAddingDM(false); return; }
                const svc = new DiscordService(token);
                try {
                    const channel = await svc.createDMChannel(addDMUserId.trim());
                    result = { success: true, channel: { id: channel.id, name: channel.name, recipients: channel.recipients } };
                } catch (err: any) {
                    result = { success: false, error: err.message };
                }
            }

            if (result.success && result.channel) {
                // Add to DMs list if not already present
                setDms(prev => {
                    const exists = prev.some(dm => dm.id === result.channel!.id);
                    if (!exists) {
                        return [...prev, {
                            id: result.channel!.id,
                            type: 1,
                            name: result.channel!.name,
                            recipients: result.channel!.recipients
                        }];
                    }
                    return prev;
                });

                // Auto-select the new DM
                setSelectedDMs(prev => new Set([...prev, result.channel!.id]));

                // Close modal and reset
                setShowAddDMModal(false);
                setAddDMUserId('');
            } else {
                setAddDMError(result.error || 'Failed to create DM channel');
            }
        } catch (err: any) {
            setAddDMError(err.message || 'An error occurred');
        } finally {
            setIsAddingDM(false);
        }
    };

    const [selectedGuilds, setSelectedGuilds] = useState<Set<string>>(new Set());
    const [selectedDMs, setSelectedDMs] = useState<Set<string>>(new Set());

    const toggleGuildSelection = (guildId: string) => {
        const newSelected = new Set(selectedGuilds);
        if (newSelected.has(guildId)) {
            newSelected.delete(guildId);
        } else {
            newSelected.add(guildId);
        }
        setSelectedGuilds(newSelected);
    };

    const toggleDMSelection = (channelId: string) => {
        const newSelected = new Set(selectedDMs);
        if (newSelected.has(channelId)) {
            newSelected.delete(channelId);
        } else {
            newSelected.add(channelId);
        }
        setSelectedDMs(newSelected);
    };

    const selectAllGuilds = () => {
        // Filter based on search if active, otherwise all
        const targets = serverSearch ? guilds.filter(g => g.name.toLowerCase().includes(serverSearch.toLowerCase())) : guilds;
        const newSelected = new Set(selectedGuilds);
        targets.forEach(g => newSelected.add(g.id));
        setSelectedGuilds(newSelected);
    };

    const selectAllDMs = () => {
        const targets = dmSearch ? dms.filter(dm => {
            const name = dm.recipients?.[0]?.username || dm.name || 'Group DM';
            return name.toLowerCase().includes(dmSearch.toLowerCase());
        }) : dms;
        const newSelected = new Set(selectedDMs);
        targets.forEach(dm => newSelected.add(dm.id));
        setSelectedDMs(newSelected);
    };

    const clearSelection = () => {
        setSelectedGuilds(new Set());
        setSelectedDMs(new Set());
    };



    const config = platformConfig[platformId || 'discord'];
    const isElectron = !!window.electronAPI?.discord;

    // Initialize DiscordService on mount if connected
    useEffect(() => {
        let cancelled = false;
        const electronMode = !!window.electronAPI?.discord;
        const initService = async () => {
            if (platformId === 'discord' && platform?.connected) {
                setIsLoadingData(true);
                try {
                    if (electronMode) {
                        const [fetchedGuilds, fetchedDMs] = await Promise.all([
                            window.electronAPI!.discord.getGuilds(),
                            window.electronAPI!.discord.getDMs()
                        ]);
                        if (cancelled) return;
                        setGuilds(fetchedGuilds);
                        setDms(fetchedDMs);
                    } else {
                        const token = platform.token || sessionStorage.getItem(`burndata-token-${platformId}`) || '';
                        if (!token) {
                            if (!cancelled) setError('No token found. Please reconnect.');
                            if (!cancelled) setIsLoadingData(false);
                            return;
                        }
                        const svc = new DiscordService(token);
                        await svc.validateToken();
                        if (cancelled) return;
                        setDiscordService(svc);
                        const [fetchedGuilds, fetchedDMs] = await Promise.all([
                            svc.getGuilds(),
                            svc.getDMChannels()
                        ]);
                        if (cancelled) return;
                        setGuilds(fetchedGuilds);
                        setDms(fetchedDMs);
                    }
                } catch (err) {
                    if (cancelled) return;
                    console.error('Failed to fetch Discord data', err);
                    const errMsg = err instanceof Error ? err.message : 'Failed to fetch Discord data';
                    if (errMsg.includes('No Discord token')) {
                        disconnectPlatform('discord');
                        setError('Your session has expired. Please log in again.');
                    } else {
                        setError(errMsg);
                    }
                } finally {
                    if (!cancelled) setIsLoadingData(false);
                }
            }
        };
        initService();
        return () => { cancelled = true; };
    }, [platformId, platform?.connected]); // eslint-disable-line react-hooks/exhaustive-deps


    if (!config || !platform) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-burn-muted">Platform not found</p>
            </div>
        );
    }

    const handleAutoLogin = async () => {
        if (!isElectron) {
            setError('Auto-login only works in the desktop app');
            setShowManualInput(true);
            return;
        }

        setIsConnecting(true);
        setError('');

        try {
            const result = await window.electronAPI!.discord.login();

            if (result.success && result.token) {
                // Validate the token
                const tempService = new DiscordService(result.token);
                const userData = await tempService.validateToken();

                // Store token SECURELY
                await window.electronAPI!.tokens.set('discord', result.token);

                // Update store (can store token in memory or masked)
                connectPlatform('discord', result.token, {
                    id: userData.id,
                    username: userData.username,
                    avatar: userData.avatar ?? undefined,
                });

                // Set service
                setDiscordService(tempService);

                // Switch to overview
                setActiveTab('overview');
            } else {
                setError(result.error || 'Login failed');
            }
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleManualConnect = async () => {
        if (!manualToken.trim()) {
            setError('Please enter your token');
            return;
        }

        setIsConnecting(true);
        setError('');

        try {
            const tempService = new DiscordService(manualToken);
            const userData = await tempService.validateToken();

            if (window.electronAPI) {
                await window.electronAPI.tokens.set(platformId!, manualToken);
            } else {
                // Browser mode: persist token in sessionStorage for navigation
                sessionStorage.setItem(`burndata-token-${platformId}`, manualToken);
            }

            connectPlatform(platformId!, manualToken, {
                id: userData.id,
                username: userData.username,
                avatar: userData.avatar ?? undefined,
            });

            setDiscordService(tempService);
            setManualToken('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        if (window.electronAPI) {
            if (platformId === 'discord') {
                await window.electronAPI.discord.logout();
            } else {
                await window.electronAPI.tokens.delete(platformId!);
            }
        }
        disconnectPlatform(platformId!);
        setDiscordService(null);
        setGuilds([]);
        setDms([]);
        setActiveTab('overview');
    };

    const PlatformIcon = config.icon;

    const renderTabContent = () => {
        if (isLoadingData) {
            return (
                <div className="flex flex-col items-center justify-center py-20 text-burn-muted">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-discord-blurple" />
                    <p>Fetching your servers and messages...</p>
                </div>
            );
        }

        switch (activeTab) {
            case 'servers':
                const filteredGuilds = guilds.filter(g =>
                    g.name.toLowerCase().includes(serverSearch.toLowerCase())
                );
                return (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-burn-cream">Your Servers</h3>
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={selectAllGuilds}
                                    className="text-xs text-discord-blurple hover:text-burn-cream font-medium transition-colors"
                                >
                                    Select All
                                </button>
                                {selectedGuilds.size > 0 && (
                                    <div className="flex items-center gap-2 border-l border-dark-600 pl-4">
                                        <span className="text-sm text-discord-blurple font-medium">
                                            {selectedGuilds.size} selected
                                        </span>
                                        <button
                                            onClick={clearSelection}
                                            className="text-xs text-burn-muted hover:text-burn-cream underline"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-burn-muted" />
                                    <input
                                        type="text"
                                        placeholder="Search servers..."
                                        className="input-field pl-10 py-2 w-64"
                                        value={serverSearch}
                                        onChange={(e) => setServerSearch(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredGuilds.map(guild => {
                                const isSelected = selectedGuilds.has(guild.id);
                                return (
                                    <div
                                        key={guild.id}
                                        onClick={() => toggleGuildSelection(guild.id)}
                                        className={`glass-card p-4 transition-all cursor-pointer group relative border-2 ${isSelected
                                            ? 'border-discord-blurple bg-discord-blurple/10'
                                            : 'border-transparent hover:border-discord-blurple/50'
                                            }`}
                                    >
                                        {isSelected && (
                                            <div className="absolute top-3 right-3 text-discord-blurple">
                                                <CheckCircle className="w-5 h-5 fill-discord-blurple text-white" />
                                            </div>
                                        )}
                                        <div className="flex items-center gap-4">
                                            {guild.icon ? (
                                                <img
                                                    src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                                                    alt={guild.name}
                                                    className="w-12 h-12 rounded-full"
                                                />
                                            ) : (
                                                <div className="w-12 h-12 rounded-full bg-dark-700 flex items-center justify-center text-white font-bold">
                                                    {guild.name.substring(0, 2)}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0 pr-6">
                                                <h4 className="font-semibold text-burn-cream truncate">{guild.name}</h4>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            case 'dms':
                const filteredDMs = dms.filter(dm => {
                    const name = dm.recipients?.[0]?.username || dm.name || 'Group DM';
                    return name.toLowerCase().includes(dmSearch.toLowerCase());
                });

                return (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-burn-cream">Direct Messages</h3>
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={selectAllDMs}
                                    className="text-xs text-discord-green hover:text-burn-cream font-medium transition-colors"
                                >
                                    Select All
                                </button>
                                <button
                                    onClick={() => setShowAddDMModal(true)}
                                    className="flex items-center gap-1 text-xs text-discord-blurple hover:text-burn-cream font-medium transition-colors"
                                >
                                    <UserPlus className="w-3 h-3" />
                                    Add by ID
                                </button>
                                {selectedDMs.size > 0 && (
                                    <div className="flex items-center gap-2 border-l border-dark-600 pl-4">
                                        <span className="text-sm text-discord-green font-medium">
                                            {selectedDMs.size} selected
                                        </span>
                                        <button
                                            onClick={clearSelection}
                                            className="text-xs text-burn-muted hover:text-burn-cream underline"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-burn-muted" />
                                    <input
                                        type="text"
                                        placeholder="Search people..."
                                        className="input-field pl-10 py-2 w-64"
                                        value={dmSearch}
                                        onChange={(e) => setDmSearch(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredDMs.map(dm => {
                                const recipient = dm.recipients?.[0];
                                const isSelected = selectedDMs.has(dm.id);
                                const packageCount = dataPackage?.channels[dm.id]?.count;
                                return (
                                    <div
                                        key={dm.id}
                                        onClick={() => toggleDMSelection(dm.id)}
                                        className={`glass-card p-4 transition-all cursor-pointer group relative border-2 ${isSelected
                                            ? 'border-discord-green bg-discord-green/10'
                                            : 'border-transparent hover:border-discord-green/50'
                                            }`}
                                    >
                                        {isSelected && (
                                            <div className="absolute top-3 right-3 text-discord-green">
                                                <CheckCircle className="w-5 h-5 fill-discord-green text-white" />
                                            </div>
                                        )}
                                        <div className="flex items-center gap-4">
                                            {recipient?.avatar ? (
                                                <img
                                                    src={`https://cdn.discordapp.com/avatars/${recipient.id}/${recipient.avatar}.png?size=64`}
                                                    alt={recipient.username}
                                                    className="w-12 h-12 rounded-full"
                                                />
                                            ) : recipient?.id ? (
                                                <div className="w-12 h-12 rounded-full bg-discord-green/20 flex items-center justify-center text-discord-green">
                                                    <User className="w-6 h-6" />
                                                </div>
                                            ) : (
                                                <div className="w-12 h-12 rounded-full bg-dark-700 flex items-center justify-center">
                                                    <Users className="w-6 h-6 text-burn-muted" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0 pr-6">
                                                <h4 className="font-semibold text-burn-cream truncate">
                                                    {recipient ? recipient.username : (dm.name || 'Group DM')}
                                                </h4>
                                                <p className="text-xs text-burn-muted">
                                                    {dm.type === 1 ? 'Direct Message' : 'Group Chat'}
                                                    {packageCount != null && packageCount > 0 && (() => {
                                                        const alreadyDone = getDeletedCount(dm.id);
                                                        const remaining = Math.max(0, packageCount - alreadyDone);
                                                        return (
                                                            <span className={`ml-2 font-medium ${remaining > 0 ? 'text-discord-fuchsia' : 'text-discord-green'}`}>
                                                                {remaining > 0
                                                                    ? `(${remaining.toLocaleString()} remaining)`
                                                                    : '(all cleared)'}
                                                            </span>
                                                        );
                                                    })()}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            default: // Overview
                return (
                    <div className="space-y-6">
                        {/* Stats */}
                        <div className="glass-card p-6">
                            <h3 className="text-lg font-semibold text-burn-cream mb-4">Statistics</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-dark-800">
                                    <p className="text-2xl font-bold text-burn-cream">
                                        {platform.stats.totalDeleted.toLocaleString()}
                                    </p>
                                    <p className="text-sm text-burn-muted">Items Deleted</p>
                                </div>
                                <div className="p-4 bg-dark-800">
                                    <p className="text-2xl font-bold text-burn-cream">
                                        {platform.stats.lastDeletionAt
                                            ? new Date(platform.stats.lastDeletionAt).toLocaleDateString()
                                            : 'Never'
                                        }
                                    </p>
                                    <p className="text-sm text-burn-muted">Last Deletion</p>
                                </div>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                className="glass-card p-6 text-left hover:border-discord-blurple/50 transition-colors group"
                                onClick={() => setActiveTab('servers')}
                            >
                                <div className="w-12 h-12 bg-discord-blurple/20 flex items-center justify-center text-discord-blurple mb-4 group-hover:scale-110 transition-transform">
                                    <Users className="w-6 h-6" />
                                </div>
                                <h3 className="font-semibold text-burn-cream mb-2">Clean Servers</h3>
                                <p className="text-sm text-burn-muted mb-4">Delete messages from servers you joined</p>
                                <span className="text-sm font-medium text-discord-blurple">
                                    Browse Servers →
                                </span>
                            </button>
                            <button
                                className="glass-card p-6 text-left hover:border-discord-green/50 transition-colors group"
                                onClick={() => setActiveTab('dms')}
                            >
                                <div className="w-12 h-12 bg-discord-green/20 flex items-center justify-center text-discord-green mb-4 group-hover:scale-110 transition-transform">
                                    <MessageSquare className="w-6 h-6" />
                                </div>
                                <h3 className="font-semibold text-burn-cream mb-2">Clean DMs</h3>
                                <p className="text-sm text-burn-muted mb-4">Delete private messages and group chats</p>
                                <span className="text-sm font-medium text-discord-green">
                                    Browse DMs →
                                </span>
                            </button>
                        </div>

                        {/* Data Package Import */}
                        <div className="glass-card p-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-discord-fuchsia/20 flex items-center justify-center text-discord-fuchsia">
                                        <Package className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-burn-cream">Import Data Package</h3>
                                        <p className="text-sm text-burn-muted">
                                            Import your Discord data export (ZIP) for faster deletion — skips the search phase entirely.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleImportDataPackage}
                                    disabled={isImportingPackage}
                                    className="flex items-center gap-2 px-4 py-2 bg-discord-fuchsia/10 text-discord-fuchsia hover:bg-discord-fuchsia/20 transition-colors font-medium text-sm disabled:opacity-50"
                                >
                                    {isImportingPackage ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Upload className="w-4 h-4" />
                                    )}
                                    {isImportingPackage ? 'Importing...' : 'Import ZIP'}
                                </button>
                            </div>

                            {dataPackage && (
                                <div className="mt-4 p-4 bg-discord-fuchsia/5 border border-discord-fuchsia/20">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-burn-cream">Data Package Loaded</span>
                                        <button
                                            onClick={() => setDataPackage(null)}
                                            className="text-xs text-burn-muted hover:text-burn-cream"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                    <p className="text-sm text-burn-muted">
                                        {dataPackage.totalMessages.toLocaleString()} messages across {dataPackage.channelCount} channels ready for deletion.
                                    </p>
                                    <p className="text-xs text-burn-muted mt-1">
                                        When you start a deletion, the data package will be used automatically (no search needed).
                                    </p>
                                </div>
                            )}</div>
                    </div>
                );
        }
    };

    const [showDeletionModal, setShowDeletionModal] = useState(false);
    const [deletionMode, setDeletionMode] = useState<'simple' | 'advanced'>('simple');
    const addJob = useAppStore(state => state.addJob);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleStartDeletion = async () => {
        setIsDeleting(true);

        const currentFilter = deletionMode === 'simple' ? easyDateFilter : advancedDateFilter;
        let finalStart = currentFilter.startDate;
        let finalEnd = currentFilter.endDate;

        const dataPackageMessages: Record<string, string[]> | undefined = dataPackage
            ? Object.fromEntries(
                Object.entries(dataPackage.channels).map(([chId, ch]) => [chId, ch.messageIds])
            )
            : undefined;

        const config = {
            mode: deletionMode,
            guilds: Array.from(selectedGuilds),
            dms: Array.from(selectedDMs),
            selectedChannels: Array.from(selectedChannels),
            dateFilter: {
                startDate: finalStart,
                endDate: finalEnd
            },
            ...(dataPackageMessages && { dataPackageMessages }),
        };

        try {
            if (window.electronAPI?.discord) {
                const result = await window.electronAPI!.discord.startDeletion(config);

                if (result && result.jobId) {
                    const jobStatus = result.queued ? 'queued' : 'running';

                    addJob({
                        id: result.jobId,
                        platformId: 'discord',
                        status: jobStatus,
                        totalItems: targetsCount,
                        deletedItems: 0,
                        failedItems: 0,
                        progress: 0,
                        startedAt: new Date().toISOString()
                    });

                    clearSelection();
                    setSelectedChannels(new Set());
                    setShowDeletionModal(false);
                    setIsDeleting(false);

                    navigate('/jobs', {
                        state: {
                            jobStarted: true,
                            queued: result.queued,
                            queuePosition: result.queuePosition
                        }
                    });
                }
            } else {
                // Browser mode: use DiscordService directly
                if (hasActiveJob()) {
                    useAppStore.getState().addToast({ type: 'warning', message: 'A job is already running. Stop it first.' });
                    setIsDeleting(false);
                    return;
                }
                const token = platform.token || sessionStorage.getItem(`burndata-token-${platformId}`) || '';
                if (!token) throw new Error('No token available');

                const svc = new DiscordService(token);
                const user = await svc.validateToken();
                const jobId = crypto.randomUUID();

                // Collect all channel IDs to process
                const channelIds = Array.from(selectedDMs);

                addJob({
                    id: jobId,
                    platformId: 'discord',
                    status: 'running',
                    totalItems: 0,
                    deletedItems: 0,
                    failedItems: 0,
                    progress: 0,
                    startedAt: new Date().toISOString()
                });

                clearSelection();
                setSelectedChannels(new Set());
                setShowDeletionModal(false);
                setIsDeleting(false);
                navigate('/jobs');

                // Run deletion in background: scan first, then delete
                const control = registerJob(jobId);

                (async () => {
                    const updateJob = useAppStore.getState().updateJob;
                    const updatePlatformStats = useAppStore.getState().updatePlatformStats;

                    // Phase 1: Scan API — this is the source of truth for what exists
                    const allMessages: { channelId: string; messageId: string }[] = [];
                    const scanFoundIds = new Set<string>();

                    updateJob(jobId, { currentChannel: 'Scanning for all messages...' });
                    for (const channelId of channelIds) {
                        if (control.isCancelled) break;
                        let before: string | undefined;
                        let hasMore = true;

                        while (hasMore && !control.isCancelled) {
                            try {
                                const messages = await svc.getChannelMessages(channelId, 100, before);
                                if (messages.length === 0) { hasMore = false; break; }

                                const myMessages = messages.filter(m => m.author.id === user.id);
                                for (const msg of myMessages) {
                                    const key = `${channelId}:${msg.id}`;
                                    if (!scanFoundIds.has(key)) {
                                        scanFoundIds.add(key);
                                        allMessages.push({ channelId, messageId: msg.id });
                                    }
                                }
                                updateJob(jobId, { totalItems: allMessages.length });

                                before = messages[messages.length - 1].id;
                                if (messages.length < 100) hasMore = false;

                                await new Promise(r => setTimeout(r, 300));
                            } catch (err) {
                                console.error('Fetch error:', err);
                                hasMore = false;
                            }
                        }
                    }

                    // Reconcile package with scan: mark package IDs not found by scan as deleted
                    if (dataPackageMessages) {
                        let reconciled = 0;
                        for (const channelId of channelIds) {
                            if (dataPackageMessages[channelId]) {
                                for (const msgId of dataPackageMessages[channelId]) {
                                    if (!scanFoundIds.has(`${channelId}:${msgId}`)) {
                                        markDeleted(channelId, msgId);
                                        reconciled++;
                                    }
                                }
                            }
                        }
                        if (reconciled > 0) {
                            flushDeleted();
                            console.log(`[Reconcile] Marked ${reconciled} package messages as already deleted`);
                        }
                    }

                    if (control.isCancelled) {
                        updateJob(jobId, { status: 'failed', error: 'Stopped by user' });
                        removeJobControl(jobId);
                        return;
                    }

                    // Phase 2: Delete all found messages
                    // Cooldown: let rate limits reset before starting deletions
                    updateJob(jobId, { totalItems: allMessages.length, currentChannel: 'Waiting for rate limit reset...' });
                    await new Promise(r => setTimeout(r, 3000));

                    updateJob(jobId, { currentChannel: `Deleting ${allMessages.length.toLocaleString()} messages...` });
                    let totalDeleted = 0;
                    let totalFailed = 0;

                    for (const { channelId, messageId } of allMessages) {
                        // Stop check
                        if (control.isCancelled) {
                            updateJob(jobId, { status: 'failed', error: 'Stopped by user' });
                            removeJobControl(jobId);
                            return;
                        }

                        // Pause loop
                        while (control.isPaused && !control.isCancelled) {
                            updateJob(jobId, { status: 'paused' });
                            await new Promise(r => setTimeout(r, 200));
                        }
                        if (control.isCancelled) {
                            updateJob(jobId, { status: 'failed', error: 'Stopped by user' });
                            removeJobControl(jobId);
                            return;
                        }
                        // Restore running status after unpause
                        if (useAppStore.getState().jobs.find(j => j.id === jobId)?.status === 'paused') {
                            updateJob(jobId, { status: 'running' });
                        }

                        let wasAlreadyDeleted = false;
                        let rateLimitRemaining: number | null = null;
                        let rateLimitResetMs: number | null = null;
                        try {
                            const result = await svc.deleteMessageWithRateInfo(channelId, messageId);
                            rateLimitRemaining = result.rateLimits.remaining;
                            rateLimitResetMs = result.rateLimits.resetAfterMs;
                            if (result.alreadyDeleted) {
                                wasAlreadyDeleted = true;
                                totalDeleted++;
                            } else if (result.success) {
                                totalDeleted++;
                                markDeleted(channelId, messageId);
                            } else {
                                totalFailed++;
                            }
                        } catch {
                            totalFailed++;
                        }

                        const processed = totalDeleted + totalFailed;
                        updateJob(jobId, {
                            deletedItems: totalDeleted,
                            failedItems: totalFailed,
                            progress: Math.round(processed / allMessages.length * 100),
                        });

                        if (wasAlreadyDeleted) {
                            await new Promise(r => setTimeout(r, 50));
                        } else if (rateLimitRemaining !== null && rateLimitRemaining <= 1 && rateLimitResetMs) {
                            // Almost out of rate limit budget — wait for reset
                            await new Promise(r => setTimeout(r, rateLimitResetMs + 100));
                        } else if (rateLimitRemaining !== null && rateLimitRemaining > 2) {
                            // Plenty of budget left — go faster
                            await new Promise(r => setTimeout(r, 200));
                        } else {
                            // Default: use configured speed
                            const currentDelay = getSpeedDelay(useAppStore.getState().settings.deletionSpeed);
                            await new Promise(r => setTimeout(r, currentDelay));
                        }
                    }

                    flushDeleted();
                    updateJob(jobId, {
                        status: 'completed',
                        progress: 100,
                        deletedItems: totalDeleted,
                        failedItems: totalFailed,
                        completedAt: new Date().toISOString(),
                    });
                    updatePlatformStats('discord', {
                        totalDeleted: (useAppStore.getState().platforms.discord?.stats?.totalDeleted || 0) + totalDeleted,
                        lastDeletionAt: new Date().toISOString(),
                    });
                    useAppStore.getState().addToast({
                        type: 'success',
                        message: `Deleted ${totalDeleted} messages from ${channelIds.length} channel(s)`,
                    });
                    removeJobControl(jobId);
                })().catch((err) => {
                    console.error('[Deletion] Unhandled error:', err);
                    useAppStore.getState().updateJob(jobId, {
                        status: 'failed',
                        error: err instanceof Error ? err.message : 'Unexpected error during deletion',
                    });
                    useAppStore.getState().addToast({
                        type: 'error',
                        message: `Deletion failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                    });
                    removeJobControl(jobId);
                });
            }
        } catch (err) {
            console.error(err);
            setIsDeleting(false);
        }
    };



    type TimePreset = 'all_time' | 'year' | 'month' | 'week' | 'yesterday' | 'now' | 'custom';

    interface DateFilterState {
        startPreset: TimePreset;
        endPreset: TimePreset;
        startDate: string;
        endDate: string;
    }

    const defaultDateFilter: DateFilterState = {
        startPreset: 'all_time',
        endPreset: 'now',
        startDate: '',
        endDate: '',
    };

    const [easyDateFilter, setEasyDateFilter] = useState<DateFilterState>(defaultDateFilter);
    const [advancedDateFilter, setAdvancedDateFilter] = useState<DateFilterState>(defaultDateFilter);

    const activeDateFilter = deletionMode === 'simple' ? easyDateFilter : advancedDateFilter;
    const setActiveDateFilter = deletionMode === 'simple' ? setEasyDateFilter : setAdvancedDateFilter;

    const calculateDateFromPreset = (preset: TimePreset): string => {
        const now = new Date();
        switch (preset) {
            case 'yesterday':
                now.setDate(now.getDate() - 1);
                break;
            case 'week':
                now.setDate(now.getDate() - 7);
                break;
            case 'month':
                now.setMonth(now.getMonth() - 1);
                break;
            case 'year':
                now.setFullYear(now.getFullYear() - 1);
                break;
            case 'now':
            case 'all_time':
                return '';
        }
        return now.toISOString().split('T')[0];
    };

    const handlePresetChange = (type: 'start' | 'end', preset: TimePreset) => {
        const newDate = calculateDateFromPreset(preset);
        setActiveDateFilter(prev => ({
            ...prev,
            [`${type}Preset`]: preset,
            [`${type}Date`]: newDate
        }));
    };

    const [expandedGuilds, setExpandedGuilds] = useState<Set<string>>(new Set());
    const [guildChannels, setGuildChannels] = useState<Record<string, DiscordChannel[]>>({});
    const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
    const [isLoadingChannels, setIsLoadingChannels] = useState(false);

    const loadGuildChannels = async (guildId: string) => {
        if (guildChannels[guildId]) return; // Already loaded

        setIsLoadingChannels(true);
        try {
            let channels;
            if (isElectron) {
                channels = await window.electronAPI!.discord.getGuildChannels(guildId);
            } else {
                const token = platform?.token || sessionStorage.getItem(`burndata-token-${platformId}`) || '';
                if (!token) { setIsLoadingChannels(false); return; }
                const svc = new DiscordService(token);
                channels = await svc.getGuildChannels(guildId);
            }
            setGuildChannels(prev => ({ ...prev, [guildId]: channels }));
        } catch (err) {
            console.error(`Failed to load channels for guild ${guildId}`, err);
        } finally {
            setIsLoadingChannels(false);
        }
    };

    const toggleGuildExpand = async (guildId: string) => {
        const newExpanded = new Set(expandedGuilds);
        if (newExpanded.has(guildId)) {
            newExpanded.delete(guildId);
        } else {
            newExpanded.add(guildId);
            await loadGuildChannels(guildId);
        }
        setExpandedGuilds(newExpanded);
    };

    const toggleChannelSelection = (channelId: string) => {
        const newSelected = new Set(selectedChannels);
        if (newSelected.has(channelId)) {
            newSelected.delete(channelId);
        } else {
            newSelected.add(channelId);
        }
        setSelectedChannels(newSelected);
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsImportingPackage(true);
        try {
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(file);

            // Find index.json (case-insensitive path matching)
            let indexData: Record<string, string> = {};
            for (const [path, zipEntry] of Object.entries(zip.files)) {
                if (/messages\/index\.json$/i.test(path)) {
                    const content = await zipEntry.async('string');
                    indexData = JSON.parse(content);
                    break;
                }
            }

            const channelMessages: Record<string, { channelId: string; name: string; messageIds: string[]; count: number }> = {};

            for (const [filePath, zipEntry] of Object.entries(zip.files)) {
                // Match both old format (messages/c123/messages.csv) and new (Messages/c123/messages.json or messages.csv)
                const match = filePath.match(/[Mm]essages\/c?(\d+)\/messages\.(csv|json)$/);
                if (!match) continue;

                const channelId = match[1];
                const fileType = match[2];
                const channelName = indexData[channelId] || `Channel ${channelId}`;
                const content = await zipEntry.async('string');
                const messageIds: string[] = [];

                if (fileType === 'json') {
                    // New format: JSON array of message objects
                    try {
                        const messages = JSON.parse(content);
                        if (Array.isArray(messages)) {
                            for (const msg of messages) {
                                const id = msg.ID || msg.id || msg.Id;
                                if (id && /^\d+$/.test(String(id))) {
                                    messageIds.push(String(id));
                                }
                            }
                        }
                    } catch { /* skip malformed JSON */ }
                } else {
                    // Old format: CSV with ID as first column
                    const lines = content.split('\n');
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const firstComma = line.indexOf(',');
                        if (firstComma > 0) {
                            const id = line.substring(0, firstComma);
                            if (/^\d+$/.test(id)) messageIds.push(id);
                        }
                    }
                }

                if (messageIds.length > 0) {
                    channelMessages[channelId] = { channelId, name: channelName, messageIds, count: messageIds.length };
                }
            }

            console.log('[Import] Parsed', Object.keys(channelMessages).length, 'channels');

            const totalMessages = Object.values(channelMessages).reduce((sum, ch) => sum + ch.count, 0);
            const channelCount = Object.keys(channelMessages).length;
            setDataPackage({ channels: channelMessages, totalMessages, channelCount });
            addToast({ type: 'success', message: `Imported ${totalMessages.toLocaleString()} messages from ${channelCount} channels` });
        } catch (err: any) {
            addToast({ type: 'error', message: err.message || 'Failed to parse ZIP' });
        } finally {
            setIsImportingPackage(false);
            // Reset input so same file can be re-selected
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const totalSelected = selectedGuilds.size + selectedDMs.size;

    const getTargetsCount = () => {
        if (deletionMode === 'simple') {
            return totalSelected;
        } else {
            // In advanced mode, channels are for servers; DMs always use simple deletion
            return selectedChannels.size + selectedDMs.size;
        }
    };

    const targetsCount = getTargetsCount();

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="max-w-4xl mx-auto pb-20" // Added padding bottom for status bar
        >
            {/* Hidden file input for browser ZIP import */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileSelected}
                style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}
            />
            {/* ... (Existing JSX) ... */}

            {/* Back Button */}
            <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 text-burn-muted hover:text-burn-cream transition-colors mb-6"
            >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Dashboard</span>
            </button>

            {/* Platform Header */}
            <div className="flex items-center justify-between mb-8">
                {/* ... header content ... */}
                <div className="flex items-center gap-4">
                    <div className={`p-4 bg-gradient-to-br ${config.gradient}`}>
                        <PlatformIcon className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <h1 className="font-heading text-2xl font-black text-burn-cream uppercase tracking-wider">{config.name}</h1>
                        <p className="text-burn-muted">
                            {platform.connected ? (
                                <span className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-discord-green"></span>
                                    Logged in as {platform.user?.username}
                                </span>
                            ) : 'Connect to start deleting'}
                        </p>
                    </div>
                </div>

                {platform.connected && (
                    <button
                        onClick={handleDisconnect}
                        className="flex items-center gap-2 px-4 py-2 border border-dark-600 hover:bg-dark-700 text-burn-text transition-colors text-sm"
                    >
                        <LogOut className="w-4 h-4" />
                        Disconnect
                    </button>
                )}
            </div>

            {/* Content Area */}
            <AnimatePresence mode="wait">
                {!platform.connected ? (
                    // ... connect UI ...
                    <motion.div
                        key="connect"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="space-y-6 max-w-2xl mx-auto"
                    >
                        {/* Warning Banner */}
                        <div className="flex items-start gap-4 p-5 bg-red-500/10 border-2 border-red-500/40 shadow-lg shadow-red-500/5">
                            <div className="flex-shrink-0 mt-0.5 p-2 bg-red-500/20">
                                <AlertTriangle className="w-6 h-6 text-red-400" />
                            </div>
                            <div>
                                <p className="font-bold text-red-400 text-base">Account Risk Warning</p>
                                <p className="text-sm text-burn-text mt-2 leading-relaxed">
                                    This tool uses your {config.name} account token to perform actions on your behalf.
                                    Using self-bots or automated user accounts <strong className="text-burn-cream">violates {config.name}&apos;s Terms of Service</strong> and
                                    may result in your account being suspended or permanently banned.
                                    Your data stays on your device. <strong className="text-burn-cream">Use at your own risk.</strong>
                                </p>
                            </div>
                        </div>

                        {/* Login Options UI - Same as before */}
                        <div className="glass-card p-8">
                            {/* ... same login form ... */}
                            <div className="text-center mb-8">
                                <h3 className="text-xl font-bold text-burn-cream mb-2">Connect your account</h3>
                                <p className="text-burn-muted">Select a method to log in to Discord</p>
                            </div>

                            <div className="space-y-4">
                                {config.supportsAutoLogin && (
                                    <button
                                        onClick={handleAutoLogin}
                                        disabled={isConnecting || !isElectron}
                                        className="w-full flex items-center justify-center gap-3 p-4 font-bold text-white transition-all disabled:opacity-50 hover:opacity-90 active:scale-95"
                                        style={{ backgroundColor: isElectron ? config.color : '#3f3f46' }}
                                    >
                                        {isConnecting ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                Logging in...
                                            </>
                                        ) : (
                                            <>
                                                <LogIn className="w-5 h-5" />
                                                Auto Login (Recommended)
                                            </>
                                        )}
                                    </button>
                                )}

                                <div className="relative py-4">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-dark-700"></div>
                                    </div>
                                    <div className="relative flex justify-center text-sm">
                                        <span className="px-2 bg-dark-950 text-burn-muted">Or use token</span>
                                    </div>
                                </div>

                                <button
                                    onClick={() => setShowManualInput(!showManualInput)}
                                    className="w-full flex items-center justify-center gap-3 p-4 bg-dark-800 text-burn-cream font-medium hover:bg-dark-700 transition-all border border-dark-700"
                                >
                                    <Key className="w-5 h-5" />
                                    Enter Token Manually
                                </button>
                            </div>

                            {/* Manual Input Form */}
                            <AnimatePresence>
                                {showManualInput && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="pt-6">
                                            <input
                                                type="password"
                                                value={manualToken}
                                                onChange={(e) => {
                                                    setManualToken(e.target.value);
                                                    setError('');
                                                }}
                                                placeholder="Paste your token here..."
                                                className="input-field mb-4"
                                                onKeyDown={(e) => e.key === 'Enter' && handleManualConnect()}
                                            />
                                            <button
                                                onClick={handleManualConnect}
                                                disabled={isConnecting || !manualToken.trim()}
                                                className="w-full flex items-center justify-center gap-2 p-3 bg-dark-700 hover:bg-dark-600 text-burn-cream font-medium transition-colors"
                                            >
                                                Connect
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {error && (
                                <div className="mt-6 flex items-center gap-2 p-4 bg-discord-red/10 border border-discord-red/30">
                                    <AlertTriangle className="w-5 h-5 text-discord-red" />
                                    <p className="text-discord-red text-sm">{error}</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="connected"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6"
                    >
                        {/* Tabs */}
                        <div className="flex items-center gap-2 p-1 bg-dark-800/50 w-fit">
                            {[
                                { id: 'overview', label: 'Overview', icon: CheckCircle },
                                { id: 'servers', label: 'Servers', icon: Users },
                                { id: 'dms', label: 'DMs', icon: MessageSquare },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`
                                        flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all
                                        ${activeTab === tab.id
                                            ? 'bg-discord-blurple text-white shadow-lg shadow-discord-blurple/20'
                                            : 'text-burn-muted hover:text-burn-cream hover:bg-dark-700'
                                        }
                                    `}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Main Content */}
                        {renderTabContent()}

                    </motion.div>
                )}
            </AnimatePresence>

            {/* Action Bar */}
            <AnimatePresence>
                {totalSelected > 0 && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4"
                    >
                        <div className="bg-dark-800/90 backdrop-blur-xl border border-dark-600 p-4 shadow-2xl flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-discord-blurple/20 text-discord-blurple">
                                    <CheckCircle className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="font-bold text-burn-cream">{totalSelected} item{totalSelected !== 1 ? 's' : ''} selected</p>
                                    <p className="text-sm text-burn-muted">Ready to configure deletion</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={clearSelection}
                                    className="px-4 py-2 text-burn-muted hover:text-burn-cream font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => setShowDeletionModal(true)}
                                    className="px-6 py-2 bg-discord-red hover:bg-discord-red/90 text-white font-bold shadow-lg shadow-discord-red/20 transition-all active:scale-95"
                                >
                                    Configure & Delete
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Deletion Configuration Modal */}
            <AnimatePresence>
                {showDeletionModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-2xl bg-dark-900 border border-dark-700 shadow-2xl max-h-[90vh] flex flex-col"
                        >
                            {/* Modal Header */}
                            <div className="p-6 border-b border-dark-700 flex items-center justify-between">
                                <h2 className="text-xl font-bold text-burn-cream">Configure Deletion</h2>
                                <button
                                    onClick={() => setShowDeletionModal(false)}
                                    className="p-2 text-burn-muted hover:text-burn-cream transition-colors"
                                >
                                    <div className="w-6 h-6">✕</div>
                                </button>
                            </div>

                            {/* Modal Content */}
                            <div className="p-6 overflow-y-auto flex-1">
                                {/* Mode Selection */}
                                <div className="grid grid-cols-2 gap-4 mb-8">
                                    <div
                                        onClick={() => setDeletionMode('simple')}
                                        className={`p-4 border-2 cursor-pointer transition-all ${deletionMode === 'simple'
                                            ? 'border-discord-blurple bg-discord-blurple/10'
                                            : 'border-dark-700 hover:border-dark-600'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="p-2 bg-discord-green/20 text-discord-green">
                                                <CheckCircle className="w-5 h-5" />
                                            </div>
                                            <h3 className="font-bold text-burn-cream">Easy Mode</h3>
                                        </div>
                                        <p className="text-sm text-burn-muted">
                                            Delete all your messages in the selected servers/DMs. Best for cleaning up quickly.
                                        </p>
                                    </div>

                                    <div
                                        onClick={() => setDeletionMode('advanced')}
                                        className={`p-4 border-2 cursor-pointer transition-all ${deletionMode === 'advanced'
                                            ? 'border-discord-blurple bg-discord-blurple/10'
                                            : 'border-dark-700 hover:border-dark-600'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="p-2 bg-discord-yellow/20 text-discord-yellow">
                                                <Users className="w-5 h-5" />
                                            </div>
                                            <h3 className="font-bold text-burn-cream">Advanced Mode</h3>
                                        </div>
                                        <p className="text-sm text-burn-muted">
                                            Select specific channels from servers. Filter by date, keywords, or message type.
                                        </p>
                                    </div>
                                </div>

                                {/* Common: Date Range Configuration */}
                                <div className="mb-8 p-6 bg-dark-800 border border-dark-700">
                                    <h3 className="text-lg font-bold text-burn-cream mb-4 flex items-center gap-2">
                                        <div className="p-1 rounded bg-discord-blurple/20 text-discord-blurple">
                                            <CheckCircle className="w-4 h-4" />
                                        </div>
                                        Time Range
                                    </h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* From */}
                                        <div className="space-y-3">
                                            <label className="text-sm font-medium text-burn-text">From</label>
                                            <div className="flex flex-wrap gap-2">
                                                {[
                                                    { id: 'all_time', label: 'All Time' },
                                                    { id: 'year', label: '1 Year ago' },
                                                    { id: 'month', label: '1 Month ago' },
                                                    { id: 'week', label: '1 Week ago' },
                                                    { id: 'yesterday', label: 'Yesterday' },
                                                ].map(opt => (
                                                    <button
                                                        key={opt.id}
                                                        onClick={() => handlePresetChange('start', opt.id as TimePreset)}
                                                        className={`px-3 py-1.5 text-xs font-medium transition-all ${activeDateFilter.startPreset === opt.id
                                                            ? 'bg-discord-blurple text-white'
                                                            : 'bg-dark-700 text-burn-muted hover:text-burn-cream'
                                                            }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => handlePresetChange('start', 'custom')}
                                                    className={`px-3 py-1.5 text-xs font-medium transition-all ${activeDateFilter.startPreset === 'custom'
                                                        ? 'bg-discord-blurple text-white'
                                                        : 'bg-dark-700 text-burn-muted hover:text-burn-cream'
                                                        }`}
                                                >
                                                    Custom
                                                </button>
                                            </div>
                                            <input
                                                type="date"
                                                className={`input-field w-full text-sm transition-opacity ${activeDateFilter.startPreset === 'all_time' && !activeDateFilter.startDate ? 'opacity-50' : 'opacity-100'}`}
                                                value={activeDateFilter.startDate}
                                                onChange={(e) => setActiveDateFilter(prev => ({ ...prev, startPreset: 'custom', startDate: e.target.value }))}
                                            />
                                        </div>

                                        {/* To */}
                                        <div className="space-y-3">
                                            <label className="text-sm font-medium text-burn-text">To</label>
                                            <div className="flex flex-wrap gap-2">
                                                {[
                                                    { id: 'now', label: 'Now' },
                                                    { id: 'yesterday', label: 'Yesterday' },
                                                    { id: 'week', label: '1 Week ago' },
                                                    { id: 'month', label: '1 Month ago' },
                                                    { id: 'year', label: '1 Year ago' },
                                                ].map(opt => (
                                                    <button
                                                        key={opt.id}
                                                        onClick={() => handlePresetChange('end', opt.id as TimePreset)}
                                                        className={`px-3 py-1.5 text-xs font-medium transition-all ${activeDateFilter.endPreset === opt.id
                                                            ? 'bg-discord-blurple text-white'
                                                            : 'bg-dark-700 text-burn-muted hover:text-burn-cream'
                                                            }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => handlePresetChange('end', 'custom')}
                                                    className={`px-3 py-1.5 text-xs font-medium transition-all ${activeDateFilter.endPreset === 'custom'
                                                        ? 'bg-discord-blurple text-white'
                                                        : 'bg-dark-700 text-burn-muted hover:text-burn-cream'
                                                        }`}
                                                >
                                                    Custom
                                                </button>
                                            </div>
                                            <input
                                                type="date"
                                                className={`input-field w-full text-sm transition-opacity ${activeDateFilter.endPreset === 'now' && !activeDateFilter.endDate ? 'opacity-50' : 'opacity-100'}`}
                                                value={activeDateFilter.endDate}
                                                onChange={(e) => setActiveDateFilter(prev => ({ ...prev, endPreset: 'custom', endDate: e.target.value }))}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {deletionMode === 'simple' ? (
                                    <div className="space-y-4">
                                        <div className="p-4 bg-discord-blurple/10 border border-discord-blurple/30 flex items-start gap-3">
                                            <CheckCircle className="w-5 h-5 text-discord-blurple mt-0.5" />
                                            <div>
                                                <h4 className="font-bold text-burn-cream text-sm">Ready to clean</h4>
                                                <p className="text-sm text-burn-text mt-1">
                                                    We will delete messages from
                                                    <span className="text-burn-cream font-medium"> {activeDateFilter.startPreset === 'all_time' ? 'the beginning' : activeDateFilter.startDate} </span>
                                                    to
                                                    <span className="text-burn-cream font-medium"> {activeDateFilter.endPreset === 'now' ? 'now' : activeDateFilter.endDate} </span>
                                                    in all selected servers/DMs.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        <h3 className="text-lg font-bold text-burn-cream">Target Specific Channels</h3>

                                        {/* Iterate selected servers */}
                                        {Array.from(selectedGuilds).map(guildId => {
                                            const guild = guilds.find(g => g.id === guildId);
                                            const enrichedChannels = guildChannels[guildId] || [];
                                            const isExpanded = expandedGuilds.has(guildId);

                                            // Group channels by category
                                            const categories = enrichedChannels
                                                .filter(c => c.type === 4) // Type 4 is Category
                                                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                                            const channelsByParent: Record<string, DiscordChannel[]> = {};
                                            const orphanChannels: DiscordChannel[] = []; // No category

                                            enrichedChannels.forEach(c => {
                                                if (c.type === 0) { // Text Channel
                                                    if (c.parent_id) {
                                                        if (!channelsByParent[c.parent_id]) {
                                                            channelsByParent[c.parent_id] = [];
                                                        }
                                                        channelsByParent[c.parent_id].push(c);
                                                    } else {
                                                        orphanChannels.push(c);
                                                    }
                                                }
                                            });

                                            return (
                                                <div key={guildId} className="border border-dark-700 overflow-hidden">
                                                    <div
                                                        className="p-4 bg-dark-800 flex items-center justify-between cursor-pointer hover:bg-dark-750"
                                                        onClick={() => toggleGuildExpand(guildId)}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {guild?.icon ? (
                                                                <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`} className="w-8 h-8 rounded-full" />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded-full bg-dark-600"></div>
                                                            )}
                                                            <span className="font-bold text-burn-cream">{guild?.name}</span>
                                                        </div>
                                                        <div className="text-burn-muted">
                                                            {isExpanded ? '▼' : '▶'}
                                                        </div>
                                                    </div>

                                                    {isExpanded && (
                                                        <div className="bg-dark-900 p-4 border-t border-dark-700">
                                                            {isLoadingChannels && enrichedChannels.length === 0 ? (
                                                                <div className="text-center py-4 text-burn-muted">Loading channels...</div>
                                                            ) : (
                                                                <div className="space-y-4 max-h-80 overflow-y-auto pr-2">

                                                                    {/* Render Channels in Categories */}
                                                                    {categories.map(cat => {
                                                                        const catChannels = channelsByParent[cat.id];
                                                                        if (!catChannels || catChannels.length === 0) return null;

                                                                        return (
                                                                            <div key={cat.id}>
                                                                                <h4 className="text-xs font-bold text-burn-muted uppercase tracking-wider mb-2 flex items-center gap-1">
                                                                                    {cat.name}
                                                                                </h4>
                                                                                <div className="space-y-1 ml-2 border-l-2 border-dark-700 pl-2">
                                                                                    {catChannels.map(channel => (
                                                                                        <div
                                                                                            key={channel.id}
                                                                                            className="flex items-center gap-3 p-2 hover:bg-dark-800 cursor-pointer"
                                                                                            onClick={() => toggleChannelSelection(channel.id)}
                                                                                        >
                                                                                            <div className={`w-4 h-4 rounded border flex-shrink-0 ${selectedChannels.has(channel.id) ? 'bg-discord-blurple border-discord-blurple' : 'border-dark-500'}`}>
                                                                                                {selectedChannels.has(channel.id) && <div className="text-white text-[10px] flex items-center justify-center h-full">✓</div>}
                                                                                            </div>
                                                                                            <span className={`text-sm truncate ${selectedChannels.has(channel.id) ? 'text-burn-cream font-medium' : 'text-burn-text'}`}># {channel.name}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}

                                                                    {/* Render Orphan Channels */}
                                                                    {orphanChannels.length > 0 && (
                                                                        <div>
                                                                            {categories.length > 0 && <h4 className="text-xs font-bold text-burn-muted uppercase tracking-wider mb-2">Uncategorized</h4>}
                                                                            <div className="space-y-1 ml-2">
                                                                                {orphanChannels.map(channel => (
                                                                                    <div
                                                                                        key={channel.id}
                                                                                        className="flex items-center gap-3 p-2 hover:bg-dark-800 cursor-pointer"
                                                                                        onClick={() => toggleChannelSelection(channel.id)}
                                                                                    >
                                                                                        <div className={`w-4 h-4 rounded border flex-shrink-0 ${selectedChannels.has(channel.id) ? 'bg-discord-blurple border-discord-blurple' : 'border-dark-500'}`}>
                                                                                            {selectedChannels.has(channel.id) && <div className="text-white text-[10px] flex items-center justify-center h-full">✓</div>}
                                                                                        </div>
                                                                                        <span className={`text-sm truncate ${selectedChannels.has(channel.id) ? 'text-burn-cream font-medium' : 'text-burn-text'}`}># {channel.name}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {enrichedChannels.length === 0 && <p className="text-burn-muted text-sm">No text channels found.</p>}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {selectedGuilds.size === 0 && selectedDMs.size > 0 && (
                                            <p className="text-burn-muted italic">Advanced channel selection is currently only available for Servers. For DMs, simple deletion applies to the whole conversation.</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Footer / Progress Area */}
                            <div className="p-6 border-t border-dark-700 bg-dark-800/50">
                                {isDeleting ? (
                                    <div className="flex flex-col items-center justify-center p-4 space-y-3">
                                        <Loader2 className="w-6 h-6 animate-spin text-discord-blurple" />
                                        <span className="text-burn-cream font-medium">Starting background job...</span>
                                        <p className="text-xs text-burn-muted">You can close this window, the job will continue in background.</p>
                                    </div>


                                ) : (
                                    <div className="flex justify-end gap-3">
                                        <button
                                            onClick={() => setShowDeletionModal(false)}
                                            className="px-4 py-2 text-burn-text hover:text-burn-cream font-medium"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleStartDeletion}
                                            disabled={targetsCount === 0 || isDeleting}
                                            className={`px-6 py-2 font-bold transition-all ${targetsCount === 0 || isDeleting
                                                ? 'bg-dark-600 text-burn-muted cursor-not-allowed'
                                                : 'bg-discord-red hover:bg-discord-red/90 text-white shadow-lg shadow-discord-red/20 active:scale-95'
                                                }`}
                                        >
                                            {isDeleting ? 'Starting...' : `Start Deletion (${targetsCount} target${targetsCount !== 1 ? 's' : ''})`}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Add DM by User ID Modal */}
            <AnimatePresence>
                {showAddDMModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                        onClick={() => setShowAddDMModal(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-md bg-dark-900 border border-dark-700 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-6 border-b border-dark-700">
                                <h2 className="text-lg font-bold text-burn-cream flex items-center gap-2">
                                    <UserPlus className="w-5 h-5 text-discord-blurple" />
                                    Add DM by User ID
                                </h2>
                                <p className="text-sm text-burn-muted mt-1">
                                    Enter a Discord User ID to find an old/closed DM conversation.
                                </p>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-burn-text mb-2">
                                        User ID
                                    </label>
                                    <input
                                        type="text"
                                        value={addDMUserId}
                                        onChange={(e) => setAddDMUserId(e.target.value)}
                                        placeholder="e.g. 312705763091021824"
                                        className="input-field w-full"
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddDMByUserId()}
                                    />
                                    <p className="text-xs text-burn-muted mt-2">
                                        💡 Right-click a user profile → Copy User ID
                                    </p>
                                </div>

                                {addDMError && (
                                    <div className="p-3 bg-discord-red/10 border border-discord-red/30">
                                        <p className="text-sm text-discord-red">{addDMError}</p>
                                    </div>
                                )}
                            </div>
                            <div className="p-6 border-t border-dark-700 flex justify-end gap-3">
                                <button
                                    onClick={() => {
                                        setShowAddDMModal(false);
                                        setAddDMUserId('');
                                        setAddDMError('');
                                    }}
                                    className="px-4 py-2 text-burn-text hover:text-burn-cream font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddDMByUserId}
                                    disabled={isAddingDM || !addDMUserId.trim()}
                                    className={`px-6 py-2 font-bold transition-all flex items-center gap-2 ${isAddingDM || !addDMUserId.trim()
                                        ? 'bg-dark-600 text-burn-muted cursor-not-allowed'
                                        : 'bg-discord-blurple hover:bg-discord-blurple/90 text-white'
                                        }`}
                                >
                                    {isAddingDM ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Searching...
                                        </>
                                    ) : (
                                        <>
                                            <Plus className="w-4 h-4" />
                                            Add DM
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
