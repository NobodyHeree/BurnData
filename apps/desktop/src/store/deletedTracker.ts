// Tracks deleted message IDs in localStorage so it survives refreshes.

const STORAGE_KEY = 'burndata-deleted-ids';
const OLD_STORAGE_KEY = 'deletedata-deleted-ids';
const MAX_IDS_PER_CHANNEL = 50000;
const MAX_IDS_GLOBAL = 200000;

// Migrate from old branding
if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(OLD_STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, localStorage.getItem(OLD_STORAGE_KEY)!);
    localStorage.removeItem(OLD_STORAGE_KEY);
}

// Batch buffer — avoids hammering localStorage on every delete
let pendingWrites: Record<string, string[]> = {};

function getStore(): Record<string, string[]> {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveStore(store: Record<string, string[]>) {
    // Per-channel cap
    for (const channelId of Object.keys(store)) {
        if (store[channelId].length > MAX_IDS_PER_CHANNEL) {
            store[channelId] = store[channelId].slice(-MAX_IDS_PER_CHANNEL);
        }
    }

    // Global cap — evict smallest channels first
    let total = Object.values(store).reduce((sum, ids) => sum + ids.length, 0);
    if (total > MAX_IDS_GLOBAL) {
        const sorted = Object.entries(store).sort((a, b) => a[1].length - b[1].length);
        for (const [channelId] of sorted) {
            if (total <= MAX_IDS_GLOBAL) break;
            total -= store[channelId].length;
            delete store[channelId];
        }
    }

    // Write with eviction fallback if localStorage is full
    while (true) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
            return;
        } catch {
            const sorted = Object.keys(store).sort((a, b) => store[a].length - store[b].length);
            if (sorted.length <= 1) return;
            console.warn('[DeletedTracker] localStorage full, evicting channel:', sorted[0]);
            delete store[sorted[0]];
        }
    }
}

export function markDeleted(channelId: string, messageId: string) {
    if (!pendingWrites[channelId]) pendingWrites[channelId] = [];
    pendingWrites[channelId].push(messageId);

    const totalPending = Object.values(pendingWrites).reduce((sum, arr) => sum + arr.length, 0);
    if (totalPending >= 100) flushDeleted();
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

export const getDeletedSet = (channelId: string): Set<string> =>
    new Set(getStore()[channelId] || []);

export const getDeletedCount = (channelId: string): number =>
    (getStore()[channelId] || []).length;

export function filterOutDeleted(channelId: string, messageIds: string[]): string[] {
    const deleted = getDeletedSet(channelId);
    return messageIds.filter(id => !deleted.has(id));
}

export const clearDeletedForChannel = (channelId: string) => {
    const store = getStore();
    delete store[channelId];
    saveStore(store);
};

export const clearAllDeleted = () => localStorage.removeItem(STORAGE_KEY);

window.addEventListener('beforeunload', () => {
    if (Object.keys(pendingWrites).length > 0) flushDeleted();
});
