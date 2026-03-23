// Type declarations for Electron API exposed via preload
export interface ElectronAPI {
    window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
    };
    store: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
        clear: () => Promise<boolean>;
    };
    tokens: {
        get: (platform: string) => Promise<string | undefined>;
        set: (platform: string, token: string) => Promise<boolean>;
        delete: (platform: string) => Promise<boolean>;
        getAll: () => Promise<Record<string, string>>;
    };
    discord: {
        login: () => Promise<{ success: boolean; token?: string; error?: string }>;
        logout: () => Promise<boolean>;
        getGuilds: () => Promise<any[]>;
        getDMs: () => Promise<any[]>;
        getGuildChannels: (guildId: string) => Promise<any[]>;
        startDeletion: (config: any) => Promise<{ success: boolean; jobId?: string; queued?: boolean; queuePosition?: number }>;
        stopDeletion: () => Promise<boolean>;
        pauseDeletion: () => Promise<boolean>;
        resumeDeletion: () => Promise<boolean>;
        createDM: (userId: string) => Promise<{ success: boolean; channel?: { id: string; name: string; recipients?: any[] }; error?: string }>;
        // Queue management
        getQueueStatus: () => Promise<{ queueLength: number; queuedJobs: { jobId: string; position: number }[]; currentJobId?: string; isActive: boolean }>;
        cancelQueuedJob: (jobId: string) => Promise<{ success: boolean; removed: boolean; error?: string }>;
        clearQueue: () => Promise<{ success: boolean; removed: number }>;
        // Job persistence
        getPersistedJobs: () => Promise<{ jobs: any[]; queue: any[] }>;
        resumeJob: (jobId: string) => Promise<{ success: boolean; queued?: boolean; queuePosition?: number; error?: string }>;
        cancelPersistedJob: (jobId: string) => Promise<{ success: boolean }>;
        onProgress: (callback: (data: {
            jobId: string;
            status: string;
            progress: number;
            stats: { deleted: number; checked: number; currentChannel?: string; eta?: string | null };
            details: string;
        }) => void) => () => void;
    };
    psn: {
        login: (npssoToken: string) => Promise<{ success: boolean; friendCount?: number; username?: string; error?: string }>;
        logout: () => Promise<boolean>;
        isAuthenticated: () => Promise<{ authenticated: boolean; username?: string }>;
        getFriends: () => Promise<{
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
        }[]>;
        removeFriend: (accountId: string) => Promise<{ success: boolean; error?: string }>;
        startUnfriend: (config: { accountIds: string[] }) => Promise<{ success: boolean; jobId?: string; error?: string }>;
        onUnfriendProgress: (callback: (data: {
            jobId: string;
            current: number;
            total: number;
            removed: number;
            failed: number;
            progress: number;
            completed?: boolean
        }) => void) => () => void;
        getPresences: (accountIds: string[]) => Promise<Record<string, {
            onlineStatus: 'online' | 'offline';
            lastOnlineDate?: string;
            platform?: string;
            currentGame?: string;
        }>>;
        onPresenceProgress: (callback: (data: {
            current: number;
            total: number;
            progress: number;
        }) => void) => () => void;
    };
    app: {
        version: () => Promise<string>;
        platform: () => Promise<string>;
    };
    on: (channel: string, callback: (...args: unknown[]) => void) => void;
    removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

export { };
