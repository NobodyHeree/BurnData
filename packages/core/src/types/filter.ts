export interface ContentFilter {
    // Date filtering
    startDate?: string; // ISO 8601
    endDate?: string;   // ISO 8601

    // Content filtering
    includeKeywords?: string[];
    excludeKeywords?: string[];
    hasAttachments?: boolean;
    minLength?: number;
    maxLength?: number;

    // Source filtering
    sourceIds?: string[];

    // Content types
    contentTypes?: string[];
}
