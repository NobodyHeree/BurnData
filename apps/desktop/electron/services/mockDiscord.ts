/**
 * Mock Discord Service for testing all deletion scenarios.
 * Implements the same interface as DiscordService so it can be swapped in.
 *
 * Simulated scenarios:
 * - Multiple guilds with varying channel counts
 * - Channels with 403 (no permission), 404 (deleted), or normal access
 * - Mixed messages from different users (only current user's should be deleted)
 * - Rate limit simulation (429 responses)
 * - DMs (open, closed/inaccessible)
 * - Empty channels
 * - Large channels with many messages
 */

import type { RateLimitInfo, DeleteResult } from '@services/discord';

const MOCK_USER_ID = '100000000000000001';
const MOCK_USER = {
    id: MOCK_USER_ID,
    username: 'TestUser',
    discriminator: '0',
    global_name: 'Test User',
    avatar: null,
    email: 'test@burndata.dev',
};

// Fake guilds
const MOCK_GUILDS = [
    { id: '900000000000000001', name: 'Test Server Alpha', icon: null, owner: false, permissions: '0' },
    { id: '900000000000000002', name: 'Big Community Server', icon: null, owner: false, permissions: '0' },
    { id: '900000000000000003', name: 'Private Server', icon: null, owner: true, permissions: '0' },
    { id: '900000000000000004', name: 'Empty Server', icon: null, owner: false, permissions: '0' },
];

// Channels per guild
const MOCK_GUILD_CHANNELS: Record<string, Array<{ id: string; type: number; name: string; guild_id: string; parent_id?: string }>> = {
    '900000000000000001': [
        { id: '800000000000000001', type: 0, name: 'general', guild_id: '900000000000000001' },
        { id: '800000000000000002', type: 0, name: 'memes', guild_id: '900000000000000001' },
        { id: '800000000000000003', type: 0, name: 'no-access', guild_id: '900000000000000001' }, // will 403
        { id: '800000000000000004', type: 2, name: 'Voice Chat', guild_id: '900000000000000001' }, // voice, should be skipped
    ],
    '900000000000000002': [
        { id: '800000000000000010', type: 0, name: 'welcome', guild_id: '900000000000000002' },
        { id: '800000000000000011', type: 0, name: 'chat', guild_id: '900000000000000002' },
        { id: '800000000000000012', type: 0, name: 'admin-only', guild_id: '900000000000000002' }, // will 403
        { id: '800000000000000013', type: 0, name: 'empty-channel', guild_id: '900000000000000002' }, // no messages
        { id: '800000000000000014', type: 0, name: 'busy-channel', guild_id: '900000000000000002' }, // lots of messages
    ],
    '900000000000000003': [
        { id: '800000000000000020', type: 0, name: 'private-general', guild_id: '900000000000000003' },
        { id: '800000000000000021', type: 0, name: 'deleted-channel', guild_id: '900000000000000003' }, // will 404
    ],
    '900000000000000004': [], // empty server, no channels
};

// Channels that simulate 403/404 errors
const FORBIDDEN_CHANNELS = new Set(['800000000000000003', '800000000000000012']);
const NOT_FOUND_CHANNELS = new Set(['800000000000000021']);
const EMPTY_CHANNELS = new Set(['800000000000000013']);

// DM channels
const MOCK_DMS = [
    { id: '700000000000000001', type: 1, name: null, recipients: [{ id: '200000000000000001', username: 'Alice', avatar: null }] },
    { id: '700000000000000002', type: 1, name: null, recipients: [{ id: '200000000000000002', username: 'Bob', avatar: null }] },
    { id: '700000000000000003', type: 1, name: null, recipients: [{ id: '200000000000000003', username: 'ClosedDM', avatar: null }] }, // will 403
    { id: '700000000000000004', type: 3, name: 'Group Chat', recipients: [
        { id: '200000000000000001', username: 'Alice', avatar: null },
        { id: '200000000000000004', username: 'Charlie', avatar: null },
    ]},
];

const FORBIDDEN_DMS = new Set(['700000000000000003']);

// Other users that posted messages (to test author filtering)
const OTHER_USERS = [
    { id: '200000000000000001', username: 'Alice', avatar: null },
    { id: '200000000000000002', username: 'Bob', avatar: null },
    { id: '200000000000000005', username: 'RandomUser', avatar: null },
];

// Generate fake messages for a channel
function generateMessages(channelId: string, beforeId?: string): Array<{
    id: string;
    type: number;
    content: string;
    channel_id: string;
    author: { id: string; username: string; avatar: string | null };
    timestamp: string;
    attachments: any[];
}> {
    if (EMPTY_CHANNELS.has(channelId)) return [];

    // Use channelId to seed message generation so it's deterministic
    const channelSeed = parseInt(channelId.slice(-4), 10);
    const isBusy = channelId === '800000000000000014';
    const msgCount = isBusy ? 50 : 15; // messages per "page"

    // Simulate pagination: beforeId means we're on page 2+
    const pageIndex = beforeId ? parseInt(beforeId.slice(-3), 10) : 0;
    const totalPages = isBusy ? 4 : 2;

    if (pageIndex >= totalPages) return [];

    const messages = [];
    const baseTimestamp = new Date('2025-06-01T12:00:00Z').getTime();

    for (let i = 0; i < msgCount; i++) {
        const msgIndex = pageIndex * msgCount + i;
        const msgId = `${channelSeed}${String(msgIndex).padStart(6, '0')}${String(pageIndex + 1).padStart(3, '0')}`;

        // Alternate between mock user and other users (roughly 40% are ours)
        const isOurMessage = (msgIndex + channelSeed) % 5 < 2;
        const author = isOurMessage
            ? { id: MOCK_USER_ID, username: MOCK_USER.username, avatar: null }
            : OTHER_USERS[msgIndex % OTHER_USERS.length];

        const timestamp = new Date(baseTimestamp - msgIndex * 60000 * (channelSeed % 5 + 1)).toISOString();

        messages.push({
            id: msgId,
            type: 0,
            content: isOurMessage
                ? `My message #${msgIndex} in channel ${channelId}`
                : `Other user message #${msgIndex}`,
            channel_id: channelId,
            author,
            timestamp,
            attachments: [],
        });
    }

    return messages;
}

