import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Migrate old localStorage key from previous branding
const OLD_STORAGE_KEY = 'deletedata-storage';
const NEW_STORAGE_KEY = 'burndata-storage';
if (!localStorage.getItem(NEW_STORAGE_KEY) && localStorage.getItem(OLD_STORAGE_KEY)) {
    localStorage.setItem(NEW_STORAGE_KEY, localStorage.getItem(OLD_STORAGE_KEY)!);
    localStorage.removeItem(OLD_STORAGE_KEY);
}

export interface Platform {
    id: string;
    name: string;
    connected: boolean;
    color?: string; // Platform brand color
    token?: string;
    user?: {
        id: string;
        username: string;
        avatar?: string;
    };
    stats: {
        totalDeleted: number;
        lastDeletionAt?: string;
    };
}

export interface DeletionJob {
    id: string;
    platformId: string;
    status: 'pending' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
    totalItems: number;
    deletedItems: number;
    failedItems: number;
    startedAt: string;
    completedAt?: string;
    error?: string;
    progress: number; // 0-100
    currentChannel?: string;
    speed?: string; // e.g. "0.8 msg/s"
}

export interface Toast {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title?: string;
    message: string;
    duration?: number; // ms, default 5000, Infinity for persistent
}

export interface PSNFriend {
    accountId: string;
    onlineId: string;
    avatarUrl?: string;
    isPlus?: boolean;
    languages?: string[];
    aboutMe?: string;
    onlineStatus?: 'online' | 'offline';
    lastOnlineDate?: string;
    platform?: string;
    currentGame?: string;
}

export type DeletionSpeed = 'conservative' | 'balanced' | 'aggressive';

export interface AppSettings {
    exportBeforeDelete: boolean;
    confirmBeforeDelete: boolean;
    notifications: boolean;
    deletionSpeed: DeletionSpeed;
}

interface AppState {
    // Platforms
    platforms: Record<string, Platform>;

    // Jobs
    jobs: DeletionJob[];

    // Settings
    settings: AppSettings;
    updateSettings: (settings: Partial<AppSettings>) => void;

    // PSN Data
    psnFriends: PSNFriend[];
    psnHasPresenceData: boolean;
    psnPresenceLoading: boolean;
    psnPresenceProgress: { current: number; total: number };
    setPSNFriends: (friends: PSNFriend[]) => void;
    setPSNHasPresenceData: (hasData: boolean) => void;
    setPSNPresenceLoading: (loading: boolean) => void;
    setPSNPresenceProgress: (progress: { current: number; total: number }) => void;

    // Actions - Platforms
    connectPlatform: (platformId: string, token: string, user?: Platform['user']) => void;
    disconnectPlatform: (platformId: string) => void;
    updatePlatformStats: (platformId: string, stats: Partial<Platform['stats']>) => void;

    // Actions - Jobs
    addJob: (job: DeletionJob) => void;
    updateJob: (jobId: string, updates: Partial<DeletionJob>) => void;
    removeJob: (jobId: string) => void;
    clearCompletedJobs: () => void;

    // Toasts
    toasts: Toast[];
    addToast: (toast: Omit<Toast, 'id'>) => void;
    removeToast: (id: string) => void;

    // Computed
    getTotalDeleted: () => number;
    getActiveJobs: () => DeletionJob[];
    getConnectedPlatforms: () => Platform[];
}

