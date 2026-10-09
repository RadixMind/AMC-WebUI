import React, { useState } from 'react';
import { Check, MessageSquarePlus, Download, Trash2, Eye, Copy } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import { interpolate } from '@/i18n/interpolate';
import { useLibraryStore } from '@/stores/libraryStore';
import type { LibraryItem } from '@/types';
import { formatLibraryDate } from '@/utils/library/libraryFiles';
import { formatFileSize } from '@/utils/file/fileSize';
import { copyTextToClipboard } from '@/utils/clipboard';
import { LibraryItemThumbnail } from './LibraryItemThumbnail';

interface LibraryGridViewProps {
  items: LibraryItem[];
  onPreviewItem: (item: LibraryItem) => void;
  onStartChatWithItem: (item: LibraryItem) => void;
  onDownloadItem: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onJumpToSession?: (sessionId: string) => void;
  onToggleSelect?: (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void;
}

interface LibraryGridCardProps {
  item: LibraryItem;
  isSelected: boolean;
  selectedCount: number;
  language: string;
  isCopied: boolean;
  onPreviewItem: (item: LibraryItem) => void;
  onStartChatWithItem: (item: LibraryItem) => void;
  onDownloadItem: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onJumpToSession?: (sessionId: string) => void;
  onToggleSelect: (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void;
  onCopyApiName: (name: string, id: string) => void;
  t: (key: any) => string;
}

const LibraryGridCard = React.memo<LibraryGridCardProps>(
  ({
    item,
    isSelected,
    selectedCount,
    language,
    isCopied,
    onPreviewItem,
    onStartChatWithItem,
    onDownloadItem,
    onDeleteItem,
    onJumpToSession,
    onToggleSelect,
    onCopyApiName,
    t,
  }) => {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={item.name}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || selectedCount > 0) {
            onToggleSelect(item.id, event);
          } else {
            onPreviewItem(item);
          }
        }}
        onDoubleClick={() => onPreviewItem(item)}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
            event.preventDefault();
            if (event.key === ' ' && (event.metaKey || event.ctrlKey || event.shiftKey || selectedCount > 0)) {
              onToggleSelect(item.id, event);
            } else {
              onPreviewItem(item);
            }
          }
        }}
        className={`group relative flex flex-col rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] ${
          isSelected
            ? 'border-[var(--theme-text-primary)] ring-2 ring-[var(--theme-text-primary)] bg-[var(--theme-bg-secondary)] shadow-md'
            : 'border-[var(--theme-border-primary)] hover:border-[var(--theme-border-secondary)] hover:shadow-sm bg-[var(--theme-bg-secondary)]'
        }`}
      >
        <div className="relative w-full aspect-[4/3] bg-[var(--theme-bg-tertiary)] overflow-hidden flex items-center justify-center">
          <LibraryItemThumbnail item={item} size="full" className="w-full h-full object-contain" />

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect(item.id, event);
            }}
            className={`absolute bottom-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-sm ${
              isSelected
                ? 'bg-[var(--theme-text-primary)] text-[var(--theme-bg-primary)] scale-100 opacity-100 ring-2 ring-white/30'
                : selectedCount > 0
                  ? 'bg-black/50 text-white/90 hover:bg-black/80 scale-95 opacity-90 hover:scale-100'
                  : 'bg-black/40 text-white hover:bg-black/70 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 scale-90 hover:scale-100'
            }`}
            aria-label={`Select ${item.name}`}
          >
            <Check size={13} strokeWidth={3} />
          </button>

          <div
            className="absolute top-2 right-2 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-xs p-1 rounded-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStartChatWithItem(item);
              }}
              title={t('libraryStartChat')}
              aria-label={t('libraryStartChat')}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors"
            >
              <MessageSquarePlus size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPreviewItem(item);
              }}
              title={t('libraryPreview')}
              aria-label={t('libraryPreview')}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors"
            >
              <Eye size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDownloadItem(item);
              }}
              title={t('libraryDownload')}
              aria-label={t('libraryDownload')}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors"
            >
              <Download size={14} strokeWidth={2} />
            </button>
            {item.fileApiName && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCopyApiName(item.fileApiName!, item.id);
                }}
                title={isCopied ? t('selectedFileIdCopied') : t('selectedFileCopyFileId')}
                aria-label={isCopied ? t('selectedFileIdCopied') : t('selectedFileCopyFileId')}
                className={`p-1 rounded-lg transition-colors ${
                  isCopied ? 'text-green-400' : 'text-white/80 hover:text-white hover:bg-white/20'
                }`}
              >
                {isCopied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
              </button>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteItem(item);
              }}
              title={t('libraryDelete')}
              aria-label={t('libraryDelete')}
              className="p-1 rounded-lg text-red-400 hover:text-red-300 hover:bg-white/20 transition-colors"
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="p-3 sm:p-3.5 flex flex-col justify-between flex-1">
          <div className="flex items-center justify-between gap-1 mb-1">
            <h4 className="text-sm font-medium text-[var(--theme-text-primary)] truncate" title={item.name}>
              {item.name}
            </h4>
            {item.fileApiName && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--theme-text-link)]/10 text-[var(--theme-text-link)] border border-[var(--theme-text-link)]/20 shrink-0"
                title={`Files API: ${item.fileApiName}`}
              >
                Files API
              </span>
            )}
          </div>

          {item.sessionTitle && (
            <div
              role={onJumpToSession && item.sessionId ? 'button' : undefined}
              tabIndex={onJumpToSession && item.sessionId ? 0 : undefined}
              className={`text-xs text-[var(--theme-text-tertiary)] truncate mb-1 ${
                onJumpToSession && item.sessionId
                  ? 'hover:text-[var(--theme-accent)] hover:underline cursor-pointer focus:outline-none focus-visible:underline'
                  : ''
              }`}
              title={item.sessionTitle}
              onClick={(event) => {
                if (onJumpToSession && item.sessionId) {
                  event.stopPropagation();
                  onJumpToSession(item.sessionId);
                }
              }}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && onJumpToSession && item.sessionId) {
                  event.stopPropagation();
                  event.preventDefault();
                  onJumpToSession(item.sessionId);
                }
              }}
            >
              {interpolate(t('libraryFromSession'), { title: item.sessionTitle })}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-[var(--theme-text-tertiary)] mt-auto pt-1 border-t border-[var(--theme-border-secondary)]/40">
            <span>{formatLibraryDate(item.timestamp, language)}</span>
            <span>{formatFileSize(item.size)}</span>
          </div>
        </div>
      </div>
    );
  },
);

