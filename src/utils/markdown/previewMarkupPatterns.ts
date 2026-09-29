export type PreviewMarkupType = 'html' | 'svg';

export const LIVE_ARTIFACT_HTML_LANGUAGE = 'amc-live-artifact-html';
export const LIVE_ARTIFACT_INTERACTION_LANGUAGE = 'amc-live-artifact-interaction';
const HTML_LANGUAGE_ALIASES = new Set(['html', 'htm']);
const SVG_LANGUAGE_ALIASES = new Set(['svg']);

// Trailing whitespace/comments after </html> are tolerated: models sometimes
// append a closing remark comment to a full document, and rejecting the whole
// document over it is why such replies fell back to colorless raw HTML. Trailing
// prose text is still rejected here (the segment extractor handles that case by
// splitting the artifact off from surrounding text instead).
const HTML_DOCUMENT_REGEX = /^(?:<!doctype\s+html\b[^>]*>\s*)?<html\b[\s\S]*<\/html>\s*(?:<!--[\s\S]*-->\s*)*$/i;
const HTML_DOCUMENT_START_REGEX = /^(?:<!doctype\s+html\b[^>]*>\s*)?(?:<html\b|<head\b|<body\b)/i;
const HTML_DOCTYPE_START_REGEX = /^<!doctype\s+html\b/i;
export const HTML_FRAGMENT_TAG_NAMES = [
  'article',
  'aside',
  'blockquote',
  'button',
  'caption',
  'details',
  'div',
  'figure',
  'figcaption',
  'footer',
  'form',
  'h[1-6]',
  'header',
  'label',
  'li',
  'main',
  'meter',
  'nav',
  'ol',
  'p',
  'progress',
  'section',
  'select',
  'span',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
].join('|');
const HTML_FRAGMENT_REGEX = new RegExp(`^<(${HTML_FRAGMENT_TAG_NAMES})(?:\\s[^>]*)?>[\\s\\S]*<\\/\\1>$`, 'i');
const HTML_FRAGMENT_CONTAINER_REGEX = new RegExp(
  `^<(?:${HTML_FRAGMENT_TAG_NAMES})(?:\\s[^>]*)?>[\\s\\S]*<\\/(?:${HTML_FRAGMENT_TAG_NAMES})>$`,
  'i',
);
const HTML_FRAGMENT_START_REGEX = new RegExp(
  `^(?:<!--[\\s\\S]*?-->\\s*)?<(?:${HTML_FRAGMENT_TAG_NAMES})(?:\\s[^>]*)?>`,
  'i',
);
export const HTML_STRUCTURAL_BLANK_LINE_REGEX = new RegExp(
  `\\n[ \\t]*\\n(?=[ \\t]*(?:<!--|<\\/?(?:${HTML_FRAGMENT_TAG_NAMES})(?:\\s|>|/)))`,
  'gi',
);
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;
// NOTE: Do not reject fragments that merely mention <script>/<iframe>/… in text.
// Models often document those tags inside Live Artifacts (e.g. "通过 <iframe> 嵌入"),
// and string-matching them used to drop the whole reply out of ArtifactFrame into a
// broken Markdown/HTML code-block view. Executable tags are still stripped by the
// preview sanitizer when the artifact actually renders.
const SVG_DOCUMENT_REGEX = /^<svg\b[\s\S]*<\/svg>$/i;
export const FENCED_CODE_BLOCK_REGEX = /```([^\n`]*)\n?([\s\S]*?)```/g;
export const OPEN_FENCED_CODE_BLOCK_AT_END_REGEX = /```([^\n`]*)\n?([\s\S]*)$/;
export const MISLABELED_HTML_FRAGMENT_LANGUAGES = new Set(['css', 'text', 'txt', 'markdown', 'md']);
export const TOOL_RESULT_FRAGMENT_REGEX = /^<div\b(?=[^>]*\bclass=["'][^"']*\btool-result\b)/i;
// Live Artifacts 协议特征:只会出现在模型按 LA 提示词产出的内容里,几乎不可
// 能出现在"展示源码"的教程文本中。CSS 变量(--amc-live-artifact-*)与声明式
// 交互属性(data-amc-*)都是 LA 专有,作为解包误标代码块的强信号。
const LIVE_ARTIFACT_MARKER_REGEX = /--amc-live-artifact-|data-amc-/i;

export const normalizeLanguage = (language?: string): string => {
  if (!language) return '';
  return language.trim().split(/\s+/)[0].toLowerCase();
};

export const isLiveArtifactLanguage = (language?: string): boolean => {
  return normalizeLanguage(language) === LIVE_ARTIFACT_HTML_LANGUAGE;
};

export const isLiveArtifactInteractionLanguage = (language?: string): boolean => {
  return normalizeLanguage(language) === LIVE_ARTIFACT_INTERACTION_LANGUAGE;
};

export const isLikelyLiveArtifactInteractionJson = (textContent: string): boolean => {
  // Lenient by design: CodeBlock renders the interaction form OR a diagnostic
  // card via diagnoseLiveArtifactInteraction, which can repair specs that a
  // strict parse would reject (e.g. a missing items.type). Wrapping on the
  // same shape gate CodeBlock uses keeps the two paths consistent — a
  // repairable spec gets a form/diagnostic, not a silent plain-text fallback.
  const normalizedContent = textContent.trim();
  return (
    !!normalizedContent &&
    normalizedContent.startsWith('{') &&
    normalizedContent.includes('"instruction"') &&
    normalizedContent.includes('"schema"')
  );
};

export const isStandaloneHtmlFragment = (textContent: string): boolean => {
  if (!textContent) return false;

  const normalizedContent = textContent.trim();
  if (!normalizedContent) {
    return false;
  }

  const contentWithoutComments = normalizedContent.replace(HTML_COMMENT_REGEX, '').trim();

  return HTML_FRAGMENT_REGEX.test(contentWithoutComments) || HTML_FRAGMENT_CONTAINER_REGEX.test(contentWithoutComments);
};

export const isLikelyStreamingStandaloneHtmlFragment = (textContent: string): boolean => {
  const normalizedContent = textContent.trim();

  if (!normalizedContent) {
    return false;
  }

  return HTML_FRAGMENT_START_REGEX.test(normalizedContent);
};

const isLikelyStreamingStandaloneHtmlDocument = (textContent: string): boolean => {
  const normalizedContent = textContent.trim();

  if (!normalizedContent) {
    return false;
  }

  return HTML_DOCUMENT_START_REGEX.test(normalizedContent) || HTML_DOCTYPE_START_REGEX.test(normalizedContent);
};

export const isLikelyStreamingHtmlArtifact = (textContent: string): boolean => {
  const normalizedContent = textContent.trim();

  if (!normalizedContent || TOOL_RESULT_FRAGMENT_REGEX.test(normalizedContent)) {
    return false;
  }

  return (
    isLikelyStreamingStandaloneHtmlDocument(normalizedContent) ||
    isLikelyStreamingStandaloneHtmlFragment(normalizedContent)
  );
};

export const hasStreamingLiveArtifactFence = (textContent: string): boolean => {
  return (
    /```(?:amc-live-artifact-html|amc-live-artifact-interaction|html)\b/i.test(textContent) ||
    LIVE_ARTIFACT_MARKER_REGEX.test(textContent)
  );
};