// Track deleted messages (to verify correctness)
const deletedMessages = new Set<string>();
let deleteCallCount = 0;
let rateLimitCounter = 0;

function makeRateLimitInfo(remaining?: number): RateLimitInfo {
    return {
        remaining: remaining ?? Math.floor(Math.random() * 5) + 1,
        resetAfterMs: 500 + Math.random() * 500,
        limit: 5,
        bucket: 'mock-bucket',
    };
}

async function simulateLatency(minMs = 20, maxMs = 80): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise(r => setTimeout(r, delay));
}

function throwAxiosLike(status: number, message: string): never {
    const err: any = new Error(message);
    err.response = { status, data: { message }, headers: {} };
    err.config = { headers: {} };
    throw err;
}

export class MockDiscordService {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    async getMe() {
        await simulateLatency();
        return { ...MOCK_USER };
    }

    async getGuilds() {
        await simulateLatency();
        return [...MOCK_GUILDS];
    }

    async getDMChannels() {
        await simulateLatency();
        return MOCK_DMS.map(dm => ({ ...dm }));
    }

    async getGuildChannels(guildId: string) {
        await simulateLatency();
        const channels = MOCK_GUILD_CHANNELS[guildId];
        if (!channels) throwAxiosLike(404, 'Unknown Guild');
        return channels.map(c => ({ ...c }));
    }

    async getChannel(channelId: string) {
        await simulateLatency();
        if (FORBIDDEN_DMS.has(channelId) || FORBIDDEN_CHANNELS.has(channelId)) {
            throwAxiosLike(403, 'Missing Access');
        }
        if (NOT_FOUND_CHANNELS.has(channelId)) {
            throwAxiosLike(404, 'Unknown Channel');
        }
        // Find in DMs
        const dm = MOCK_DMS.find(d => d.id === channelId);
        if (dm) return { ...dm };
        // Find in guild channels
        for (const channels of Object.values(MOCK_GUILD_CHANNELS)) {
            const ch = channels.find(c => c.id === channelId);
            if (ch) return { ...ch, recipients: undefined };
        }
        throwAxiosLike(404, 'Unknown Channel');
    }

    async getChannelMessages(channelId: string, limit: number = 100, before?: string) {
        await simulateLatency(30, 120);

        if (FORBIDDEN_CHANNELS.has(channelId) || FORBIDDEN_DMS.has(channelId)) {
            throwAxiosLike(403, 'Missing Access');
        }
        if (NOT_FOUND_CHANNELS.has(channelId)) {
            throwAxiosLike(404, 'Unknown Channel');
        }

        return generateMessages(channelId, before);
    }

    async deleteMessageWithRateInfo(channelId: string, messageId: string): Promise<DeleteResult> {
        deleteCallCount++;
        rateLimitCounter++;

        // Simulate rate limit every ~20 deletes
        if (rateLimitCounter >= 20) {
            rateLimitCounter = 0;
            await new Promise(r => setTimeout(r, 200)); // simulate rate limit wait
        }

        await simulateLatency(10, 50);
        deletedMessages.add(messageId);

        return {
            success: true,
            rateLimits: makeRateLimitInfo(),
        };
    }

    async deleteMessage(channelId: string, messageId: string): Promise<boolean> {
        const result = await this.deleteMessageWithRateInfo(channelId, messageId);
        return result.success;
    }

    async searchMessages(channelId: string, options: { authorId?: string; limit?: number; before?: string } = {}) {
        const messages = await this.getChannelMessages(channelId, options.limit || 100, options.before);
        if (options.authorId) {
            return messages.filter(m => m.author.id === options.authorId);
        }
        return messages;
    }

    async createDMChannel(userId: string) {
        await simulateLatency();
        return { id: `700000000000000099`, type: 1, recipients: [{ id: userId, username: `User_${userId}`, avatar: null }] };
    }

    async getUser(userId: string) {
        await simulateLatency();
        return { id: userId, username: `User_${userId}`, discriminator: '0', global_name: null, avatar: null };
    }

    // Test helpers
    static getDeletedMessages(): Set<string> { return deletedMessages; }
    static getDeleteCallCount(): number { return deleteCallCount; }
    static resetStats(): void {
        deletedMessages.clear();
        deleteCallCount = 0;
        rateLimitCounter = 0;
    }
    static getMockUserId(): string { return MOCK_USER_ID; }
    static getMockGuilds() { return MOCK_GUILDS; }
    static getMockDMs() { return MOCK_DMS; }
}
