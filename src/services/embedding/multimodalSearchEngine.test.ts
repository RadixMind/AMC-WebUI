import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchMultimodalByText,
  searchMultimodalByImage,
  searchMultimodalCombined,
  indexAllHistoricalItems,
  indexSingleItem,
} from './multimodalSearchEngine';
import * as geminiServiceModule from './geminiEmbeddingService';
import * as indexStoreModule from './multimodalIndexStore';
import * as pdfExtractionModule from '@/utils/file/pdfTextExtraction';
import * as mediaDurationModule from '@/utils/media/mediaDuration';
import { dbService } from '@/services/db/dbService';
import type { MultimodalEmbeddingItem } from './embeddingTypes';

describe('multimodalSearchEngine', () => {
  const sampleItems: Record<string, MultimodalEmbeddingItem> = {
    'item-1': {
      id: 'item-1',
      name: 'cat_running.png',
      type: 'image/png',
      category: 'image',
      embedding: [0.9, 0.1, 0],
      updatedAt: 1000,
    },
    'item-2': {
      id: 'item-2',
      name: 'dog_barking.png',
      type: 'image/png',
      category: 'image',
      embedding: [0.1, 0.9, 0],
      updatedAt: 1000,
    },
    'item-3': {
      id: 'item-3',
      name: 'financial_report.pdf',
      type: 'application/pdf',
      category: 'document',
      embedding: [0.0, 0.0, 0.9],
      updatedAt: 1000,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(indexStoreModule, 'getStoredEmbeddings').mockResolvedValue(sampleItems);
    vi.spyOn(indexStoreModule, 'getStoredEmbeddingIds').mockResolvedValue(new Set(Object.keys(sampleItems)));
  });

  describe('searchMultimodalByText', () => {
    it('ranks items by cosine similarity to text query embedding', async () => {
      // Query embedding matches item-1 closest
      vi.spyOn(geminiServiceModule, 'generateQueryEmbedding').mockResolvedValue([0.95, 0.05, 0]);

      const { results, queryEmbedding } = await searchMultimodalByText('a playful kitty', { minSimilarity: 0.1 });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].item.id).toBe('item-1');
      expect(results[0].similarity).toBeGreaterThan(0.8);
      expect(queryEmbedding).toEqual([0.95, 0.05, 0]);
    });

    it('filters by category when specified', async () => {
      vi.spyOn(geminiServiceModule, 'generateQueryEmbedding').mockResolvedValue([0.1, 0.1, 0.8]);

      const { results } = await searchMultimodalByText('document report', {
        category: 'document',
        minSimilarity: 0.1,
      });

      expect(results).toHaveLength(1);
      expect(results[0].item.category).toBe('document');
      expect(results[0].item.id).toBe('item-3');
    });

    it('reuses cachedQueryEmbedding without calling generateQueryEmbedding', async () => {
      const generateSpy = vi.spyOn(geminiServiceModule, 'generateQueryEmbedding');

      const { results, queryEmbedding } = await searchMultimodalByText('cached search', {
        cachedQueryEmbedding: [0.95, 0.05, 0],
        minSimilarity: 0.1,
      });

      expect(generateSpy).not.toHaveBeenCalled();
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].item.id).toBe('item-1');
      expect(queryEmbedding).toEqual([0.95, 0.05, 0]);
    });

    it('returns empty array when query is empty', async () => {
      const { results, queryEmbedding } = await searchMultimodalByText('   ');
      expect(results).toEqual([]);
      expect(queryEmbedding).toEqual([]);
    });
  });

  describe('searchMultimodalByImage', () => {
    it('ranks items by similarity to query image embedding', async () => {
      vi.spyOn(geminiServiceModule, 'generateMediaEmbedding').mockResolvedValue([0.1, 0.95, 0]);

      const dummyImage = new Blob(['img'], { type: 'image/png' });
      const { results, queryEmbedding } = await searchMultimodalByImage(dummyImage, { minSimilarity: 0.1 });

      expect(results[0].item.id).toBe('item-2');
      expect(results[0].similarity).toBeGreaterThan(0.8);
      expect(queryEmbedding).toEqual([0.1, 0.95, 0]);
    });

    it('reuses cachedQueryEmbedding without calling generateMediaEmbedding', async () => {
      const mediaSpy = vi.spyOn(geminiServiceModule, 'generateMediaEmbedding');

      const dummyImage = new Blob(['img'], { type: 'image/png' });
      const { results } = await searchMultimodalByImage(dummyImage, {
        cachedQueryEmbedding: [0.1, 0.95, 0],
        minSimilarity: 0.1,
      });

      expect(mediaSpy).not.toHaveBeenCalled();
      expect(results[0].item.id).toBe('item-2');
    });
  });

  describe('searchMultimodalCombined', () => {
    it('ranks items using aggregated multimodal query embedding when both query and image are present', async () => {
      const mockMultimodalEmbed = vi
        .spyOn(geminiServiceModule, 'generateMultimodalQueryEmbedding')
        .mockResolvedValue([0.92, 0.08, 0]);

      const dummyImage = new Blob(['img'], { type: 'image/jpeg' });
      const { results, queryEmbedding } = await searchMultimodalCombined('red kitten', dummyImage, {
        minSimilarity: 0.1,
      });

      expect(mockMultimodalEmbed).toHaveBeenCalledWith('red kitten', dummyImage, 'image/jpeg');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].item.id).toBe('item-1');
      expect(results[0].similarity).toBeGreaterThan(0.8);
      expect(queryEmbedding).toEqual([0.92, 0.08, 0]);
    });

    it('falls back to searchMultimodalByImage when query string is empty or blank', async () => {
      vi.spyOn(geminiServiceModule, 'generateMediaEmbedding').mockResolvedValue([0.1, 0.95, 0]);

      const dummyImage = new Blob(['img'], { type: 'image/png' });
      const { results } = await searchMultimodalCombined('   ', dummyImage, { minSimilarity: 0.1 });

      expect(results[0].item.id).toBe('item-2');
    });

    it('filters by category when specified', async () => {
      vi.spyOn(geminiServiceModule, 'generateMultimodalQueryEmbedding').mockResolvedValue([0.0, 0.0, 0.95]);

      const dummyImage = new Blob(['img'], { type: 'image/png' });
      const { results } = await searchMultimodalCombined('quarterly report', dummyImage, {
        category: 'document',
        minSimilarity: 0.1,
      });

      expect(results).toHaveLength(1);
      expect(results[0].item.category).toBe('document');
      expect(results[0].item.id).toBe('item-3');
    });

    it('reuses cachedQueryEmbedding in combined search', async () => {
      const combinedSpy = vi.spyOn(geminiServiceModule, 'generateMultimodalQueryEmbedding');

      const dummyImage = new Blob(['img'], { type: 'image/jpeg' });
      const { results, queryEmbedding } = await searchMultimodalCombined('red kitten', dummyImage, {
        cachedQueryEmbedding: [0.92, 0.08, 0],
        minSimilarity: 0.1,
      });

      expect(combinedSpy).not.toHaveBeenCalled();
      expect(results[0].item.id).toBe('item-1');
      expect(queryEmbedding).toEqual([0.92, 0.08, 0]);
    });
  });

  describe('indexSingleItem', () => {
    it('skips an oversized media file without reading its payload', async () => {
      const fetchSpy = vi.spyOn(dbService, 'fetchLibraryFileBlob');

      const result = await indexSingleItem({
        id: 'huge-video',
        name: 'huge.mp4',
        type: 'video/mp4',
        size: 2 * 1024 * 1024 * 1024,
      });

      expect(result).toEqual({ status: 'skipped', reason: 'too-large' });
      // The whole point of the cap: never base64-encode a multi-hundred-MB file.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips when the payload cannot be resolved', async () => {
      vi.spyOn(dbService, 'fetchLibraryFileBlob').mockResolvedValue(undefined);

      const result = await indexSingleItem({
        id: 'missing',
        name: 'missing.png',
        type: 'image/png',
        size: 100,
      });

      expect(result).toEqual({ status: 'skipped', reason: 'missing-payload' });
    });

    it('indexes an image and reports the stored item', async () => {
      vi.spyOn(dbService, 'fetchLibraryFileBlob').mockResolvedValue(new Blob(['img'], { type: 'image/png' }));
      vi.spyOn(geminiServiceModule, 'generateMediaEmbedding').mockResolvedValue([0.1, 0.2, 0.3]);
      const saveSpy = vi.spyOn(indexStoreModule, 'saveStoredEmbedding').mockResolvedValue();

      const result = await indexSingleItem({
        id: 'pic-1',
        name: 'pic.png',
        type: 'image/png',
        size: 3,
      });

      expect(result.status).toBe('indexed');
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'pic-1', category: 'image' }));
    });

    it('indexes short PDF (<= 6 pages) using generateMediaEmbedding', async () => {
      const dummyBlob = new Blob(['pdf-data'], { type: 'application/pdf' });
      vi.spyOn(dbService, 'fetchLibraryFileBlob').mockResolvedValue(dummyBlob);
      vi.spyOn(pdfExtractionModule, 'inspectPdfBlob').mockResolvedValue({
        numPages: 4,
        text: 'Short document text',
      });
      const mediaSpy = vi.spyOn(geminiServiceModule, 'generateMediaEmbedding').mockResolvedValue([0.1, 0.2, 0.3]);
      const docSpy = vi.spyOn(geminiServiceModule, 'generateDocumentEmbedding');

      const result = await indexSingleItem({
        id: 'pdf-short',
        name: 'short.pdf',
        type: 'application/pdf',
        size: 1000,
      });

      expect(result.status).toBe('indexed');
      expect(mediaSpy).toHaveBeenCalledWith(dummyBlob, 'application/pdf');
      expect(docSpy).not.toHaveBeenCalled();
    });

    it('falls back to generateDocumentEmbedding for long PDF (> 6 pages) with text', async () => {
      const dummyBlob = new Blob(['pdf-long-data'], { type: 'application/pdf' });
      vi.spyOn(dbService, 'fetchLibraryFileBlob').mockResolvedValue(dummyBlob);
      vi.spyOn(pdfExtractionModule, 'inspectPdfBlob').mockResolvedValue({
        numPages: 25,
        text: 'Detailed multi-page report content across 25 pages',
      });
      const mediaSpy = vi.spyOn(geminiServiceModule, 'generateMediaEmbedding');
      const docSpy = vi.spyOn(geminiServiceModule, 'generateDocumentEmbedding').mockResolvedValue([0.3, 0.4, 0.5]);

      const result = await indexSingleItem({
        id: 'pdf-long',
        name: 'report.pdf',
        type: 'application/pdf',
        size: 5000,
      });

      expect(result.status).toBe('indexed');
      expect(docSpy).toHaveBeenCalledWith('report.pdf', expect.stringContaining('Detailed multi-page report content'));
      expect(mediaSpy).not.toHaveBeenCalled();
    });

    it('skips long PDF (> 6 pages) when no text could be extracted', async () => {
      const dummyBlob = new Blob(['pdf-scanned-data'], { type: 'application/pdf' });
      vi.spyOn(dbService, 'fetchLibraryFileBlob').mockResolvedValue(dummyBlob);
      vi.spyOn(pdfExtractionModule, 'inspectPdfBlob').mockResolvedValue({
        numPages: 10,
        text: '   ',
      });

      const result = await indexSingleItem({
        id: 'pdf-scanned',
        name: 'scanned.pdf',
        type: 'application/pdf',
        size: 5000,
      });

      expect(result).toEqual({ status: 'skipped', reason: 'too-large' });
    });

    it('skips media file when duration exceeds official limit', async () => {
      const dummyBlob = new Blob(['video-data'], { type: 'video/mp4' });
      vi.spyOn(dbService, 'fetchLibraryFileBlob').mockResolvedValue(dummyBlob);
      vi.spyOn(mediaDurationModule, 'probeMediaDuration').mockResolvedValue(150); // > 120s limit

      const result = await indexSingleItem({
        id: 'video-long',
        name: 'long-video.mp4',
        type: 'video/mp4',
        size: 5000,
      });

      expect(result).toEqual({ status: 'skipped', reason: 'duration-exceeded' });
    });
  });

  describe('indexAllHistoricalItems', () => {
    it('indexes unindexed items and reports progress', async () => {
      vi.spyOn(indexStoreModule, 'getStoredEmbeddingIds').mockResolvedValue(new Set(['item-1']));

      const mockLibraryItem = {
        id: 'new-photo',
        name: 'beach.jpg',
        type: 'image/jpeg',
        size: 1024,
      } as any;

      vi.spyOn(dbService, 'getStandaloneLibraryFiles').mockResolvedValue([mockLibraryItem]);
      vi.spyOn(dbService, 'getAllHistoricalSessionFiles').mockResolvedValue([]);
      vi.spyOn(dbService, 'getDeletedLibraryFileIds').mockResolvedValue([]);
      vi.spyOn(dbService, 'fetchLibraryFileBlob').mockResolvedValue(new Blob(['data'], { type: 'image/jpeg' }));
      vi.spyOn(geminiServiceModule, 'generateMediaEmbedding').mockResolvedValue([0.5, 0.5, 0]);
      const saveSpy = vi.spyOn(indexStoreModule, 'saveStoredEmbedding').mockResolvedValue();

      const progressUpdates: any[] = [];
      const result = await indexAllHistoricalItems((p) => progressUpdates.push(p));

      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-photo',
          name: 'beach.jpg',
          category: 'image',
        }),
      );
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1].phase).toBe('completed');
    });
  });
});
