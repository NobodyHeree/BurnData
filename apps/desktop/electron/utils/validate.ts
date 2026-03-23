import { z } from 'zod';

// Schema definitions for IPC handlers
export const schemas = {
    // Store
    storeKey: z.string().min(1).max(100),

    // Tokens
    platform: z.string().min(1).max(50),
    token: z.string().min(1),

    // Discord
    discordGuildId: z.string().regex(/^\d+$/),
    discordChannelId: z.string().regex(/^\d+$/),
    discordUserId: z.string().regex(/^\d+$/),

    discordDeletionConfig: z.object({
        mode: z.enum(['simple', 'advanced']),
        dms: z.array(z.string()).optional(),
        guilds: z.array(z.string()).optional(),
        selectedChannels: z.array(z.string()).optional(),
        dateFilter: z.object({
            startDate: z.string().nullable().optional(),
            endDate: z.string().nullable().optional(),
        }).optional(),
        dataPackageMessages: z.record(z.string(), z.array(z.string())).optional(),
    }),

    // PSN
    psnNpsso: z.string().min(30).max(200),
    psnAccountIds: z.array(z.string().min(1)),
    psnAccountId: z.string().min(1),
};

/**
 * Validates IPC handler input and returns typed result.
 * Throws a user-friendly error on validation failure.
 */
export function validateIPC<T>(schema: z.ZodSchema<T>, data: unknown, handlerName: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new Error(`[IPC:${handlerName}] Invalid input: ${errors}`);
    }
    return result.data;
}
