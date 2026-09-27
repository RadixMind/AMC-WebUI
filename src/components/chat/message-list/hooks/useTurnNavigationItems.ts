import { useMemo } from 'react';
import type { ChatMessage } from '@/types';

const PROMPT_PREVIEW_LIMIT = 50;
const RESPONSE_PREVIEW_LIMIT = 120;

export interface TurnNavigationItem {
  readonly turn: number;
  readonly messageIndex: number;
  readonly messageId: string;
  readonly prompt: string;
  readonly response: string;
  readonly anchor?:
    { readonly kind: 'loaded'; readonly key?: string } | { readonly kind: 'unloaded'; readonly seq?: number };
}

function normalizeSnippet(text: string, maxLength: number = 140): string {
  if (!text) return '';
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, ' ')
    .replace(/```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^[ \t]*[#>*+-]+[ \t]*/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trimEnd()}…`;
}

export function extractTurnNavigationItems(messages: readonly ChatMessage[]): TurnNavigationItem[] {
  const items: TurnNavigationItem[] = [];
  let currentItem: {
    turn: number;
    messageIndex: number;
    messageId: string;
    prompt: string;
    response: string;
    anchor: { kind: 'loaded'; key: string };
  } | null = null;
  let turnNumber = 0;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'user') {
      turnNumber += 1;
      currentItem = {
        turn: turnNumber,
        messageIndex: index,
        messageId: message.id,
        prompt: normalizeSnippet(message.content, PROMPT_PREVIEW_LIMIT),
        response: '',
        anchor: { kind: 'loaded', key: message.id },
      };
      items.push(currentItem);
    } else if (message.role === 'model' && currentItem !== null) {
      if (currentItem.response === '') {
        const text = message.content || message.thoughts || '';
        currentItem.response = normalizeSnippet(text, RESPONSE_PREVIEW_LIMIT);
      }
    }
  }

  return items;
}

export function useTurnNavigationItems(messages: readonly ChatMessage[]): TurnNavigationItem[] {
  return useMemo(() => extractTurnNavigationItems(messages), [messages]);
}
