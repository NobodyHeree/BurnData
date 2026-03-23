/**
 * SmartRateLimiter — Intelligent rate limiting for Discord API
 *
 * Inspired by Undiscord's burst+pause strategy and community findings:
 * - Discord rate limits: ~5 DELETE/5s per channel (bucket-based)
 * - Global rate limit escalation: consecutive 429s increase delays
 * - retry_after > 60s may indicate IP-level throttling
 *
 * Strategy: Burst N requests, then pause. Adapts based on Discord's response headers.
 * Works in Node.js (CLI), Electron, and browser.
 */

export interface RateLimitConfig {
    /** Max requests before mandatory pause. Default: 5 */
    burstSize: number;
    /** Pause duration after burst in ms. Default: 10000 */
    burstPauseMs: number;
    /** Minimum delay between requests in ms. Default: 200 */
    minDelayMs: number;
    /** Base delay when no rate limit info available. Default: 1000 */
    baseDelayMs: number;
    /** Multiplier for retry_after on 429. Default: 2 */
    retryAfterMultiplier: number;
}

export type SpeedPreset = 'conservative' | 'balanced' | 'aggressive';

const PRESETS: Record<SpeedPreset, RateLimitConfig> = {
    conservative: {
        burstSize: 3,
        burstPauseMs: 15000,
        minDelayMs: 500,
        baseDelayMs: 1500,
        retryAfterMultiplier: 2.5,
    },
    balanced: {
        burstSize: 5,
        burstPauseMs: 10000,
        minDelayMs: 200,
        baseDelayMs: 1000,
        retryAfterMultiplier: 2,
    },
    aggressive: {
        burstSize: 8,
        burstPauseMs: 8000,
        minDelayMs: 100,
        baseDelayMs: 800,
        retryAfterMultiplier: 1.5,
    },
};

export class SmartRateLimiter {
    private config: RateLimitConfig;
    private burstCount = 0;
    private consecutive429s = 0;
    private lastRequestTime = 0;
    private pausedSince = 0;
    private totalPausedMs = 0;
    private _isPaused = false;
    private _isCancelled = false;

    // Stats
    public stats = {
        totalRequests: 0,
        totalThrottled: 0,
        totalThrottleWaitMs: 0,
        avgPing: 0,
    };

    constructor(preset: SpeedPreset = 'balanced') {
        this.config = { ...PRESETS[preset] };
    }

    setPreset(preset: SpeedPreset) {
        this.config = { ...PRESETS[preset] };
    }

    setConfig(config: Partial<RateLimitConfig>) {
        Object.assign(this.config, config);
    }

    pause() { this._isPaused = true; this.pausedSince = Date.now(); }
    resume() {
        if (this._isPaused && this.pausedSince > 0) {
            this.totalPausedMs += Date.now() - this.pausedSince;
            this.pausedSince = 0;
        }
        this._isPaused = false;
    }
    cancel() { this._isCancelled = true; this._isPaused = false; }

    reset() {
        this._isCancelled = false;
        this._isPaused = false;
        this.burstCount = 0;
        this.consecutive429s = 0;
        this.lastRequestTime = 0;
        this.pausedSince = 0;
        this.totalPausedMs = 0;
        this.stats.totalRequests = 0;
    }

    get isPaused() { return this._isPaused; }
    get isCancelled() { return this._isCancelled; }

