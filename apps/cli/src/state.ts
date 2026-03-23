import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Persistent state manager — saves/loads progress to a JSON file
 * Enables resume after crash/reboot
 */

export interface ChannelState {
    channelId: string;
    label: string;
    status: 'pending' | 'scanning' | 'deleting' | 'completed' | 'failed';
    totalMessages: number;
    deletedMessages: number;
    failedMessages: number;
    /** Message IDs already deleted (for dedup on resume) */
    deletedIds: string[];
    /** Last message ID processed (for scan resume) */
    lastScannedId?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

export interface AppState {
    version: number;
    startedAt: string;
    currentTargetIndex: number;
    targets: ChannelState[];
    /** Data package channels loaded */
    dataPackageLoaded: boolean;
}

const STATE_VERSION = 1;

export class StateManager {
    private filePath: string;
    private state: AppState;
    private dirty = false;
    private saveInterval: ReturnType<typeof setInterval> | null = null;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.state = this.load();

        // Auto-save every 10 seconds if dirty
        this.saveInterval = setInterval(() => {
            if (this.dirty) this.save();
        }, 10000);
    }

    private load(): AppState {
        if (existsSync(this.filePath)) {
            try {
                const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
                if (data.version === STATE_VERSION) {
                    console.log(`[State] Loaded state: ${data.targets?.length || 0} targets, index ${data.currentTargetIndex}`);
                    return data;
                }
                console.warn('[State] State version mismatch, starting fresh');
            } catch (err) {
                console.warn('[State] Failed to load state, starting fresh:', (err as Error).message);
            }
        }
        return {
            version: STATE_VERSION,
            startedAt: new Date().toISOString(),
            currentTargetIndex: 0,
            targets: [],
            dataPackageLoaded: false,
        };
    }

    save() {
        try {
            writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
            this.dirty = false;
        } catch (err) {
            console.error('[State] Failed to save:', (err as Error).message);
        }
    }

    destroy() {
        if (this.saveInterval) clearInterval(this.saveInterval);
        this.save(); // Final save
    }

    get data(): AppState { return this.state; }

    initTargets(targets: { channelId: string; label: string }[]) {
        // Only init if empty (don't overwrite resume state)
        if (this.state.targets.length > 0) {
            console.log('[State] Targets already initialized, resuming');
            return;
        }
        this.state.targets = targets.map(t => ({
            channelId: t.channelId,
            label: t.label,
            status: 'pending',
            totalMessages: 0,
            deletedMessages: 0,
            failedMessages: 0,
            deletedIds: [],
        }));
        this.dirty = true;
    }

    getCurrentTarget(): ChannelState | null {
        return this.state.targets[this.state.currentTargetIndex] || null;
    }

    advanceTarget() {
        this.state.currentTargetIndex++;
        this.dirty = true;
        this.save();
    }

    updateTarget(channelId: string, updates: Partial<ChannelState>) {
        const target = this.state.targets.find(t => t.channelId === channelId);
        if (target) {
            Object.assign(target, updates);
            this.dirty = true;
        }
    }

    markDeleted(channelId: string, messageId: string) {
        const target = this.state.targets.find(t => t.channelId === channelId);
        if (target) {
            target.deletedIds.push(messageId);
            target.deletedMessages++;
            this.dirty = true;
        }
    }

    getDeletedSet(channelId: string): Set<string> {
        const target = this.state.targets.find(t => t.channelId === channelId);
        return new Set(target?.deletedIds || []);
    }

    isComplete(): boolean {
        return this.state.currentTargetIndex >= this.state.targets.length;
    }

    setDataPackageLoaded(loaded: boolean) {
        this.state.dataPackageLoaded = loaded;
        this.dirty = true;
    }

    /** Cap deletedIds arrays to prevent JSON bloat (keep last N) */
    trimDeletedIds(maxPerChannel = 50000) {
        for (const target of this.state.targets) {
            if (target.deletedIds.length > maxPerChannel) {
                target.deletedIds = target.deletedIds.slice(-maxPerChannel);
            }
        }
        this.dirty = true;
    }
}
