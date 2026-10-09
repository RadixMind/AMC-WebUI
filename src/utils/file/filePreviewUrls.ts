import { createManagedObjectUrl, releaseManagedObjectUrl } from '@/services/objectUrlManager';

/**
 * Creates a managed blob URL from a File or Blob, registered in objectUrlManager.
 */
export const fileToBlobUrl = (file: File | Blob): string => {
  return createManagedObjectUrl(file);
};

/**
 * Revokes a managed blob preview URL if dataUrl is a blob URL.
 */
export const cleanupFilePreviewUrl = (file: { dataUrl?: string } | undefined) => {
  if (file?.dataUrl?.startsWith('blob:')) {
    releaseManagedObjectUrl(file.dataUrl);
  }
};

/**
 * Revokes the previous file's blob URL if it was replaced with a different URL.
 */
export const cleanupReplacedFilePreviewUrl = (
  previousFile: { dataUrl?: string } | undefined,
  nextFile: { dataUrl?: string } | undefined,
) => {
  if (previousFile?.dataUrl && previousFile.dataUrl !== nextFile?.dataUrl) {
    cleanupFilePreviewUrl(previousFile);
  }
};

/**
 * Revokes an array of file preview URLs in batch.
 */
export const cleanupFilePreviewUrls = (files: { dataUrl?: string }[] | undefined) => {
  files?.forEach(cleanupFilePreviewUrl);
};
