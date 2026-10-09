import React, { type MouseEvent } from 'react';
import { Check, Plus, Download, Loader2 } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import { interpolate } from '@/i18n/interpolate';
import { formatFileSize } from '@/utils/file/fileSize';
import { LibraryItemThumbnail } from '@/components/library/LibraryItemThumbnail';
import type { MultimodalSearchResult } from '@/services/embedding/embeddingTypes';
import { toLibraryItemFromSearchResult } from './useMultimodalSearchLogic';

export interface MultimodalSearchResultCardProps {
  result: MultimodalSearchResult;
  isSelected: boolean;
  isInserting: boolean;
  onToggleSelect: (id: string, event?: MouseEvent) => void;
  onInsertSingleItem: (result: MultimodalSearchResult) => void | Promise<void>;
  onDownloadItem: (result: MultimodalSearchResult) => void | Promise<void>;
  onJumpToSession: (sessionId?: string) => void;
}

export const MultimodalSearchResultCard: React.FC<MultimodalSearchResultCardProps> = ({
  result,
  isSelected,
  isInserting,
  onToggleSelect,
  onInsertSingleItem,
  onDownloadItem,
  onJumpToSession,
}) => {
  const { t } = useI18n();
  const item = result.item;
  const libraryItem = toLibraryItemFromSearchResult(item);

  const getSimilarityBadge = (similarity: number) => {
    const pct = Math.round(similarity * 100);
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-black/60 text-white backdrop-blur-xs shadow-sm">
        {pct}%
      </span>
    );
  };

  return (
    <div
      className={`group flex flex-col rounded-2xl border transition-all duration-200 overflow-hidden ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/50 bg-[var(--theme-bg-secondary)]'
          : 'border-[var(--theme-border-primary)] hover:border-[var(--theme-border-secondary)] hover:shadow-sm bg-[var(--theme-bg-secondary)]'
      }`}
    >
      <div className="relative w-full aspect-[4/3] bg-[var(--theme-bg-tertiary)] overflow-hidden flex items-center justify-center">
        <LibraryItemThumbnail item={libraryItem} size="full" className="w-full h-full object-contain" />

        <button
          type="button"
          onClick={(event) => onToggleSelect(item.id, event)}
          className={`absolute top-2.5 left-2.5 z-10 w-6 h-6 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-xs ${
            isSelected
              ? 'bg-blue-600 text-white'
              : 'bg-black/50 text-white/80 hover:text-white hover:bg-black/70 sm:opacity-0 sm:group-hover:opacity-100'
          }`}
          title={isSelected ? t('multimodalSearchDeselectAll') : t('multimodalSearchSelectAll')}
          aria-label={isSelected ? t('multimodalSearchDeselectAll') : t('multimodalSearchSelectAll')}
        >
          {isSelected ? (
            <Check size={14} strokeWidth={2.5} />
          ) : (
            <div className="w-3.5 h-3.5 rounded border border-white/60" />
          )}
        </button>

        <div
          className="absolute top-2.5 right-2.5 flex items-center gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-black/60 backdrop-blur-xs p-1 rounded-xl">
            <button
              type="button"
              onClick={() => void onInsertSingleItem(result)}
              title={t('multimodalSearchInsertIntoChat')}
              aria-label={t('multimodalSearchInsertIntoChat')}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors cursor-pointer"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => void onDownloadItem(result)}
              title={t('libraryDownload')}
              aria-label={t('libraryDownload')}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors cursor-pointer"
            >
              <Download size={14} strokeWidth={2} />
            </button>
          </div>
          {getSimilarityBadge(result.similarity)}
        </div>
      </div>

      <div className="p-3 sm:p-3.5 flex flex-col justify-between flex-1 gap-2">
        <div>
          <h4 className="text-sm font-medium text-[var(--theme-text-primary)] truncate" title={item.name}>
            {item.name}
          </h4>
          <div className="flex items-center gap-2 mt-1 text-xs text-[var(--theme-text-tertiary)]">
            <span>{formatFileSize(item.size || 0)}</span>
            <span>•</span>
            <span className="uppercase">{item.category}</span>
          </div>
        </div>

        {item.sessionTitle && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onJumpToSession(item.sessionId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onJumpToSession(item.sessionId);
              }
            }}
            className="text-xs text-[var(--theme-text-tertiary)] hover:text-[var(--theme-accent)] hover:underline truncate cursor-pointer transition-colors"
            title={item.sessionTitle}
          >
            {interpolate(t('libraryFromSession'), { title: item.sessionTitle })}
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-2 border-t border-[var(--theme-border-secondary)]">
          <button
            type="button"
            onClick={() => void onInsertSingleItem(result)}
            disabled={isInserting}
            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-text-primary)] hover:text-[var(--theme-bg-primary)] text-xs font-medium text-[var(--theme-text-secondary)] transition-colors cursor-pointer disabled:opacity-50"
            title={t('multimodalSearchInsertIntoChat')}
          >
            {isInserting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2} />}
            <span>{t('multimodalSearchInsertIntoChat')}</span>
          </button>

          <button
            type="button"
            onClick={() => void onDownloadItem(result)}
            className="p-1.5 rounded-lg bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-bg-primary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
            title={t('libraryDownload')}
            aria-label={t('libraryDownload')}
          >
            <Download size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
