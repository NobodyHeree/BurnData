/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to reimport the module fresh for each test group to reset module-level state.
// The module reads/writes localStorage at import time (migration) and keeps pendingWrites in closure.

describe('deletedTracker', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    async function loadTracker() {
        return await import('../deletedTracker');
    }


    describe('markDeleted + flushDeleted', () => {
        it('stores and retrieves deleted IDs after flush', async () => {
            const tracker = await loadTracker();
            tracker.markDeleted('ch1', 'msg1');
            tracker.markDeleted('ch1', 'msg2');
            tracker.flushDeleted();

            const set = tracker.getDeletedSet('ch1');
            expect(set.has('msg1')).toBe(true);
            expect(set.has('msg2')).toBe(true);
            expect(set.size).toBe(2);
        });

        it('returns empty set for unknown channel', async () => {
            const tracker = await loadTracker();
            expect(tracker.getDeletedSet('unknown').size).toBe(0);
        });

        it('getDeletedCount returns correct count', async () => {
            const tracker = await loadTracker();
            tracker.markDeleted('ch1', 'a');
            tracker.markDeleted('ch1', 'b');
            tracker.markDeleted('ch1', 'c');
            tracker.flushDeleted();

            expect(tracker.getDeletedCount('ch1')).toBe(3);
            expect(tracker.getDeletedCount('ch-none')).toBe(0);
        });
    });


    describe('auto-flush', () => {
        it('flushes automatically when pending count reaches 100', async () => {
            const tracker = await loadTracker();
            for (let i = 0; i < 100; i++) {
                tracker.markDeleted('ch1', `msg-${i}`);
            }
            // Should have auto-flushed — no manual flush needed
            const set = tracker.getDeletedSet('ch1');
            expect(set.size).toBe(100);
        });
    });


    describe('filterOutDeleted', () => {
        it('removes already-deleted IDs from array', async () => {
            const tracker = await loadTracker();
            tracker.markDeleted('ch1', 'msg1');
            tracker.markDeleted('ch1', 'msg3');
            tracker.flushDeleted();

            const remaining = tracker.filterOutDeleted('ch1', ['msg1', 'msg2', 'msg3', 'msg4']);
            expect(remaining).toEqual(['msg2', 'msg4']);
        });
    });


    describe('clear operations', () => {
        it('clearDeletedForChannel removes only that channel', async () => {
            const tracker = await loadTracker();
            tracker.markDeleted('ch1', 'a');
            tracker.markDeleted('ch2', 'b');
            tracker.flushDeleted();

            tracker.clearDeletedForChannel('ch1');
            expect(tracker.getDeletedSet('ch1').size).toBe(0);
            expect(tracker.getDeletedSet('ch2').size).toBe(1);
        });

        it('clearAllDeleted removes everything', async () => {
            const tracker = await loadTracker();
            tracker.markDeleted('ch1', 'a');
            tracker.markDeleted('ch2', 'b');
            tracker.flushDeleted();

            tracker.clearAllDeleted();
            expect(tracker.getDeletedSet('ch1').size).toBe(0);
            expect(tracker.getDeletedSet('ch2').size).toBe(0);
        });
    });


    describe('overflow caps', () => {
        it('caps per-channel IDs at 50,000 (keeps most recent)', async () => {
            const tracker = await loadTracker();
            // Write 50,100 IDs directly to localStorage
            const ids = Array.from({ length: 50100 }, (_, i) => `id-${i}`);
            localStorage.setItem('burndata-deleted-ids', JSON.stringify({ ch1: ids }));

            // Trigger saveStore by adding one more and flushing
            tracker.markDeleted('ch1', 'new-id');
            tracker.flushDeleted();

            const count = tracker.getDeletedCount('ch1');
            expect(count).toBeLessThanOrEqual(50000);
        });

        it('global cap evicts smallest channels first', async () => {
            const tracker = await loadTracker();
            // 5 channels with 41000 each = 205000 > 200k global cap
            const bigStore: Record<string, string[]> = {};
            // 5 channels with 41000 each = 205000 > 200k
            for (let c = 0; c < 5; c++) {
                bigStore[`ch-${c}`] = Array.from({ length: 41000 }, (_, i) => `id-${c}-${i}`);
            }
            localStorage.setItem('burndata-deleted-ids', JSON.stringify(bigStore));

            // Trigger saveStore
            tracker.markDeleted('ch-0', 'trigger');
            tracker.flushDeleted();

            // Some channels should have been evicted to bring total under 200k
            let total = 0;
            for (let c = 0; c < 5; c++) {
                total += tracker.getDeletedCount(`ch-${c}`);
            }
            expect(total).toBeLessThanOrEqual(200000);
        });
    });


    describe('migration', () => {
        it('migrates from old deletedata-deleted-ids key', async () => {
            localStorage.setItem('deletedata-deleted-ids', JSON.stringify({ ch1: ['old-1', 'old-2'] }));

            const tracker = await loadTracker();
            const set = tracker.getDeletedSet('ch1');
            expect(set.has('old-1')).toBe(true);
            expect(set.has('old-2')).toBe(true);

            // Old key should be removed
            expect(localStorage.getItem('deletedata-deleted-ids')).toBeNull();
            // New key should exist
            expect(localStorage.getItem('burndata-deleted-ids')).not.toBeNull();
        });

        it('does not overwrite existing new key during migration', async () => {
            localStorage.setItem('burndata-deleted-ids', JSON.stringify({ ch1: ['new-1'] }));
            localStorage.setItem('deletedata-deleted-ids', JSON.stringify({ ch1: ['old-1'] }));

            const tracker = await loadTracker();
            const set = tracker.getDeletedSet('ch1');
            expect(set.has('new-1')).toBe(true);
            // Old data should not have overwritten new
        });
    });
});
