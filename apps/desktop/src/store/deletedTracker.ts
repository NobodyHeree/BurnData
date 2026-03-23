// Tracks which message IDs have been successfully deleted
// Persisted in localStorage so it survives page refreshes

const STORAGE_KEY = 'burndata-deleted-ids';
const OLD_STORAGE_KEY = 'deletedata-deleted-ids';
const MAX_IDS_PER_CHANNEL = 50000; // Cap to prevent localStorage bloat

// Migrate from old branding
if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(OLD_STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, localStorage.getItem(OLD_STORAGE_KEY)!);
    localStorage.removeItem(OLD_STORAGE_KEY);
}

// In-memory batch buffer to avoid excessive localStorage writes
let pendingWrites: Record<string, string[]> = {};

function getStore(): Record<string, string[]> {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveStore(store: Record<string, string[]>) {
    // Enforce cap per channel
    for (const channelId of Object.keys(store)) {
        if (store[channelId].length > MAX_IDS_PER_CHANNEL) {
            store[channelId] = store[channelId].slice(-MAX_IDS_PER_CHANNEL);
        }
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
        // localStorage full — clear oldest channels
        console.warn('[DeletedTracker] localStorage full, clearing oldest data');
        const channels = Object.keys(store);
        if (channels.length > 1) {
            delete store[channels[0]];
            saveStore(store);
        }
    }
}

export function markDeleted(channelId: string, messageId: string) {
    // Buffer in memory, flush periodically
    if (!pendingWrites[channelId]) pendingWrites[channelId] = [];
    pendingWrites[channelId].push(messageId);
    // Auto-flush every 100 entries
    const totalPending = Object.values(pendingWrites).reduce((sum, arr) => sum + arr.length, 0);
    if (totalPending >= 100) {
        flushDeleted();
    }
}

export function flushDeleted() {
    const store = getStore();
    for (const [channelId, ids] of Object.entries(pendingWrites)) {
        if (!store[channelId]) store[channelId] = [];
        store[channelId].push(...ids);
    }
    pendingWrites = {};
    saveStore(store);
}

export function getDeletedSet(channelId: string): Set<string> {
    const store = getStore();
    return new Set(store[channelId] || []);
}

export function getDeletedCount(channelId: string): number {
    const store = getStore();
    return (store[channelId] || []).length;
}

export function filterOutDeleted(
    channelId: string,
    messageIds: string[]
): string[] {
    const deleted = getDeletedSet(channelId);
    return messageIds.filter(id => !deleted.has(id));
}

export function clearDeletedForChannel(channelId: string) {
    const store = getStore();
    delete store[channelId];
    saveStore(store);
}

export function clearAllDeleted() {
    localStorage.removeItem(STORAGE_KEY);
}
