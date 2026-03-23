import axios, { AxiosError, AxiosResponse } from 'axios';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
const DISCORD_API_BASE = (!isElectron && typeof window !== 'undefined') ? '/discord-api' : 'https://discord.com/api/v10';
const MAX_RETRIES = 3;
const MAX_EXPORT_MESSAGES = 10000;
const REQUEST_TIMEOUT_MS = 30000;

export interface DiscordUser {
    id: string;
    username: string;
    discriminator: string;
    global_name: string | null;
    avatar: string | null;
    email?: string;
}

export interface DiscordGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
}

export interface DiscordChannel {
    id: string;
    type: number;
    name?: string;
    guild_id?: string;
    parent_id?: string;
    recipients?: { id: string; username: string; avatar?: string | null }[];
}

export interface DiscordMessage {
    id: string;
    type: number;
    content: string;
    channel_id: string;
    author: {
        id: string;
        username: string;
        avatar: string | null;
    };
    timestamp: string;
    attachments: { id: string; filename: string; url: string }[];
}

export interface DeletionFilter {
    channelIds?: string[];
    guildIds?: string[];
    keywords?: string[];
    excludeKeywords?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    hasAttachments?: boolean;
    minLength?: number;
    maxLength?: number;
}

export interface RateLimitInfo {
    remaining: number | null;
    resetAfterMs: number | null;
    limit: number | null;
    bucket: string | null;
}

export interface DeleteResult {
    success: boolean;
    alreadyDeleted?: boolean;
    rateLimits: RateLimitInfo;
}

export class DiscordService {
    private token: string;
    private userId: string | null = null;

    constructor(token: string) {
        this.token = token;
    }

    private get headers() {
        const h: Record<string, string> = {
            Authorization: this.token,
            'Content-Type': 'application/json',
        };
        // User-Agent can only be set in Node/Electron, browsers block it
        if (isElectron || typeof window === 'undefined') {
            h['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        }
        return h;
    }

    async getMe(): Promise<DiscordUser> {
        return this.request<DiscordUser>('GET', '/users/@me');
    }

    private async delay(attempt: number = 0, baseMs: number = 500): Promise<void> {
        const exponentialDelay = Math.min(baseMs * Math.pow(2, attempt), 10000);
        const jitter = Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, exponentialDelay + jitter));
    }

    private parseRateLimitHeaders(headers?: Record<string, unknown>): RateLimitInfo {
        if (!headers) {
            return { remaining: null, resetAfterMs: null, limit: null, bucket: null };
        }
        const remaining = headers['x-ratelimit-remaining'];
        const resetAfter = headers['x-ratelimit-reset-after'];
        const limit = headers['x-ratelimit-limit'];
        const bucket = headers['x-ratelimit-bucket'];

        return {
            remaining: remaining !== undefined ? Number(remaining) : null,
            resetAfterMs: resetAfter !== undefined ? Number(resetAfter) * 1000 : null,
            limit: limit !== undefined ? Number(limit) : null,
            bucket: typeof bucket === 'string' ? bucket : null,
        };
    }

