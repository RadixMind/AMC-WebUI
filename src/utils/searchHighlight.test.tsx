import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { extractSearchSnippet, SearchHighlight } from './searchHighlight';
import type { ChatMessage } from '@/types';

describe('extractSearchSnippet', () => {
  it('returns null if query is empty or no messages match', () => {
    const messages: ChatMessage[] = [{ id: '1', role: 'user', content: 'Hello world', timestamp: new Date() }];
    expect(extractSearchSnippet(messages, '')).toBeNull();
    expect(extractSearchSnippet(messages, '   ')).toBeNull();
    expect(extractSearchSnippet(messages, 'nonexistent')).toBeNull();
    expect(extractSearchSnippet([], 'hello')).toBeNull();
  });

  it('extracts snippet centered around matching keyword with ellipsis', () => {
    const content = 'The quick brown fox jumps over the lazy dog in a very long sentence with many words.';
    const messages: ChatMessage[] = [{ id: '1', role: 'user', content, timestamp: new Date() }];
    const snippet = extractSearchSnippet(messages, 'fox');
    expect(snippet).not.toBeNull();
    expect(snippet).toContain('fox');
    expect(snippet).toContain('The quick brown fox jumps');
  });

  it('adds ellipsis prefix when match is deep into content', () => {
    const prefix = 'A'.repeat(50);
    const content = `${prefix} specificKeyword and some more text following`;
    const messages: ChatMessage[] = [{ id: '1', role: 'user', content, timestamp: new Date() }];
    const snippet = extractSearchSnippet(messages, 'specificKeyword');
    expect(snippet).not.toBeNull();
    expect(snippet?.startsWith('…')).toBe(true);
    expect(snippet).toContain('specificKeyword');
  });

  it('safely handles regex special characters in query without crashing', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Price is $10.00 (discounted) [special]?', timestamp: new Date() },
    ];
    const snippet = extractSearchSnippet(messages, '$10.00 (discounted)');
    expect(snippet).not.toBeNull();
    expect(snippet).toContain('$10.00 (discounted)');
  });
});

describe('SearchHighlight', () => {
  it('renders unhighlighted text when query is empty', () => {
    render(<SearchHighlight text="Hello World" query="" />);
    expect(screen.getByText('Hello World')).not.toBeNull();
  });

  it('highlights matching substring case-insensitively with mark element', () => {
    render(<SearchHighlight text="Quick Brown Fox" query="brown" />);
    const mark = screen.getByText('Brown');
    expect(mark.tagName.toLowerCase()).toBe('mark');
  });

  it('handles regex characters like [ * + ? safely', () => {
    render(<SearchHighlight text="Result is [a+b]*2" query="[a+b]*2" />);
    const mark = screen.getByText('[a+b]*2');
    expect(mark.tagName.toLowerCase()).toBe('mark');
  });
});
