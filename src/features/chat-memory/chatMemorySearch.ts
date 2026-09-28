import type { SavedChatSession } from '@/types';
import { dbService } from '@/services/db/dbService';
import { useChatStore } from '@/stores/chatStore';

export interface ChatMemorySearchResult {
  sessionId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  snippet: string;
}

export interface ChatMemorySearchDeps {
  getAllSessions?: () => Promise<SavedChatSession[]>;
  getSession?: (id: string) => Promise<SavedChatSession | undefined>;
  getActiveSessionId?: () => string | null | undefined;
}

export const extractSnippet = (text: string, query: string, radius = 80): string => {
  if (!text || !query) return '';
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return '';

  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return '';

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + lowerQuery.length + radius);

  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
};

const formatDate = (dateVal: unknown): string => {
  if (!dateVal) return '未知时间';
  try {
    const parsedDate = new Date(dateVal as number | string | Date);
    return Number.isNaN(parsedDate.getTime()) ? String(dateVal) : parsedDate.toLocaleString();
  } catch {
    return String(dateVal);
  }
};

export const searchChatHistory = async (
  query: string,
  options: { limit?: number; excludeSessionId?: string } = {},
  deps: ChatMemorySearchDeps = {},
): Promise<ChatMemorySearchResult[]> => {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const limit = Math.min(Math.max(1, options.limit ?? 5), 10);
  const activeId =
    options.excludeSessionId ??
    (deps.getActiveSessionId ? deps.getActiveSessionId() : useChatStore.getState().activeSessionId);

  const fetcher = deps.getAllSessions ?? dbService.getAllSessions;
  const sessions = await fetcher();
  const lowerQuery = cleanQuery.toLowerCase();

  const matchedResults: ChatMemorySearchResult[] = [];

  for (const session of sessions) {
    if (activeId && session.id === activeId) {
      continue;
    }

    const title = session.title || '未命名会话';
    const titleMatch = title.toLowerCase().includes(lowerQuery);
    let matchedSnippet = '';

    if (titleMatch) {
      matchedSnippet = `[标题匹配] ${title}`;
    }

    if (session.messages && session.messages.length > 0) {
      for (const message of session.messages) {
        if (message.content && message.content.toLowerCase().includes(lowerQuery)) {
          const contentSnippet = extractSnippet(message.content, cleanQuery);
          if (contentSnippet) {
            matchedSnippet = matchedSnippet ? `${matchedSnippet}\n${contentSnippet}` : contentSnippet;
            break;
          }
        }
        if (message.thoughts && message.thoughts.toLowerCase().includes(lowerQuery)) {
          const thoughtsSnippet = extractSnippet(message.thoughts, cleanQuery);
          if (thoughtsSnippet) {
            matchedSnippet = matchedSnippet ? `${matchedSnippet}\n${thoughtsSnippet}` : thoughtsSnippet;
            break;
          }
        }
      }
    }

    if (titleMatch || matchedSnippet) {
      matchedResults.push({
        sessionId: session.id,
        title,
        updatedAt: formatDate(session.timestamp),
        messageCount: session.messages?.length || 0,
        snippet: matchedSnippet || `[匹配会话] ${title}`,
      });
    }
  }

  return matchedResults.slice(0, limit);
};

export const getChatDetail = async (
  sessionId: string,
  options: { maxMessages?: number } = {},
  deps: ChatMemorySearchDeps = {},
): Promise<{ found: boolean; text: string }> => {
  const cleanId = sessionId.trim();
  if (!cleanId) {
    return { found: false, text: '错误：未提供有效的 sessionId。' };
  }

  const maxMessages = Math.min(Math.max(1, options.maxMessages ?? 10), 30);
  const fetcher = deps.getSession ?? dbService.getSessionMetadataOnly;
  const session = await fetcher(cleanId);

  if (!session) {
    return { found: false, text: `未找到会话 ID 为 "${cleanId}" 的记录。` };
  }

  const title = session.title || '未命名会话';
  const formattedDate = formatDate(session.timestamp);
  const messages = session.messages || [];
  const recentMessages = messages.slice(-maxMessages);

  const lines: string[] = [
    `### 会话: ${title} (ID: ${cleanId})`,
    `> 更新时间: ${formattedDate} | 共 ${messages.length} 条消息 (展示最近 ${recentMessages.length} 条)`,
    '',
  ];

  for (const message of recentMessages) {
    const role = message.role || 'unknown';
    const content = (message.content || '').trim() || '(无文本内容)';
    lines.push(`**${role}**: ${content}`);
    lines.push('');
  }

  return {
    found: true,
    text: lines.join('\n').trim(),
  };
};
