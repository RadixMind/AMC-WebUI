import type { LibraryFileTypeFilter, LibraryItem } from '@/types';
import { dbService } from '@/services/db/dbService';
import { getLibraryFileType, formatLibraryDate } from '@/utils/library/libraryFiles';
import { formatFileSize } from '@/utils/file/fileSize';
import { getFileKindFlags } from '@/utils/file/fileTypeClassification';

export interface SearchLibraryOptions {
  query: string;
  fileType?: string;
  limit?: number;
}

export interface LibrarySearchResult {
  id: string;
  name: string;
  type: string;
  fileType: LibraryFileTypeFilter;
  size: number;
  formattedSize: string;
  timestamp: number;
  dateStr: string;
  source: 'standalone' | 'session';
  sessionTitle?: string;
  sessionId?: string;
  snippet?: string;
  score: number;
}

export interface ReadLibraryFileOptions {
  fileId: string;
  maxLines?: number;
  startLine?: number;
}

export interface ReadLibraryFileResult {
  found: boolean;
  id: string;
  name?: string;
  type?: string;
  isBinary?: boolean;
  content?: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  truncated?: boolean;
  message?: string;
}

/**
 * Extracts a contextual text snippet around the first keyword match.
 * Normalizes all whitespace and line breaks into single spaces for card/preview display.
 * If the query is not found in the text, returns an initial prefix fallback (up to `radius * 2` chars).
 *
 * @param text - Full file text content
 * @param query - Keyword to locate
 * @param radius - Character radius around the match (defaults to 70)
 */
export const extractSnippet = (text: string, query: string, radius: number = 70): string => {
  if (!text || !query) return '';
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) {
    return text
      .slice(0, radius * 2)
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  let snippet = text
    .slice(start, end)
    .replace(/[\r\n\t]+/g, ' ')
    .trim();

  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet;
};

/**
 * Collects all active library items, deduplicating standalone and session files,
 * and filtering out deleted records.
 */
export const getActiveLibraryItems = async (db = dbService): Promise<LibraryItem[]> => {
  const [standalone, historical, deletedIds] = await Promise.all([
    db.getStandaloneLibraryFiles(),
    db.getAllHistoricalSessionFiles(),
    db.getDeletedLibraryFileIds(),
  ]);

  const deletedSet = new Set(deletedIds || []);
  const itemMap = new Map<string, LibraryItem>();

  // Standalone library items take priority
  for (const item of standalone || []) {
    if (item?.id && !deletedSet.has(item.id)) {
      itemMap.set(item.id, { ...item, isStandalone: true, source: 'uploaded' });
    }
  }

  // Then add historical session files if not already present
  for (const item of historical || []) {
    if (item?.id && !deletedSet.has(item.id) && !itemMap.has(item.id)) {
      itemMap.set(item.id, item);
    }
  }

  return Array.from(itemMap.values());
};

/**
 * Searches the user's library and knowledge base for files matching the given query and optional type filter.
 */
export const searchLibrary = async (options: SearchLibraryOptions, db = dbService): Promise<LibrarySearchResult[]> => {
  const rawQuery = options.query ? options.query.trim() : '';
  if (!rawQuery) return [];

  const limit = Math.max(1, Math.min(options.limit ?? 10, 30));
  const fileTypeFilter = options.fileType?.trim().toLowerCase();
  const lowerQuery = rawQuery.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter(Boolean);

  const items = await getActiveLibraryItems(db);
  const results: LibrarySearchResult[] = [];

  for (const item of items) {
    const itemFileType = getLibraryFileType(item.type || '', item.name || '');

    if (fileTypeFilter && fileTypeFilter !== 'all' && itemFileType !== fileTypeFilter) {
      continue;
    }

    const lowerName = (item.name || '').toLowerCase();
    const lowerSessionTitle = (item.sessionTitle || '').toLowerCase();
    const textContent = item.textContent || '';
    const lowerContent = textContent.toLowerCase();

    let score = 0;
    let snippet: string | undefined;

    // 1. Name exact or whole match
    if (lowerName.includes(lowerQuery)) {
      score += 100;
    } else {
      // Name word matches
      const matchedWords = queryWords.filter((word) => lowerName.includes(word));
      if (matchedWords.length > 0) {
        score += 40 * (matchedWords.length / queryWords.length);
      }
    }

    // 2. Session title match
    if (lowerSessionTitle && lowerSessionTitle.includes(lowerQuery)) {
      score += 30;
    }

    // 3. Content match
    if (lowerContent) {
      if (lowerContent.includes(lowerQuery)) {
        score += 50;
        snippet = extractSnippet(textContent, rawQuery);
      } else {
        const matchedWords = queryWords.filter((word) => lowerContent.includes(word));
        if (matchedWords.length > 0) {
          score += 20 * (matchedWords.length / queryWords.length);
          snippet = extractSnippet(textContent, matchedWords[0]);
        }
      }
    }

    if (score > 0) {
      results.push({
        id: item.id,
        name: item.name,
        type: item.type || 'application/octet-stream',
        fileType: itemFileType,
        size: item.size || 0,
        formattedSize: formatFileSize(item.size || 0),
        timestamp: item.timestamp || 0,
        dateStr: item.timestamp ? formatLibraryDate(item.timestamp, 'zh') : '',
        source: item.isStandalone || !item.sessionId ? 'standalone' : 'session',
        sessionTitle: item.sessionTitle,
        sessionId: item.sessionId,
        snippet,
        score,
      });
    }
  }

  // Sort by score desc, then timestamp desc
  results.sort((itemA, itemB) => {
    if (itemB.score !== itemA.score) return itemB.score - itemA.score;
    return itemB.timestamp - itemA.timestamp;
  });

  return results.slice(0, limit);
};

/**
 * Reads the text content of a specific library file by ID, with line slicing and safety limits.
 */
export const readLibraryFile = async (
  options: ReadLibraryFileOptions,
  db = dbService,
): Promise<ReadLibraryFileResult> => {
  const fileId = options.fileId ? options.fileId.trim() : '';
  if (!fileId) {
    return { found: false, id: fileId, message: 'fileId is required.' };
  }

  const items = await getActiveLibraryItems(db);
  const item = items.find((libraryItem) => libraryItem.id === fileId);

  if (!item) {
    return { found: false, id: fileId, message: `File with ID "${fileId}" was not found in the library.` };
  }

  const flags = getFileKindFlags({ type: item.type, name: item.name });
  if (flags.isImage || flags.isAudio || flags.isVideo) {
    return {
      found: true,
      id: item.id,
      name: item.name,
      type: item.type,
      isBinary: true,
      message: `File "${item.name}" is a binary media file (${item.type}) and cannot be read as plain text.`,
    };
  }

  let text = item.textContent || '';
  if (!text) {
    const blob = await db.fetchLibraryFileBlob(item);
    if (blob) {
      try {
        text = await blob.text();
      } catch {
        text = '';
      }
    }
  }

  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const startLine = Math.max(1, options.startLine ?? 1);
  const maxLines = Math.max(1, Math.min(options.maxLines ?? 200, 1000));

  const startIndex = startLine - 1;
  const endIndex = Math.min(totalLines, startIndex + maxLines);

  const slicedContent = startIndex < totalLines ? lines.slice(startIndex, endIndex).join('\n') : '';

  return {
    found: true,
    id: item.id,
    name: item.name,
    type: item.type,
    isBinary: false,
    content: slicedContent,
    startLine,
    endLine: endIndex,
    totalLines,
    truncated: endIndex < totalLines,
  };
};
