/**
 * Core platform adapter interface.
 * Every platform service (Discord, PSN, Twitter, etc.) must implement this.
 */

import { AuthResult } from './auth';
import { ContentFilter } from './filter';

export type PlatformCapability =
    | 'delete-messages'
    | 'delete-posts'
    | 'delete-comments'
    | 'delete-likes'
    | 'delete-friends'
    | 'delete-activity'
    | 'export-data';

export interface PlatformInfo {
    id: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    capabilities: PlatformCapability[];
}

export interface ContentSource {
    id: string;
    name: string;
    type: 'channel' | 'server' | 'feed' | 'profile' | 'friend-list' | 'subreddit' | 'thread';
    parentId?: string;
    itemCount?: number;
    metadata?: Record<string, unknown>;
}

export interface ContentItem {
    id: string;
    sourceId: string;
    type: string;
    content?: string;
    authorId?: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
}

export interface DeletionResult {
    itemId: string;
    success: boolean;
    verified?: boolean;
    error?: string;
    retryable?: boolean;
}

export interface RateLimitInfo {
    requestsPerSecond: number;
    burstLimit?: number;
    adaptiveFromHeaders: boolean;
}

export interface PlatformAdapter {
    readonly info: PlatformInfo;

    // Authentication
    authenticate(credentials: Record<string, string>): Promise<AuthResult>;
    logout(): Promise<void>;
    isAuthenticated(): boolean;

    // Content discovery
    getContentSources(): Promise<ContentSource[]>;
    getContentCount(sourceId: string, filter?: ContentFilter): Promise<number>;

    // Content operations (async generators for streaming)
    scanContent(sourceId: string, filter?: ContentFilter): AsyncGenerator<ContentItem[], void, undefined>;
    deleteItem(item: ContentItem): Promise<DeletionResult>;
    verifyDeletion(item: ContentItem): Promise<boolean>;

    // Export
    exportContent(sourceId: string, filter?: ContentFilter): AsyncGenerator<ContentItem[], void, undefined>;

    // Rate limiting
    getRateLimitInfo(): RateLimitInfo;
}
