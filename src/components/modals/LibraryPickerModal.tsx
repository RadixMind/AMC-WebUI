import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Library, Loader2, Upload, X } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { useI18n } from '@/contexts/I18nContext';
import { interpolate } from '@/i18n/interpolate';
import { filterAndSortLibraryItems } from '@/utils/library/libraryFiles';
import { MODAL_CLOSE_BUTTON_CLASS } from '@/constants/buttonClasses';
import { logService } from '@/services/logService';
import { FilePreviewModal } from './FilePreviewModal';
import { useLibraryPickerFiles } from './library-picker/useLibraryPickerFiles';
import { LibraryPickerToolbar } from './library-picker/LibraryPickerToolbar';
import { LibraryPickerGrid } from './library-picker/LibraryPickerGrid';
import { LibraryPickerList } from './library-picker/LibraryPickerList';
import { cleanupFilePreviewUrl } from '@/utils/file/filePreviewUrls';
import type {
  LibraryCategoryFilter,
  LibraryFileTypeFilter,
  LibraryItem,
  LibrarySortOption,
  LibrarySourceFilter,
} from '@/types';

interface LibraryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedItems: LibraryItem[]) => Promise<void>;
  initialCategory?: LibraryCategoryFilter;
}

export const LibraryPickerModal: React.FC<LibraryPickerModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialCategory = 'all',
}) => {
  const { t, language } = useI18n();

  const [isImporting, setIsImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<LibraryCategoryFilter>(initialCategory);
  const [sourceFilter, setSourceFilter] = useState<LibrarySourceFilter>('all');
  const [fileTypeFilter, setFileTypeFilter] = useState<LibraryFileTypeFilter>('all');
  const [sortOption, setSortOption] = useState<LibrarySortOption>('date_desc');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    allItems,
    isLoading,
    isUploading,
    isDraggingOver,
    previewFile,
    fileInputRef,
    previewOriginalDataUrlRef,
    handleFileInputChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePreviewItem,
    handleClosePreview,
  } = useLibraryPickerFiles({
    isOpen,
    onAutoSelectUploaded: (newIds) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        newIds.forEach((id) => next.add(id));
        return next;
      });
    },
  });

  // Reset filter and selection state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
    setSearchQuery('');
    setCategoryFilter(initialCategory);
    setSourceFilter('all');
    setFileTypeFilter('all');
    setSortOption('date_desc');
    setIsFilterMenuOpen(false);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [isOpen, initialCategory]);

  const hasAdvancedFilters = sourceFilter !== 'all' || fileTypeFilter !== 'all' || sortOption !== 'date_desc';

  const handleResetFilters = useCallback(() => {
    setSourceFilter('all');
    setFileTypeFilter('all');
    setSortOption('date_desc');
    setIsFilterMenuOpen(false);
  }, []);

  const handleSelectSubtype = useCallback(
    (type: LibraryFileTypeFilter) => {
      setFileTypeFilter(type);
      if (type !== 'all' && (categoryFilter === 'image' || categoryFilter === 'audio' || categoryFilter === 'video')) {
        setCategoryFilter('document');
      }
      setIsFilterMenuOpen(false);
    },
    [categoryFilter],
  );

  // Filter and sort items
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
  }, [previewIndex, previewFile, filteredItems, handlePreviewItem, previewOriginalDataUrlRef]);

  const handleNextPreview = useCallback(() => {
    if (previewIndex !== -1 && previewIndex < filteredItems.length - 1) {
      if (previewFile?.dataUrl && previewFile.dataUrl !== previewOriginalDataUrlRef.current) {
        cleanupFilePreviewUrl(previewFile);
      }
      previewOriginalDataUrlRef.current = null;
      void handlePreviewItem(filteredItems[previewIndex + 1]);
    }
  }, [previewIndex, previewFile, filteredItems, handlePreviewItem, previewOriginalDataUrlRef]);

  const lastSelectedIdRef = useRef<string | null>(null);

  const toggleSelectItem = useCallback(
    (id: string, event?: React.MouseEvent | React.KeyboardEvent) => {
      const isShift = event?.shiftKey;
      if (isShift && lastSelectedIdRef.current && lastSelectedIdRef.current !== id) {
        const lastIndex = filteredItems.findIndex((item) => item.id === lastSelectedIdRef.current);
        const currentIndex = filteredItems.findIndex((item) => item.id === id);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const rangeIds = filteredItems.slice(start, end + 1).map((item) => item.id);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const rangeId of rangeIds) {
              next.add(rangeId);
            }
            return next;
          });
          lastSelectedIdRef.current = id;
          return;
        }
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastSelectedIdRef.current = id;
    },
    [filteredItems],
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (previewFile) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedIds(new Set(filteredItems.map((item) => item.id)));
      } else if (event.key === 'Escape' && selectedIds.size > 0) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIds(new Set());
        lastSelectedIdRef.current = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredItems, isOpen, previewFile, selectedIds.size]);

  const handleSelectAllToggle = useCallback(() => {
    if (filteredItems.length === 0) return;
    const allFilteredSelected = filteredItems.every((item) => selectedIds.has(item.id));
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredItems.forEach((item) => next.delete(item.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredItems.forEach((item) => next.add(item.id));
        return next;
      });
    }
  }, [filteredItems, selectedIds]);

  const handleConfirmSelection = useCallback(async () => {
    if (selectedIds.size === 0 || isImporting) return;

    const itemsToImport = allItems.filter((item) => selectedIds.has(item.id));
    if (itemsToImport.length === 0) return;

    setIsImporting(true);
    try {
      await onConfirm(itemsToImport);
      onClose();
    } catch (importError) {
      logService.error('Failed to import items from library', importError);
    } finally {
      setIsImporting(false);
    }
  }, [allItems, isImporting, onClose, onConfirm, selectedIds]);

  const handleItemDoubleClick = useCallback(
    async (item: LibraryItem) => {
      if (isImporting) return;
      setIsImporting(true);
      try {
        await onConfirm([item]);
        onClose();
      } catch (importError) {
        logService.error('Failed to import single item from library', importError);
      } finally {
        setIsImporting(false);
      }
    },
    [isImporting, onClose, onConfirm],
  );

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      contentClassName="w-full max-w-3xl sm:max-w-4xl h-[85vh] max-h-[720px] bg-[var(--theme-bg-primary)] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[var(--theme-border-primary)] relative"
      noPadding
      ariaLabel={t('attachMenuLibrary')}
    >
      <div
        className="flex flex-col flex-1 h-full w-full overflow-hidden relative"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 z-50 bg-[var(--theme-bg-accent)]/10 backdrop-blur-xs border-2 border-dashed border-[var(--theme-accent)] flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-100 rounded-2xl">
            <div className="p-3.5 rounded-full bg-[var(--theme-bg-primary)] text-[var(--theme-accent)] shadow-xl mb-2">
              <Upload size={28} strokeWidth={2} />
            </div>
            <span className="text-sm font-semibold text-[var(--theme-text-primary)]">{t('libraryDropOverlay')}</span>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)]/40 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--theme-bg-tertiary)] flex items-center justify-center text-[var(--theme-text-primary)]">
              <Library size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--theme-text-primary)] leading-tight">
                {t('attachMenuLibrary')}
              </h2>
              <p className="text-xs text-[var(--theme-text-tertiary)]">
                {interpolate(t('librarySelectedCount'), { count: selectedIds.size })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-[var(--theme-border-secondary)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-secondary)] active:scale-95 transition-all cursor-pointer"
            >
              {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              <span>{t('libraryUpload')}</span>
            </button>
            <button type="button" onClick={onClose} className={MODAL_CLOSE_BUTTON_CLASS} aria-label={t('close')}>
              <X size={18} />
            </button>
          </div>
        </div>

        <LibraryPickerToolbar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          fileTypeFilter={fileTypeFilter}
          setFileTypeFilter={setFileTypeFilter}
          sortOption={sortOption}
          setSortOption={setSortOption}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isFilterMenuOpen={isFilterMenuOpen}
          setIsFilterMenuOpen={setIsFilterMenuOpen}
          hasAdvancedFilters={hasAdvancedFilters}
          handleResetFilters={handleResetFilters}
          handleSelectSubtype={handleSelectSubtype}
          searchInputRef={searchInputRef}
          t={t}
        />

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center py-20 text-[var(--theme-text-tertiary)] gap-3">
              <Loader2 size={32} className="animate-spin text-[var(--theme-text-primary)]" />
              <p className="text-sm">{t('loading')}</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-20 text-[var(--theme-text-tertiary)] gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--theme-bg-tertiary)] flex items-center justify-center text-[var(--theme-text-secondary)]">
                <FolderOpen size={24} />
              </div>
              <p className="text-sm font-medium text-[var(--theme-text-primary)]">{t('libraryEmptyTitle')}</p>
              <p className="text-xs max-w-sm text-center">{t('libraryEmptyDesc')}</p>
              {(searchQuery || categoryFilter !== 'all' || hasAdvancedFilters) && (
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter('all');
                    handleResetFilters();
                    setSearchQuery('');
                  }}
                  className="mt-1 px-3 py-1.5 text-xs text-[var(--theme-text-link)] hover:underline cursor-pointer"
                >
                  {t('libraryResetFilters')}
                </button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <LibraryPickerGrid
              filteredItems={filteredItems}
              selectedIds={selectedIds}
              toggleSelectItem={toggleSelectItem}
              handleItemDoubleClick={handleItemDoubleClick}
              handlePreviewItem={handlePreviewItem}
              t={t}
            />
          ) : (
            <LibraryPickerList
              filteredItems={filteredItems}
              selectedIds={selectedIds}
              allFilteredSelected={allFilteredSelected}
              handleSelectAllToggle={handleSelectAllToggle}
              toggleSelectItem={toggleSelectItem}
              handleItemDoubleClick={handleItemDoubleClick}
              handlePreviewItem={handlePreviewItem}
              language={language}
              t={t}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)]/40 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--theme-text-secondary)]">
              {interpolate(t('librarySelectedCount'), { count: selectedIds.size })}
            </span>
            {filteredItems.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAllToggle}
                className="text-xs text-[var(--theme-text-link)] hover:underline font-medium cursor-pointer"
              >
                {allFilteredSelected ? t('libraryDeselectAll') : t('librarySelectAll')}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 text-xs font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] rounded-xl transition-colors border border-[var(--theme-border-secondary)] cursor-pointer"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmSelection}
              disabled={selectedIds.size === 0 || isImporting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors shadow-xs cursor-pointer"
            >
              {isImporting && <Loader2 size={14} className="animate-spin" />}
              <span>
                {t('libraryAddFiles')}
                {selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </span>
            </button>
          </div>
        </div>

        {previewFile && (
          <FilePreviewModal
            file={previewFile}
            onClose={handleClosePreview}
            onPrev={handlePrevPreview}
            onNext={handleNextPreview}
            hasPrev={hasPrevPreview}
            hasNext={hasNextPreview}
          />
        )}
      </div>
    </Modal>
  );
};
