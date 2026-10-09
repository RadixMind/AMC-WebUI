import { useState, useEffect, useMemo, useCallback, useRef, type DragEvent } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { LibraryItem, UploadedFile } from '@/types';
import { dbService } from '@/services/db/dbService';
import {
  extractLibraryItemsFromSessions,
  filterAndSortLibraryItems,
  resolveLibraryItemToUploadedFile,
} from '@/utils/library/libraryFiles';
import { sanitizeFilename, triggerDownload } from '@/utils/export/core';
import { fileToBlobUrl, cleanupFilePreviewUrl } from '@/utils/file/filePreviewUrls';
import { EXTENSION_TO_MIME } from '@/constants/fileTypeSupport';
import { isTextFile, isMarkdownFile } from '@/utils/file/fileTypeClassification';
import { autoIndexingQueue } from '@/services/embedding/autoIndexingQueue';

interface UseLibraryViewLogicProps {
  onNewChat?: (initialFiles?: UploadedFile[]) => void;
  onSelectSession?: (sessionId: string) => void;
}

export const useLibraryViewLogic = ({ onNewChat, onSelectSession }: UseLibraryViewLogicProps) => {
  const savedSessions = useChatStore((state) => state.savedSessions);
  const setSelectedFiles = useChatStore((state) => state.setSelectedFiles);
  const setActiveView = useUIStore((state) => state.setActiveView);

  const viewMode = useLibraryStore((state) => state.viewMode);
  const categoryFilter = useLibraryStore((state) => state.categoryFilter);
  const sourceFilter = useLibraryStore((state) => state.sourceFilter);
  const fileTypeFilter = useLibraryStore((state) => state.fileTypeFilter);
  const sortOption = useLibraryStore((state) => state.sortOption);
  const searchQuery = useLibraryStore((state) => state.searchQuery);
  const selectedFileIds = useLibraryStore((state) => state.selectedFileIds);
  const clearSelection = useLibraryStore((state) => state.clearSelection);
  const selectAllFiles = useLibraryStore((state) => state.selectAllFiles);
  const invertSelection = useLibraryStore((state) => state.invertSelection);
  const selectRange = useLibraryStore((state) => state.selectRange);
  const toggleSelectFile = useLibraryStore((state) => state.toggleSelectFile);
  const setCategoryFilter = useLibraryStore((state) => state.setCategoryFilter);
  const setSourceFilter = useLibraryStore((state) => state.setSourceFilter);
  const setFileTypeFilter = useLibraryStore((state) => state.setFileTypeFilter);
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);

  const [standaloneFiles, setStandaloneFiles] = useState<LibraryItem[]>([]);
  const [historicalFiles, setHistoricalFiles] = useState<LibraryItem[]>([]);
  const [deletedFileIds, setDeletedFileIds] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<LibraryItem | 'selected' | null>(null);
  const [showCreateNote, setShowCreateNote] = useState(false);

  const previewOriginalDataUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedFilesRef = useRef(false);

  const refreshLibraryFiles = useCallback(async () => {
    const [standalone, historical, deleted] = await Promise.all([
      dbService.getStandaloneLibraryFiles(),
      dbService.getAllHistoricalSessionFiles(),
      dbService.getDeletedLibraryFileIds(),
    ]);
    setStandaloneFiles(standalone);
    setHistoricalFiles(historical);
    setDeletedFileIds(new Set(deleted));
    hasLoadedFilesRef.current = true;
  }, []);

  useEffect(() => {
    void refreshLibraryFiles();
  }, [refreshLibraryFiles]);

  const allItems = useMemo(() => {
    const map = new Map<string, LibraryItem>();

    standaloneFiles.forEach((file) => {
      if (!deletedFileIds.has(file.id)) {
        map.set(file.id, file);
      }
    });

    historicalFiles.forEach((file) => {
      if (!deletedFileIds.has(file.id) && !map.has(file.id)) {
        map.set(file.id, file);
      }
    });

    const inMemorySessionFiles = extractLibraryItemsFromSessions(savedSessions);
    inMemorySessionFiles.forEach((file) => {
      if (!deletedFileIds.has(file.id)) {
        map.set(file.id, file);
      }
    });

    return Array.from(map.values());
  }, [savedSessions, standaloneFiles, historicalFiles, deletedFileIds]);

  // Prune any persisted selectedFileIds that no longer exist once files have been loaded
  useEffect(() => {
    if (!hasLoadedFilesRef.current || selectedFileIds.size === 0) return;
    const existingIds = new Set(allItems.map((item) => item.id));
    let hasStale = false;
    for (const fileId of selectedFileIds) {
      if (!existingIds.has(fileId)) {
        hasStale = true;
        break;
      }
    }
    if (hasStale) {
      const pruned = new Set([...selectedFileIds].filter((fileId) => existingIds.has(fileId)));
      useLibraryStore.setState({ selectedFileIds: pruned });
    }
  }, [allItems, selectedFileIds]);

  const filteredItems = useMemo(() => {
    return filterAndSortLibraryItems(allItems, {
      category: categoryFilter,
      source: sourceFilter,
      fileType: fileTypeFilter,
      sort: sortOption,
      searchQuery,
      viewMode,
    });
  }, [allItems, categoryFilter, sourceFilter, fileTypeFilter, sortOption, searchQuery, viewMode]);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      const newItems: LibraryItem[] = await Promise.all(
        files.map(async (file) => {
          const id = `lib-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          let textContent: string | undefined;

          const isText =
            file.type.startsWith('text/') ||
            isTextFile({ name: file.name, type: file.type }) ||
            isMarkdownFile({ name: file.name, type: file.type });

          if (isText && file.size <= 5 * 1024 * 1024) {
            try {
              textContent = await file.text();
            } catch {
              // ignore
            }
          }

          return {
            id,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            timestamp: Date.now(),
            rawFile: file,
            textContent,
            source: 'uploaded' as const,
            isStandalone: true,
          };
        }),
      );

      await dbService.addStandaloneLibraryFiles(newItems);
      autoIndexingQueue.enqueueItems(newItems);
      await refreshLibraryFiles();
    },
    [refreshLibraryFiles],
  );

  const handleDragEnter = useCallback((event: DragEvent) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      setIsDraggingOver(false);

      const droppedFiles = Array.from(event.dataTransfer.files);
      if (droppedFiles.length > 0) {
        await handleUploadFiles(droppedFiles);
      }
    },
    [handleUploadFiles],
  );

  const handleStartChatWithItems = useCallback(
    async (items: LibraryItem[]) => {
      if (!items.length) return;

      const uploadedFiles: UploadedFile[] = await Promise.all(
        items.map((item) =>
          resolveLibraryItemToUploadedFile(item, (fileItem) => dbService.fetchLibraryFileBlob(fileItem), {
            generateNewId: true,
          }),
        ),
      );

      if (onNewChat) {
        onNewChat(uploadedFiles);
      }
      setSelectedFiles(uploadedFiles);
      setActiveView('chat');
    },
    [onNewChat, setSelectedFiles, setActiveView],
  );

  const handleStartChatWithSelected = useCallback(async () => {
    const selectedItems = allItems.filter((item) => selectedFileIds.has(item.id));
    clearSelection();
    await handleStartChatWithItems(selectedItems);
  }, [allItems, selectedFileIds, clearSelection, handleStartChatWithItems]);

  const handleSelectAll = useCallback(() => {
    selectAllFiles(filteredItems.map((item) => item.id));
  }, [filteredItems, selectAllFiles]);

  const lastSelectedIdRef = useRef<string | null>(null);

  const handleToggleSelect = useCallback(
    (id: string, event?: React.MouseEvent | React.KeyboardEvent) => {
      const isShift = event?.shiftKey;
      if (isShift && lastSelectedIdRef.current && lastSelectedIdRef.current !== id) {
        const lastIndex = filteredItems.findIndex((item) => item.id === lastSelectedIdRef.current);
        const currentIndex = filteredItems.findIndex((item) => item.id === id);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const rangeIds = filteredItems.slice(start, end + 1).map((item) => item.id);
          selectRange(rangeIds);
          lastSelectedIdRef.current = id;
          return;
        }
      }

      toggleSelectFile(id);
      lastSelectedIdRef.current = id;
    },
    [filteredItems, selectRange, toggleSelectFile],
  );

  const handleInvertSelection = useCallback(() => {
    invertSelection(filteredItems.map((item) => item.id));
  }, [filteredItems, invertSelection]);

  const handleClearSelection = useCallback(() => {
    clearSelection();
    lastSelectedIdRef.current = null;
  }, [clearSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (previewFile || deleteConfirmTarget || showCreateNote) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        handleSelectAll();
      } else if (event.key === 'Escape' && selectedFileIds.size > 0) {
        event.preventDefault();
        handleClearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirmTarget, handleClearSelection, handleSelectAll, previewFile, selectedFileIds.size, showCreateNote]);

  const handleSaveNote = useCallback(
    async (content: string | Blob, filename: string) => {
      const safeFilename = filename.trim() ? sanitizeFilename(filename) : `note-${Date.now()}.md`;
      const extension = safeFilename.includes('.') ? `.${safeFilename.split('.').pop()?.toLowerCase()}` : '.md';
      const resolvedMime =
        content instanceof Blob
          ? content.type || EXTENSION_TO_MIME[extension] || 'application/octet-stream'
          : EXTENSION_TO_MIME[extension] || (extension === '.md' ? 'text/markdown' : 'text/plain');

      const blob = typeof content === 'string' ? new Blob([content], { type: resolvedMime }) : content;
      const textContent = typeof content === 'string' ? content : undefined;
      const file = new File([blob], safeFilename, { type: resolvedMime });

      const newItem: LibraryItem = {
        id: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: safeFilename,
        type: file.type,
        size: file.size,
        timestamp: Date.now(),
        rawFile: file,
        textContent,
        source: 'uploaded',
        isStandalone: true,
      };

      await dbService.addStandaloneLibraryFiles([newItem]);
      autoIndexingQueue.enqueueItems([newItem]);
      await refreshLibraryFiles();
      setShowCreateNote(false);
    },
    [refreshLibraryFiles],
  );

  const handleDownloadItem = useCallback(async (item: LibraryItem) => {
    if (item.type === 'video/youtube' || item.dataUrl?.startsWith('http://') || item.dataUrl?.startsWith('https://')) {
      if (item.dataUrl) {
        window.open(item.dataUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    let blob = item.rawFile;
    if (!blob) {
      blob = await dbService.fetchLibraryFileBlob(item);
    }

    if (blob) {
      const url = fileToBlobUrl(blob);
      triggerDownload(url, item.name, true);
    } else if (item.dataUrl) {
      triggerDownload(item.dataUrl, item.name, false);
    }
  }, []);

  const handleDownloadSelected = useCallback(async () => {
    const selectedItems = allItems.filter((item) => selectedFileIds.has(item.id));
    for (const item of selectedItems) {
      await handleDownloadItem(item);
    }
  }, [allItems, selectedFileIds, handleDownloadItem]);

  const handleDeleteItem = useCallback((item: LibraryItem) => {
    setDeleteConfirmTarget(item);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    setDeleteConfirmTarget('selected');
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmTarget) return;

    const ids = deleteConfirmTarget === 'selected' ? Array.from(selectedFileIds) : [deleteConfirmTarget.id];
    const idSet = new Set(ids);

    void autoIndexingQueue.removeItems(ids);

    await Promise.all([
      dbService.deleteStandaloneLibraryFiles(ids),
      dbService.deleteFilesFromSessions(ids),
      dbService.addDeletedLibraryFileIds(ids),
    ]);

    useChatStore.getState().removeFilesFromStore(ids);

    setDeletedFileIds((prev) => new Set([...prev, ...ids]));
    setStandaloneFiles((prev) => prev.filter((item) => !idSet.has(item.id)));
    setHistoricalFiles((prev) => prev.filter((item) => !idSet.has(item.id)));

    if (deleteConfirmTarget === 'selected') {
      clearSelection();
    }
    setDeleteConfirmTarget(null);
    await refreshLibraryFiles();
  }, [deleteConfirmTarget, selectedFileIds, clearSelection, refreshLibraryFiles]);

  const handlePreviewItem = useCallback(async (item: LibraryItem) => {
    previewOriginalDataUrlRef.current = item.dataUrl ?? null;
    const file = await resolveLibraryItemToUploadedFile(item, (fileItem) => dbService.fetchLibraryFileBlob(fileItem));
    setPreviewFile(file);
  }, []);

  const handleClosePreview = useCallback(() => {
    if (previewFile?.dataUrl) {
      if (previewFile.dataUrl !== previewOriginalDataUrlRef.current) {
        cleanupFilePreviewUrl(previewFile);
      }
    }
    previewOriginalDataUrlRef.current = null;
    setPreviewFile(null);
  }, [previewFile]);

  const previewIndex = previewFile ? filteredItems.findIndex((item) => item.id === previewFile.id) : -1;
  const hasPrevPreview = previewIndex > 0;
  const hasNextPreview = previewIndex !== -1 && previewIndex < filteredItems.length - 1;

  const handlePrevPreview = useCallback(() => {
    if (previewIndex > 0) {
      if (previewFile?.dataUrl && previewFile.dataUrl !== previewOriginalDataUrlRef.current) {
        cleanupFilePreviewUrl(previewFile);
      }
      previewOriginalDataUrlRef.current = null;
      void handlePreviewItem(filteredItems[previewIndex - 1]);
    }
  }, [previewIndex, previewFile, filteredItems, handlePreviewItem]);

  const handleNextPreview = useCallback(() => {
    if (previewIndex !== -1 && previewIndex < filteredItems.length - 1) {
      if (previewFile?.dataUrl && previewFile.dataUrl !== previewOriginalDataUrlRef.current) {
        cleanupFilePreviewUrl(previewFile);
      }
      previewOriginalDataUrlRef.current = null;
      void handlePreviewItem(filteredItems[previewIndex + 1]);
    }
  }, [previewIndex, previewFile, filteredItems, handlePreviewItem]);

  const handleClearFilters = useCallback(() => {
    setCategoryFilter('all');
    setSourceFilter('all');
    setFileTypeFilter('all');
    setSearchQuery('');
  }, [setCategoryFilter, setSourceFilter, setFileTypeFilter, setSearchQuery]);

  const handleJumpToSession = useCallback(
    (sessionId: string) => {
      onSelectSession?.(sessionId);
      setActiveView('chat');
    },
    [onSelectSession, setActiveView],
  );

  const isFiltered =
    categoryFilter !== 'all' || sourceFilter !== 'all' || fileTypeFilter !== 'all' || searchQuery.trim().length > 0;

  return {
    viewMode,
    selectedFileIds,
    filteredItems,
    isFiltered,
    isDraggingOver,
    fileInputRef,
    previewFile,
    hasPrevPreview,
    hasNextPreview,
    deleteConfirmTarget,
    setDeleteConfirmTarget,
    showCreateNote,
    setShowCreateNote,
    handleUploadFiles,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleStartChatWithItems,
    handleStartChatWithSelected,
    handleSelectAll,
    handleToggleSelect,
    handleInvertSelection,
    handleClearSelection,
    handleSaveNote,
    handleDownloadItem,
    handleDownloadSelected,
    handleDeleteItem,
    handleDeleteSelected,
    handleConfirmDelete,
    handlePreviewItem,
    handleClosePreview,
    handlePrevPreview,
    handleNextPreview,
    handleClearFilters,
    handleJumpToSession,
  };
};
