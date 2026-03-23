import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateManager } from '../state';

describe('StateManager', () => {
    let tmpDir: string;
    let statePath: string;
    let manager: StateManager;

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        tmpDir = mkdtempSync(join(tmpdir(), 'burndata-test-'));
        statePath = join(tmpDir, 'state.json');
    });

    afterEach(() => {
        manager?.destroy();
        vi.useRealTimers();
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });

    // ── Initialization ────────────────────────────────────────────

    describe('initialization', () => {
        it('creates fresh state when no file exists', () => {
            manager = new StateManager(statePath);
            expect(manager.data.version).toBe(1);
            expect(manager.data.targets).toEqual([]);
            expect(manager.data.currentTargetIndex).toBe(0);
        });

        it('loads existing state from file', () => {
            const existing = {
                version: 1,
                startedAt: '2026-01-01T00:00:00Z',
                currentTargetIndex: 2,
                targets: [
                    { channelId: 'ch1', label: 'test', status: 'completed', totalMessages: 100, deletedMessages: 100, failedMessages: 0, deletedIds: ['a'] },
                ],
                dataPackageLoaded: true,
            };
            writeFileSync(statePath, JSON.stringify(existing));

            manager = new StateManager(statePath);
            expect(manager.data.currentTargetIndex).toBe(2);
            expect(manager.data.targets[0].channelId).toBe('ch1');
            expect(manager.data.dataPackageLoaded).toBe(true);
        });

        it('starts fresh on version mismatch', () => {
            writeFileSync(statePath, JSON.stringify({ version: 999, targets: [] }));

            manager = new StateManager(statePath);
            expect(manager.data.version).toBe(1);
            expect(manager.data.targets).toEqual([]);
        });

        it('starts fresh on corrupted JSON', () => {
            writeFileSync(statePath, '{not valid json!!!');

            manager = new StateManager(statePath);
            expect(manager.data.version).toBe(1);
        });
    });

    // ── Target management ─────────────────────────────────────────

    describe('initTargets', () => {
        it('initializes targets from config', () => {
            manager = new StateManager(statePath);
            manager.initTargets([
                { channelId: 'ch1', label: 'General' },
                { channelId: 'ch2', label: 'Random' },
            ]);

            expect(manager.data.targets).toHaveLength(2);
            expect(manager.data.targets[0]).toMatchObject({
                channelId: 'ch1',
                label: 'General',
                status: 'pending',
                deletedMessages: 0,
                deletedIds: [],
            });
        });

        it('does not overwrite existing targets (resume mode)', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'First' }]);
            manager.updateTarget('ch1', { status: 'deleting', deletedMessages: 50 });

            // Re-init should be a no-op
            manager.initTargets([{ channelId: 'ch1', label: 'First' }, { channelId: 'ch2', label: 'Second' }]);

            expect(manager.data.targets).toHaveLength(1); // Still just 1
            expect(manager.data.targets[0].deletedMessages).toBe(50);
        });
    });

    describe('getCurrentTarget', () => {
        it('returns current target based on index', () => {
            manager = new StateManager(statePath);
            manager.initTargets([
                { channelId: 'ch1', label: 'A' },
                { channelId: 'ch2', label: 'B' },
            ]);

            expect(manager.getCurrentTarget()!.channelId).toBe('ch1');
        });

        it('returns null when past all targets', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'A' }]);
            manager.advanceTarget();

            expect(manager.getCurrentTarget()).toBeNull();
        });
    });

    describe('advanceTarget', () => {
        it('increments currentTargetIndex and saves', () => {
            manager = new StateManager(statePath);
            manager.initTargets([
                { channelId: 'ch1', label: 'A' },
                { channelId: 'ch2', label: 'B' },
            ]);

            manager.advanceTarget();
            expect(manager.data.currentTargetIndex).toBe(1);

            // Should have saved to disk
            const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
            expect(saved.currentTargetIndex).toBe(1);
        });
    });

    // ── Deletion tracking ─────────────────────────────────────────

    describe('markDeleted', () => {
        it('tracks deleted message IDs and increments counter', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'Test' }]);

            manager.markDeleted('ch1', 'msg1');
            manager.markDeleted('ch1', 'msg2');

            const target = manager.data.targets[0];
            expect(target.deletedMessages).toBe(2);
            expect(target.deletedIds).toContain('msg1');
            expect(target.deletedIds).toContain('msg2');
        });

        it('ignores markDeleted for unknown channel', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'Test' }]);
            manager.markDeleted('ch-unknown', 'msg1');
            // No crash
        });
    });

    describe('getDeletedSet', () => {
        it('returns Set for dedup lookup', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'Test' }]);
            manager.markDeleted('ch1', 'a');
            manager.markDeleted('ch1', 'b');

            const set = manager.getDeletedSet('ch1');
            expect(set.has('a')).toBe(true);
            expect(set.has('b')).toBe(true);
            expect(set.has('c')).toBe(false);
        });

        it('returns empty set for unknown channel', () => {
            manager = new StateManager(statePath);
            expect(manager.getDeletedSet('nope').size).toBe(0);
        });
    });

    // ── isComplete ────────────────────────────────────────────────

    describe('isComplete', () => {
        it('returns false while targets remain', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'A' }]);
            expect(manager.isComplete()).toBe(false);
        });

        it('returns true when past all targets', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'A' }]);
            manager.advanceTarget();
            expect(manager.isComplete()).toBe(true);
        });
    });

    // ── trimDeletedIds ────────────────────────────────────────────

    describe('trimDeletedIds', () => {
        it('caps deletedIds to maxPerChannel (keeps last N)', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'Test' }]);

            // Manually push 60k IDs
            const target = manager.data.targets[0];
            target.deletedIds = Array.from({ length: 60000 }, (_, i) => `id-${i}`);

            manager.trimDeletedIds(50000);

            expect(target.deletedIds.length).toBe(50000);
            // Should keep the last 50000 (most recent)
            expect(target.deletedIds[0]).toBe('id-10000');
            expect(target.deletedIds[49999]).toBe('id-59999');
        });

        it('leaves arrays under the cap untouched', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'Test' }]);
            manager.markDeleted('ch1', 'a');
            manager.markDeleted('ch1', 'b');

            manager.trimDeletedIds(50000);
            expect(manager.data.targets[0].deletedIds).toEqual(['a', 'b']);
        });
    });

    // ── Auto-save ─────────────────────────────────────────────────

    describe('auto-save', () => {
        it('saves to disk after 10s interval when dirty', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'Test' }]);
            manager.markDeleted('ch1', 'msg1');

            // Advance 10 seconds
            vi.advanceTimersByTime(10000);

            const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
            expect(saved.targets[0].deletedIds).toContain('msg1');
        });
    });

    // ── destroy ───────────────────────────────────────────────────

    describe('destroy', () => {
        it('saves and clears interval', () => {
            manager = new StateManager(statePath);
            manager.initTargets([{ channelId: 'ch1', label: 'Test' }]);
            manager.markDeleted('ch1', 'final');

            manager.destroy();

            const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
            expect(saved.targets[0].deletedIds).toContain('final');
        });
    });

    // ── setDataPackageLoaded ──────────────────────────────────────

    describe('setDataPackageLoaded', () => {
        it('sets flag', () => {
            manager = new StateManager(statePath);
            manager.setDataPackageLoaded(true);
            expect(manager.data.dataPackageLoaded).toBe(true);
        });
    });
});