export const isLikelyStreamingLiveArtifactInteractionJson = (textContent: string): boolean => {
  const normalizedContent = textContent.trim();
  const openFenceMatch = normalizedContent.match(OPEN_FENCED_CODE_BLOCK_AT_END_REGEX);
  const candidateContent =
    openFenceMatch && isLiveArtifactInteractionLanguage(openFenceMatch[1])
      ? (openFenceMatch[2] ?? '').trim()
      : normalizedContent;

  return (
    candidateContent.startsWith('{') &&
    candidateContent.includes('"instruction"') &&
    candidateContent.includes('"schema"')
  );
};

/**
 * 误标代码块是否应解包还原为实时预览。只有强信号才解包:
 * - 强信号 A:完整 HTML 文档(以 <!doctype html> 或 <html> 开头)——模型输出
 *   完整文档却误标成 text/css 时,几乎可以确定是 LA 产物。
 * - 强信号 B:内容含 Live Artifacts 协议标记(--amc-live-artifact-* CSS 变量
 *   或 data-amc-* 声明式交互属性)。
 * 刻意放弃"块级标签首尾匹配"的裸片段:这类内容无法区分"误标 LA"与"故意
 * 展示源码",一律按源码显示(即该特性引入前的行为)。
 */
export const shouldUnwrapMislabeledHtmlFence = (content: string): boolean => {
  if (!content) return false;

  if (HTML_DOCTYPE_START_REGEX.test(content) || /^<html\b/i.test(content)) {
    return true;
  }

  return LIVE_ARTIFACT_MARKER_REGEX.test(content);
};

