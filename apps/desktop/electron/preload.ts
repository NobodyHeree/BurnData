import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
    },

    // Secure storage
    store: {
        get: (key: string) => ipcRenderer.invoke('store:get', key),
        set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
        delete: (key: string) => ipcRenderer.invoke('store:delete', key),
        clear: () => ipcRenderer.invoke('store:clear'),
    },

    // Platform tokens (encrypted)
    tokens: {
        get: (platform: string) => ipcRenderer.invoke('tokens:get', platform),
        set: (platform: string, token: string) => ipcRenderer.invoke('tokens:set', platform, token),
        delete: (platform: string) => ipcRenderer.invoke('tokens:delete', platform),
        // getAll intentionally removed for security
    },

    // Discord specific
    discord: {
        login: () => ipcRenderer.invoke('discord:login'),
        logout: () => ipcRenderer.invoke('discord:logout'),
        getGuilds: () => ipcRenderer.invoke('discord:getGuilds'),
        getDMs: () => ipcRenderer.invoke('discord:getDMs'),
        getGuildChannels: (guildId: string) => ipcRenderer.invoke('discord:getGuildChannels', guildId),
        startDeletion: (config: any) => ipcRenderer.invoke('discord:startDeletion', config),
        stopDeletion: () => ipcRenderer.invoke('discord:stopDeletion'),
        pauseDeletion: () => ipcRenderer.invoke('discord:pauseDeletion'),
        resumeDeletion: () => ipcRenderer.invoke('discord:resumeDeletion'),
        createDM: (userId: string) => ipcRenderer.invoke('discord:createDM', userId),
        importDataPackage: () => ipcRenderer.invoke('discord:importDataPackage'),
        // Queue management
        getQueueStatus: () => ipcRenderer.invoke('discord:getQueueStatus'),
        cancelQueuedJob: (jobId: string) => ipcRenderer.invoke('discord:cancelQueuedJob', jobId),
        clearQueue: () => ipcRenderer.invoke('discord:clearQueue'),
        // Job persistence
        getPersistedJobs: () => ipcRenderer.invoke('discord:getPersistedJobs'),
        resumeJob: (jobId: string) => ipcRenderer.invoke('discord:resumeJob', jobId),
        cancelPersistedJob: (jobId: string) => ipcRenderer.invoke('discord:cancelPersistedJob', jobId),
        onProgress: (callback: (data: any) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on('discord:deletionProgress', listener);
            return () => ipcRenderer.removeListener('discord:deletionProgress', listener);
        }
    },

    // PSN specific
    psn: {
        login: (npssoToken: string) => ipcRenderer.invoke('psn:login', npssoToken),
        logout: () => ipcRenderer.invoke('psn:logout'),
        isAuthenticated: () => ipcRenderer.invoke('psn:isAuthenticated'),
        getFriends: () => ipcRenderer.invoke('psn:getFriends'),
        removeFriend: (accountId: string) => ipcRenderer.invoke('psn:removeFriend', accountId),
        startUnfriend: (config: { accountIds: string[] }) => ipcRenderer.invoke('psn:startUnfriend', config),
        onUnfriendProgress: (callback: (data: any) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on('psn:unfriendProgress', listener);
            return () => ipcRenderer.removeListener('psn:unfriendProgress', listener);
        },
        getPresences: (accountIds: string[]) => ipcRenderer.invoke('psn:getPresences', accountIds),
        onPresenceProgress: (callback: (data: { current: number; total: number; progress: number }) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on('psn:presenceProgress', listener);
            return () => ipcRenderer.removeListener('psn:presenceProgress', listener);
        }
    },

    // App info
    app: {
        version: () => ipcRenderer.invoke('app:version'),
        platform: () => ipcRenderer.invoke('app:platform'),
    },

    // Events from main process
    on: (channel: string, callback: (...args: unknown[]) => void) => {
        const validChannels = [
            'discord:deletionProgress',
            'psn:unfriendProgress',
            'psn:presenceProgress',
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (_, ...args) => callback(...args));
        }
    },

    removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
        ipcRenderer.removeListener(channel, callback);
    },
});

// Type declarations for the renderer
declare global {
    interface Window {
        electronAPI?: {
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
                // getAll intentionally removed for security
            };
            discord: {
                login: () => Promise<{ success: boolean; token?: string; error?: string }>;
                logout: () => Promise<boolean>;
                getGuilds: () => Promise<any[]>;
                getDMs: () => Promise<any[]>;
            };
            app: {
                version: () => Promise<string>;
                platform: () => Promise<string>;
            };
            on: (channel: string, callback: (...args: unknown[]) => void) => void;
            removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
        };
    }
}
