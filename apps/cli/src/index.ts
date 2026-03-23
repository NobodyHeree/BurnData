#!/usr/bin/env node

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { resolve } from 'path';
import axios, { AxiosError } from 'axios';
import YAML from 'yaml';
import JSZip from 'jszip';
import { WebhookNotifier } from './webhook.js';
import { StateManager, type ChannelState } from './state.js';

interface Config {
    discord_token: string;
    webhook_url?: string;
    targets: { channel_id: string; label?: string }[];
    data_package?: string;
    speed: 'conservative' | 'balanced' | 'aggressive';
    notify_every: number;
    auto_resume: boolean;
    state_file: string;
    log_file?: string;
}

interface RateLimitInfo {
    remaining: number | null;
    resetAfterMs: number | null;
}

// Aligned with SmartRateLimiter presets in @services
const SPEED_CONFIGS = {
    conservative: { burstSize: 3, burstPauseMs: 15000, minDelayMs: 500, baseDelayMs: 1500 },
    balanced: { burstSize: 5, burstPauseMs: 10000, minDelayMs: 200, baseDelayMs: 1000 },
    aggressive: { burstSize: 8, burstPauseMs: 8000, minDelayMs: 100, baseDelayMs: 800 },
};

const DISCORD_API = 'https://discord.com/api/v10';
let isShuttingDown = false;
let config: Config;
let webhook: WebhookNotifier;
let state: StateManager;
let logFile: string | null = null;

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}`;
    console.log(line);
    if (logFile) {
        try { appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
    }
}

// --- Discord API helpers ---

const headers = () => ({
    'Authorization': config.discord_token,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
});

const parseRateLimits = (respHeaders: any): RateLimitInfo => {
    const remaining = respHeaders?.['x-ratelimit-remaining'];
    const resetAfter = respHeaders?.['x-ratelimit-reset-after'];
    return {
        remaining: remaining !== undefined ? Number(remaining) : null,
        resetAfterMs: resetAfter !== undefined ? Number(resetAfter) * 1000 : null,
    };
};

async function discordRequest<T>(method: string, endpoint: string, retries = 3): Promise<{ data: T; rateLimits: RateLimitInfo }> {
    let consecutive429s = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await axios({ method, url: `${DISCORD_API}${endpoint}`, headers: headers(), timeout: 30000 });
            return { data: resp.data, rateLimits: parseRateLimits(resp.headers) };
        } catch (error) {
            const axErr = error as AxiosError<{ retry_after?: number }>;

            // Token expired/invalid — fatal, stop everything
            if (axErr.response?.status === 401) {
                log('ERROR', 'Token expired or invalid (401). Stopping.');
                await webhook.error('Token expired (401)', 'The Discord token is no longer valid. Update config.yaml and restart.');
                state?.destroy();
                process.exit(1);
            }

            if (axErr.response?.status === 429) {
                consecutive429s++;
                const retryAfter = axErr.response.data?.retry_after || 5;
                const waitMs = retryAfter * 1000;
                const multiplier = Math.min(consecutive429s, 4); // Escalate: 2x, 3x, 4x
                const actualWait = waitMs * multiplier;
                log('WARN', `Rate limited (${consecutive429s}x). Waiting ${Math.ceil(actualWait)}ms`);
                if (consecutive429s >= 3) await webhook.rateLimited(actualWait, consecutive429s);
                await sleep(actualWait);
                // Don't count 429 against retry limit — always retry rate limits
                attempt--;
                continue;
            }

            const isNetworkError = !axErr.response && (axErr.code === 'ECONNRESET' || axErr.code === 'ETIMEDOUT' || axErr.code === 'ECONNABORTED');
            const isServerError = axErr.response?.status && axErr.response.status >= 500;

            if (attempt < retries && (isNetworkError || isServerError)) {
                const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30000);
                log('WARN', `Request failed (${axErr.code || axErr.response?.status}), retrying in ${Math.ceil(backoff)}ms`);
                await sleep(backoff);
                continue;
            }

            // Sanitize token from error
            if (axErr.config?.headers) {
                (axErr.config.headers as any)['Authorization'] = '[REDACTED]';
            }
            throw error;
        }
    }
    throw new Error('Max retries exceeded');
}

async function deleteMessage(channelId: string, messageId: string): Promise<{ success: boolean; alreadyDeleted: boolean; rateLimits: RateLimitInfo }> {
    try {
        const result = await discordRequest('DELETE', `/channels/${channelId}/messages/${messageId}`);
        return { success: true, alreadyDeleted: false, rateLimits: result.rateLimits };
    } catch (error) {
        const axErr = error as AxiosError;
        if (axErr.response?.status === 404 || axErr.response?.status === 403) {
            return { success: true, alreadyDeleted: true, rateLimits: parseRateLimits(axErr.response.headers) };
        }
        throw error;
    }
}

async function loadDataPackage(zipPath: string): Promise<Record<string, string[]>> {
    log('INFO', `Loading data package: ${zipPath}`);
    const data = readFileSync(zipPath);
    const zip = await JSZip.loadAsync(data);

    // Find index.json
    let indexData: Record<string, string> = {};
    for (const [path, entry] of Object.entries(zip.files)) {
        if (/[Mm]essages\/index\.json$/i.test(path)) {
            indexData = JSON.parse(await entry.async('string'));
            break;
        }
    }

    const channelMessages: Record<string, string[]> = {};

    for (const [filePath, entry] of Object.entries(zip.files)) {
        const match = filePath.match(/[Mm]essages\/c?(\d+)\/messages\.(csv|json)$/);
        if (!match) continue;

        const channelId = match[1];
        const fileType = match[2];
        const content = await entry.async('string');
        const messageIds: string[] = [];

        if (fileType === 'json') {
            try {
                const messages = JSON.parse(content);
                if (Array.isArray(messages)) {
                    for (const msg of messages) {
                        const id = msg.ID || msg.id || msg.Id;
                        if (id && /^\d+$/.test(String(id))) messageIds.push(String(id));
                    }
                }
            } catch { /* malformed json, skip */ }
        } else {
            const lines = content.split('\n');
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const firstComma = line.indexOf(',');
                if (firstComma > 0) {
                    const id = line.substring(0, firstComma);
                    if (/^\d+$/.test(id)) messageIds.push(id);
                }
            }
        }

        if (messageIds.length > 0) {
            channelMessages[channelId] = messageIds;
        }
    }

    const totalMsgs = Object.values(channelMessages).reduce((s, ids) => s + ids.length, 0);
    log('INFO', `Data package: ${totalMsgs.toLocaleString()} messages across ${Object.keys(channelMessages).length} channels`);
    return channelMessages;
}

async function scanChannel(channelId: string, userId: string): Promise<{ channelId: string; messageId: string }[]> {
    const messages: { channelId: string; messageId: string }[] = [];
    let before: string | undefined;
    let hasMore = true;
    let lastBefore: string | undefined;

    while (hasMore && !isShuttingDown) {
        try {
            const result = await discordRequest<any[]>('GET',
                `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`
            );
            const batch = result.data;
            if (batch.length === 0) { hasMore = false; break; }

            for (const msg of batch) {
                if (msg.author.id === userId) {
                    messages.push({ channelId, messageId: msg.id });
                }
            }

            before = batch[batch.length - 1].id;
            if (before === lastBefore) break; // Infinite loop guard
            lastBefore = before;
            if (batch.length < 100) hasMore = false;

            await sleep(300);
        } catch (err) {
            log('ERROR', `Scan error in ${channelId}: ${(err as Error).message}`);
            hasMore = false;
        }
    }

    return messages;
}

async function processTarget(target: ChannelState, dataPackage: Record<string, string[]> | null) {
    const speedConfig = SPEED_CONFIGS[config.speed];
    let burstCount = 0;
    const startTime = Date.now();

    state.updateTarget(target.channelId, { status: 'scanning', startedAt: new Date().toISOString() });
    state.save();

    // Phase 1: Validate token
    log('INFO', `Validating token...`);
    const { data: user } = await discordRequest<{ id: string; username: string }>('GET', '/users/@me');
    log('INFO', `Authenticated as ${user.username} (${user.id})`);

    // Phase 2+3: Scan-Delete loop — repeat until no messages left
    let deleted = target.deletedMessages;
    let failed = target.failedMessages;
    let pass = 0;
    let totalEverFound = target.deletedMessages; // Include already-deleted from prior runs
    let lastProgressTime = Date.now();

    while (!isShuttingDown) {
        pass++;
        burstCount = 0; // Reset burst counter between passes
        log('INFO', `[Pass ${pass}] Scanning messages in ${target.label} (${target.channelId})...`);

        let scannedMessages: { channelId: string; messageId: string }[];
        try {
            scannedMessages = await scanChannel(target.channelId, user.id);
        } catch (err) {
            log('WARN', `[Pass ${pass}] Scan failed: ${(err as Error).message}. Retrying after cooldown...`);
            await sleep(5000);
            if (pass > 5) {
                log('ERROR', `[Pass ${pass}] Too many scan failures, stopping target.`);
                break;
            }
            continue;
        }

        const alreadyDeleted = state.getDeletedSet(target.channelId);
        const toDelete = scannedMessages.filter(m => !alreadyDeleted.has(m.messageId));

        if (toDelete.length === 0) {
            log('INFO', `[Pass ${pass}] No more messages found. Done!`);
            break;
        }

        // Safety: cap passes to avoid infinite re-scan if something is broken
        if (pass > 50) {
            log('WARN', `[Pass ${pass}] Too many passes, likely a bug. Stopping this target.`);
            await webhook.error(`${target.label}: too many scan passes (${pass})`, 'Possible infinite loop — messages may not be deletable.');
            break;
        }

        totalEverFound += toDelete.length;
        log('INFO', `[Pass ${pass}] Found ${toDelete.length} messages to delete`);

        if (pass === 1) {
            state.updateTarget(target.channelId, { status: 'deleting', totalMessages: toDelete.length });
            await webhook.jobStarted({ channelId: target.channelId, label: target.label }, toDelete.length);
        }

        // Cooldown after scan
        await sleep(2000);

    for (let i = 0; i < toDelete.length; i++) {
        if (isShuttingDown) {
            log('INFO', 'Shutdown requested, saving state...');
            state.save();
            return;
        }

        const { channelId, messageId } = toDelete[i];

        try {
            const result = await deleteMessage(channelId, messageId);

            if (result.alreadyDeleted) {
                deleted++;
                state.markDeleted(channelId, messageId); // Track to avoid re-scanning
                await sleep(30); // Minimal delay for 404
                continue;
            }

            if (result.success) {
                deleted++;
                state.markDeleted(channelId, messageId);
                burstCount++;

                // Burst pause
                if (burstCount >= speedConfig.burstSize) {
                    burstCount = 0;
                    await sleep(speedConfig.burstPauseMs);
                } else {
                    // Adaptive delay from headers
                    const { remaining, resetAfterMs } = result.rateLimits;
                    let delay: number;
                    if (remaining !== null && resetAfterMs) {
                        if (remaining <= 1) {
                            delay = resetAfterMs + 100;
                        } else if (remaining <= 3) {
                            delay = Math.ceil(resetAfterMs / remaining);
                        } else {
                            delay = speedConfig.minDelayMs;
                        }
                    } else {
                        delay = speedConfig.baseDelayMs;
                    }
                    await sleep(delay);
                }
            } else {
                failed++;
            }
        } catch (err) {
            failed++;
            log('ERROR', `Delete failed for ${messageId}: ${(err as Error).message}`);

            // If too many consecutive failures, something is wrong
            if (failed > 10 && failed > deleted * 0.5) {
                const errorMsg = 'Too many failures, stopping this target';
                log('ERROR', errorMsg);
                await webhook.error(errorMsg, `${failed} failures vs ${deleted} successes`);
                state.updateTarget(channelId, { status: 'failed', error: errorMsg });
                return;
            }
        }

        // Progress update
        state.updateTarget(target.channelId, { deletedMessages: deleted, failedMessages: failed });
        lastProgressTime = Date.now();

        if (deleted % config.notify_every === 0 && deleted > 0) {
            const elapsed = Date.now() - startTime;
            const rate = deleted / (elapsed / 1000);
            const speed = `${rate.toFixed(1)} msg/s`;
            log('INFO', `Progress: ${deleted} deleted - ${speed}`);
            await webhook.progress({ label: target.label }, deleted, totalEverFound, speed);
        }

        // Watchdog: if no progress for 5 minutes, something is wrong
        if (Date.now() - lastProgressTime > 300000) {
            log('WARN', 'No progress for 5 minutes — possible hang');
            await webhook.error(`${target.label}: no progress for 5min`, 'The deletion process may be stuck.');
            lastProgressTime = Date.now(); // Reset to avoid spamming
        }
    }

        log('INFO', `[Pass ${pass}] Finished. Deleted so far: ${deleted}. Re-scanning...`);
        await sleep(2000);
    } // end while scan-delete loop

    const duration = Date.now() - startTime;
    state.updateTarget(target.channelId, {
        status: 'completed',
        deletedMessages: deleted,
        failedMessages: failed,
        completedAt: new Date().toISOString(),
    });
    state.save();

    log('INFO', `Completed ${target.label}: ${deleted} deleted, ${failed} failed in ${formatDuration(duration)}`);
    await webhook.jobCompleted({ label: target.label }, deleted, failed, duration);
}

async function main() {
    // Load config
    const configPath = process.argv[2] || 'config.yaml';
    if (!existsSync(configPath)) {
        console.error(`Config file not found: ${configPath}`);
        console.error('Copy config.example.yaml to config.yaml and fill in your values.');
        process.exit(1);
    }

    config = YAML.parse(readFileSync(configPath, 'utf-8')) as Config;

    // Validate config
    if (!config.discord_token || config.discord_token === 'YOUR_TOKEN_HERE') {
        console.error('Please set your Discord token in config.yaml');
        process.exit(1);
    }
    if (!config.targets?.length) {
        console.error('No targets configured in config.yaml');
        process.exit(1);
    }

    // Defaults
    config.speed = config.speed || 'balanced';
    config.notify_every = config.notify_every || 100;
    config.auto_resume = config.auto_resume !== false;
    config.state_file = config.state_file || './burndata-state.json';

    // Setup
    logFile = config.log_file ? resolve(config.log_file) : null;
    webhook = new WebhookNotifier(config.webhook_url);
    state = new StateManager(resolve(config.state_file));

    log('INFO', '=== BurnData CLI ===');
    log('INFO', `Speed: ${config.speed}`);
    log('INFO', `Targets: ${config.targets.length}`);
    log('INFO', `Webhook: ${webhook.enabled ? 'enabled' : 'disabled'}`);
    log('INFO', `Auto-resume: ${config.auto_resume}`);

    // Signal handling for graceful shutdown
    const shutdown = () => {
        if (isShuttingDown) {
            log('WARN', 'Force shutdown');
            process.exit(1);
        }
        isShuttingDown = true;
        log('INFO', 'Graceful shutdown requested (Ctrl+C again to force)...');
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Init targets
    state.initTargets(config.targets.map(t => ({
        channelId: t.channel_id,
        label: t.label || t.channel_id,
    })));

    // Load data package if configured
    let dataPackage: Record<string, string[]> | null = null;
    if (config.data_package && existsSync(config.data_package)) {
        try {
            dataPackage = await loadDataPackage(resolve(config.data_package));
            state.setDataPackageLoaded(true);
        } catch (err) {
            log('ERROR', `Failed to load data package: ${(err as Error).message}`);
        }
    }

    // Process targets
    const overallStart = Date.now();
    let totalDeleted = 0;
    let totalFailed = 0;

    while (!state.isComplete() && !isShuttingDown) {
        const target = state.getCurrentTarget();
        if (!target) break;

        if (target.status === 'completed') {
            totalDeleted += target.deletedMessages;
            totalFailed += target.failedMessages;
            state.advanceTarget();
            continue;
        }

        const nextIdx = state.data.currentTargetIndex + 1;
        const remainingTargets = state.data.targets.length - nextIdx;

        log('INFO', `--- Processing: ${target.label} (${target.channelId}) ---`);
        log('INFO', `Target ${state.data.currentTargetIndex + 1}/${state.data.targets.length}`);

        try {
            await processTarget(target, dataPackage);
            totalDeleted += target.deletedMessages;
            totalFailed += target.failedMessages;
        } catch (err) {
            const errorMsg = (err as Error).message;
            log('ERROR', `Target failed: ${errorMsg}`);
            await webhook.error(`Target ${target.label} failed`, errorMsg);
            state.updateTarget(target.channelId, { status: 'failed', error: errorMsg });
            totalFailed += target.failedMessages;
        }

        // Notify next target
        const nextTarget = state.data.targets[nextIdx];
        if (nextTarget && !isShuttingDown) {
            await webhook.nextTarget({ label: target.label }, { label: nextTarget.label }, remainingTargets);
        }

        state.advanceTarget();

        // Trim state to prevent bloat
        state.trimDeletedIds();
    }

    // Final summary
    const totalDuration = Date.now() - overallStart;
    log('INFO', `=== All done ===`);
    log('INFO', `Total deleted: ${totalDeleted}, failed: ${totalFailed}, duration: ${formatDuration(totalDuration)}`);
    await webhook.allDone(totalDeleted, totalFailed, totalDuration);

    state.destroy();
    process.exit(0);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

process.on('uncaughtException', async (err) => {
    log('ERROR', `Uncaught exception: ${err.message}`);
    try {
        await webhook.error('CLI crashed (uncaughtException)', err.stack || err.message);
        state?.destroy();
    } catch { /* last resort, nothing to do */ }
    process.exit(1);
});

process.on('unhandledRejection', async (reason: any) => {
    log('ERROR', `Unhandled rejection: ${reason?.message || reason}`);
    try {
        await webhook.error('CLI crashed (unhandledRejection)', String(reason?.stack || reason));
        state?.destroy();
    } catch { /* last resort, nothing to do */ }
    process.exit(1);
});

main().catch(async err => {
    log('ERROR', `Fatal error: ${err.message}`);
    try {
        await webhook.error('CLI fatal error', err.stack || err.message);
        state?.destroy();
    } catch { /* last resort, nothing to do */ }
    process.exit(1);
});
