import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { AxiosError } from 'axios';
import { DiscordService, DiscordMessage, DeletionFilter } from '../discord';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

function makeAxiosError(status: number, data?: unknown, code?: string): AxiosError {
    const error = new Error(`Request failed with status ${status}`) as AxiosError;
    error.isAxiosError = true;
    error.response = {
        status,
        statusText: String(status),
        headers: {},
        config: {} as any,
        data: data ?? {},
    };
    error.code = code;
    error.config = {} as any;
    error.toJSON = () => ({});
    return error;
}

function makeNetworkError(code: string): AxiosError {
    const error = new Error(`Network error: ${code}`) as AxiosError;
    error.isAxiosError = true;
    error.response = undefined;
    error.code = code;
    error.config = {} as any;
    error.toJSON = () => ({});
    return error;
}

function makeMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
    return {
        id: overrides.id ?? '1',
        type: 0,
        content: overrides.content ?? 'hello world',
        channel_id: overrides.channel_id ?? 'ch1',
        author: overrides.author ?? { id: 'user123', username: 'testuser', avatar: null },
        timestamp: overrides.timestamp ?? '2025-06-15T12:00:00.000Z',
        attachments: overrides.attachments ?? [],
    };
}

describe('DiscordService', () => {
    let service: DiscordService;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        service = new DiscordService('test-token-123');
    });

    afterEach(() => {
        vi.useRealTimers();
    });


    describe('validateToken', () => {
        it('returns user object and stores userId on success', async () => {
            const mockUser = {
                id: 'user123',
                username: 'testuser',
                discriminator: '0001',
                global_name: 'Test User',
                avatar: 'abc123',
                email: 'test@example.com',
            };

            mockedAxios.mockResolvedValueOnce({ data: mockUser });

            const user = await service.validateToken();

            expect(user).toEqual(mockUser);
            expect(mockedAxios).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET',
                    url: 'https://discord.com/api/v10/users/@me',
                    headers: expect.objectContaining({
                        Authorization: 'test-token-123',
                    }),
                })
            );
        });

        it('throws on 401 unauthorized', async () => {
            mockedAxios.mockRejectedValueOnce(makeAxiosError(401, { message: '401: Unauthorized' }));

            await expect(service.validateToken()).rejects.toThrow();
        });
    });


    describe('filterMessages', () => {
        // Set userId by calling validateToken first
        beforeEach(async () => {
            mockedAxios.mockResolvedValueOnce({
                data: { id: 'user123', username: 'testuser', discriminator: '0', global_name: null, avatar: null },
            });
            await service.validateToken();
        });

        it('filters to only the authenticated user\'s messages', () => {
            const messages = [
                makeMessage({ id: '1', author: { id: 'user123', username: 'me', avatar: null } }),
                makeMessage({ id: '2', author: { id: 'other456', username: 'someone', avatar: null } }),
            ];

            const result = service.filterMessages(messages, {});
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('filters by keywords (case-insensitive)', () => {
            const messages = [
                makeMessage({ id: '1', content: 'Hello World' }),
                makeMessage({ id: '2', content: 'goodbye world' }),
                makeMessage({ id: '3', content: 'nothing here' }),
            ];

            const result = service.filterMessages(messages, { keywords: ['hello'] });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('excludes messages matching excludeKeywords', () => {
            const messages = [
                makeMessage({ id: '1', content: 'keep this message' }),
                makeMessage({ id: '2', content: 'remove secret data' }),
            ];

            const result = service.filterMessages(messages, { excludeKeywords: ['secret'] });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('filters by date range (dateFrom)', () => {
            const messages = [
                makeMessage({ id: '1', timestamp: '2025-01-01T00:00:00.000Z' }),
                makeMessage({ id: '2', timestamp: '2025-06-15T00:00:00.000Z' }),
            ];

            const result = service.filterMessages(messages, { dateFrom: new Date('2025-03-01') });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        it('filters by date range (dateTo)', () => {
            const messages = [
                makeMessage({ id: '1', timestamp: '2025-01-01T00:00:00.000Z' }),
                makeMessage({ id: '2', timestamp: '2025-06-15T00:00:00.000Z' }),
            ];

            const result = service.filterMessages(messages, { dateTo: new Date('2025-03-01') });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('filters by hasAttachments: true', () => {
            const messages = [
                makeMessage({ id: '1', attachments: [] }),
                makeMessage({
                    id: '2',
                    attachments: [{ id: 'att1', filename: 'image.png', url: 'https://cdn.discord.com/img.png' }],
                }),
            ];

            const result = service.filterMessages(messages, { hasAttachments: true });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        it('filters by hasAttachments: false', () => {
            const messages = [
                makeMessage({ id: '1', attachments: [] }),
                makeMessage({
                    id: '2',
                    attachments: [{ id: 'att1', filename: 'image.png', url: 'https://cdn.discord.com/img.png' }],
                }),
            ];

            const result = service.filterMessages(messages, { hasAttachments: false });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('filters by minLength', () => {
            const messages = [
                makeMessage({ id: '1', content: 'hi' }),
                makeMessage({ id: '2', content: 'this is a longer message' }),
            ];

            const result = service.filterMessages(messages, { minLength: 10 });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        it('filters by maxLength', () => {
            const messages = [
                makeMessage({ id: '1', content: 'hi' }),
                makeMessage({ id: '2', content: 'this is a longer message' }),
            ];

            const result = service.filterMessages(messages, { maxLength: 5 });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('combines multiple filters', () => {
            const messages = [
                makeMessage({ id: '1', content: 'important short', timestamp: '2025-06-01T00:00:00.000Z' }),
                makeMessage({ id: '2', content: 'important and this is a much longer message', timestamp: '2025-06-01T00:00:00.000Z' }),
                makeMessage({ id: '3', content: 'important and this is also long enough', timestamp: '2025-01-01T00:00:00.000Z' }),
            ];

            const result = service.filterMessages(messages, {
                keywords: ['important'],
                minLength: 20,
                dateFrom: new Date('2025-03-01'),
            });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });
    });


    describe('rate limit handling', () => {
        it('retries after a 429 response with retry_after', async () => {
            const rateLimitError = makeAxiosError(429, { retry_after: 1 });
            const mockUser = {
                id: 'user123',
                username: 'testuser',
                discriminator: '0',
                global_name: null,
                avatar: null,
            };

            mockedAxios
                .mockRejectedValueOnce(rateLimitError)
                .mockResolvedValueOnce({ data: mockUser });

            const result = await service.validateToken();

            expect(result).toEqual(mockUser);
            expect(mockedAxios).toHaveBeenCalledTimes(2);
        });

        it('uses default 5s retry_after when not provided in 429 response', { timeout: 15000 }, async () => {
            const rateLimitError = makeAxiosError(429, {});
            const mockUser = {
                id: 'user123',
                username: 'testuser',
                discriminator: '0',
                global_name: null,
                avatar: null,
            };

            mockedAxios
                .mockRejectedValueOnce(rateLimitError)
                .mockResolvedValueOnce({ data: mockUser });

            const result = await service.validateToken();

            expect(result).toEqual(mockUser);
            expect(mockedAxios).toHaveBeenCalledTimes(2);
        });
    });


    describe('deleteMessage', () => {
        it('returns true on successful deletion (204)', async () => {
            mockedAxios.mockResolvedValueOnce({ data: undefined, status: 204 });

            const result = await service.deleteMessage('ch1', 'msg1');

            expect(result).toBe(true);
            expect(mockedAxios).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'DELETE',
                    url: 'https://discord.com/api/v10/channels/ch1/messages/msg1',
                })
            );
        });

        it('returns true when message is already deleted (404)', async () => {
            mockedAxios.mockRejectedValueOnce(makeAxiosError(404));

            const result = await service.deleteMessage('ch1', 'msg1');
            expect(result).toBe(true);
        });

        it('returns false when forbidden (403)', async () => {
            mockedAxios.mockRejectedValueOnce(makeAxiosError(403));

            const result = await service.deleteMessage('ch1', 'msg1');
            expect(result).toBe(false);
        });

        it('throws on persistent server errors after all retries', { timeout: 30000 }, async () => {
            const serverError = makeAxiosError(500);
            mockedAxios.mockRejectedValue(serverError);

            await expect(service.deleteMessage('ch1', 'msg1')).rejects.toThrow();
        });
    });


    describe('error handling', () => {
        it('retries on ECONNRESET network errors and succeeds', async () => {
            const networkError = makeNetworkError('ECONNRESET');
            const mockUser = {
                id: 'user123',
                username: 'testuser',
                discriminator: '0',
                global_name: null,
                avatar: null,
            };

            mockedAxios
                .mockRejectedValueOnce(networkError)
                .mockResolvedValueOnce({ data: mockUser });

            const result = await service.validateToken();
            expect(result).toEqual(mockUser);
            expect(mockedAxios).toHaveBeenCalledTimes(2);
        });

        it('retries on ETIMEDOUT network errors and succeeds', async () => {
            const networkError = makeNetworkError('ETIMEDOUT');
            const mockUser = {
                id: 'user123',
                username: 'testuser',
                discriminator: '0',
                global_name: null,
                avatar: null,
            };

            mockedAxios
                .mockRejectedValueOnce(networkError)
                .mockResolvedValueOnce({ data: mockUser });

            const result = await service.validateToken();
            expect(result).toEqual(mockUser);
        });

        it('retries on ECONNABORTED (timeout) errors and succeeds', async () => {
            const networkError = makeNetworkError('ECONNABORTED');

            mockedAxios
                .mockRejectedValueOnce(networkError)
                .mockResolvedValueOnce({ data: { id: 'u1', username: 'x', discriminator: '0', global_name: null, avatar: null } });

            const result = await service.validateToken();
            expect(result.id).toBe('u1');
        });

        it('throws after exhausting retries on persistent server errors', { timeout: 30000 }, async () => {
            const serverError = makeAxiosError(502);
            mockedAxios.mockRejectedValue(serverError);

            await expect(service.validateToken()).rejects.toThrow();
            // initial + 3 retries = 4 calls
            expect(mockedAxios).toHaveBeenCalledTimes(4);
        });

        it('does not retry on non-retryable client errors (e.g. 400)', async () => {
            mockedAxios.mockRejectedValue(makeAxiosError(400, { message: 'Bad Request' }));

            await expect(service.validateToken()).rejects.toThrow();
            expect(mockedAxios).toHaveBeenCalledTimes(1);
        });
    });


    describe('getGuilds', () => {
        it('returns guild list', async () => {
            const mockGuilds = [
                { id: 'g1', name: 'Server 1', icon: null, owner: false, permissions: '123' },
            ];
            mockedAxios.mockResolvedValueOnce({ data: mockGuilds });

            const guilds = await service.getGuilds();
            expect(guilds).toEqual(mockGuilds);
        });
    });

    describe('getDMChannels', () => {
        it('returns DM channel list', async () => {
            const mockChannels = [
                { id: 'dm1', type: 1, recipients: [{ id: 'u2', username: 'friend' }] },
            ];
            mockedAxios.mockResolvedValueOnce({ data: mockChannels });

            const channels = await service.getDMChannels();
            expect(channels).toEqual(mockChannels);
        });
    });
});
