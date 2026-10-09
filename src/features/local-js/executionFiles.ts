import type { ChatMessage } from '@/types';
import { collectActiveUserContextFiles } from '@/utils/chat/contextFiles';

/**
 * Collect text-based input files from previous user messages in the chat session
 * and format them into a dictionary of { [fileName]: fileContent } for the JS sandbox.
 */
export const collectLocalJsInputFiles = (messages: ChatMessage[], targetMessageId?: string): Record<string, string> => {
  const files = collectActiveUserContextFiles(
    messages,
    targetMessageId,
    (file) => typeof file.textContent === 'string',
  );
  const filesMap: Record<string, string> = {};

  for (const file of files) {
    if (typeof file.textContent === 'string') {
      filesMap[file.name] = file.textContent;
    }
  }

  return filesMap;
};
