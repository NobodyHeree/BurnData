import axios from 'axios';

/**
 * Discord Webhook notifier — sends embeds to a Discord channel
 */
export class WebhookNotifier {
    private url: string | null;
    private rateLimitUntil = 0;

    constructor(webhookUrl?: string) {
        this.url = webhookUrl || null;
    }

    get enabled() { return !!this.url; }

    private async send(payload: any) {
        if (!this.url) return;

        // Respect rate limits
        const now = Date.now();
        if (now < this.rateLimitUntil) {
            return; // Skip this notification
        }

        try {
            const resp = await axios.post(this.url, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000,
            });

            // Track rate limits
            const remaining = resp.headers['x-ratelimit-remaining'];
            if (remaining !== undefined && Number(remaining) <= 1) {
                const resetAfter = resp.headers['x-ratelimit-reset-after'];
                this.rateLimitUntil = now + (Number(resetAfter || 5) * 1000);
            }
        } catch (err) {
            // Don't crash on webhook failures
            console.error('[Webhook] Failed to send:', (err as Error).message);
        }
    }

    async jobStarted(target: { channelId: string; label: string }, messageCount: number) {
        await this.send({
            embeds: [{
                title: 'Deletion Started',
                color: 0x5865F2, // Discord blurple
                fields: [
                    { name: 'Target', value: target.label || target.channelId, inline: true },
                    { name: 'Messages', value: messageCount.toLocaleString(), inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'BurnData CLI' },
            }],
        });
    }

    async progress(target: { label: string }, deleted: number, total: number, speed: string) {
        const pct = total > 0 ? Math.min(100, Math.round(deleted / total * 100)) : 0;
        const filled = Math.min(20, Math.round(pct / 5));
        const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
        await this.send({
            embeds: [{
                title: 'Deletion Progress',
                color: 0xFEE75C, // Yellow
                description: `\`${bar}\` **${pct}%**`,
                fields: [
                    { name: 'Target', value: target.label, inline: true },
                    { name: 'Deleted', value: `${deleted.toLocaleString()} / ${total.toLocaleString()}`, inline: true },
                    { name: 'Speed', value: speed, inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'BurnData CLI' },
            }],
        });
    }

    async jobCompleted(target: { label: string }, deleted: number, failed: number, durationMs: number) {
        const duration = formatDuration(durationMs);
        await this.send({
            embeds: [{
                title: 'Deletion Completed',
                color: 0x57F287, // Green
                fields: [
                    { name: 'Target', value: target.label, inline: true },
                    { name: 'Deleted', value: deleted.toLocaleString(), inline: true },
                    { name: 'Failed', value: failed.toLocaleString(), inline: true },
                    { name: 'Duration', value: duration, inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'BurnData CLI' },
            }],
        });
    }

    async nextTarget(current: { label: string }, next: { label: string }, remaining: number) {
        await this.send({
            embeds: [{
                title: 'Moving to Next Target',
                color: 0x5865F2,
                description: `Finished **${current.label}**, starting **${next.label}**`,
                fields: [
                    { name: 'Remaining targets', value: remaining.toString(), inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'BurnData CLI' },
            }],
        });
    }

    async error(message: string, details?: string) {
        await this.send({
            embeds: [{
                title: 'Error',
                color: 0xED4245, // Red
                description: message,
                fields: details ? [{ name: 'Details', value: details.substring(0, 1000) }] : [],
                timestamp: new Date().toISOString(),
                footer: { text: 'BurnData CLI' },
            }],
        });
    }

    async rateLimited(waitMs: number, consecutive: number) {
        if (consecutive < 3) return; // Only notify on escalation
        await this.send({
            embeds: [{
                title: 'Rate Limited',
                color: 0xFFA500, // Orange
                description: `Waiting ${Math.ceil(waitMs / 1000)}s (${consecutive} consecutive 429s)`,
                timestamp: new Date().toISOString(),
                footer: { text: 'BurnData CLI' },
            }],
        });
    }

    async allDone(totalDeleted: number, totalFailed: number, totalDurationMs: number) {
        await this.send({
            embeds: [{
                title: 'All Deletions Complete',
                color: 0x57F287,
                description: 'All targets have been processed.',
                fields: [
                    { name: 'Total Deleted', value: totalDeleted.toLocaleString(), inline: true },
                    { name: 'Total Failed', value: totalFailed.toLocaleString(), inline: true },
                    { name: 'Total Duration', value: formatDuration(totalDurationMs), inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'BurnData CLI' },
            }],
        });
    }
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}
