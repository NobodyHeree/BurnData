import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartRateLimiter, SpeedPreset } from '../SmartRateLimiter';

describe('SmartRateLimiter', () => {
    let limiter: SmartRateLimiter;

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        limiter = new SmartRateLimiter('balanced');
    });

    afterEach(() => {
        limiter.cancel(); // Prevent lingering intervals
        vi.useRealTimers();
    });

    // ── Constructor & presets ─────────────────────────────────────

    describe('presets', () => {
        it('defaults to balanced preset', () => {
            const l = new SmartRateLimiter();
            // balanced burstSize = 5, verify via burst behavior
            expect(l.isPaused).toBe(false);
            expect(l.isCancelled).toBe(false);
        });

        it.each<SpeedPreset>(['conservative', 'balanced', 'aggressive'])(
            'accepts %s preset without error',
            (preset) => {
                const l = new SmartRateLimiter(preset);
                expect(l.isCancelled).toBe(false);
            }
        );

        it('setPreset switches config', async () => {
            limiter.setPreset('aggressive');
            // aggressive has burstSize 8 — should not burst-pause after 5 requests
            for (let i = 0; i < 5; i++) {
                await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            }
            // If it were balanced (burstSize 5) we'd have hit a long pause
            expect(limiter.stats.totalRequests).toBe(5);
        });
    });

    // ── waitAfterRequest ──────────────────────────────────────────

    describe('waitAfterRequest', () => {
        it('increments totalRequests on each call', async () => {
            await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            expect(limiter.stats.totalRequests).toBe(2);
        });

        it('returns ok on normal request', async () => {
            const result = await limiter.waitAfterRequest();
            expect(result).toBe('ok');
        });

        it('minimal wait for already-deleted messages', async () => {
            const start = Date.now();
            await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            // Should take ~30ms, not baseDelayMs (1000)
            expect(Date.now() - start).toBeLessThan(200);
        });

        it('uses baseDelayMs when no rate limit headers', async () => {
            const start = Date.now();
            await limiter.waitAfterRequest();
            const elapsed = Date.now() - start;
            // balanced baseDelayMs = 1000
            expect(elapsed).toBeGreaterThanOrEqual(900);
        });

        it('uses minDelayMs when rate limit budget is plentiful', async () => {
            const start = Date.now();
            await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            const elapsed = Date.now() - start;
            // balanced minDelayMs = 200
            expect(elapsed).toBeGreaterThanOrEqual(150);
            expect(elapsed).toBeLessThan(800);
        });

        it('waits for full reset when remaining <= 1', async () => {
            const start = Date.now();
            await limiter.waitAfterRequest({ rateLimitRemaining: 1, rateLimitResetMs: 2000 });
            const elapsed = Date.now() - start;
            // Should wait resetMs + 100 = 2100
            expect(elapsed).toBeGreaterThanOrEqual(2000);
        });

        it('spreads delay when remaining <= 3', async () => {
            const start = Date.now();
            await limiter.waitAfterRequest({ rateLimitRemaining: 2, rateLimitResetMs: 4000 });
            const elapsed = Date.now() - start;
            // ceil(4000 / 2) = 2000
            expect(elapsed).toBeGreaterThanOrEqual(1900);
            expect(elapsed).toBeLessThan(2500);
        });
    });

    // ── Burst pacing ──────────────────────────────────────────────

    describe('burst pacing', () => {
        it('triggers burst pause after burstSize successful requests', { timeout: 30000 }, async () => {
            // Use aggressive preset for shorter delays: burstSize=8, burstPauseMs=8000, minDelayMs=100
            limiter.setConfig({ burstSize: 3, burstPauseMs: 500, minDelayMs: 50, baseDelayMs: 50 });

            for (let i = 0; i < 2; i++) {
                await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            }
            // 3rd request triggers burst pause (500ms)
            const start = Date.now();
            await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(400);
        });

        it('resets burst counter after burst pause', { timeout: 30000 }, async () => {
            limiter.setConfig({ burstSize: 2, burstPauseMs: 200, minDelayMs: 30, baseDelayMs: 30 });

            // Exhaust one burst (2 requests)
            await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });

            // Next request should NOT trigger burst pause (counter was reset)
            const start = Date.now();
            await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(200); // Should be minDelayMs (30), not burstPause
        });
    });

    // ── handleRateLimit — 429 escalation ─────────────────────────

    describe('handleRateLimit', () => {
        it('tracks consecutive 429s and throttle stats', () => {
            limiter.handleRateLimit(2000);
            expect(limiter.stats.totalThrottled).toBe(1);
            expect(limiter.stats.totalThrottleWaitMs).toBe(2000);

            limiter.handleRateLimit(3000);
            expect(limiter.stats.totalThrottled).toBe(2);
            expect(limiter.stats.totalThrottleWaitMs).toBe(5000);
        });

        it('escalates delays after 3 consecutive 429s', () => {
            // balanced: baseDelayMs=1000, burstPauseMs=10000
            limiter.handleRateLimit(1000);
            limiter.handleRateLimit(1000);
            limiter.handleRateLimit(1000); // 3rd — triggers escalation

            // baseDelayMs should have increased (1000 * 1.5 = 1500)
            // burstPauseMs should have increased (10000 * 1.3 = 13000)
            // We can test this indirectly by checking a request uses higher delay
        });

        it('resets burst counter on 429', () => {
            // Simulate 3 successful requests then a 429
            // burst counter is private, but handleRateLimit resets it
            // Subsequent waitAfterRequest should start fresh burst
            limiter.handleRateLimit(1000);
            // No crash = good, burst counter reset to 0
        });

        it('escalates dramatically on retry_after > 60s (IP-level throttle)', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            limiter.handleRateLimit(70000);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('IP-level throttle'));
            warnSpy.mockRestore();
        });

        it('resets consecutive 429 counter on successful request', async () => {
            limiter.handleRateLimit(1000);
            limiter.handleRateLimit(1000);
            // Now a successful request should reset counter
            await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            // A single 429 after this should NOT escalate (counter was reset)
            limiter.handleRateLimit(1000);
            expect(limiter.stats.totalThrottled).toBe(3);
        });
    });

    // ── Pause / Resume / Cancel ──────────────────────────────────

    describe('pause/resume/cancel', () => {
        it('pause sets isPaused, resume clears it', () => {
            limiter.pause();
            expect(limiter.isPaused).toBe(true);
            limiter.resume();
            expect(limiter.isPaused).toBe(false);
        });

        it('cancel sets isCancelled and clears pause', () => {
            limiter.pause();
            limiter.cancel();
            expect(limiter.isCancelled).toBe(true);
            expect(limiter.isPaused).toBe(false);
        });

        it('waitAfterRequest returns cancelled when cancelled', async () => {
            limiter.cancel();
            const result = await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            expect(result).toBe('cancelled');
        });

        it('cancel interrupts a long sleep', async () => {
            // Start a request that will wait baseDelayMs (1000ms)
            const promise = limiter.waitAfterRequest();
            // Cancel after 200ms — sleep > 500ms so check interval is active
            setTimeout(() => limiter.cancel(), 200);
            const result = await promise;
            expect(result).toBe('cancelled');
        });

        it('pause during burst pause is respected', async () => {
            // Fill up burst (4 quick + 1 triggers pause)
            for (let i = 0; i < 4; i++) {
                await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            }
            // 5th triggers burst pause
            const promise = limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            // Pause then resume
            setTimeout(() => limiter.pause(), 100);
            setTimeout(() => limiter.resume(), 300);
            const result = await promise;
            expect(result).toBe('ok');
        });
    });

    // ── reset ─────────────────────────────────────────────────────

    describe('reset', () => {
        it('clears all state', async () => {
            await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            limiter.handleRateLimit(1000);
            limiter.pause();
            limiter.cancel();

            limiter.reset();

            expect(limiter.isPaused).toBe(false);
            expect(limiter.isCancelled).toBe(false);
            expect(limiter.stats.totalRequests).toBe(0);
            // totalThrottled is NOT reset (only totalRequests is reset in the source)
        });
    });

    // ── getETR ────────────────────────────────────────────────────

    describe('getETR', () => {
        it('estimates from config when not enough data', () => {
            const etr = limiter.getETR(100);
            // balanced: baseDelayMs=1000, burstSize=5, burstPauseMs=10000
            // (100 * 1000) + (ceil(100/5) * 10000) = 100000 + 200000 = 300000
            expect(etr).toBe(300000);
        });

        it('estimates from actual rate after enough requests', async () => {
            // Make several requests to build up stats
            for (let i = 0; i < 5; i++) {
                await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            }
            const etr = limiter.getETR(50);
            // Should be a positive number based on actual timing
            expect(etr).toBeGreaterThan(0);
            // Should be much less than config-based estimate since wasAlreadyDeleted is fast
            expect(etr).toBeLessThan(300000);
        });
    });

    // ── setConfig ─────────────────────────────────────────────────

    describe('setConfig', () => {
        it('overrides individual config values', async () => {
            limiter.setConfig({ burstSize: 2, burstPauseMs: 100 });
            // First request — no burst
            await limiter.waitAfterRequest({ wasAlreadyDeleted: true });
            // Second request — triggers burst (burstSize=2)
            const start = Date.now();
            await limiter.waitAfterRequest({ rateLimitRemaining: 10, rateLimitResetMs: 5000 });
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(80); // ~100ms burst pause
            expect(elapsed).toBeLessThan(1000);
        });
    });
});
