import { cleanupFilePreviewUrl } from '@/utils/file/filePreviewUrls';
import { createLruCache } from '@/utils/cache/lruCache';

// Bounded LRU cache for extracted text snippet lines
const TEXT_SNIPPET_CACHE_LIMIT = 256;
const textSnippetCache = createLruCache<string[]>({ limit: TEXT_SNIPPET_CACHE_LIMIT });

export const readSnippetCache = (id: string): string[] | undefined => textSnippetCache.get(id);
export const writeSnippetCache = (id: string, lines: string[]): void => textSnippetCache.set(id, lines);

// Bounded LRU cache for created thumbnail blob URLs across view-mode toggles
const THUMBNAIL_BLOB_CACHE_LIMIT = 64;
const thumbnailBlobUrlCache = createLruCache<string>({
  limit: THUMBNAIL_BLOB_CACHE_LIMIT,
  onEvict: (oldestUrl) => {
    cleanupFilePreviewUrl({ dataUrl: oldestUrl });
  },
});

export const readThumbnailBlobCache = (id: string): string | undefined => thumbnailBlobUrlCache.get(id);
export const writeThumbnailBlobCache = (id: string, url: string): void => thumbnailBlobUrlCache.set(id, url);

// Bounded LRU cache for extracted spreadsheet grid cells
const SPREADSHEET_GRID_CACHE_LIMIT = 128;
const spreadsheetGridCache = createLruCache<string[][]>({ limit: SPREADSHEET_GRID_CACHE_LIMIT });

export const readSpreadsheetCache = (id: string): string[][] | undefined => spreadsheetGridCache.get(id);
export const writeSpreadsheetCache = (id: string, rows: string[][]): void => spreadsheetGridCache.set(id, rows);
