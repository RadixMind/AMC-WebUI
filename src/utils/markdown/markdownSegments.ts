/**
 * Represents a segmented chunk of markdown text.
 * - `literal`: Code blocks (fenced ``` or inline `) that should not undergo text transforms.
 * - `text`: Regular markdown text that can safely be transformed.
 */
export interface MarkdownSegment {
  type: 'text' | 'literal';
  value: string;
}

/**
 * Splits a markdown string into literal code segments (fenced code blocks and inline code)
 * and regular text segments.
 *
 * @param value The markdown string to segment.
 * @returns An array of MarkdownSegment objects preserving the original content order.
 */
export const splitMarkdownSegments = (value: string): MarkdownSegment[] => {
  if (!value) {
    return [];
  }

  const segments: MarkdownSegment[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    if (value.startsWith('```', cursor)) {
      const closingFenceIndex = value.indexOf('```', cursor + 3);

      if (closingFenceIndex === -1) {
        segments.push({ type: 'literal', value: value.slice(cursor) });
        break;
      }

      segments.push({
        type: 'literal',
        value: value.slice(cursor, closingFenceIndex + 3),
      });
      cursor = closingFenceIndex + 3;
      continue;
    }

    if (value[cursor] === '`') {
      let tickCount = 1;
      while (value[cursor + tickCount] === '`') {
        tickCount += 1;
      }

      const delimiter = '`'.repeat(tickCount);
      const closingInlineCodeIndex = value.indexOf(delimiter, cursor + tickCount);

      if (closingInlineCodeIndex === -1) {
        segments.push({ type: 'text', value: value.slice(cursor, cursor + tickCount) });
        cursor += tickCount;
        continue;
      }

      segments.push({
        type: 'literal',
        value: value.slice(cursor, closingInlineCodeIndex + tickCount),
      });
      cursor = closingInlineCodeIndex + tickCount;
      continue;
    }

    const nextCodeDelimiterIndex = value.indexOf('`', cursor);
    const nextCursor = nextCodeDelimiterIndex === -1 ? value.length : nextCodeDelimiterIndex;
    segments.push({ type: 'text', value: value.slice(cursor, nextCursor) });
    cursor = nextCursor;
  }

  return segments.filter((segment) => segment.value.length > 0);
};

/**
 * Split a value into literal (code) and text segments, then apply `transform`
 * only to the text segments, leaving fenced/code segments untouched. Used to
 * rewrite markdown (e.g. thinking-block markup, math normalization) without
 * corrupting code blocks.
 */
export const transformMarkdownTextSegments = (value: string, transform: (segment: string) => string): string =>
  splitMarkdownSegments(value)
    .map((segment) => (segment.type === 'literal' ? segment.value : transform(segment.value)))
    .join('');
