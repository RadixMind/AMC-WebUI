import {
  FENCED_CODE_BLOCK_REGEX,
  getPreviewMarkupType,
  HTML_FRAGMENT_TAG_NAMES,
  isLikelyStreamingHtmlArtifact,
  isPromotableBareArtifact,
  isPromotableStreamingBareFragment,
  OPEN_FENCED_CODE_BLOCK_AT_END_REGEX,
  type PreviewMarkupType,
} from './previewMarkupPatterns';

export type LiveUiSegment = {
  html: string;
  markupType: PreviewMarkupType;
  suffix: string;
};

/**
 * Locates a self-contained HTML/SVG LiveUI element in the content, tolerating optional
 * trailing prose after `</html>` (comments are also tolerated by the whole-content
 * path via HTML_DOCUMENT_REGEX). Leading prose + a bare fragment is intentionally
 * NOT treated as an artifact here: inline "prose + HTML" is rendered as rich
 * markdown in the message DOM (with theme tokens available via the main-page
 * --amc-live-artifact-* variables), not promoted into a LiveUI frame.
 */
const extractLiveUiSegment = (textContent: string, isStreaming: boolean): LiveUiSegment | null => {
  const trimmed = textContent.trim();
  if (!trimmed) {
    return null;
  }

  const wholeMarkupType =
    getPreviewMarkupType(trimmed) || (isStreaming && isLikelyStreamingHtmlArtifact(trimmed) ? 'html' : null);
  if (wholeMarkupType) {
    return { html: trimmed, markupType: wholeMarkupType, suffix: '' };
  }

  // A full document that only carries trailing prose after </html>: split the
  // artifact off so it still renders as a Live Artifact instead of degrading to
  // colorless raw HTML. The document regex already handles trailing comments.
  // The trimmed content starts with the document (there is no leading prose to
  // skip in this path), so the artifact is everything up to and including
  // `</html>`.
  if (!/^(\s*)(?:<!doctype\s+html\b[^>]*>\s*)?<html\b[^>]*>/i.test(trimmed)) {
    return null;
  }

  const htmlCloseIndex = trimmed.lastIndexOf('</html>');
  if (htmlCloseIndex === -1) {
    return null;
  }

  const doc = trimmed.slice(0, htmlCloseIndex + '</html>'.length);
  const docType = getPreviewMarkupType(doc);
  if (!docType) {
    return null;
  }

  const suffix = trimmed.slice(htmlCloseIndex + '</html>'.length).trim();
  return { html: doc, markupType: docType, suffix };
};

export const extractArtifactSegment = extractLiveUiSegment;

/**
 * A model reply is often prose PLUS a bare artifact (`引导语 + <div …>`), not a
 * single artifact. `extractArtifactSegment` only fires when the artifact is the
 * whole message (optionally with trailing prose after a full `</html>`), so a
 * fragment preceded by a sentence used to fall through to the Markdown
 * renderer and surface as escaped source text in the bubble.
 *
 * This finds the outermost bare artifact region anywhere in the reply so the
 * surrounding prose can be preserved verbatim. Three rules keep it safe:
 *
 * 1. Fenced regions are never considered. A fenced block is author intent —
 *    either a real artifact fence or a deliberate source example — and must
 *    not be re-wrapped or nested.
 * 2. Only strong LA signals qualify: a complete HTML document/SVG, or a
 *    `--amc-live-artifact-*` / `data-amc-*` marker. A marker-less bare fragment
 *    stays as-is to match `shouldUnwrapMislabeledHtmlFence`, which cannot
 *    distinguish "mislabeled LA" from "intentionally showing markup".
 * 3. The artifact must be separated from the prose by a blank line. Inline
 *    "prose + HTML" (`已为你生成：\n<section>…`) is deliberately rendered as
 *    rich markdown in the message flow, not promoted into an artifact frame.
 */
const BARE_ARTIFACT_OPENER_REGEX = new RegExp(
  `^(?:<!doctype\\s+html\\b[^>]*>|<html\\b|<(?:${HTML_FRAGMENT_TAG_NAMES})(?:\\s[^>]*)?>)`,
  'i',
);

/** A region is only a candidate when a blank line precedes it. */
const BLANK_LINE_BEFORE_REGEX = /\n[ \t]*\n[ \t]*$/;

