export type LiveUiHtmlNormalizerOptions = {
  isStreaming?: boolean;
};

/**
 * Normalizes Graphviz DOT source inside declarative Live UI attributes:
 * 1. Converts single-quoted DOT attributes (e.g. `label='...'` or `[label=\'...\']`)
 *    into double-quoted attributes (`label="..."`) which Graphviz WASM expects.
 * 2. Escapes raw inner single quotes (`'`) and `\'` inside strings or HTML-like labels
 *    to `&#39;` so the containing HTML attribute value does not terminate prematurely
 *    in browser DOMParser. The browser DOM automatically decodes `&#39;` back to `'`
 *    when reading `node.getAttribute('data-amc-graphviz')`.
 */
export const normalizeDotSource = (dot: string): string => {
  if (!dot) return dot;

  // Convert single-quoted DOT attributes (label='...', label=\'...\')
  // or outer-escaped attributes (label=\"...\") to standard double-quoted attributes: label="..."
  const normalized = dot.replace(
    /\b([a-zA-Z0-9_]+)\s*=\s*(?:'|\\'|\\")([\s\S]*?)(?:'|\\'|\\")(?=\s*[\],;\s\n])/g,
    (_match, attr, content) => {
      // Unescape escaped single quotes and outer double quotes, then escape unescaped double quotes inside content
      const safeContent = content
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/"/g, '\\"');
      return `${attr}="${safeContent}"`;
    },
  );

  let result = '';
  let inDoubleQuote = false;
  let inHtmlLabel = false;
  let htmlLabelDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const nextChar = i + 1 < normalized.length ? normalized[i + 1] : '';

    if (inLineComment) {
      result += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === '*' && nextChar === '/') {
        result += nextChar;
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (char === '\\') {
      const escaped = nextChar;
      if (inDoubleQuote) {
        if (escaped === "'") {
          result += '&#39;';
          i++;
          continue;
        }
        if (escaped === '"') {
          result += '\\"';
          i++;
          continue;
        }
      }
      if (escaped === "'") {
        result += '&#39;';
        i++;
        continue;
      }
      result += char + escaped;
      i++;
      continue;
    }

    if (!inDoubleQuote && !inHtmlLabel) {
      if (char === '/' && nextChar === '/') {
        inLineComment = true;
        result += '//';
        i++;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        result += '/*';
        i++;
        continue;
      }
      if (char === '#') {
        inLineComment = true;
        result += '#';
        continue;
      }
      if (char === '<' && !/^[0-9]/.test(nextChar)) {
        inHtmlLabel = true;
        htmlLabelDepth = 1;
        result += char;
        continue;
      }
    }

    if (inHtmlLabel) {
      if (char === '<') htmlLabelDepth++;
      else if (char === '>') {
        htmlLabelDepth--;
        if (htmlLabelDepth <= 0) inHtmlLabel = false;
      }
      if (char === "'" || (char === '\\' && nextChar === "'")) {
        result += '&#39;';
        if (char === '\\') i++;
        continue;
      }
      result += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (inDoubleQuote) {
      if (char === "'") {
        result += '&#39;';
        continue;
      }
      result += char;
      continue;
    }

    // Outside double quotes, if a single quote appears, escape it
    if (char === "'") {
      result += '&#39;';
      continue;
    }

    result += char;
  }

  return result;
};

/**
 * Normalizes JSON string attributes (chart, echarts, followup) by escaping raw `'`
 * or `\'` inside JSON string values to `&#39;`.
 */
export const normalizeJsonSource = (json: string): string => {
  if (!json) return json;

  let result = '';
  let inString = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    const nextChar = i + 1 < json.length ? json[i + 1] : '';

    if (char === '\\') {
      if (inString && nextChar === "'") {
        result += '&#39;';
        i++;
        continue;
      }
      result += char + nextChar;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && char === "'") {
      result += '&#39;';
      continue;
    }

    result += char;
  }

  return result;
};

/**
 * Normalizes Live UI HTML for both static preview and streaming typewriter modes:
 *
 * 1. Declarative Attributes (data-amc-graphviz, data-amc-chart, data-amc-echarts, data-amc-followup):
 *    - Uses outer single quotes with inner apostrophes escaped to `&#39;`.
 *    - Replaces single-quoted DOT labels with double-quoted DOT labels.
 * 2. Streaming Auto-Closure (options.isStreaming = true):
 *    - When an incomplete `<div data-amc-graphviz='digraph { ...` is streaming (even with `->` arrows),
 *      safely auto-closes with `'></div>'` so DOMParser keeps the node in the DOM tree and activates
 *      the smooth pending spinner (`amc-gv-spin`).
 *    - Strips dangling non-declarative tag openers at EOF (e.g. `<div style="display:`).
 */