export const getPreviewMarkupType = (textContent: string): PreviewMarkupType | null => {
  if (!textContent) return null;

  const normalizedContent = textContent.trim();
  if (!normalizedContent) return null;

  if (SVG_DOCUMENT_REGEX.test(normalizedContent)) {
    return 'svg';
  }

  if (HTML_DOCUMENT_REGEX.test(normalizedContent)) {
    return 'html';
  }

  if (isStandaloneHtmlFragment(normalizedContent)) {
    return 'html';
  }

  return null;
};

export const getStandaloneDocumentPreviewType = (textContent: string): PreviewMarkupType | null => {
  if (!textContent) return null;

  const normalizedContent = textContent.trim();
  if (!normalizedContent) return null;

  if (SVG_DOCUMENT_REGEX.test(normalizedContent)) {
    return 'svg';
  }

  if (HTML_DOCUMENT_REGEX.test(normalizedContent)) {
    return 'html';
  }

  return null;
};

export const getCodeBlockPreviewType = (textContent: string, language?: string): PreviewMarkupType | null => {
  const normalizedLanguage = normalizeLanguage(language);

  if (isLiveArtifactLanguage(normalizedLanguage)) {
    return 'html';
  }

  if (HTML_LANGUAGE_ALIASES.has(normalizedLanguage)) {
    return 'html';
  }

  if (SVG_LANGUAGE_ALIASES.has(normalizedLanguage)) {
    return 'svg';
  }

  return getPreviewMarkupType(textContent);
};

// Strict classifier for the automatic preview-open path. Unlike
// getCodeBlockPreviewType, it never content-sniffs: an explicit non-HTML/SVG
// language (python, css, text, …) is treated as author intent and returns
// null even when the body happens to look like HTML. Only an explicit
// html/svg label, or an unlabeled full HTML/SVG document, counts as a
// preview target for auto-open.
export const getAutoPreviewType = (textContent: string, language?: string): PreviewMarkupType | null => {
  const normalizedLanguage = normalizeLanguage(language);

  // Live Artifacts (amc-live-artifact-html) render ONLY inline in the message
  // bubble via ArtifactFrame. They must never trigger the automatic fullscreen
  // preview modal, so this fence language is excluded from auto-open. Note:
  // bare HTML documents are wrapped into this fence by
  // normalizePreviewableMarkdownContent, so they are excluded here too —
  // they render inline as Live Artifacts instead of opening the preview modal.

  if (HTML_LANGUAGE_ALIASES.has(normalizedLanguage)) {
    return 'html';
  }

  if (SVG_LANGUAGE_ALIASES.has(normalizedLanguage)) {
    return 'svg';
  }

  if (normalizedLanguage) {
    return null;
  }

  return getStandaloneDocumentPreviewType(textContent);
};

export const isLikelyHtml = (textContent: string): boolean => {
  return getPreviewMarkupType(textContent) !== null;
};

/**
 * Does this bare region carry a strong enough signal to be promoted?
 *
 * A complete document/SVG is unambiguous. For fragments the bar is deliberately
 * higher than `getPreviewMarkupType`: a bare `<div>…</div>` is very often a
 * truncation boundary of a longer streaming fragment, or plain markup being
 * shown on purpose. Only a Live Artifacts marker (protocol CSS variable or
 * `data-amc-*`) proves the author meant an artifact — the same signal
 * `shouldUnwrapMislabeledHtmlFence` relies on.
 */
export const isPromotableBareArtifact = (artifact: string): boolean => {
  const markupType = getPreviewMarkupType(artifact);
  if (markupType === 'svg') {
    return true;
  }

  if (markupType === 'html' && HTML_DOCUMENT_REGEX.test(artifact.trim())) {
    return true;
  }

  return LIVE_ARTIFACT_MARKER_REGEX.test(artifact) && isStandaloneHtmlFragment(artifact);
};

export const isPromotableStreamingBareFragment = (artifact: string): boolean => {
  return LIVE_ARTIFACT_MARKER_REGEX.test(artifact) && HTML_FRAGMENT_START_REGEX.test(artifact.trimStart());
};
