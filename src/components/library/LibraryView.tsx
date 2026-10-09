import React from 'react';
import type { UploadedFile } from '@/types';
import { LibraryHeader } from './LibraryHeader';
import { LibraryToolbar } from './LibraryToolbar';
import { LibraryDropOverlay } from './LibraryDropOverlay';
import { LibraryContentArea } from './LibraryContentArea';
import { LibraryModals } from './LibraryModals';
import { useLibraryViewLogic } from './useLibraryViewLogic';

interface LibraryViewProps {
  onNewChat?: (initialFiles?: UploadedFile[]) => void;
  onSelectSession?: (sessionId: string) => void;
  onClose?: () => void;
  themeId?: string;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  onNewChat,
  onSelectSession,
  onClose,
  themeId = 'default',
}) => {
  const {
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
  } = useLibraryViewLogic({ onNewChat, onSelectSession });

  return (
    <div
      className="flex flex-col flex-1 h-full w-full overflow-hidden bg-[var(--theme-bg-primary)] relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <LibraryDropOverlay isDraggingOver={isDraggingOver} />

      <LibraryHeader onUploadFiles={handleUploadFiles} onCreateNote={() => setShowCreateNote(true)} onClose={onClose} />

      <LibraryToolbar
        selectedCount={selectedFileIds.size}
        totalCount={filteredItems.length}
        onStartChat={handleStartChatWithSelected}
        onDownloadSelected={handleDownloadSelected}
        onDeleteSelected={handleDeleteSelected}
        onSelectAll={handleSelectAll}
        onInvertSelection={handleInvertSelection}
      />

      <LibraryContentArea
        filteredItems={filteredItems}
        viewMode={viewMode}
        isFiltered={isFiltered}
        onClearFilters={handleClearFilters}
        onUploadClick={() => fileInputRef.current?.click()}
        onPreviewItem={handlePreviewItem}
        onStartChatWithItem={(item) => handleStartChatWithItems([item])}
        onDownloadItem={handleDownloadItem}
        onDeleteItem={handleDeleteItem}
        onJumpToSession={handleJumpToSession}
        onToggleSelect={handleToggleSelect}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            void handleUploadFiles(Array.from(event.target.files));
            event.target.value = '';
          }
        }}
        className="hidden"
        data-testid="library-empty-file-input"
      />

      <LibraryModals
        previewFile={previewFile}
        onClosePreview={handleClosePreview}
        onPrevPreview={handlePrevPreview}
        onNextPreview={handleNextPreview}
        hasPrevPreview={hasPrevPreview}
        hasNextPreview={hasNextPreview}
        deleteConfirmTarget={deleteConfirmTarget}
        onCloseDeleteConfirm={() => setDeleteConfirmTarget(null)}
        onConfirmDelete={handleConfirmDelete}
        showCreateNote={showCreateNote}
        onCloseCreateNote={() => setShowCreateNote(false)}
        onSaveNote={handleSaveNote}
        themeId={themeId}
      />
    </div>
  );
};
