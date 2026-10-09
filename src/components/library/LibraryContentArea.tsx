import React from 'react';
import type { LibraryItem } from '@/types';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryListView } from './LibraryListView';
import { LibraryGridView } from './LibraryGridView';

interface LibraryContentAreaProps {
  filteredItems: LibraryItem[];
  viewMode: 'grid' | 'list';
  isFiltered: boolean;
  onClearFilters: () => void;
  onUploadClick: () => void;
  onPreviewItem: (item: LibraryItem) => void;
  onStartChatWithItem: (item: LibraryItem) => void;
  onDownloadItem: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onJumpToSession: (sessionId: string) => void;
  onToggleSelect?: (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void;
}

export const LibraryContentArea: React.FC<LibraryContentAreaProps> = ({
  filteredItems,
  viewMode,
  isFiltered,
  onClearFilters,
  onUploadClick,
  onPreviewItem,
  onStartChatWithItem,
  onDownloadItem,
  onDeleteItem,
  onJumpToSession,
  onToggleSelect,
}) => {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {filteredItems.length === 0 ? (
        <LibraryEmptyState isFiltered={isFiltered} onClearFilters={onClearFilters} onUploadClick={onUploadClick} />
      ) : viewMode === 'list' ? (
        <LibraryListView
          items={filteredItems}
          onPreviewItem={onPreviewItem}
          onStartChatWithItem={onStartChatWithItem}
          onDownloadItem={onDownloadItem}
          onDeleteItem={onDeleteItem}
          onJumpToSession={onJumpToSession}
          onToggleSelect={onToggleSelect}
        />
      ) : (
        <LibraryGridView
          items={filteredItems}
          onPreviewItem={onPreviewItem}
          onStartChatWithItem={onStartChatWithItem}
          onDownloadItem={onDownloadItem}
          onDeleteItem={onDeleteItem}
          onJumpToSession={onJumpToSession}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
};