/** Offsets of every fenced code region, so bare-artifact scanning can skip them. */
const getFencedRegionOffsets = (text: string): Array<{ start: number; end: number }> => {
  const regions: Array<{ start: number; end: number }> = [];
  const regex = new RegExp(FENCED_CODE_BLOCK_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length });
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  // An unclosed fence opened at the end swallows the rest of the reply.
  const openMatch = text.match(OPEN_FENCED_CODE_BLOCK_AT_END_REGEX);
  if (openMatch && openMatch.index !== undefined) {
    const alreadyCovered = regions.some(
      (region) => openMatch.index !== undefined && openMatch.index >= region.start && openMatch.index < region.end,
    );
    if (!alreadyCovered) {
      regions.push({ start: openMatch.index, end: text.length });
    }
  }

  return regions;
};

const isInsideFencedRegion = (offset: number, regions: Array<{ start: number; end: number }>): boolean =>
  regions.some((region) => offset >= region.start && offset < region.end);

const VOID_HTML_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Parses balanced HTML tags starting at `startIndex` to find the exact end of an
 * HTML fragment. When tag depth returns to 0 and is followed by prose (or EOF),
 * this returns the offset immediately after the last closed element.
 */
const findHtmlFragmentEnd = (text: string, startIndex: number): number | null => {
  const stack: string[] = [];
  let charIndex = startIndex;
  let lastValidEnd: number | null = null;
  const textLength = text.length;

  while (charIndex < textLength) {
    if (stack.length === 0 && lastValidEnd !== null) {
      let nextCharIndex = charIndex;
      while (nextCharIndex < textLength && /\s/.test(text[nextCharIndex])) {
        nextCharIndex += 1;
      }
      if (nextCharIndex >= textLength) {
        return lastValidEnd;
      }
      // If the next non-whitespace character does not start an HTML tag or comment, stop.
      if (text[nextCharIndex] !== '<' || text.startsWith('```', nextCharIndex)) {
        return lastValidEnd;
      }
      charIndex = nextCharIndex;
    }

    if (text.startsWith('<!--', charIndex)) {
      const commentEnd = text.indexOf('-->', charIndex + 4);
      if (commentEnd === -1) {
        break;
      }
      charIndex = commentEnd + 3;
      if (stack.length === 0) {
        lastValidEnd = charIndex;
      }
      continue;
    }

    const tagStartMatch = text.slice(charIndex).match(/^<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (tagStartMatch) {
      const isClosing = Boolean(tagStartMatch[1]);
      const tagName = tagStartMatch[2].toLowerCase();

      let tagClosingBracketIndex = -1;
      let quote: string | null = null;
      let searchIndex = charIndex + 1;
      while (searchIndex < textLength) {
        const character = text[searchIndex];
        if (quote) {
          if (character === quote) {
            quote = null;
          }
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === '>') {
          tagClosingBracketIndex = searchIndex;
          break;
        }
        searchIndex += 1;
      }

      if (tagClosingBracketIndex === -1) {
        break;
      }

      const tagContent = text.slice(charIndex + 1, tagClosingBracketIndex).trim();
      const isSelfClosing = tagContent.endsWith('/');

      if (tagName === 'script' || tagName === 'style') {
        const closeTag = `</${tagName}>`;
        const closeIndex = text.toLowerCase().indexOf(closeTag, tagClosingBracketIndex + 1);
        if (closeIndex !== -1) {
          charIndex = closeIndex + closeTag.length;
          if (stack.length === 0) {
            lastValidEnd = charIndex;
          }
          continue;
        }
      }

      if (isClosing) {
        if (stack.length > 0 && stack[stack.length - 1] === tagName) {
          stack.pop();
        } else {
          const lastTagIndex = stack.lastIndexOf(tagName);
          if (lastTagIndex !== -1) {
            stack.length = lastTagIndex;
          }
        }
      } else if (!isSelfClosing && !VOID_HTML_ELEMENTS.has(tagName)) {
        stack.push(tagName);
      }

      if (stack.length === 0) {
        lastValidEnd = tagClosingBracketIndex + 1;
      }

      charIndex = tagClosingBracketIndex + 1;
      continue;
    }

    if (stack.length === 0 && /\S/.test(text[charIndex])) {
      if (lastValidEnd !== null) {
        return lastValidEnd;
      }
      return null;
    }

    charIndex += 1;
  }

  if (stack.length === 0 && lastValidEnd !== null) {
    return lastValidEnd;
  }

  return null;
};

const findBareLiveUiRegion = (text: string, isStreaming = false): { start: number; end: number } | null => {
  const lines = text.split('\n');
  const fencedRegions = getFencedRegionOffsets(text);
  // Absolute offset of each line so a matched region can be spliced back into
  // the original string without re-normalizing the prose around it.
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  for (let candidateLineIndex = 0; candidateLineIndex < lines.length; candidateLineIndex += 1) {
    const line = lines[candidateLineIndex];
    const lineStart = lineOffsets[candidateLineIndex];

    if (isInsideFencedRegion(lineStart, fencedRegions)) {
      continue;
    }

    if (!BARE_ARTIFACT_OPENER_REGEX.test(line.trimStart())) {
      continue;
    }

    const leadingWhitespace = line.length - line.trimStart().length;
    const candidateStart = lineStart + leadingWhitespace;

    // Rule 3: the artifact must be set off from preceding prose by a blank line
    // (or be the whole reply). Otherwise it is inline prose+HTML and stays as
    // rich markdown in the message flow.
    const precedingText = text.slice(0, candidateStart);
    if (precedingText.trim() !== '' && !BLANK_LINE_BEFORE_REGEX.test(precedingText)) {
      continue;
    }

    // Rule 1: a fence that opens after the candidate swallows everything that
    // follows it, so nothing at or past that fence can be part of the artifact.
    const followingFenceStart = fencedRegions
      .filter((region) => region.start > candidateStart)
      .reduce((min, region) => Math.min(min, region.start), Number.POSITIVE_INFINITY);

    // 1. Try finding complete HTML document
    const candidateText = text.slice(candidateStart);
    if (/^(?:<!doctype\s+html\b[^>]*>\s*)?<html\b/i.test(candidateText)) {
      const closeIndex = candidateText.toLowerCase().indexOf('</html>');
      if (closeIndex !== -1) {
        let end = candidateStart + closeIndex + '</html>'.length;
        const trailingCommentMatch = text.slice(end).match(/^\s*(?:<!--[\s\S]*?-->\s*)*/);
        if (trailingCommentMatch) {
          end += trailingCommentMatch[0].trimEnd().length;
        }
        if (!Number.isFinite(followingFenceStart) || end <= followingFenceStart) {
          const candidate = text.slice(candidateStart, end);
          if (isPromotableBareArtifact(candidate)) {
            return { start: candidateStart, end };
          }
        }
      } else if (isStreaming && (!Number.isFinite(followingFenceStart) || text.length <= followingFenceStart)) {
        return { start: candidateStart, end: text.length };
      }
    }

    // 2. Try finding complete SVG
    if (/^<svg\b/i.test(candidateText)) {
      const closeIndex = candidateText.toLowerCase().indexOf('</svg>');
      if (closeIndex !== -1) {
        const end = candidateStart + closeIndex + '</svg>'.length;
        if (!Number.isFinite(followingFenceStart) || end <= followingFenceStart) {
          const candidate = text.slice(candidateStart, end);
          if (isPromotableBareArtifact(candidate)) {
            return { start: candidateStart, end };
          }
        }
      } else if (isStreaming && (!Number.isFinite(followingFenceStart) || text.length <= followingFenceStart)) {
        return { start: candidateStart, end: text.length };
      }
    }

    // 3. Try finding HTML fragment via balanced tag parsing
    const fragmentEnd = findHtmlFragmentEnd(text, candidateStart);
    if (fragmentEnd !== null) {
      if (!Number.isFinite(followingFenceStart) || fragmentEnd <= followingFenceStart) {
        const candidate = text.slice(candidateStart, fragmentEnd);
        if (isPromotableBareArtifact(candidate)) {
          return { start: candidateStart, end: fragmentEnd };
        }
      }
    } else if (isStreaming && isPromotableStreamingBareFragment(candidateText)) {
      if (!Number.isFinite(followingFenceStart) || text.length <= followingFenceStart) {
        return { start: candidateStart, end: text.length };
      }
    }

    // 4. Fallback line-by-line check (bounded by the first prose block after candidate)
    let maxLineIndex = lines.length - 1;
    for (let searchIndex = candidateLineIndex + 1; searchIndex < lines.length; searchIndex += 1) {
      const prevLine = lines[searchIndex - 1];
      const curLine = lines[searchIndex];
      if (prevLine.trim() === '' && curLine.trim() !== '' && !curLine.trimStart().startsWith('<')) {
        maxLineIndex = searchIndex - 1;
        break;
      }
    }

    for (let fallbackLineIndex = maxLineIndex; fallbackLineIndex >= candidateLineIndex; fallbackLineIndex -= 1) {
      const end = fallbackLineIndex === lines.length - 1 ? text.length : lineOffsets[fallbackLineIndex + 1] - 1;
      if (end <= candidateStart) {
        continue;
      }
      if (Number.isFinite(followingFenceStart) && end > followingFenceStart) {
        continue;
      }

      const candidate = text.slice(candidateStart, end);
      if (isPromotableBareArtifact(candidate)) {
        return { start: candidateStart, end };
      }
    }
  }

  return null;
};

export const findBareArtifactRegion = findBareLiveUiRegion;
