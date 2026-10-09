import React, { Suspense } from 'react';
import { useI18n } from '@/contexts/I18nContext';
import type { LibraryItem, UploadedFile } from '@/types';
import { FilePreviewModal } from '@/components/modals/FilePreviewModal';
import { ConfirmationModal } from '@/components/modals/ConfirmationModal';
import { lazyNamedComponent } from '@/utils/lazyNamedComponent';

const LazyCreateTextFileEditor = lazyNamedComponent(
  () => import('@/components/modals/create-file/CreateTextFileEditor'),
  'CreateTextFileEditor',
);

interface LibraryModalsProps {
  previewFile: UploadedFile | null;
  onClosePreview: () => void;
  onPrevPreview: () => void;
  onNextPreview: () => void;
  hasPrevPreview: boolean;
  hasNextPreview: boolean;
  deleteConfirmTarget: LibraryItem | 'selected' | null;
  onCloseDeleteConfirm: () => void;
  onConfirmDelete: () => void;
  showCreateNote: boolean;
  onCloseCreateNote: () => void;
  onSaveNote: (content: string | Blob, filename: string) => Promise<void>;
  themeId: string;
}

export const LibraryModals: React.FC<LibraryModalsProps> = ({
  previewFile,
  onClosePreview,
  onPrevPreview,
  onNextPreview,
  hasPrevPreview,
  hasNextPreview,
  deleteConfirmTarget,
  onCloseDeleteConfirm,
  onConfirmDelete,
  showCreateNote,
  onCloseCreateNote,
  onSaveNote,
  themeId,
}) => {
  const { t } = useI18n();

  return (
    <>
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={onClosePreview}
          onPrev={onPrevPreview}
          onNext={onNextPreview}
          hasPrev={hasPrevPreview}
          hasNext={hasNextPreview}
        />
      )}

      {deleteConfirmTarget && (
        <ConfirmationModal
          isOpen={Boolean(deleteConfirmTarget)}
          onClose={onCloseDeleteConfirm}
          onConfirm={onConfirmDelete}
          title={t('confirm')}
          message={t('libraryDeleteConfirm')}
          isDanger
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          confirmOnEnter
        />
      )}

      {showCreateNote && (
        <Suspense fallback={null}>
          <LazyCreateTextFileEditor
            onConfirm={onSaveNote}
            onCancel={onCloseCreateNote}
            isProcessing={false}
            isLoading={false}
            themeId={themeId}
          />
        </Suspense>
      )}
    </>
  );
};
