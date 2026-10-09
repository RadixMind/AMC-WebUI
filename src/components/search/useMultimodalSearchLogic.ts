import {
  useState,
  useEffect,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { useMultimodalSearchStore } from '@/stores/multimodalSearchStore';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { dbService } from '@/services/db/dbService';
import { resolveLibraryItemToUploadedFile } from '@/utils/library/libraryFiles';
import { triggerDownload } from '@/utils/export/core';
import type { LibraryItem } from '@/types';
import type { MultimodalSearchResult } from '@/services/embedding/embeddingTypes';

export const toLibraryItemFromSearchResult = (item: MultimodalSearchResult['item']): LibraryItem => ({
  id: item.id,
  name: item.name,
  type: item.type,
  size: item.size || 0,
  timestamp: item.createdAt || item.updatedAt,
  sessionId: item.sessionId,
  sessionTitle: item.sessionTitle,
  messageId: item.messageId,
  source: 'uploaded',
  isStandalone: item.isStandalone,
  dataUrl: item.thumbnailUrl,
});

export function useMultimodalSearchLogic() {
  const isOpen = useMultimodalSearchStore((state) => state.isOpen);
  const closeModal = useMultimodalSearchStore((state) => state.closeModal);
  const searchQuery = useMultimodalSearchStore((state) => state.searchQuery);
  const setSearchQuery = useMultimodalSearchStore((state) => state.setSearchQuery);
  const searchImagePreviewUrl = useMultimodalSearchStore((state) => state.searchImagePreviewUrl);
  const setSearchImage = useMultimodalSearchStore((state) => state.setSearchImage);
  const clearSearchImage = useMultimodalSearchStore((state) => state.clearSearchImage);
  const categoryFilter = useMultimodalSearchStore((state) => state.categoryFilter);
  const setCategoryFilter = useMultimodalSearchStore((state) => state.setCategoryFilter);
  const isSearching = useMultimodalSearchStore((state) => state.isSearching);
  const isIndexing = useMultimodalSearchStore((state) => state.isIndexing);
  const isAutoIndexEnabled = useMultimodalSearchStore((state) => state.isAutoIndexEnabled);
  const setIsAutoIndexEnabled = useMultimodalSearchStore((state) => state.setIsAutoIndexEnabled);
  const indexedCount = useMultimodalSearchStore((state) => state.indexedCount);
  const indexProgress = useMultimodalSearchStore((state) => state.indexProgress);
  const results = useMultimodalSearchStore((state) => state.results);
  const searchError = useMultimodalSearchStore((state) => state.searchError);
  const executeSearch = useMultimodalSearchStore((state) => state.executeSearch);
  const triggerIndexing = useMultimodalSearchStore((state) => state.triggerIndexing);

  const setActiveView = useUIStore((state) => state.setActiveView);
  const setActiveSessionId = useChatStore((state) => state.setActiveSessionId);
  const setSelectedFiles = useChatStore((state) => state.setSelectedFiles);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set());
  const [isInserting, setIsInserting] = useState(false);

  useEffect(() => {
    setSelectedResultIds(new Set());
  }, [results, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void executeSearch();
    }
  };

  const handleImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setSearchImage(file, previewUrl);
      event.target.value = '';
      void executeSearch();
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const previewUrl = URL.createObjectURL(file);
      setSearchImage(file, previewUrl);
      void executeSearch();
    }
  };

  const handleJumpToSession = (sessionId?: string) => {
    if (!sessionId) return;
    setActiveSessionId(sessionId);
    setActiveView('chat');
    closeModal();
  };

  const resolveSearchResultToUploadedFile = async (result: MultimodalSearchResult) => {
    const libraryItem = toLibraryItemFromSearchResult(result.item);

    return resolveLibraryItemToUploadedFile(libraryItem, (itemToFetch) => dbService.fetchLibraryFileBlob(itemToFetch), {
      generateNewId: true,
    });
  };

  const handleInsertSingleItem = async (result: MultimodalSearchResult) => {
    setIsInserting(true);
    try {
      const uploadedFile = await resolveSearchResultToUploadedFile(result);
      const currentFiles = useChatStore.getState().selectedFiles;
      const alreadyExists = currentFiles.some(
        (file) => file.id === uploadedFile.id || (file.name === uploadedFile.name && file.size === uploadedFile.size),
      );
      if (!alreadyExists) {
        setSelectedFiles([...currentFiles, uploadedFile]);
      }
      setActiveView('chat');
      closeModal();
    } catch {
      setActiveView('chat');
      closeModal();
    } finally {
      setIsInserting(false);
    }
  };

  const handleBatchInsert = async () => {
    if (selectedResultIds.size === 0 || isInserting) return;
    setIsInserting(true);
    try {
      const selectedResults = results.filter((result) => selectedResultIds.has(result.item.id));
      const resolvedFiles = await Promise.all(
        selectedResults.map((searchResult) => resolveSearchResultToUploadedFile(searchResult)),
      );
      const currentFiles = useChatStore.getState().selectedFiles;
      const newFiles = resolvedFiles.filter(
        (newFile) =>
          !currentFiles.some(
            (file) => file.id === newFile.id || (file.name === newFile.name && file.size === newFile.size),
          ),
      );
      setSelectedFiles([...currentFiles, ...newFiles]);
      setActiveView('chat');
      closeModal();
    } catch {
      setActiveView('chat');
      closeModal();
    } finally {
      setIsInserting(false);
    }
  };

  const handleToggleSelect = (id: string, event?: MouseEvent) => {
    event?.stopPropagation();
    setSelectedResultIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    if (selectedResultIds.size === results.length) {
      setSelectedResultIds(new Set());
    } else {
      setSelectedResultIds(new Set(results.map((result) => result.item.id)));
    }
  };

  const handleDownloadItem = async (result: MultimodalSearchResult) => {
    const item = result.item;
    const libraryItem = toLibraryItemFromSearchResult(item);

    const blob = await dbService.fetchLibraryFileBlob(libraryItem);
    if (blob) {
      const url = URL.createObjectURL(blob);
      triggerDownload(url, item.name, true);
    } else if (item.thumbnailUrl) {
      triggerDownload(item.thumbnailUrl, item.name, false);
    }
  };

  return {
    isOpen,
    closeModal,
    searchQuery,
    setSearchQuery,
    searchImagePreviewUrl,
    setSearchImage,
    clearSearchImage,
    categoryFilter,
    setCategoryFilter,
    isSearching,
    isIndexing,
    isAutoIndexEnabled,
    setIsAutoIndexEnabled,
    indexedCount,
    indexProgress,
    results,
    searchError,
    executeSearch,
    triggerIndexing,
    fileInputRef: fileInputRef as RefObject<HTMLInputElement>,
    searchInputRef: searchInputRef as RefObject<HTMLInputElement>,
    isDragOver,
    selectedResultIds,
    setSelectedResultIds,
    isInserting,
    handleKeyDown,
    handleImageSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleJumpToSession,
    handleInsertSingleItem,
    handleBatchInsert,
    handleToggleSelect,
    handleSelectAllToggle,
    handleDownloadItem,
  };
}
