import { dbService } from '@/services/db/dbService';
import {
  computeCosineSimilarity,
  generateDocumentEmbedding,
  generateMediaEmbedding,
  generateMultimodalQueryEmbedding,
  generateQueryEmbedding,
} from './geminiEmbeddingService';
import { getStoredEmbeddings, getStoredEmbeddingIds, saveStoredEmbedding } from './multimodalIndexStore';
import {
  isOversizedForEmbedding,
  truncateEmbeddingText,
  MAX_EMBEDDING_PDF_PAGES,
  MAX_EMBEDDING_AUDIO_SECONDS,
  MAX_EMBEDDING_VIDEO_SECONDS,
} from './embeddingLimits';
import { inspectPdfBlob } from '@/utils/file/pdfTextExtraction';
import { probeMediaDuration } from '@/utils/media/mediaDuration';
import type {
  IndexableLibraryItem,
  IndexSkipReason,
  MultimodalEmbeddingItem,
  MultimodalIndexProgress,
  MultimodalMediaCategory,
  MultimodalSearchFilter,
  MultimodalSearchResult,
} from './embeddingTypes';
import type { LibraryItem } from '@/types';

const resolveMediaCategory = (mimeType: string): MultimodalMediaCategory => {
  const cleanType = (mimeType || '').toLowerCase();
  if (cleanType.startsWith('image/')) return 'image';
  if (cleanType.startsWith('video/')) return 'video';
  if (cleanType.startsWith('audio/')) return 'audio';
  if (cleanType === 'application/pdf') return 'document';
  return 'document';
};

export interface MultimodalSearchExecutionResult {
  results: MultimodalSearchResult[];
  queryEmbedding: number[];
}

/**
 * Filters stored embeddings by category, computes cosine similarity against
 * the query embedding, filters by minimum threshold, and sorts results descending.
 */
const rankEmbeddingsBySimilarity = (
  items: MultimodalEmbeddingItem[],
  queryEmbedding: number[],
  options: MultimodalSearchFilter = {},
): MultimodalSearchResult[] => {
  const { category = 'all', minSimilarity = 0.25, limit = 40 } = options;
  const results: MultimodalSearchResult[] = [];

  for (const item of items) {
    if (category !== 'all' && item.category !== category) {
      continue;
    }

    const similarity = computeCosineSimilarity(queryEmbedding, item.embedding);
    if (similarity >= minSimilarity) {
      results.push({ item, similarity });
    }
  }

  results.sort((resultA, resultB) => resultB.similarity - resultA.similarity);
  return results.slice(0, limit);
};

/**
 * Searches stored multimodal embeddings by a natural language query.
 */
export const searchMultimodalByText = async (
  query: string,
  options: MultimodalSearchFilter & { cachedQueryEmbedding?: number[] } = {},
): Promise<MultimodalSearchExecutionResult> => {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], queryEmbedding: [] };

  const queryEmbedding =
    options.cachedQueryEmbedding && options.cachedQueryEmbedding.length > 0
      ? options.cachedQueryEmbedding
      : await generateQueryEmbedding(trimmed);
  const stored = await getStoredEmbeddings();
  const items = Object.values(stored);
  const results = rankEmbeddingsBySimilarity(items, queryEmbedding, options);

  return { results, queryEmbedding };
};

/**
 * Searches stored multimodal embeddings using an image as input (以图搜图).
 */
export const searchMultimodalByImage = async (
  imageBlob: Blob,
  options: MultimodalSearchFilter & { cachedQueryEmbedding?: number[] } = {},
): Promise<MultimodalSearchExecutionResult> => {
  const mimeType = imageBlob.type || 'image/png';
  const queryEmbedding =
    options.cachedQueryEmbedding && options.cachedQueryEmbedding.length > 0
      ? options.cachedQueryEmbedding
      : await generateMediaEmbedding(imageBlob, mimeType);
  const stored = await getStoredEmbeddings();
  const items = Object.values(stored);
  const results = rankEmbeddingsBySimilarity(items, queryEmbedding, options);

  return { results, queryEmbedding };
};

/**
 * Searches stored multimodal embeddings using both text and an image (图文联合检索).
 * Uses Gemini Embedding 2 aggregated input [query, inlineData] without task prefix.
 */
export const searchMultimodalCombined = async (
  query: string,
  imageBlob: Blob,
  options: MultimodalSearchFilter & { cachedQueryEmbedding?: number[] } = {},
): Promise<MultimodalSearchExecutionResult> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return searchMultimodalByImage(imageBlob, options);
  }

  const mimeType = imageBlob.type || 'image/png';
  const queryEmbedding =
    options.cachedQueryEmbedding && options.cachedQueryEmbedding.length > 0
      ? options.cachedQueryEmbedding
      : await generateMultimodalQueryEmbedding(trimmed, imageBlob, mimeType);
  const stored = await getStoredEmbeddings();
  const items = Object.values(stored);
  const results = rankEmbeddingsBySimilarity(items, queryEmbedding, options);

  return { results, queryEmbedding };
};

export type IndexSingleItemResult =
  { status: 'indexed'; item: MultimodalEmbeddingItem } | { status: 'skipped'; reason: IndexSkipReason };

/**
 * Indexes a single library item and saves its embedding into the vector store.
 *
 * The item payload is resolved here, one item at a time, and released as soon as
 * the embedding has been produced. Callers must not pass payload-bearing objects
 * in bulk.
 */
