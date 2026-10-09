import type { ChatMessage, UploadedFile } from '@/types';
import { isImageMimeType } from '@/utils/file/fileTypeClassification';
import { collectActiveUserContextFiles } from '@/utils/chat/contextFiles';

export const collectLocalPythonInputFiles = (messages: ChatMessage[], targetMessageId: string) => {
  const files = collectActiveUserContextFiles(messages, targetMessageId, (file) => Boolean(file.rawFile));
  const inputFiles = new Map<string, UploadedFile>();

  for (const file of files) {
    inputFiles.set(file.id, file);
  }

  return Array.from(inputFiles.values());
};

export const hasGeneratedImageFile = (files: Array<{ type: string }>) =>
  files.some((file) => isImageMimeType(file.type));
