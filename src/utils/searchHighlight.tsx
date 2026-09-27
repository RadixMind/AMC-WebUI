import React from 'react';
import type { ChatMessage } from '@/types';

/**
 * Escape regex special characters so user search queries can be safely passed to RegExp.
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search through conversation messages to extract a compact excerpt around the query keyword.
 * Returns null if no match found.
 */
export function extractSearchSnippet(messages: ChatMessage[], query: string, maxLen: number = 70): string | null {
  const trimmed = query?.trim();
  if (!trimmed || !messages || messages.length === 0) {
    return null;
  }

  const lowerQuery = trimmed.toLowerCase();

  for (const message of messages) {
    const rawContent = message?.content;
    if (!rawContent || typeof rawContent !== 'string') continue;

    // Normalize whitespace and newlines for a one-line preview
    const cleanContent = rawContent.replace(/\s+/g, ' ').trim();
    const lowerContent = cleanContent.toLowerCase();
    const matchIndex = lowerContent.indexOf(lowerQuery);

    if (matchIndex !== -1) {
      const matchLength = trimmed.length;
      const contextChars = Math.max(15, Math.floor((maxLen - matchLength) / 2));

      const startIndex = Math.max(0, matchIndex - contextChars);
      const endIndex = Math.min(cleanContent.length, matchIndex + matchLength + contextChars);

      let excerpt = cleanContent.slice(startIndex, endIndex);

      if (startIndex > 0) {
        excerpt = `…${excerpt}`;
      }
      if (endIndex < cleanContent.length) {
        excerpt = `${excerpt}…`;
      }

      return excerpt;
    }
  }

  return null;
}

export interface SearchHighlightProps {
  text: string;
  query: string;
  className?: string;
  highlightClassName?: string;
}

/**
 * Renders text with matching query portions highlighted using <mark>.
 */
export const SearchHighlight: React.FC<SearchHighlightProps> = ({
  text,
  query,
  className = '',
  highlightClassName = 'bg-[var(--theme-bg-accent)]/25 text-[var(--theme-text-primary)] font-semibold rounded px-0.5',
}) => {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery || !text) {
    return <span className={className}>{text}</span>;
  }

  const escaped = escapeRegExp(trimmedQuery);
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (part.toLowerCase() === trimmedQuery.toLowerCase()) {
          return (
            <mark key={index} className={highlightClassName}>
              {part}
            </mark>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </span>
  );
};
