import * as fs from 'fs';
import * as path from 'path';
import { ContentItem } from '../types';

/**
 * Handles exporting content items to JSON or CSV files.
 */
export class Exporter {
    /**
     * Export items as a JSON array to a file.
     * Returns the count of items exported.
     */
    static async exportToJSON(items: ContentItem[], filePath: string): Promise<number> {
        await Exporter.ensureDirectory(filePath);
        const data = JSON.stringify(items, null, 2);
        await fs.promises.writeFile(filePath, data, 'utf-8');
        return items.length;
    }

    /**
     * Export items as CSV to a file.
     * Handles CSV escaping for quotes, commas, and newlines in content.
     * Returns the count of items exported.
     */
    static async exportToCSV(items: ContentItem[], filePath: string): Promise<number> {
        await Exporter.ensureDirectory(filePath);
        const headers = ['id', 'sourceId', 'type', 'content', 'timestamp'];
        const rows: string[] = [headers.join(',')];

        for (const item of items) {
            const row = [
                Exporter.escapeCsvField(item.id),
                Exporter.escapeCsvField(item.sourceId),
                Exporter.escapeCsvField(item.type),
                Exporter.escapeCsvField(item.content ?? ''),
                Exporter.escapeCsvField(item.timestamp),
            ];
            rows.push(row.join(','));
        }

        await fs.promises.writeFile(filePath, rows.join('\n') + '\n', 'utf-8');
        return items.length;
    }

    /**
     * Create a streaming exporter that accepts batches of ContentItem arrays.
     * For JSON: writes opening bracket, comma-separated items, and closing bracket.
     * For CSV: writes header row first, then data rows.
     */
    static createExportStream(filePath: string, format: 'json' | 'csv'): ExportStream {
        if (format === 'json') {
            return new JsonExportStream(filePath);
        }
        return new CsvExportStream(filePath);
    }

    /**
     * Escape a field value for safe CSV output.
     * Wraps in double quotes if the value contains commas, quotes, or newlines.
     */
    static escapeCsvField(value: string): string {
        if (value === '') {
            return '""';
        }
        // If value contains comma, double-quote, or newline, wrap in quotes and escape internal quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
            return '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
    }

    private static async ensureDirectory(filePath: string): Promise<void> {
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });
    }
}

export interface ExportStream {
    write(items: ContentItem[]): Promise<void>;
    close(): Promise<number>; // Returns total items exported
}

/**
 * Streaming JSON exporter. Writes items as a JSON array across multiple write calls.
 */
class JsonExportStream implements ExportStream {
    private fd: fs.promises.FileHandle | null = null;
    private filePath: string;
    private totalItems: number = 0;
    private firstBatch: boolean = true;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    async write(items: ContentItem[]): Promise<void> {
        if (!this.fd) {
            const dir = path.dirname(this.filePath);
            await fs.promises.mkdir(dir, { recursive: true });
            this.fd = await fs.promises.open(this.filePath, 'w');
            await this.fd.write('[\n');
        }

        for (const item of items) {
            if (!this.firstBatch) {
                await this.fd.write(',\n');
            }
            this.firstBatch = false;
            await this.fd.write('  ' + JSON.stringify(item));
            this.totalItems++;
        }
    }

    async close(): Promise<number> {
        if (this.fd) {
            await this.fd.write('\n]\n');
            await this.fd.close();
            this.fd = null;
        }
        return this.totalItems;
    }
}

/**
 * Streaming CSV exporter. Writes header on first batch, then data rows.
 */
class CsvExportStream implements ExportStream {
    private fd: fs.promises.FileHandle | null = null;
    private filePath: string;
    private totalItems: number = 0;
    private headerWritten: boolean = false;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    async write(items: ContentItem[]): Promise<void> {
        if (!this.fd) {
            const dir = path.dirname(this.filePath);
            await fs.promises.mkdir(dir, { recursive: true });
            this.fd = await fs.promises.open(this.filePath, 'w');
        }

        if (!this.headerWritten) {
            await this.fd.write('id,sourceId,type,content,timestamp\n');
            this.headerWritten = true;
        }

        for (const item of items) {
            const row = [
                Exporter.escapeCsvField(item.id),
                Exporter.escapeCsvField(item.sourceId),
                Exporter.escapeCsvField(item.type),
                Exporter.escapeCsvField(item.content ?? ''),
                Exporter.escapeCsvField(item.timestamp),
            ].join(',');
            await this.fd.write(row + '\n');
            this.totalItems++;
        }
    }

    async close(): Promise<number> {
        if (this.fd) {
            await this.fd.close();
            this.fd = null;
        }
        return this.totalItems;
    }
}
