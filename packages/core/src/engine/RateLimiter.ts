/**
 * Token bucket rate limiter with adaptive rate limiting from API response headers.
 */
export class RateLimiter {
    private tokens: number;
    private maxTokens: number;
    private refillRate: number; // tokens per second
    private lastRefill: number;
    private retryAfter: number = 0; // timestamp (ms) until which we must wait

    constructor(requestsPerSecond: number, burstLimit?: number) {
        this.refillRate = requestsPerSecond;
        this.maxTokens = burstLimit ?? requestsPerSecond;
        this.tokens = this.maxTokens;
        this.lastRefill = Date.now();
    }

    /**
     * Acquire a token before making a request.
     * Blocks until a token is available and any retry-after period has passed.
     */
    async acquire(): Promise<void> {
        // Wait for retry-after if set
        const now = Date.now();
        if (this.retryAfter > now) {
            const waitMs = this.retryAfter - now;
            await this.sleep(waitMs);
        }

        // Refill tokens based on elapsed time
        this.refill();

        // If no tokens available, wait until one refills
        if (this.tokens < 1) {
            const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
            await this.sleep(waitMs);
            this.refill();
        }

        // Consume one token
        this.tokens = Math.max(0, this.tokens - 1);
    }

    /**
     * Handle a rate limit response from the API.
     * Parses standard rate limit headers and adjusts internal state.
     */
    handleRateLimitResponse(headers: Record<string, string>, status: number): void {
        // Parse Retry-After header (seconds or HTTP date)
        const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
        if (retryAfter) {
            const seconds = Number(retryAfter);
            if (!isNaN(seconds)) {
                this.retryAfter = Date.now() + seconds * 1000;
            } else {
                // Try parsing as HTTP date
                const date = new Date(retryAfter).getTime();
                if (!isNaN(date)) {
                    this.retryAfter = date;
                }
            }
        }

        // Parse X-RateLimit-Remaining
        const remaining = headers['x-ratelimit-remaining'] ?? headers['X-RateLimit-Remaining'];
        if (remaining !== undefined) {
            const remainingCount = Number(remaining);
            if (!isNaN(remainingCount)) {
                // Set tokens to remaining count so we don't exceed the API limit
                this.tokens = Math.min(remainingCount, this.maxTokens);
            }
        }

        // Parse X-RateLimit-Reset (Unix timestamp in seconds)
        const reset = headers['x-ratelimit-reset'] ?? headers['X-RateLimit-Reset'];
        if (reset !== undefined) {
            const resetTime = Number(reset) * 1000; // Convert to ms
            if (!isNaN(resetTime) && resetTime > Date.now()) {
                // If we have zero remaining, set retry-after to the reset time
                if (remaining !== undefined && Number(remaining) === 0) {
                    this.retryAfter = Math.max(this.retryAfter, resetTime);
                }
            }
        }

        // On 429 status with no headers, apply a default backoff of 5 seconds
        if (status === 429 && this.retryAfter <= Date.now()) {
            this.retryAfter = Date.now() + 5000;
        }
    }

    /**
     * Return current rate limiter state for UI display.
     */
    getInfo(): { tokensRemaining: number; nextRefillMs: number } {
        this.refill();
        const nextRefillMs = this.tokens >= this.maxTokens
            ? 0
            : Math.ceil(((1 - (this.tokens % 1 || 1)) / this.refillRate) * 1000);
        return {
            tokensRemaining: Math.floor(this.tokens),
            nextRefillMs: Math.max(0, nextRefillMs),
        };
    }

    /**
     * Refill tokens based on elapsed time since last refill.
     */
    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000; // seconds
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    }
}