    // Call after each DELETE. Handles burst pacing, rate limit headers, and pause/cancel.
    async waitAfterRequest(options: {
        wasAlreadyDeleted?: boolean;
        rateLimitRemaining?: number | null;
        rateLimitResetMs?: number | null;
    } = {}): Promise<'ok' | 'paused' | 'cancelled'> {
        const { wasAlreadyDeleted, rateLimitRemaining, rateLimitResetMs } = options;

        this.stats.totalRequests++;
        if (this.lastRequestTime === 0) this.lastRequestTime = Date.now();

        // Already deleted = no rate limit consumed, minimal wait
        if (wasAlreadyDeleted) {
            await this.sleep(30);
            return this._isCancelled ? 'cancelled' : 'ok';
        }

        // Reset consecutive 429 counter on success
        this.consecutive429s = 0;
        this.burstCount++;

        // Burst pause: after N successful requests, take a mandatory break
        if (this.burstCount >= this.config.burstSize) {
            this.burstCount = 0;
            await this.sleep(this.config.burstPauseMs);
            if (this._isCancelled) return 'cancelled';
            // Check pause during burst pause
            const pauseResult = await this.waitWhilePaused();
            if (pauseResult === 'cancelled') return 'cancelled';
            return 'ok';
        }

        // Adaptive delay based on rate limit headers
        let delay: number;
        if (rateLimitRemaining !== null && rateLimitRemaining !== undefined && rateLimitResetMs) {
            if (rateLimitRemaining <= 1) {
                // Almost out of budget — wait for full reset
                delay = rateLimitResetMs + 100;
            } else if (rateLimitRemaining <= 3) {
                // Getting low — spread remaining requests over reset window
                delay = Math.ceil(rateLimitResetMs / rateLimitRemaining);
            } else {
                // Plenty of budget — go fast
                delay = this.config.minDelayMs;
            }
        } else {
            // No header info — use base delay
            delay = this.config.baseDelayMs;
        }

        await this.sleep(delay);
        if (this._isCancelled) return 'cancelled';

        const pauseResult = await this.waitWhilePaused();
        return pauseResult;
    }

    // Track 429s and escalate delays if they keep coming
    handleRateLimit(retryAfterMs: number) {
        this.consecutive429s++;
        this.stats.totalThrottled++;
        this.stats.totalThrottleWaitMs += retryAfterMs;

        // Escalation detection
        if (retryAfterMs > 60000) {
            console.warn('[RateLimiter] retry_after > 60s — possible IP-level throttle. Slowing down significantly.');
            this.config.burstSize = Math.max(1, this.config.burstSize - 2);
            this.config.burstPauseMs = Math.min(30000, this.config.burstPauseMs * 2);
        }

        if (this.consecutive429s >= 3) {
            console.warn(`[RateLimiter] ${this.consecutive429s} consecutive 429s — escalating delays`);
            this.config.baseDelayMs = Math.min(5000, this.config.baseDelayMs * 1.5);
            this.config.burstPauseMs = Math.min(30000, this.config.burstPauseMs * 1.3);
        }

        // Reset burst counter — the pause from 429 retry counts as a break
        this.burstCount = 0;
    }

    private async waitWhilePaused(): Promise<'ok' | 'cancelled'> {
        while (this._isPaused && !this._isCancelled) {
            await this.sleep(200);
        }
        return this._isCancelled ? 'cancelled' : 'ok';
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            let checkInterval: ReturnType<typeof setInterval> | null = null;
            const timer = setTimeout(() => {
                if (checkInterval) clearInterval(checkInterval);
                resolve();
            }, ms);
            // Check cancellation every 100ms for long sleeps
            if (ms > 500) {
                checkInterval = setInterval(() => {
                    if (this._isCancelled) {
                        clearTimeout(timer);
                        clearInterval(checkInterval!);
                        resolve();
                    }
                }, 100);
            }
        });
    }

    getETR(remainingMessages: number): number {
        if (this.stats.totalRequests < 2 || this.lastRequestTime === 0) {
            // Not enough data — estimate from config
            const perMsg = this.config.baseDelayMs;
            const burstsRemaining = Math.ceil(remainingMessages / this.config.burstSize);
            return (remainingMessages * perMsg) + (burstsRemaining * this.config.burstPauseMs);
        }

        const activePause = this._isPaused && this.pausedSince > 0 ? Date.now() - this.pausedSince : 0;
        const elapsed = Date.now() - this.lastRequestTime - this.totalPausedMs - activePause;
        const msPerMessage = elapsed / this.stats.totalRequests;
        return Math.round(remainingMessages * msPerMessage);
    }
}