    /**
     * Make an API request with retry logic for rate limits.
     * Returns both the data and the response object.
     */
    private async requestRaw<T>(
        method: 'GET' | 'POST' | 'DELETE',
        endpoint: string,
        data?: unknown,
        retries: number = MAX_RETRIES
    ): Promise<{ data: T; rateLimits: RateLimitInfo }> {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response: AxiosResponse<T> = await axios({
                    method,
                    url: `${DISCORD_API_BASE}${endpoint}`,
                    headers: this.headers,
                    data,
                    timeout: REQUEST_TIMEOUT_MS,
                });
                return {
                    data: response.data,
                    rateLimits: this.parseRateLimitHeaders(response.headers),
                };
            } catch (error) {
                const axiosError = error as AxiosError<{ retry_after?: number; retry_after_ms?: number }>;

                if (axiosError.response?.status === 429) {
                    // Rate limited - determine wait time from multiple sources
                    let waitMs: number;
                    const retryAfterHeader = axiosError.response.headers?.['retry-after'];
                    const retryAfterMs = axiosError.response.data?.retry_after_ms;
                    const retryAfter = axiosError.response.data?.retry_after;

                    if (retryAfterHeader) {
                        waitMs = parseFloat(retryAfterHeader as string) * 1000;
                    } else if (retryAfterMs) {
                        waitMs = retryAfterMs;
                    } else if (retryAfter) {
                        waitMs = retryAfter * 1000;
                    } else {
                        waitMs = 5000;
                    }

                    console.log(`Rate limited. Waiting ${Math.ceil(waitMs)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitMs + 100));
                    continue;
                }

                // Retry on server errors or network errors
                const isNetworkError = !axiosError.response && (axiosError.code === 'ECONNRESET' || axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED');
                const isServerError = axiosError.response?.status && axiosError.response.status >= 500;

                if (attempt < retries && (isNetworkError || isServerError)) {
                    console.log(`Request failed (${axiosError.code || axiosError.response?.status}), retrying (${attempt + 1}/${retries})...`);
                    await this.delay(attempt);
                    continue;
                }

                // Sanitize token from error before re-throwing
                if (axiosError.config?.headers) {
                    axiosError.config.headers['Authorization'] = '[REDACTED]';
                }
                throw error;
            }
        }
        throw new Error('Max retries exceeded');
    }

    private async request<T>(
        method: 'GET' | 'POST' | 'DELETE',
        endpoint: string,
        data?: unknown,
        retries: number = MAX_RETRIES
    ): Promise<T> {
        const result = await this.requestRaw<T>(method, endpoint, data, retries);
        return result.data;
    }

    async validateToken(): Promise<DiscordUser> {
        const user = await this.request<DiscordUser>('GET', '/users/@me');
        this.userId = user.id;
        return user;
    }

    async getGuilds(): Promise<DiscordGuild[]> {
        return this.request<DiscordGuild[]>('GET', '/users/@me/guilds');
    }

    async getDMChannels(): Promise<DiscordChannel[]> {
        return this.request<DiscordChannel[]>('GET', '/users/@me/channels');
    }

    async getGuildChannels(guildId: string): Promise<DiscordChannel[]> {
        return this.request<DiscordChannel[]>('GET', `/guilds/${guildId}/channels`);
    }

    async searchMessages(
        channelId: string,
        options: {
            authorId?: string;
            limit?: number;
            before?: string;
        } = {}
    ): Promise<DiscordMessage[]> {
        const params = new URLSearchParams();
        if (options.authorId) params.set('author_id', options.authorId);
        if (options.limit) params.set('limit', options.limit.toString());
        if (options.before) params.set('before', options.before);

        const endpoint = `/channels/${channelId}/messages?${params.toString()}`;
        return this.request<DiscordMessage[]>('GET', endpoint);
    }

    async deleteMessage(channelId: string, messageId: string): Promise<boolean> {
        try {
            await this.request('DELETE', `/channels/${channelId}/messages/${messageId}`);
            return true;
        } catch (error) {
            const axiosError = error as AxiosError;
            // 404 = already deleted, 403 = no permission - skip both gracefully
            if (axiosError.response?.status === 404 || axiosError.response?.status === 403) return true;
            throw error;
        }
    }

    // Like deleteMessage but also returns rate limit headers
    async deleteMessageWithRateInfo(channelId: string, messageId: string): Promise<DeleteResult> {
        try {
            const result = await this.requestRaw('DELETE', `/channels/${channelId}/messages/${messageId}`);
            return { success: true, rateLimits: result.rateLimits };
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404 || axiosError.response?.status === 403) {
                return {
                    success: true,
                    alreadyDeleted: true,
                    rateLimits: this.parseRateLimitHeaders(axiosError.response.headers || {}),
                };
            }
            throw error;
        }
    }

    filterMessages(messages: DiscordMessage[], filter: DeletionFilter): DiscordMessage[] {
        return messages.filter(msg => {
            if (msg.author.id !== this.userId) return false;

            if (filter.keywords?.length) {
                const match = filter.keywords.some(kw =>
                    msg.content.toLowerCase().includes(kw.toLowerCase())
                );
                if (!match) return false;
            }
            if (filter.excludeKeywords?.length) {
                const excluded = filter.excludeKeywords.some(kw =>
                    msg.content.toLowerCase().includes(kw.toLowerCase())
                );
                if (excluded) return false;
            }

            if (filter.dateFrom && new Date(msg.timestamp) < filter.dateFrom) return false;
            if (filter.dateTo && new Date(msg.timestamp) > filter.dateTo) return false;

            if (filter.hasAttachments !== undefined && filter.hasAttachments !== (msg.attachments.length > 0)) return false;
            if (filter.minLength && msg.content.length < filter.minLength) return false;
            if (filter.maxLength && msg.content.length > filter.maxLength) return false;

            return true;
        });
    }

    async exportMessages(
        channelId: string,
        filter?: DeletionFilter
    ): Promise<DiscordMessage[]> {
        const allMessages: DiscordMessage[] = [];
        let before: string | undefined;
        let lastBefore: string | undefined;

        while (true) {
            const messages = await this.searchMessages(channelId, {
                authorId: this.userId || undefined,
                limit: 100,
                before,
            });

            if (messages.length === 0) break;

            allMessages.push(...messages);
            before = messages[messages.length - 1].id;

            // Guard against infinite loop if API keeps returning same messages
            if (before === lastBefore) break;
            lastBefore = before;

            // Safety limit
            if (allMessages.length >= MAX_EXPORT_MESSAGES) break;

            await this.delay(0, 200);
        }

        return filter ? this.filterMessages(allMessages, filter) : allMessages;
    }
    async getChannelMessages(channelId: string, limit: number = 100, before?: string): Promise<DiscordMessage[]> {
        let url = `/channels/${channelId}/messages?limit=${limit}`;
        if (before) url += `&before=${before}`;
        return this.request<DiscordMessage[]>('GET', url);
    }

    async getChannel(channelId: string): Promise<DiscordChannel> {
        return this.request<DiscordChannel>('GET', `/channels/${channelId}`);
    }

    async createDMChannel(userId: string): Promise<DiscordChannel> {
        return this.request<DiscordChannel>('POST', '/users/@me/channels', {
            recipient_id: userId
        });
    }

    async getUser(userId: string): Promise<DiscordUser> {
        return this.request<DiscordUser>('GET', `/users/${userId}`);
    }
}
