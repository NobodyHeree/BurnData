/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock crypto.randomUUID for toast IDs
Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` },
    writable: true,
});

describe('appStore', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    async function loadStore() {
        const mod = await import('../appStore');
        return mod.useAppStore;
    }

    // ── Initial state ─────────────────────────────────────────────

    describe('initial state', () => {
        it('has discord and psn platforms disconnected', async () => {
            const useAppStore = await loadStore();
            const { platforms } = useAppStore.getState();
            expect(platforms.discord.connected).toBe(false);
            expect(platforms.psn.connected).toBe(false);
            expect(platforms.discord.stats.totalDeleted).toBe(0);
        });

        it('has default settings', async () => {
            const useAppStore = await loadStore();
            const { settings } = useAppStore.getState();
            expect(settings.deletionSpeed).toBe('balanced');
            expect(settings.confirmBeforeDelete).toBe(true);
            expect(settings.exportBeforeDelete).toBe(true);
            expect(settings.notifications).toBe(true);
        });

        it('starts with empty jobs and toasts', async () => {
            const useAppStore = await loadStore();
            const state = useAppStore.getState();
            expect(state.jobs).toEqual([]);
            expect(state.toasts).toEqual([]);
        });
    });

    // ── Platform actions ──────────────────────────────────────────

    describe('platform actions', () => {
        it('connectPlatform sets connected + token + user', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().connectPlatform('discord', 'tok-123', { id: 'u1', username: 'bob' });

            const discord = useAppStore.getState().platforms.discord;
            expect(discord.connected).toBe(true);
            expect(discord.token).toBe('tok-123');
            expect(discord.user?.username).toBe('bob');
        });

        it('disconnectPlatform clears token and user', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().connectPlatform('discord', 'tok-123', { id: 'u1', username: 'bob' });
            useAppStore.getState().disconnectPlatform('discord');

            const discord = useAppStore.getState().platforms.discord;
            expect(discord.connected).toBe(false);
            expect(discord.token).toBeUndefined();
            expect(discord.user).toBeUndefined();
        });

        it('updatePlatformStats merges stats', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().updatePlatformStats('discord', { totalDeleted: 42, lastDeletionAt: '2026-01-01' });

            const stats = useAppStore.getState().platforms.discord.stats;
            expect(stats.totalDeleted).toBe(42);
            expect(stats.lastDeletionAt).toBe('2026-01-01');
        });
    });

    // ── Job actions ───────────────────────────────────────────────

    describe('job actions', () => {
        const makeJob = (overrides: Partial<import('../appStore').DeletionJob> = {}): import('../appStore').DeletionJob => ({
            id: overrides.id ?? 'job-1',
            platformId: 'discord',
            status: 'pending',
            totalItems: 100,
            deletedItems: 0,
            failedItems: 0,
            startedAt: '2026-01-01T00:00:00Z',
            progress: 0,
            ...overrides,
        });

        it('addJob prepends to list', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().addJob(makeJob({ id: 'j1' }));
            useAppStore.getState().addJob(makeJob({ id: 'j2' }));

            const jobs = useAppStore.getState().jobs;
            expect(jobs[0].id).toBe('j2'); // newest first
            expect(jobs[1].id).toBe('j1');
        });

        it('updateJob merges updates by ID', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().addJob(makeJob({ id: 'j1', status: 'pending' }));
            useAppStore.getState().updateJob('j1', { status: 'running', deletedItems: 5 });

            const job = useAppStore.getState().jobs.find(j => j.id === 'j1')!;
            expect(job.status).toBe('running');
            expect(job.deletedItems).toBe(5);
        });

        it('removeJob deletes by ID', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().addJob(makeJob({ id: 'j1' }));
            useAppStore.getState().addJob(makeJob({ id: 'j2' }));
            useAppStore.getState().removeJob('j1');

            expect(useAppStore.getState().jobs).toHaveLength(1);
            expect(useAppStore.getState().jobs[0].id).toBe('j2');
        });

        it('clearCompletedJobs removes only completed', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().addJob(makeJob({ id: 'j1', status: 'completed' }));
            useAppStore.getState().addJob(makeJob({ id: 'j2', status: 'running' }));
            useAppStore.getState().addJob(makeJob({ id: 'j3', status: 'completed' }));
            useAppStore.getState().clearCompletedJobs();

            const jobs = useAppStore.getState().jobs;
            expect(jobs).toHaveLength(1);
            expect(jobs[0].id).toBe('j2');
        });
    });

    // ── Computed values ───────────────────────────────────────────

    describe('computed values', () => {
        it('getTotalDeleted sums across all platforms', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().updatePlatformStats('discord', { totalDeleted: 100 });
            useAppStore.getState().updatePlatformStats('psn', { totalDeleted: 50 });

            expect(useAppStore.getState().getTotalDeleted()).toBe(150);
        });

        it('getActiveJobs returns running and pending jobs', async () => {
            const useAppStore = await loadStore();
            const makeJob = (id: string, status: string) => ({
                id, platformId: 'discord', status: status as any,
                totalItems: 10, deletedItems: 0, failedItems: 0,
                startedAt: '', progress: 0,
            });
            useAppStore.getState().addJob(makeJob('j1', 'running'));
            useAppStore.getState().addJob(makeJob('j2', 'completed'));
            useAppStore.getState().addJob(makeJob('j3', 'pending'));
            useAppStore.getState().addJob(makeJob('j4', 'paused'));

            const active = useAppStore.getState().getActiveJobs();
            expect(active).toHaveLength(2);
            expect(active.map(j => j.id).sort()).toEqual(['j1', 'j3']);
        });

        it('getConnectedPlatforms returns only connected ones', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().connectPlatform('discord', 'tok', { id: 'u1', username: 'me' });

            const connected = useAppStore.getState().getConnectedPlatforms();
            expect(connected).toHaveLength(1);
            expect(connected[0].id).toBe('discord');
        });
    });

    // ── Persistence — token stripping ─────────────────────────────

    describe('persistence', () => {
        it('does not persist tokens to localStorage', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().connectPlatform('discord', 'secret-token', { id: 'u1', username: 'me' });

            // Read raw localStorage
            const raw = JSON.parse(localStorage.getItem('burndata-storage')!);
            const persisted = raw.state.platforms.discord;
            expect(persisted.token).toBeUndefined();
            expect(persisted.connected).toBe(true);
        });

        it('ensures platform id is always present in persisted data', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().connectPlatform('discord', 'tok', { id: 'u1', username: 'me' });

            const raw = JSON.parse(localStorage.getItem('burndata-storage')!);
            expect(raw.state.platforms.discord.id).toBe('discord');
        });
    });

    // ── Rehydration — orphaned job recovery ───────────────────────

    describe('rehydration', () => {
        it('marks running/pending jobs as paused on reload', async () => {
            // Simulate persisted state with running jobs
            const persistedState = {
                state: {
                    platforms: {
                        discord: { id: 'discord', name: 'Discord', connected: false, stats: { totalDeleted: 0 } },
                        psn: { id: 'psn', name: 'PlayStation', connected: false, stats: { totalDeleted: 0 } },
                    },
                    jobs: [
                        { id: 'j1', platformId: 'discord', status: 'running', totalItems: 100, deletedItems: 50, failedItems: 0, startedAt: '', progress: 50 },
                        { id: 'j2', platformId: 'discord', status: 'pending', totalItems: 50, deletedItems: 0, failedItems: 0, startedAt: '', progress: 0 },
                        { id: 'j3', platformId: 'discord', status: 'completed', totalItems: 30, deletedItems: 30, failedItems: 0, startedAt: '', progress: 100 },
                    ],
                    settings: { exportBeforeDelete: true, confirmBeforeDelete: true, notifications: true, deletionSpeed: 'balanced' },
                    psnFriends: [],
                    psnHasPresenceData: false,
                },
                version: 0,
            };
            localStorage.setItem('burndata-storage', JSON.stringify(persistedState));

            const useAppStore = await loadStore();

            // Wait for rehydration
            await new Promise(resolve => setTimeout(resolve, 50));

            const jobs = useAppStore.getState().jobs;
            const j1 = jobs.find(j => j.id === 'j1')!;
            const j2 = jobs.find(j => j.id === 'j2')!;
            const j3 = jobs.find(j => j.id === 'j3')!;

            expect(j1.status).toBe('paused');
            expect(j2.status).toBe('paused');
            expect(j3.status).toBe('completed'); // Unchanged
        });

        it('resets psnPresenceLoading on reload', async () => {
            const persistedState = {
                state: {
                    platforms: {
                        discord: { id: 'discord', name: 'Discord', connected: false, stats: { totalDeleted: 0 } },
                        psn: { id: 'psn', name: 'PlayStation', connected: false, stats: { totalDeleted: 0 } },
                    },
                    jobs: [],
                    settings: { exportBeforeDelete: true, confirmBeforeDelete: true, notifications: true, deletionSpeed: 'balanced' },
                    psnFriends: [],
                    psnHasPresenceData: false,
                },
                version: 0,
            };
            localStorage.setItem('burndata-storage', JSON.stringify(persistedState));

            const useAppStore = await loadStore();
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(useAppStore.getState().psnPresenceLoading).toBe(false);
        });
    });

    // ── localStorage migration ────────────────────────────────────

    describe('localStorage migration', () => {
        it('migrates from old deletedata-storage key', async () => {
            const oldData = {
                state: {
                    platforms: {
                        discord: { id: 'discord', name: 'Discord', connected: true, stats: { totalDeleted: 99 } },
                        psn: { id: 'psn', name: 'PlayStation', connected: false, stats: { totalDeleted: 0 } },
                    },
                    jobs: [],
                    settings: { exportBeforeDelete: false, confirmBeforeDelete: true, notifications: true, deletionSpeed: 'aggressive' },
                    psnFriends: [],
                    psnHasPresenceData: false,
                },
                version: 0,
            };
            localStorage.setItem('deletedata-storage', JSON.stringify(oldData));

            const useAppStore = await loadStore();
            await new Promise(resolve => setTimeout(resolve, 50));

            // Old key should be removed
            expect(localStorage.getItem('deletedata-storage')).toBeNull();
            // New key should exist
            expect(localStorage.getItem('burndata-storage')).not.toBeNull();
        });
    });

    // ── Toasts ────────────────────────────────────────────────────

    describe('toasts', () => {
        it('addToast generates unique ID', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().addToast({ type: 'success', message: 'Done!' });
            useAppStore.getState().addToast({ type: 'error', message: 'Oops' });

            const toasts = useAppStore.getState().toasts;
            expect(toasts).toHaveLength(2);
            expect(toasts[0].id).not.toBe(toasts[1].id);
        });

        it('removeToast removes by ID', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().addToast({ type: 'info', message: 'Hello' });
            const id = useAppStore.getState().toasts[0].id;
            useAppStore.getState().removeToast(id);

            expect(useAppStore.getState().toasts).toHaveLength(0);
        });
    });

    // ── Settings ──────────────────────────────────────────────────

    describe('settings', () => {
        it('updateSettings merges partial updates', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().updateSettings({ deletionSpeed: 'aggressive' });

            const settings = useAppStore.getState().settings;
            expect(settings.deletionSpeed).toBe('aggressive');
            expect(settings.confirmBeforeDelete).toBe(true); // Unchanged
        });
    });

    // ── PSN state ─────────────────────────────────────────────────

    describe('PSN state', () => {
        it('setPSNFriends updates friends list', async () => {
            const useAppStore = await loadStore();
            const friends = [{ accountId: 'a1', onlineId: 'player1' }] as any[];
            useAppStore.getState().setPSNFriends(friends);

            expect(useAppStore.getState().psnFriends).toHaveLength(1);
            expect(useAppStore.getState().psnFriends[0].onlineId).toBe('player1');
        });

        it('setPSNPresenceLoading and progress', async () => {
            const useAppStore = await loadStore();
            useAppStore.getState().setPSNPresenceLoading(true);
            useAppStore.getState().setPSNPresenceProgress({ current: 5, total: 10 });

            expect(useAppStore.getState().psnPresenceLoading).toBe(true);
            expect(useAppStore.getState().psnPresenceProgress).toEqual({ current: 5, total: 10 });
        });
    });
});
