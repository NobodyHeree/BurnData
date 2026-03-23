import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { PSNService, PSNFriend, PSNPresence } from '../psn';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// We need to mock axios.create to return a mock client with get/post/delete
function createMockClient() {
    return {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        defaults: { headers: { common: {} } },
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    };
}

let mockClient: ReturnType<typeof createMockClient>;

describe('PSNService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });

        mockClient = createMockClient();
        mockedAxios.create = vi.fn().mockReturnValue(mockClient) as any;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── authenticateWithNpsso ──────────────────────────────────────

    describe('authenticateWithNpsso', () => {
        it('exchanges NPSSO token for access token through redirect chain', async () => {
            // Step 1: authorize endpoint returns 302 with code in location header
            mockedAxios.get = vi.fn().mockResolvedValueOnce({
                status: 302,
                headers: {
                    location: 'com.scee.psxandroid.scecompcall://redirect?code=v3.auth-code-123&cid=abc',
                },
            });

            // Step 2: token endpoint returns access_token
            mockedAxios.post = vi.fn().mockResolvedValueOnce({
                data: {
                    access_token: 'jwt-access-token-xyz',
                    token_type: 'bearer',
                    expires_in: 3600,
                    refresh_token: 'refresh-abc',
                    scope: 'psn:mobile.v2.core psn:clientapp',
                },
            });

            const result = await PSNService.authenticateWithNpsso('npsso-token-abc');

            expect(result.accessToken).toBe('jwt-access-token-xyz');
            expect(result.refreshToken).toBe('refresh-abc');
            expect(result.expiresIn).toBe(3600);

            // Verify authorize request
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://ca.account.sony.com/api/authz/v3/oauth/authorize',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Cookie: 'npsso=npsso-token-abc',
                    }),
                    params: expect.objectContaining({
                        response_type: 'code',
                        client_id: '09515159-7237-4370-9b40-3806e67c0891',
                    }),
                    maxRedirects: 0,
                })
            );

            // Verify token exchange request
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://ca.account.sony.com/api/authz/v3/oauth/token',
                expect.any(URLSearchParams),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Content-Type': 'application/x-www-form-urlencoded',
                    }),
                })
            );
        });

        it('throws when auth response has no redirect location', async () => {
            mockedAxios.get = vi.fn().mockResolvedValueOnce({
                status: 302,
                headers: {},
            });

            await expect(PSNService.authenticateWithNpsso('bad-token'))
                .rejects.toThrow('No redirect location in auth response');
        });

        it('throws when redirect URL has no authorization code', async () => {
            mockedAxios.get = vi.fn().mockResolvedValueOnce({
                status: 302,
                headers: {
                    location: 'com.scee.psxandroid.scecompcall://redirect?error=access_denied',
                },
            });

            await expect(PSNService.authenticateWithNpsso('expired-token'))
                .rejects.toThrow('No authorization code in redirect URL');
        });
    });

    // ── getFriends (getFriendIds + getProfiles) ────────────────────

    describe('getFriendIds', () => {
        it('returns list of friend account IDs', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({
                data: { friends: ['acct-1', 'acct-2', 'acct-3'] },
            });

            const ids = await service.getFriendIds();

            expect(ids).toEqual(['acct-1', 'acct-2', 'acct-3']);
            expect(mockClient.get).toHaveBeenCalledWith('/users/me/friends', {
                params: { limit: 1000 },
            });
        });

        it('returns empty array when user has no friends', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({
                data: { friends: [] },
            });

            const ids = await service.getFriendIds();
            expect(ids).toEqual([]);
        });

        it('returns empty array when friends field is missing', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({
                data: {},
            });

            const ids = await service.getFriendIds();
            expect(ids).toEqual([]);
        });
    });

    describe('getProfiles', () => {
        it('fetches profiles in batches of 100', async () => {
            const service = new PSNService('test-access-token');

            // Create 150 account IDs to trigger 2 batches
            const accountIds = Array.from({ length: 150 }, (_, i) => `acct-${i}`);

            // First batch (100)
            mockClient.get.mockResolvedValueOnce({
                data: {
                    profiles: Array.from({ length: 100 }, (_, i) => ({
                        accountId: `acct-${i}`,
                        onlineId: `user_${i}`,
                        avatars: [{ url: `https://avatar/${i}.png` }],
                        isPlus: i % 2 === 0,
                        languages: ['en'],
                        aboutMe: `Bio ${i}`,
                    })),
                },
            });

            // Second batch (50)
            mockClient.get.mockResolvedValueOnce({
                data: {
                    profiles: Array.from({ length: 50 }, (_, i) => ({
                        accountId: `acct-${i + 100}`,
                        onlineId: `user_${i + 100}`,
                        avatars: [],
                        isPlus: false,
                        languages: [],
                        aboutMe: '',
                    })),
                },
            });

            const profiles = await service.getProfiles(accountIds);

            expect(profiles).toHaveLength(150);
            expect(profiles[0].onlineId).toBe('user_0');
            expect(profiles[0].avatarUrl).toBe('https://avatar/0.png');
            expect(profiles[100].onlineId).toBe('user_100');
            expect(mockClient.get).toHaveBeenCalledTimes(2);
        });

        it('adds placeholder profiles when a batch fails', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockRejectedValueOnce({
                response: { status: 500, data: 'Server Error' },
                message: 'Request failed',
            });

            const profiles = await service.getProfiles(['acct-1', 'acct-2']);

            expect(profiles).toHaveLength(2);
            expect(profiles[0]).toEqual({ accountId: 'acct-1', onlineId: 'Unknown' });
            expect(profiles[1]).toEqual({ accountId: 'acct-2', onlineId: 'Unknown' });
        });
    });

    // ── removeFriend ───────────────────────────────────────────────

    describe('removeFriend', () => {
        it('returns true on successful removal', async () => {
            const service = new PSNService('test-access-token');
            mockClient.delete.mockResolvedValueOnce({ status: 204 });

            const result = await service.removeFriend('acct-123');

            expect(result).toBe(true);
            expect(mockClient.delete).toHaveBeenCalledWith('/users/me/friends/acct-123');
        });

        it('returns true when friend is already removed (404)', async () => {
            const service = new PSNService('test-access-token');
            mockClient.delete.mockRejectedValueOnce({
                response: { status: 404 },
                message: 'Not Found',
            });

            const result = await service.removeFriend('acct-gone');
            expect(result).toBe(true);
        });

        it('returns false on 401 unauthorized (expired token)', async () => {
            const service = new PSNService('expired-token');
            mockClient.delete.mockRejectedValueOnce({
                response: { status: 401 },
                message: 'Unauthorized',
            });

            const result = await service.removeFriend('acct-123');
            expect(result).toBe(false);
        });

        it('returns false on other server errors', async () => {
            const service = new PSNService('test-access-token');
            mockClient.delete.mockRejectedValueOnce({
                response: { status: 500 },
                message: 'Internal Server Error',
            });

            const result = await service.removeFriend('acct-123');
            expect(result).toBe(false);
        });
    });

    // ── removeFriends (bulk) ───────────────────────────────────────

    describe('removeFriends', () => {
        it('removes multiple friends and reports progress', async () => {
            const service = new PSNService('test-access-token');

            mockClient.delete
                .mockResolvedValueOnce({ status: 204 })
                .mockResolvedValueOnce({ status: 204 })
                .mockRejectedValueOnce({ response: { status: 500 }, message: 'Error' });

            const progressCalls: [number, number][] = [];
            const result = await service.removeFriends(
                ['acct-1', 'acct-2', 'acct-3'],
                (current, total) => progressCalls.push([current, total])
            );

            expect(result).toEqual({ success: 2, failed: 1 });
            expect(progressCalls).toEqual([
                [1, 3],
                [2, 3],
                [3, 3],
            ]);
        });
    });

    // ── getPresenceBatch ───────────────────────────────────────────

    describe('getPresenceBatch', () => {
        it('returns presence data for multiple accounts', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({
                data: {
                    basicPresences: [
                        {
                            accountId: 'acct-1',
                            primaryPlatformInfo: {
                                onlineStatus: 'online',
                                platform: 'PS5',
                                lastOnlineDate: '2025-06-15T10:00:00Z',
                            },
                            gameTitleInfoList: [{ titleName: 'Elden Ring' }],
                        },
                        {
                            accountId: 'acct-2',
                            primaryPlatformInfo: {
                                onlineStatus: 'offline',
                                platform: 'PS4',
                                lastOnlineDate: '2025-06-14T20:00:00Z',
                            },
                            gameTitleInfoList: [],
                        },
                    ],
                },
            });

            const presences = await service.getPresenceBatch(['acct-1', 'acct-2']);

            expect(presences.size).toBe(2);

            const p1 = presences.get('acct-1')!;
            expect(p1.onlineStatus).toBe('online');
            expect(p1.platform).toBe('PS5');
            expect(p1.currentGame).toBe('Elden Ring');

            const p2 = presences.get('acct-2')!;
            expect(p2.onlineStatus).toBe('offline');
            expect(p2.platform).toBe('PS4');
            expect(p2.currentGame).toBeUndefined();
        });

        it('returns empty map when API fails', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockRejectedValueOnce({
                response: { status: 500, data: 'Server Error' },
            });

            const presences = await service.getPresenceBatch(['acct-1']);
            expect(presences.size).toBe(0);
        });

        it('skips entries without accountId', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({
                data: {
                    basicPresences: [
                        { accountId: 'acct-1', onlineStatus: 'online' },
                        { onlineStatus: 'offline' }, // no accountId
                        null, // null entry
                    ],
                },
            });

            const presences = await service.getPresenceBatch(['acct-1', 'acct-2']);
            expect(presences.size).toBe(1);
            expect(presences.has('acct-1')).toBe(true);
        });

        it('uses fallback fields when primaryPlatformInfo is missing', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({
                data: {
                    basicPresences: [
                        {
                            accountId: 'acct-1',
                            onlineStatus: 'online',
                            lastOnlineDate: '2025-06-15T10:00:00Z',
                            platform: 'PS5',
                        },
                    ],
                },
            });

            const presences = await service.getPresenceBatch(['acct-1']);
            const p = presences.get('acct-1')!;
            expect(p.onlineStatus).toBe('online');
            expect(p.platform).toBe('PS5');
        });
    });

    // ── getMyProfile ───────────────────────────────────────────────

    describe('getMyProfile', () => {
        it('returns account ID and online ID', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({
                data: { accountId: 'me-123', onlineId: 'MyPSNName' },
            });

            const profile = await service.getMyProfile();
            expect(profile).toEqual({ accountId: 'me-123', onlineId: 'MyPSNName' });
            expect(mockClient.get).toHaveBeenCalledWith('/users/me/profile');
        });
    });

    // ── getFriendsWithProfiles ─────────────────────────────────────

    describe('getFriendsWithProfiles', () => {
        it('returns empty array when user has no friends', async () => {
            const service = new PSNService('test-access-token');

            mockClient.get.mockResolvedValueOnce({ data: { friends: [] } });

            const friends = await service.getFriendsWithProfiles();
            expect(friends).toEqual([]);
        });

        it('maps profiles to friend IDs preserving order', async () => {
            const service = new PSNService('test-access-token');

            // getFriendIds
            mockClient.get.mockResolvedValueOnce({
                data: { friends: ['acct-a', 'acct-b'] },
            });

            // getProfiles
            mockClient.get.mockResolvedValueOnce({
                data: {
                    profiles: [
                        { accountId: 'acct-a', onlineId: 'UserA', avatars: [], isPlus: false, languages: [], aboutMe: '' },
                        { accountId: 'acct-b', onlineId: 'UserB', avatars: [], isPlus: true, languages: ['en'], aboutMe: 'hi' },
                    ],
                },
            });

            const friends = await service.getFriendsWithProfiles();
            expect(friends).toHaveLength(2);
            expect(friends[0].onlineId).toBe('UserA');
            expect(friends[1].onlineId).toBe('UserB');
        });
    });
});