LibraryGridCard.displayName = 'LibraryGridCard';

export const LibraryGridView: React.FC<LibraryGridViewProps> = ({
  items,
  onPreviewItem,
  onStartChatWithItem,
  onDownloadItem,
  onDeleteItem,
  onJumpToSession,
  onToggleSelect,
}) => {
  const { t, language } = useI18n();
  const selectedFileIds = useLibraryStore((state) => state.selectedFileIds);
  const storeToggleSelect = useLibraryStore((state) => state.toggleSelectFile);
  const toggleSelect = onToggleSelect ?? storeToggleSelect;
  const selectedCount = selectedFileIds.size;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyApiName = React.useCallback((name: string, id: string) => {
    void copyTextToClipboard(name).then((ok) => {
      if (ok) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    });
  }, []);

  return (
    <div className="p-4 sm:p-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
        {items.map((item) => (
          <LibraryGridCard
            key={item.id}
            item={item}
            isSelected={selectedFileIds.has(item.id)}
            selectedCount={selectedCount}
            language={language}
            isCopied={copiedId === item.id}
            onPreviewItem={onPreviewItem}
            onStartChatWithItem={onStartChatWithItem}
            onDownloadItem={onDownloadItem}
            onDeleteItem={onDeleteItem}
            onJumpToSession={onJumpToSession}
            onToggleSelect={toggleSelect}
            onCopyApiName={handleCopyApiName}
            t={t}
          />
        ))}
      </div>
    </div>
  );
};
