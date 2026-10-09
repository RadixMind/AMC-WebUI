import type { ChatMessage, UploadedFile } from '@/types';

/**
 * Collects active, user-uploaded input files prior to a target message.
 * Filters out generated/edited files (e.g. `generated-*`, `edited-*`), errored files,
 * and inactive upload states.
 *
 * @param messages - Chat messages sequence
 * @param targetMessageId - Optional message ID to slice context up to (exclusive)
 * @param predicate - Optional filter for additional constraints (e.g. text content or rawFile presence)
 * @returns Array of active input files matching criteria
 */
export const collectActiveUserContextFiles = (
  messages: ChatMessage[],
  targetMessageId?: string,
  predicate?: (file: UploadedFile) => boolean,
): UploadedFile[] => {
  const targetIndex = targetMessageId ? messages.findIndex((m) => m.id === targetMessageId) : -1;
  const contextMessages = targetIndex === -1 ? messages : messages.slice(0, targetIndex);
  const result: UploadedFile[] = [];

  for (const message of contextMessages) {
    if (message.role !== 'user' || !message.files?.length) {
      continue;
    }

    for (const file of message.files) {
      const isGeneratedOutput = file.name.startsWith('generated-') || file.name.startsWith('edited-');
      const isActive = file.uploadState === undefined || file.uploadState === 'active';
      if (!isActive || file.error || isGeneratedOutput) {
        continue;
      }

      if (!predicate || predicate(file)) {
        result.push(file);
      }
    }
  }

  return result;
};