export const indexSingleItem = async (fileItem: IndexableLibraryItem): Promise<IndexSingleItemResult> => {
  const mimeType = fileItem.type || 'application/octet-stream';
  const category = resolveMediaCategory(mimeType);

  // Reject oversized items before any payload is read into memory.
  if (isOversizedForEmbedding(category, fileItem.size)) {
    return { status: 'skipped', reason: 'too-large' };
  }

  const blob = await dbService.fetchLibraryFileBlob(fileItem as LibraryItem);
  if (!blob) {
    return { status: 'skipped', reason: 'missing-payload' };
  }

  if (isOversizedForEmbedding(category, blob.size)) {
    return { status: 'skipped', reason: 'too-large' };
  }

  const resolvedMimeType = fileItem.type || blob.type || 'application/octet-stream';
  const resolvedCategory = resolveMediaCategory(resolvedMimeType);

  let embedding: number[];

  if (resolvedCategory === 'video' || resolvedCategory === 'audio') {
    const duration = await probeMediaDuration(resolvedMimeType, blob);
    if (duration !== null) {
      const maxDuration = resolvedCategory === 'video' ? MAX_EMBEDDING_VIDEO_SECONDS : MAX_EMBEDDING_AUDIO_SECONDS;
      if (duration > maxDuration) {
        return { status: 'skipped', reason: 'duration-exceeded' };
      }
    }
    embedding = await generateMediaEmbedding(blob, resolvedMimeType);
  } else if (resolvedMimeType === 'application/pdf') {
    const { numPages, text } = await inspectPdfBlob(blob);
    if (numPages <= MAX_EMBEDDING_PDF_PAGES) {
      embedding = await generateMediaEmbedding(blob, resolvedMimeType);
    } else {
      // PDF exceeds 6 pages: fallback to document text embedding
      const truncated = truncateEmbeddingText(text);
      if (!truncated.trim()) {
        return { status: 'skipped', reason: 'too-large' };
      }
      embedding = await generateDocumentEmbedding(fileItem.name, truncated);
    }
  } else if (resolvedCategory === 'image') {
    embedding = await generateMediaEmbedding(blob, resolvedMimeType);
  } else {
    const textContent = (fileItem as LibraryItem).textContent || (await blob.text().catch(() => ''));
    const text = truncateEmbeddingText(textContent);
    if (!text.trim()) {
      return { status: 'skipped', reason: 'no-content' };
    }
    embedding = await generateDocumentEmbedding(fileItem.name, text);
  }

  const embeddingItem: MultimodalEmbeddingItem = {
    id: fileItem.id,
    name: fileItem.name,
    type: resolvedMimeType,
    category: resolvedCategory,
    embedding,
    size: fileItem.size || blob.size,
    sessionId: fileItem.sessionId,
    sessionTitle: fileItem.sessionTitle,
    messageId: fileItem.messageId,
    isStandalone: fileItem.isStandalone,
    createdAt: fileItem.timestamp,
    updatedAt: Date.now(),
  };

  await saveStoredEmbedding(embeddingItem);
  return { status: 'indexed', item: embeddingItem };
};

/**
 * Scans all library files and historical chat attachments to index them into vector store.
 */
export const indexAllHistoricalItems = async (
  onProgress?: (progress: MultimodalIndexProgress) => void,
  options: { forceReindex?: boolean } = {},
): Promise<{ indexed: number; skipped: number; total: number }> => {
  onProgress?.({
    total: 0,
    current: 0,
    phase: 'scanning',
  });

  // Only ids are read here; the vectors themselves are never materialized as a
  // whole, and each item's payload is resolved individually below.
  const [standalone, historical, deletedIds, storedIds] = await Promise.all([
    dbService.getStandaloneLibraryFiles(),
    dbService.getAllHistoricalSessionFiles(),
    dbService.getDeletedLibraryFileIds(),
    getStoredEmbeddingIds(),
  ]);

  const deletedSet = new Set(deletedIds);
  const fileMap = new Map<string, LibraryItem>();

  for (const file of standalone) {
    if (!deletedSet.has(file.id)) {
      fileMap.set(file.id, file);
    }
  }

  for (const file of historical) {
    if (!deletedSet.has(file.id) && !fileMap.has(file.id)) {
      fileMap.set(file.id, file);
    }
  }

  const allFiles = Array.from(fileMap.values());
  const pendingFiles = options.forceReindex ? allFiles : allFiles.filter((file) => !storedIds.has(file.id));

  const total = pendingFiles.length;
  let indexed = 0;
  let skipped = allFiles.length - pendingFiles.length;

  onProgress?.({
    total,
    current: 0,
    phase: 'indexing',
  });

  for (let index = 0; index < total; index++) {
    const fileItem = pendingFiles[index];

    onProgress?.({
      total,
      current: index + 1,
      currentItemName: fileItem.name,
      phase: 'indexing',
    });

    try {
      const result = await indexSingleItem(fileItem);
      if (result.status === 'indexed') {
        indexed++;
      } else {
        skipped++;
      }
    } catch {
      // Failed to index single file - gracefully continue
      skipped++;
    }
  }

  onProgress?.({
    total,
    current: total,
    phase: 'completed',
  });

  return { indexed, skipped, total: allFiles.length };
};
