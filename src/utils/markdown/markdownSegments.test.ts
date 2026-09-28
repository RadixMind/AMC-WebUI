import { describe, expect, it } from 'vitest';
import { splitMarkdownSegments, transformMarkdownTextSegments } from './markdownSegments';

describe('splitMarkdownSegments', () => {
  it('returns an empty array for empty or falsy strings', () => {
    expect(splitMarkdownSegments('')).toEqual([]);
  });

  it('splits markdown into transformable text and code literals', () => {
    expect(splitMarkdownSegments('Before `inline` middle ```ts\nconst x = 1;\n``` after')).toEqual([
      { type: 'text', value: 'Before ' },
      { type: 'literal', value: '`inline`' },
      { type: 'text', value: ' middle ' },
      { type: 'literal', value: '```ts\nconst x = 1;\n```' },
      { type: 'text', value: ' after' },
    ]);
  });

  it('handles unclosed fenced code blocks as literal segment', () => {
    expect(splitMarkdownSegments('Before ```ts\nconst x = 1;')).toEqual([
      { type: 'text', value: 'Before ' },
      { type: 'literal', value: '```ts\nconst x = 1;' },
    ]);
  });

  it('leaves unmatched inline ticks as transformable text', () => {
    expect(splitMarkdownSegments('Before `` unmatched')).toEqual([
      { type: 'text', value: 'Before ' },
      { type: 'text', value: '``' },
      { type: 'text', value: ' unmatched' },
    ]);
  });
});

describe('transformMarkdownTextSegments', () => {
  it('transforms only text segments while leaving code blocks intact', () => {
    const input = 'Hello `code` world ```ts\ncode block\n``` end';
    const result = transformMarkdownTextSegments(input, (text) => text.toUpperCase());
    expect(result).toBe('HELLO `code` WORLD ```ts\ncode block\n``` END');
  });
});