export const normalizeLiveUiHtmlForPreview = (html: string, options: LiveUiHtmlNormalizerOptions = {}): string => {
  if (!html || typeof html !== 'string') return html;

  const isStreaming = Boolean(options.isStreaming);
  let result = '';
  let lastIndex = 0;

  const attrRegex = /(<[a-zA-Z0-9_-]+[^>]*?\b(data-amc-(?:graphviz|chart|echarts|followup))\s*=\s*)(['"])/g;

  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(html)) !== null) {
    const fullMatchPrefix = match[1];
    const attrName = match[2];
    const openQuote = match[3];
    const matchIndex = match.index;
    const attrStartIndex = matchIndex + match[0].length;

    result += html.slice(lastIndex, matchIndex);

    let isComplete = false;
    let attrContentEnd = -1;
    let afterClosingQuoteIndex = -1;

    if (attrName === 'data-amc-graphviz') {
      let braceCount = 0;
      let hasBraces = false;
      let inDoubleQuote = false;
      let inLineComment = false;
      let inBlockComment = false;
      let inHtmlLabel = false;
      let htmlLabelDepth = 0;

      for (let i = attrStartIndex; i < html.length; i++) {
        const char = html[i];
        const nextChar = i + 1 < html.length ? html[i + 1] : '';

        if (inLineComment) {
          if (char === '\n') inLineComment = false;
          continue;
        }

        if (inBlockComment) {
          if (char === '*' && nextChar === '/') {
            inBlockComment = false;
            i++;
          }
          continue;
        }

        if (char === '\\') {
          i++;
          continue;
        }

        if (!inDoubleQuote && !inHtmlLabel) {
          if (char === '/' && nextChar === '/') {
            inLineComment = true;
            i++;
            continue;
          }
          if (char === '/' && nextChar === '*') {
            inBlockComment = true;
            i++;
            continue;
          }
          if (char === '#') {
            inLineComment = true;
            continue;
          }
          if (char === '<' && !/^[0-9]/.test(nextChar)) {
            inHtmlLabel = true;
            htmlLabelDepth = 1;
            continue;
          }
        }

        if (inHtmlLabel) {
          if (char === '<') htmlLabelDepth++;
          else if (char === '>') {
            htmlLabelDepth--;
            if (htmlLabelDepth <= 0) inHtmlLabel = false;
          }
          continue;
        }

        // When DOT is structurally complete (balanced braces)
        if (hasBraces && braceCount === 0 && !inDoubleQuote && !inBlockComment && !inLineComment) {
          if (char === openQuote) {
            isComplete = true;
            attrContentEnd = i;
            afterClosingQuoteIndex = i + 1;
            break;
          }
        }

        if (char === '"') {
          inDoubleQuote = !inDoubleQuote;
          continue;
        }

        if (!inDoubleQuote) {
          if (char === '{') {
            braceCount++;
            hasBraces = true;
          } else if (char === '}') {
            braceCount--;
          }
        }
      }
    } else {
      // JSON attributes
      let braceCount = 0;
      let bracketCount = 0;
      let hasStarted = false;
      let inDoubleQuote = false;

      for (let i = attrStartIndex; i < html.length; i++) {
        const char = html[i];

        if (char === '\\') {
          i++;
          continue;
        }

        if (hasStarted && braceCount === 0 && bracketCount === 0 && !inDoubleQuote) {
          if (char === openQuote) {
            isComplete = true;
            attrContentEnd = i;
            afterClosingQuoteIndex = i + 1;
            break;
          }
        }

        if (char === '"') {
          inDoubleQuote = !inDoubleQuote;
          continue;
        }

        if (!inDoubleQuote) {
          if (char === '{') {
            braceCount++;
            hasStarted = true;
          } else if (char === '}') {
            braceCount--;
          } else if (char === '[') {
            bracketCount++;
            hasStarted = true;
          } else if (char === ']') {
            bracketCount--;
          }
        }
      }
    }

    if (isComplete && attrContentEnd !== -1) {
      const rawContent = html.slice(attrStartIndex, attrContentEnd);
      const normalizedContent =
        attrName === 'data-amc-graphviz' ? normalizeDotSource(rawContent) : normalizeJsonSource(rawContent);

      // Normalize outer delimiter to single quotes with properly escaped inner quotes
      result += `${fullMatchPrefix}'${normalizedContent}'`;
      lastIndex = afterClosingQuoteIndex;
      attrRegex.lastIndex = lastIndex;
    } else {
      // Incomplete attribute
      const rawContent = html.slice(attrStartIndex);
      const normalizedContent =
        attrName === 'data-amc-graphviz' ? normalizeDotSource(rawContent) : normalizeJsonSource(rawContent);

      if (isStreaming) {
        // Safely auto-close streaming tag
        result += `${fullMatchPrefix}'${normalizedContent}'></div>`;
        lastIndex = html.length;
        attrRegex.lastIndex = html.length;
      } else {
        result += fullMatchPrefix + openQuote + rawContent;
        lastIndex = html.length;
      }
      break;
    }
  }

  if (lastIndex < html.length) {
    let remaining = html.slice(lastIndex);
    if (isStreaming) {
      remaining = remaining.replace(/<[a-zA-Z][^>]*$/, '');
    }
    result += remaining;
  }

  return result;
};
