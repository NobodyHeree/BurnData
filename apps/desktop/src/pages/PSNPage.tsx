import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
    Users,
    LogOut,
    ExternalLink,
    Search,
    CheckCircle2,
    XCircle,
    Loader2,
    UserMinus,
    AlertTriangle,
    ArrowUpAZ,
    ArrowDownAZ,
    Crown,
    Filter,
    Globe,
    Wifi,
    WifiOff,
    Clock3
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { PlayStationLogo } from '../components/logos';

type SortOrder = 'a-z' | 'z-a' | 'last-online-recent' | 'last-online-old' | 'none';
type FilterType = 'all' | 'plus' | 'no-plus' | 'online' | 'offline' | 'ps5' | 'ps4';

// Format relative time
function formatLastOnline(dateStr?: string): string {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
}

export function PSNPage() {
    const { platforms, connectPlatform, disconnectPlatform, addJob, jobs, addToast } = useAppStore();
    const platform = platforms['psn'];

    // Get active PSN unfriend job if exists
    // Only show running/pending jobs in the UI
    const activeUnfriendJob = jobs.find(j => j.platformId === 'psn' && (j.status === 'running' || j.status === 'pending'));

    // Track the last completed job separately for cleanup
    const lastCompletedJob = useMemo(() => {
        return jobs
            .filter(j => j.platformId === 'psn' && j.status === 'completed')
            .sort((a, b) => {
                const aTime = new Date(a.completedAt || a.startedAt).getTime();
                const bTime = new Date(b.completedAt || b.startedAt).getTime();
                return bTime - aTime;
            })[0];
    }, [jobs]);

    // Auth state
    const [npssoToken, setNpssoToken] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    // Friends state - using global store for persistence
    const friends = useAppStore((state) => state.psnFriends);
    const setPSNFriends = useAppStore((state) => state.setPSNFriends);
    const hasPresenceData = useAppStore((state) => state.psnHasPresenceData);
    const setPSNHasPresenceData = useAppStore((state) => state.setPSNHasPresenceData);

    const [isLoadingFriends, setIsLoadingFriends] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
    const [unfriendingIds, setUnfriendingIds] = useState<Set<string>>(new Set()); // Track IDs being unfriended
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false); // Prevent double loading

    // Ref to preserve scroll position when selecting friends
    const scrollPositionRef = useRef<number>(0);
    const friendsListRef = useRef<HTMLDivElement>(null);

    // Presence state - using global store for background loading
    const isLoadingPresence = useAppStore((state) => state.psnPresenceLoading);
    const presenceProgress = useAppStore((state) => state.psnPresenceProgress);

    // Filter & Sort state
    const [sortOrder, setSortOrder] = useState<SortOrder>('none');
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [languageFilter, setLanguageFilter] = useState<string>('all');

    // Preview modal state
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [confirmCountdown, setConfirmCountdown] = useState(3);

    // Unfriend progress - removed local state, now using job system

    // Active friends = friends minus those being unfriended
    const activeFriends = useMemo(() => {
        return friends.filter(f => !unfriendingIds.has(f.accountId));
    }, [friends, unfriendingIds]);

    // Get unique languages from active friends
    const availableLanguages = useMemo(() => {
        const langs = new Set<string>();
        activeFriends.forEach(f => f.languages?.forEach(l => langs.add(l)));
        return Array.from(langs).sort();
    }, [activeFriends]);

    // Stats (using active friends)
    const stats = useMemo(() => {
        return {
            total: activeFriends.length,
            plus: activeFriends.filter(f => f.isPlus).length,
            online: activeFriends.filter(f => f.onlineStatus === 'online').length,
            ps5: activeFriends.filter(f => f.platform?.toUpperCase() === 'PS5').length,
            ps4: activeFriends.filter(f => f.platform?.toUpperCase() === 'PS4').length,
        };
    }, [activeFriends]);

    // Check auth on mount
    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        if (!window.electronAPI) return;
        if (hasLoadedOnce) return; // Prevent double loading
        setHasLoadedOnce(true); // Set before async call to prevent race condition

        const authResult = await window.electronAPI.psn.isAuthenticated();
        if (authResult.authenticated && !platform?.connected) {
            connectPlatform('psn', 'authenticated', { id: '', username: authResult.username || 'PlayStation User' });
            loadFriends();
        } else if (!authResult.authenticated && platform?.connected) {
            // Token lost but platform still marked as connected - fix it
            disconnectPlatform('psn');
        }
    };

    const handleLogin = async () => {
        if (!window.electronAPI || !npssoToken.trim()) return;

        setIsLoggingIn(true);
        setLoginError(null);

        try {
            const result = await window.electronAPI.psn.login(npssoToken.trim());
            if (result.success) {
                connectPlatform('psn', 'authenticated', {
                    id: '',
                    username: result.username || 'PlayStation User'
                });
                setNpssoToken('');
                loadFriends();
            } else {
                setLoginError(result.error || 'Login failed');
            }
        } catch (error) {
            setLoginError(String(error));
        } finally {
            setIsLoggingIn(false);
        }
    };

    const handleLogout = async () => {
        if (!window.electronAPI) return;

        console.log('[PSNPage] Logging out from PSN...');

        try {
            // Backend logout (clears token)
            await window.electronAPI.psn.logout();

            // Frontend cleanup - reset ALL state
            disconnectPlatform('psn');
            setPSNFriends([]);
            setPSNHasPresenceData(false);
            setSelectedFriends(new Set());
            setUnfriendingIds(new Set());
            setNpssoToken(''); // Clear input field
            setLoginError(null); // Clear any login errors
            setHasLoadedOnce(false); // Reset load flag
            setSearchQuery(''); // Clear search
            setSortOrder('none'); // Reset sort
            setFilterType('all'); // Reset filter
            setLanguageFilter('all'); // Reset language filter

            console.log('[PSNPage] Logged out successfully - all state cleared');
        } catch (error) {
            console.error('[PSNPage] Logout failed:', error);
        }
    };

    const loadFriends = async (preservePresence = false) => {
        if (!window.electronAPI) return;

        setIsLoadingFriends(true);
        try {
            const friendsList = await window.electronAPI.psn.getFriends();

            // If preserving presence data, merge it back into the new friends list
            if (preservePresence && hasPresenceData) {
                const presenceMap = new Map(
                    friends.map(f => [f.accountId, {
                        onlineStatus: f.onlineStatus,
                        lastOnlineDate: f.lastOnlineDate,
                        platform: f.platform,
                        currentGame: f.currentGame
                    }])
                );

                const mergedFriends = friendsList.map(f => ({
                    ...f,
                    ...(presenceMap.get(f.accountId) || {})
                }));

                setPSNFriends(mergedFriends);
            } else {
                setPSNFriends(friendsList);

                // Auto-load presence data after loading friends (unless we're preserving)
                if (friendsList.length > 0) {
                    setTimeout(() => loadPresence(), 500);
                }
            }
        } catch (error: any) {
            console.error('Failed to load friends:', error);

            // Check for token expiration
            if (error.message?.includes('PSN_TOKEN_EXPIRED')) {
                // Auto-logout on token expiration
                disconnectPlatform('psn');
                setPSNFriends([]);
                setPSNHasPresenceData(false);
                setSelectedFriends(new Set());
                setUnfriendingIds(new Set());
                setNpssoToken('');
                setLoginError('Your session has expired. Please login again.');
                setHasLoadedOnce(false);
            } else {
                setLoginError(error.message || 'Failed to load friends');
            }
        } finally {
            setIsLoadingFriends(false);
        }
    };

    const loadPresence = () => {
        // Prevent duplicate calls
        if (isLoadingPresence) {
            console.log('[PSNPage] Presence already loading, skipping duplicate call');
            return;
        }

        console.log('[PSNPage] Triggering presence load');
        // Call the global presence loader (runs in background via PSNPresenceManager)
        if ((window as any).psnLoadPresence) {
            (window as any).psnLoadPresence();
        }
    };

    const toggleFriend = (accountId: string) => {
        // Save scroll position before updating selection
        if (friendsListRef.current) {
            scrollPositionRef.current = friendsListRef.current.scrollTop;
        }

        setSelectedFriends(prev => {
            const next = new Set(prev);
            if (next.has(accountId)) {
                next.delete(accountId);
            } else {
                next.add(accountId);
            }
            return next;
        });
    };

    // Restore scroll position after selection changes
    useEffect(() => {
        if (friendsListRef.current && scrollPositionRef.current > 0) {
            friendsListRef.current.scrollTop = scrollPositionRef.current;
        }
    }, [selectedFriends]);

    const selectAll = () => {
        setSelectedFriends(new Set(filteredFriends.map(f => f.accountId)));
    };

    const deselectAll = () => {
        setSelectedFriends(new Set());
    };

    const selectInactiveForYears = (years: number) => {
        const cutoffDate = new Date();
        cutoffDate.setFullYear(cutoffDate.getFullYear() - years);

        const inactiveFriends = activeFriends.filter(f => {
            if (!f.lastOnlineDate) return false; // Skip if no date
            const lastOnline = new Date(f.lastOnlineDate);
            return lastOnline < cutoffDate;
        });

        setSelectedFriends(new Set(inactiveFriends.map(f => f.accountId)));

        // Auto-sort by oldest first so the selection makes visual sense
        setSortOrder('last-online-old');
    };

    // Count inactive friends by years (using active friends)
    const getInactiveCount = (years: number): number => {
        const cutoffDate = new Date();
        cutoffDate.setFullYear(cutoffDate.getFullYear() - years);

        return activeFriends.filter(f => {
            if (!f.lastOnlineDate) return false;
            const lastOnline = new Date(f.lastOnlineDate);
            return lastOnline < cutoffDate;
        }).length;
    };

    // Show preview modal instead of immediately unfriending
    const handleUnfriendClick = () => {
        if (selectedFriends.size === 0) return;
        setShowPreviewModal(true);
        setConfirmCountdown(3);
    };

    // Countdown timer for confirmation
    useEffect(() => {
        if (!showPreviewModal || confirmCountdown <= 0) return;

        const timer = setTimeout(() => {
            setConfirmCountdown(prev => prev - 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [showPreviewModal, confirmCountdown]);

    // Actually perform the unfriend operation
    const confirmUnfriend = async () => {
        if (!window.electronAPI || selectedFriends.size === 0) return;

        const accountIds = Array.from(selectedFriends);
        console.log('[PSNPage] Starting unfriend for', accountIds.length, 'friends');

        // Close modal
        setShowPreviewModal(false);

        try {
            // Mark these IDs as being unfriended
            setUnfriendingIds(new Set(accountIds));
            console.log('[PSNPage] Marked as unfriending:', accountIds.length, 'IDs');

            const result = await window.electronAPI.psn.startUnfriend({ accountIds });

            if (result.success && result.jobId) {
                // Create job in the store
                addJob({
                    id: result.jobId,
                    platformId: 'psn',
                    status: 'running',
                    totalItems: accountIds.length,
                    deletedItems: 0,
                    failedItems: 0,
                    startedAt: new Date().toISOString(),
                    progress: 0
                });

                // Clear selection immediately
                setSelectedFriends(new Set());
            }
        } catch (error) {
            console.error('Unfriend failed:', error);
        }
    };

    // Export friends list as JSON
    const exportFriendsList = () => {
        const selectedFriendsList = activeFriends.filter(f => selectedFriends.has(f.accountId));
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalCount: selectedFriendsList.length,
            friends: selectedFriendsList.map(f => ({
                accountId: f.accountId,
                onlineId: f.onlineId,
                isPlus: f.isPlus,
                onlineStatus: f.onlineStatus,
                lastOnlineDate: f.lastOnlineDate,
                platform: f.platform,
                currentGame: f.currentGame,
                languages: f.languages,
                aboutMe: f.aboutMe
            }))
        };

        // Create blob and download
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `psn-friends-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast({ type: 'success', message: `Exported ${selectedFriendsList.length} friends to JSON` });
    };

    // Get preview statistics
    const previewStats = useMemo(() => {
        const selectedList = activeFriends.filter(f => selectedFriends.has(f.accountId));
        return {
            total: selectedList.length,
            plus: selectedList.filter(f => f.isPlus).length,
            online: selectedList.filter(f => f.onlineStatus === 'online').length,
            ps5: selectedList.filter(f => f.platform?.toUpperCase() === 'PS5').length,
            ps4: selectedList.filter(f => f.platform?.toUpperCase() === 'PS4').length,
            sample: selectedList.slice(0, 10) // First 10 for preview
        };
    }, [activeFriends, selectedFriends]);

    // Watch for job completion and update friends list instantly
    useEffect(() => {
        if (lastCompletedJob && unfriendingIds.size > 0) {
            console.log('[PSNPage] Job completed, removing unfriended friends from list');
            console.log('[PSNPage] Job ID:', lastCompletedJob.id);

            // Get fresh friends list from store
            const currentFriends = useAppStore.getState().psnFriends;
            console.log('[PSNPage] Friends before:', currentFriends.length);
            console.log('[PSNPage] Unfriending IDs count:', unfriendingIds.size);

            // Remove unfriended friends from list
            const updatedFriends = currentFriends.filter(f => !unfriendingIds.has(f.accountId));
            console.log('[PSNPage] Friends after:', updatedFriends.length);

            useAppStore.getState().setPSNFriends(updatedFriends);

            // Clear unfriending tracker
            setUnfriendingIds(new Set());
            console.log('[PSNPage] Cleared unfriending IDs');
        }
    }, [lastCompletedJob?.id]);

    // Apply filters and sorting
    const filteredFriends = useMemo(() => {
        // Start with active friends (already excludes unfriending IDs)
        let result = activeFriends;

        // Search filter
        if (searchQuery) {
            result = result.filter(f =>
                f.onlineId.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Type filter
        switch (filterType) {
            case 'plus':
                result = result.filter(f => f.isPlus);
                break;
            case 'no-plus':
                result = result.filter(f => !f.isPlus);
                break;
            case 'online':
                result = result.filter(f => f.onlineStatus === 'online');
                break;
            case 'offline':
                result = result.filter(f => f.onlineStatus === 'offline');
                break;
            case 'ps5':
                result = result.filter(f => f.platform?.toUpperCase() === 'PS5');
                break;
            case 'ps4':
                result = result.filter(f => f.platform?.toUpperCase() === 'PS4');
                break;
        }

        // Language filter
        if (languageFilter !== 'all') {
            result = result.filter(f => f.languages?.includes(languageFilter));
        }

        // PRIORITY: Sort selected friends to the top
        result.sort((a, b) => {
            const aSelected = selectedFriends.has(a.accountId);
            const bSelected = selectedFriends.has(b.accountId);

            // Selected friends go to top
            if (aSelected && !bSelected) return -1;
            if (!aSelected && bSelected) return 1;

            // If both selected or both not selected, apply normal sorting
            switch (sortOrder) {
                case 'a-z':
                    return a.onlineId.localeCompare(b.onlineId);
                case 'z-a':
                    return b.onlineId.localeCompare(a.onlineId);
                case 'last-online-recent':
                    if (!a.lastOnlineDate) return 1;
                    if (!b.lastOnlineDate) return -1;
                    return new Date(b.lastOnlineDate).getTime() - new Date(a.lastOnlineDate).getTime();
                case 'last-online-old':
                    if (!a.lastOnlineDate) return 1;
                    if (!b.lastOnlineDate) return -1;
                    return new Date(a.lastOnlineDate).getTime() - new Date(b.lastOnlineDate).getTime();
                default:
                    return 0;
            }
        });

        return result;
    }, [activeFriends, searchQuery, filterType, languageFilter, sortOrder, selectedFriends]);

    // Not connected view
    if (!platform?.connected) {
        return (
            <div className="flex-1 p-6 overflow-auto">
                <div className="max-w-2xl mx-auto">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="p-3 bg-[#003791]/20">
                            <PlayStationLogo className="w-8 h-8 text-[#003791]" />
                        </div>
                        <div>
                            <h1 className="font-heading text-2xl font-black text-burn-cream uppercase tracking-wider">PlayStation Network</h1>
                            <p className="text-burn-muted">Mass unfriend your PSN friends list</p>
                        </div>
                    </div>

                    <div className="glass-card p-6">
                        <h2 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider mb-4">Connect with NPSSO Token</h2>

                        <div className="bg-dark-900/50 p-4 mb-6">
                            <h3 className="text-sm font-medium text-burn-cream mb-2">How to get your NPSSO token:</h3>
                            <ol className="text-sm text-burn-muted space-y-2">
                                <li>1. Log in to <a href="https://www.playstation.com" target="_blank" rel="noopener noreferrer" className="text-[#003791] hover:underline">playstation.com</a></li>
                                <li>2. Visit the token URL below</li>
                                <li>3. Copy the <code className="text-burn-cream bg-dark-700 px-1">npsso</code> value</li>
                                <li>4. Paste it here</li>
                            </ol>
                            <a
                                href="https://ca.account.sony.com/api/v1/ssocookie"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 mt-3 text-sm text-[#003791] hover:underline"
                            >
                                <ExternalLink className="w-4 h-4" />
                                Open Token URL
                            </a>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-burn-text mb-2">
                                    NPSSO Token
                                </label>
                                <input
                                    type="password"
                                    value={npssoToken}
                                    onChange={(e) => setNpssoToken(e.target.value)}
                                    placeholder="Paste your NPSSO token here..."
                                    className="input-field w-full px-4 py-3"
                                />
                            </div>

                            {loginError && (
                                <div className="flex items-center gap-2 text-burn-red text-sm">
                                    <XCircle className="w-4 h-4" />
                                    {loginError}
                                </div>
                            )}

                            <button
                                onClick={handleLogin}
                                disabled={isLoggingIn || !npssoToken.trim()}
                                className="w-full py-3 bg-[#003791] hover:bg-[#003791]/80 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-white transition-colors flex items-center justify-center gap-2"
                            >
                                {isLoggingIn ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Connecting...
                                    </>
                                ) : (
                                    <>
                                        <PlayStationLogo className="w-5 h-5" />
                                        Connect PlayStation
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="mt-6 flex items-start gap-3 p-3 bg-[rgba(255,184,0,0.1)] border border-[rgba(255,184,0,0.3)]">
                            <AlertTriangle className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-gold">
                                Keep your NPSSO token private. It provides access to your PSN account. We store it securely and only locally.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Connected view
    return (
        <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-[#003791]/20">
                            <PlayStationLogo className="w-8 h-8 text-[#003791]" />
                        </div>
                        <div>
                            <h1 className="font-heading text-2xl font-black text-burn-cream uppercase tracking-wider">PlayStation Network</h1>
                            <p className="text-burn-muted">
                                {friends.length} friends
                                {hasPresenceData && ` • ${stats.online} online`}
                                {` • ${filteredFriends.length} shown`}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-burn-text hover:text-burn-cream transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Disconnect
                    </button>
                </div>

                {/* Presence Loading Indicator */}
                {isLoadingPresence && (
                    <div className="mb-6 p-4 bg-fire/10 border border-fire/30">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-5 h-5 animate-spin text-fire" />
                                <div>
                                    <h3 className="font-medium text-fire">Loading Online Status & Platforms</h3>
                                    <p className="text-sm text-burn-muted">
                                        {presenceProgress.current}/{presenceProgress.total} friends loaded
                                    </p>
                                </div>
                            </div>
                            <span className="text-sm text-burn-muted">
                                {Math.round((presenceProgress.current / presenceProgress.total) * 100)}%
                            </span>
                        </div>
                        <div className="h-2 bg-dark-700 overflow-hidden">
                            <div
                                className="h-full bg-fire transition-all duration-300"
                                style={{ width: `${(presenceProgress.current / presenceProgress.total) * 100}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Stats Pie Charts */}
                {hasPresenceData && (
                    <div className="mb-6">
                        <h3 className="font-heading text-sm font-black text-burn-cream uppercase tracking-wider mb-3">Friend Statistics</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="glass-card p-4">
                                <h3 className="font-heading text-sm font-black text-burn-cream uppercase tracking-wider mb-3">Platform Distribution</h3>
                                <div className="flex items-center gap-4">
                                    <div className="relative w-20 h-20">
                                        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                                            {/* Background circle */}
                                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#374151" strokeWidth="3" />
                                            {/* PS5 segment */}
                                            <circle
                                                cx="18" cy="18" r="15.9"
                                                fill="none"
                                                stroke="#3B82F6"
                                                strokeWidth="3"
                                                strokeDasharray={`${(stats.ps5 / (stats.ps5 + stats.ps4 || 1)) * 100} 100`}
                                                strokeDashoffset="0"
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-lg font-bold text-burn-cream">{stats.ps5 + stats.ps4}</span>
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-blue-500" />
                                                <span className="text-sm text-burn-text">PS5</span>
                                            </div>
                                            <span className="text-sm font-medium text-burn-cream">{stats.ps5}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-purple-500" />
                                                <span className="text-sm text-burn-text">PS4</span>
                                            </div>
                                            <span className="text-sm font-medium text-burn-cream">{stats.ps4}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-gray-600" />
                                                <span className="text-sm text-burn-text">Unknown</span>
                                            </div>
                                            <span className="text-sm font-medium text-burn-cream">{stats.total - stats.ps5 - stats.ps4}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Online Status */}
                            <div className="glass-card p-4">
                                <h3 className="font-heading text-sm font-black text-burn-cream uppercase tracking-wider mb-3">Online Status</h3>
                                <div className="flex items-center gap-4">
                                    <div className="relative w-20 h-20">
                                        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                                            {/* Background circle */}
                                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#374151" strokeWidth="3" />
                                            {/* Online segment */}
                                            <circle
                                                cx="18" cy="18" r="15.9"
                                                fill="none"
                                                stroke="#22C55E"
                                                strokeWidth="3"
                                                strokeDasharray={`${(stats.online / stats.total || 0) * 100} 100`}
                                                strokeDashoffset="0"
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-lg font-bold text-burn-cream">{stats.total}</span>
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-burn-green" />
                                                <span className="text-sm text-burn-text">Online</span>
                                            </div>
                                            <span className="text-sm font-medium text-burn-green">{stats.online}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-gray-600" />
                                                <span className="text-sm text-burn-text">Offline</span>
                                            </div>
                                            <span className="text-sm font-medium text-burn-cream">{stats.total - stats.online}</span>
                                        </div>
                                        <div className="text-xs text-burn-muted mt-1">
                                            {((stats.online / stats.total) * 100).toFixed(1)}% online right now
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Filter Bar */}
                <div className="flex flex-wrap items-center gap-3 mb-4 p-4 glass-card">
                    <Filter className="w-5 h-5 text-burn-muted" />

                    {/* Sort */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setSortOrder(sortOrder === 'a-z' ? 'none' : 'a-z')}
                            className={`p-2 transition-colors ${sortOrder === 'a-z' ? 'bg-[#003791] text-white' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                            title="Sort A-Z"
                        >
                            <ArrowUpAZ className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setSortOrder(sortOrder === 'z-a' ? 'none' : 'z-a')}
                            className={`p-2 transition-colors ${sortOrder === 'z-a' ? 'bg-[#003791] text-white' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                            title="Sort Z-A"
                        >
                            <ArrowDownAZ className="w-4 h-4" />
                        </button>
                        {hasPresenceData && (
                            <>
                                <button
                                    onClick={() => setSortOrder(sortOrder === 'last-online-recent' ? 'none' : 'last-online-recent')}
                                    className={`flex items-center gap-1 px-2 py-1.5 text-sm transition-colors ${sortOrder === 'last-online-recent' ? 'bg-[#003791] text-white' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                                    title="Most Recent Online First"
                                >
                                    <Clock3 className="w-4 h-4" />
                                    <span className="text-xs">↓</span>
                                </button>
                                <button
                                    onClick={() => setSortOrder(sortOrder === 'last-online-old' ? 'none' : 'last-online-old')}
                                    className={`flex items-center gap-1 px-2 py-1.5 text-sm transition-colors ${sortOrder === 'last-online-old' ? 'bg-[#003791] text-white' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                                    title="Oldest Online First"
                                >
                                    <Clock3 className="w-4 h-4" />
                                    <span className="text-xs">↑</span>
                                </button>
                            </>
                        )}
                    </div>

                    <div className="w-px h-6 bg-dark-600" />

                    {/* Filter buttons */}
                    <button
                        onClick={() => setFilterType(filterType === 'plus' ? 'all' : 'plus')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${filterType === 'plus' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                    >
                        <Crown className="w-4 h-4" />
                        PS+ ({stats.plus})
                    </button>

                    {hasPresenceData && (
                        <>
                            <button
                                onClick={() => setFilterType(filterType === 'online' ? 'all' : 'online')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${filterType === 'online' ? 'bg-burn-green/20 text-burn-green' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                            >
                                <Wifi className="w-4 h-4" />
                                Online ({stats.online})
                            </button>
                            <button
                                onClick={() => setFilterType(filterType === 'offline' ? 'all' : 'offline')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${filterType === 'offline' ? 'bg-gray-500/20 text-gray-400' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                            >
                                <WifiOff className="w-4 h-4" />
                                Offline
                            </button>
                            <button
                                onClick={() => setFilterType(filterType === 'ps5' ? 'all' : 'ps5')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${filterType === 'ps5' ? 'bg-blue-500/20 text-blue-400' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                            >
                                PS5 ({stats.ps5})
                            </button>
                            <button
                                onClick={() => setFilterType(filterType === 'ps4' ? 'all' : 'ps4')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${filterType === 'ps4' ? 'bg-purple-500/20 text-purple-400' : 'bg-dark-700 text-burn-text hover:text-burn-cream'}`}
                            >
                                PS4 ({stats.ps4})
                            </button>
                        </>
                    )}

                    {availableLanguages.length > 0 && (
                        <>
                            <div className="w-px h-6 bg-dark-600" />
                            <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-burn-muted" />
                                <select
                                    value={languageFilter}
                                    onChange={(e) => setLanguageFilter(e.target.value)}
                                    className="px-2 py-1.5 bg-dark-700 border border-dark-600 text-sm text-burn-cream focus:outline-none focus:border-[#003791]"
                                >
                                    <option value="all">All Languages</option>
                                    {availableLanguages.map(lang => (
                                        <option key={lang} value={lang}>{lang}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}

                    {(filterType !== 'all' || languageFilter !== 'all' || sortOrder !== 'none') && (
                        <button
                            onClick={() => {
                                setFilterType('all');
                                setLanguageFilter('all');
                                setSortOrder('none');
                            }}
                            className="ml-auto text-sm text-burn-muted hover:text-burn-cream transition-colors"
                        >
                            Clear filters
                        </button>
                    )}
                </div>

                {/* Action Bar */}
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-burn-muted" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search friends..."
                            className="input-field w-full pl-10 pr-4 py-2.5"
                        />
                    </div>

                    <button
                        onClick={selectAll}
                        className="px-4 py-2.5 bg-dark-800 hover:bg-dark-700 text-burn-text hover:text-burn-cream transition-colors text-sm"
                    >
                        Select All
                    </button>
                    <button
                        onClick={deselectAll}
                        className="px-4 py-2.5 bg-dark-800 hover:bg-dark-700 text-burn-text hover:text-burn-cream transition-colors text-sm"
                    >
                        Deselect All
                    </button>

                    {/* Quick Select Inactive Dropdown */}
                    {hasPresenceData && (
                        <div className="relative">
                            <select
                                onChange={(e) => {
                                    const years = parseInt(e.target.value);
                                    if (years > 0) {
                                        selectInactiveForYears(years);
                                    }
                                    e.target.value = '0'; // Reset dropdown
                                }}
                                className="px-4 py-2.5 bg-dark-800 border border-dark-700 text-burn-text hover:text-burn-cream hover:bg-dark-700 transition-colors text-sm cursor-pointer focus:outline-none focus:border-[#003791]"
                                defaultValue="0"
                            >
                                <option value="0" disabled>Quick Select Inactive...</option>
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(years => {
                                    const count = getInactiveCount(years);
                                    return (
                                        <option key={years} value={years}>
                                            {count} friends inactive {years}+ year{years > 1 ? 's' : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    )}

                    <button
                        onClick={handleUnfriendClick}
                        disabled={selectedFriends.size === 0 || !!activeUnfriendJob}
                        className="flex items-center gap-2 px-4 py-2.5 bg-burn-red hover:bg-burn-red/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
                    >
                        <UserMinus className="w-5 h-5" />
                        {activeUnfriendJob ? 'Unfriending...' : `Unfriend (${selectedFriends.size})`}
                    </button>
                </div>

                {/* Progress bar - Show active job */}
                {activeUnfriendJob && (
                    <div className="mb-6 p-4 glass-card">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-burn-cream font-medium">Unfriending...</span>
                            <span className="text-burn-muted">
                                {activeUnfriendJob.deletedItems + activeUnfriendJob.failedItems} / {activeUnfriendJob.totalItems}
                            </span>
                        </div>
                        <div className="h-2 bg-dark-700 overflow-hidden">
                            <motion.div
                                className="h-full bg-burn-red"
                                initial={{ width: 0 }}
                                animate={{ width: `${activeUnfriendJob.progress}%` }}
                            />
                        </div>
                        <div className="flex gap-4 mt-2 text-sm">
                            <span className="text-burn-green">Removed: {activeUnfriendJob.deletedItems}</span>
                            <span className="text-burn-red">Failed: {activeUnfriendJob.failedItems}</span>
                        </div>
                    </div>
                )}

                {/* Friends List */}
                <div className="glass-card overflow-hidden">
                    {isLoadingFriends ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 text-[#003791] animate-spin" />
                        </div>
                    ) : filteredFriends.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-burn-muted">
                            <Users className="w-12 h-12 mb-3 opacity-50" />
                            <p>{searchQuery || filterType !== 'all' ? 'No friends match your filters' : 'No friends found'}</p>
                        </div>
                    ) : (
                        <div ref={friendsListRef} className="divide-y divide-dark-700 max-h-[500px] overflow-y-auto">
                            {filteredFriends.map((friend) => (
                                <motion.div
                                    key={friend.accountId}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className={`flex items-center gap-4 p-4 cursor-pointer transition-colors ${selectedFriends.has(friend.accountId)
                                        ? 'bg-burn-red/10'
                                        : 'hover:bg-dark-700/50'
                                        }`}
                                    onClick={() => toggleFriend(friend.accountId)}
                                >
                                    {/* Checkbox */}
                                    <div className={`w-5 h-5 border-2 flex items-center justify-center transition-colors ${selectedFriends.has(friend.accountId)
                                        ? 'bg-burn-red border-burn-red'
                                        : 'border-dark-600'
                                        }`}>
                                        {selectedFriends.has(friend.accountId) && (
                                            <CheckCircle2 className="w-4 h-4 text-white" />
                                        )}
                                    </div>

                                    {/* Avatar with online indicator */}
                                    <div className="relative">
                                        {friend.avatarUrl ? (
                                            <img
                                                src={friend.avatarUrl}
                                                alt={friend.onlineId}
                                                className="w-10 h-10 rounded-full"
                                            />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-dark-600 flex items-center justify-center">
                                                <Users className="w-5 h-5 text-burn-muted" />
                                            </div>
                                        )}
                                        {friend.onlineStatus === 'online' && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-burn-green rounded-full border-2 border-dark-800" />
                                        )}
                                    </div>

                                    {/* Name & Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium text-burn-cream truncate">{friend.onlineId}</p>
                                            {friend.isPlus && (
                                                <Crown className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                                            )}
                                            {friend.platform && (
                                                <span className={`text-xs px-1.5 py-0.5 ${friend.platform.toUpperCase() === 'PS5'
                                                    ? 'bg-blue-500/20 text-blue-400'
                                                    : 'bg-purple-500/20 text-purple-400'
                                                    }`}>
                                                    {friend.platform.toUpperCase()}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-burn-muted truncate">
                                            {friend.currentGame ? (
                                                <span className="text-burn-green">Playing: {friend.currentGame}</span>
                                            ) : friend.lastOnlineDate ? (
                                                <span>Last online: {formatLastOnline(friend.lastOnlineDate)}</span>
                                            ) : (
                                                friend.languages?.join(', ') || friend.accountId
                                            )}
                                        </p>
                                    </div>

                                    {/* Status */}
                                    {selectedFriends.has(friend.accountId) && (
                                        <span className="text-sm text-burn-red flex-shrink-0">Will be removed</span>
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Refresh button */}
                <button
                    onClick={() => loadFriends(false)}
                    disabled={isLoadingFriends}
                    className="mt-4 w-full py-3 bg-dark-800 hover:bg-dark-700 text-burn-text hover:text-burn-cream transition-colors flex items-center justify-center gap-2"
                >
                    {isLoadingFriends ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Users className="w-5 h-5" />
                    )}
                    Refresh Friends List
                </button>

                {/* Preview Modal */}
                {showPreviewModal && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-dark-800 border border-dark-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                        >
                            {/* Header */}
                            <div className="p-6 border-b border-dark-700">
                                <div className="flex items-center justify-between mb-2">
                                    <h2 className="font-heading text-2xl font-black text-burn-cream uppercase tracking-wider">Confirm Unfriend</h2>
                                    <button
                                        onClick={() => setShowPreviewModal(false)}
                                        className="p-2 hover:bg-dark-700 transition-colors"
                                    >
                                        <XCircle className="w-6 h-6 text-burn-muted" />
                                    </button>
                                </div>
                                <p className="text-burn-muted">
                                    You are about to remove <span className="text-burn-red font-semibold">{previewStats.total} friends</span> from your PlayStation Network.
                                </p>
                            </div>

                            {/* Stats */}
                            <div className="p-6 border-b border-dark-700">
                                <h3 className="font-heading text-sm font-black text-burn-cream uppercase tracking-wider mb-3">Selection Statistics</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 bg-dark-900/50">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Crown className="w-4 h-4 text-yellow-500" />
                                            <span className="text-sm text-burn-muted">PS+ Members</span>
                                        </div>
                                        <p className="text-lg font-semibold text-burn-cream">{previewStats.plus}</p>
                                    </div>
                                    <div className="p-3 bg-dark-900/50">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Wifi className="w-4 h-4 text-burn-green" />
                                            <span className="text-sm text-burn-muted">Currently Online</span>
                                        </div>
                                        <p className="text-lg font-semibold text-burn-cream">{previewStats.online}</p>
                                    </div>
                                    <div className="p-3 bg-dark-900/50">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm text-blue-400 font-bold">PS5</span>
                                        </div>
                                        <p className="text-lg font-semibold text-burn-cream">{previewStats.ps5}</p>
                                    </div>
                                    <div className="p-3 bg-dark-900/50">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm text-purple-400 font-bold">PS4</span>
                                        </div>
                                        <p className="text-lg font-semibold text-burn-cream">{previewStats.ps4}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Preview of friends */}
                            <div className="p-6 border-b border-dark-700">
                                <h3 className="font-heading text-sm font-black text-burn-cream uppercase tracking-wider mb-3">
                                    Preview ({previewStats.sample.length} of {previewStats.total} shown)
                                </h3>
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {previewStats.sample.map((friend) => (
                                        <div key={friend.accountId} className="flex items-center gap-3 p-2 bg-dark-900/50">
                                            {friend.avatarUrl ? (
                                                <img
                                                    src={friend.avatarUrl}
                                                    alt={friend.onlineId}
                                                    className="w-10 h-10 rounded-full"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-dark-600 flex items-center justify-center">
                                                    <Users className="w-5 h-5 text-burn-muted" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-burn-cream truncate">{friend.onlineId}</p>
                                                    {friend.isPlus && <Crown className="w-3 h-3 text-yellow-500" />}
                                                    {friend.platform && (
                                                        <span className={`text-xs px-1 py-0.5 ${
                                                            friend.platform.toUpperCase() === 'PS5'
                                                                ? 'bg-blue-500/20 text-blue-400'
                                                                : 'bg-purple-500/20 text-purple-400'
                                                        }`}>
                                                            {friend.platform.toUpperCase()}
                                                        </span>
                                                    )}
                                                </div>
                                                {friend.lastOnlineDate && (
                                                    <p className="text-xs text-burn-muted">
                                                        Last online: {formatLastOnline(friend.lastOnlineDate)}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {previewStats.total > 10 && (
                                        <p className="text-sm text-burn-muted text-center py-2">
                                            ... and {previewStats.total - 10} more
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="p-6">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={exportFriendsList}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-burn-cream transition-colors"
                                    >
                                        <ExternalLink className="w-5 h-5" />
                                        Export as JSON
                                    </button>
                                    <button
                                        onClick={() => setShowPreviewModal(false)}
                                        className="px-6 py-3 bg-dark-700 hover:bg-dark-600 text-burn-cream transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={confirmUnfriend}
                                        disabled={confirmCountdown > 0}
                                        className="px-6 py-3 bg-burn-red hover:bg-burn-red/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                                    >
                                        {confirmCountdown > 0 ? `Confirm (${confirmCountdown})` : 'Confirm Unfriend'}
                                    </button>
                                </div>
                                {confirmCountdown > 0 && (
                                    <p className="text-xs text-burn-muted text-center mt-3">
                                        Confirmation will be available in {confirmCountdown} second{confirmCountdown !== 1 ? 's' : ''}...
                                    </p>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </div>
        </div>
    );
}