// Initial platform definitions (no fake stats)
const initialPlatforms: Record<string, Platform> = {
    discord: {
        id: 'discord',
        name: 'Discord',
        connected: false,
        stats: { totalDeleted: 0 },
    },
    psn: {
        id: 'psn',
        name: 'PlayStation',
        connected: false,
        stats: { totalDeleted: 0 },
        color: '#003791', // PlayStation blue
    },
};

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            platforms: initialPlatforms,
            jobs: [],
            settings: {
                exportBeforeDelete: true,
                confirmBeforeDelete: true,
                notifications: true,
                deletionSpeed: 'balanced',
            },
            updateSettings: (newSettings) => {
                set((state) => ({
                    settings: { ...state.settings, ...newSettings },
                }));
                // Sync deletion speed to electron-store for main process
                if (newSettings.deletionSpeed) {
                    window.electronAPI?.store.set('deletionSpeed', newSettings.deletionSpeed);
                }
            },
            psnFriends: [],
            psnHasPresenceData: false,
            psnPresenceLoading: false,
            psnPresenceProgress: { current: 0, total: 0 },

            // PSN Actions
            setPSNFriends: (friends) => set({ psnFriends: friends }),
            setPSNHasPresenceData: (hasData) => set({ psnHasPresenceData: hasData }),
            setPSNPresenceLoading: (loading) => set({ psnPresenceLoading: loading }),
            setPSNPresenceProgress: (progress) => set({ psnPresenceProgress: progress }),

            // Platform actions
            connectPlatform: (platformId, token, user) => {
                set((state) => ({
                    platforms: {
                        ...state.platforms,
                        [platformId]: {
                            ...state.platforms[platformId],
                            id: platformId, // Ensure id is always set
                            connected: true,
                            token,
                            user,
                            stats: state.platforms[platformId]?.stats || { totalDeleted: 0 }, // Ensure stats exist
                        },
                    },
                }));
            },

            disconnectPlatform: (platformId) => {
                set((state) => ({
                    platforms: {
                        ...state.platforms,
                        [platformId]: {
                            ...state.platforms[platformId],
                            connected: false,
                            token: undefined,
                            user: undefined,
                        },
                    },
                }));
            },

            updatePlatformStats: (platformId, stats) => {
                set((state) => ({
                    platforms: {
                        ...state.platforms,
                        [platformId]: {
                            ...state.platforms[platformId],
                            stats: {
                                ...state.platforms[platformId].stats,
                                ...stats,
                            },
                        },
                    },
                }));
            },

            // Job actions
            addJob: (job) => {
                set((state) => ({
                    jobs: [job, ...state.jobs],
                }));
            },

            updateJob: (jobId, updates) => {
                set((state) => ({
                    jobs: state.jobs.map((job) =>
                        job.id === jobId ? { ...job, ...updates } : job
                    ),
                }));
            },

            removeJob: (jobId) => {
                set((state) => ({
                    jobs: state.jobs.filter((job) => job.id !== jobId),
                }));
            },

            clearCompletedJobs: () => {
                set((state) => ({
                    jobs: state.jobs.filter((job) => job.status !== 'completed'),
                }));
            },

            // Toasts
            toasts: [],

            addToast: (toast) => {
                const id = crypto.randomUUID();
                set((state) => ({
                    toasts: [...state.toasts, { ...toast, id }],
                }));
            },

            removeToast: (id) => {
                set((state) => ({
                    toasts: state.toasts.filter((t) => t.id !== id),
                }));
            },

            // Computed values
            getTotalDeleted: () => {
                const { platforms } = get();
                return Object.values(platforms).reduce(
                    (total, platform) => total + (platform?.stats?.totalDeleted || 0),
                    0
                );
            },

            getActiveJobs: () => {
                const { jobs } = get();
                return jobs.filter((job) => job.status === 'running' || job.status === 'pending');
            },

            getConnectedPlatforms: () => {
                const { platforms } = get();
                return Object.values(platforms).filter((p) => p.connected);
            },
        }),
        {
            name: 'burndata-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                platforms: Object.fromEntries(
                    Object.entries(state.platforms).map(([id, p]) => [
                        id,
                        { ...p, id, token: undefined }, // Ensure id is always present, don't persist tokens
                    ])
                ),
                jobs: state.jobs,
                settings: state.settings,
                psnFriends: state.psnFriends,
                psnHasPresenceData: state.psnHasPresenceData,
            }),
            onRehydrateStorage: () => (state, error) => {
                if (!state || error) return;
                const hasOrphaned = state.jobs.some(j => j.status === 'running' || j.status === 'pending');
                if (hasOrphaned) {
                    state.jobs = state.jobs.map(j =>
                        j.status === 'running' || j.status === 'pending'
                            ? { ...j, status: 'paused' as const }
                            : j
                    );
                }
                state.psnPresenceLoading = false;
            },
        }
    )
);
