import { AVAILABLE_THEMES, DEFAULT_THEME_ID } from '@/constants/themeRegistry';
import { hydrateGraphvizIntoDocument } from '@/features/graphviz/vizRuntime';
import { buildLiveArtifactThemeVars } from '@/utils/live-ui/liveUiThemeTokens';
import { PREVIEW_BRIDGE_SCRIPT } from './previewBridgeScript';
import { hydrateChartsIntoDocument } from './chartRendererScript';
import { ECHARTS_SCRIPT_ATTRIBUTE, ECHARTS_SCRIPT_SRC } from './echartsRendererScript';
import { sanitizeElementTree } from './previewSanitizer';
import { sanitizeDocumentStylesForPngExport } from '@/utils/export/cssColorSanitizer';
import { STREAMING_PREVIEW_RUNNER_SCRIPT } from './streamingPreviewRunnerScript';
import { normalizeLiveUiHtmlForPreview } from './liveUiHtmlNormalizer';
import type { HtmlPreviewPrivilege } from './previewPrivilege';
import type { ReadingFontFamily } from '@/types';

export {
  HTML_PREVIEW_CLEAR_SELECTION_EVENT,
  HTML_PREVIEW_COPY_EVENT,
  HTML_PREVIEW_DIAGNOSTIC_EVENT,
  HTML_PREVIEW_DIAGRAM_CLICK_EVENT,
  HTML_PREVIEW_GRAPHVIZ_RENDER_REQUEST_EVENT,
  HTML_PREVIEW_GRAPHVIZ_RENDER_RESPONSE_EVENT,
  HTML_PREVIEW_MESSAGE_CHANNEL,
  HTML_PREVIEW_STREAM_RENDER_EVENT,
} from './previewMessageProtocol';

const KATEX_STYLE_ATTRIBUTE = 'data-amc-katex';

/**
 * KaTeX is a heavy (~300KB) dependency used only when an HTML preview actually
 * contains TeX math. It is loaded lazily so the static import graph from
 * ArtifactFrame → previewDocument does not force every markdown message to
 * download the math chunk.
 */
type KatexModule = { default: typeof import('katex').default };
let katexInstance: typeof import('katex').default | null = null;
let katexCss: string | null = null;
let katexLoadingPromise: Promise<void> | null = null;

export const isKatexLoaded = (): boolean => Boolean(katexInstance);

export const loadKatex = (): Promise<void> => {
  if (katexInstance) {
    return Promise.resolve();
  }
  if (!katexLoadingPromise) {
    katexLoadingPromise = Promise.all([
      import('katex').then((module: KatexModule) => {
        katexInstance = module.default;
      }),
      import('katex/dist/katex.min.css?inline').then((cssModule) => {
        katexCss = cssModule.default as string;
      }),
    ])
      .then(() => {})
      .catch((error: unknown) => {
        katexLoadingPromise = null;
        throw error;
      });
  }

  return katexLoadingPromise;
};

export const whenKatexReady = (): Promise<void> => {
  if (katexInstance) {
    return Promise.resolve();
  }
  return loadKatex();
};
// SECURITY NOTE (intentional): `script-src 'unsafe-inline' https: blob:` is
// deliberately permissive. Live Artifacts are model-authored HTML/JS demos; the
// sanitizer strips declarative <script> tags and event-handler attributes, but
// the demo's own JS is allowed to create <script> elements at runtime (CDN
// loaders, blob: bundles). Tightening this to 'none' would break every demo
// that boots its JS dynamically, so the sanitizer is the first line of defense
// and CSP only blocks cross-origin/network surprises (default-src 'none',
// frame-src/object-src/form-action 'none'). The iframe sandbox omits
// allow-same-origin for message-bubble artifacts, keeping them on an opaque
// origin so scripted content cannot reach the parent page's origin.
const PREVIEW_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src http: https: data: blob:; style-src 'unsafe-inline' http: https:; script-src 'unsafe-inline' http: https: blob:; font-src http: https: data:; media-src http: https: data: blob:; connect-src http: https: data: blob:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const PREVIEW_CONTENT_SECURITY_POLICY_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`;
const PREVIEW_BASE_FONT_SIZE_ATTRIBUTE = 'data-amc-live-artifact-base-font-size';
const PREVIEW_THEME_ATTRIBUTE = 'data-amc-live-artifact-theme';
const MATH_IGNORED_ANCESTOR_SELECTOR = 'script,style,textarea,pre,code,kbd,samp,.katex';
const TEX_MATH_SIGNAL_REGEX = /[\\^_{}=+\-*/<>|]|[A-Za-z]\d|\d[A-Za-z]|[\u0370-\u03ff]/;
const TEX_MATH_ENVIRONMENT_NAMES =
  'align\\*?|aligned|alignedat|array|Bmatrix|bmatrix|cases|equation\\*?|gather\\*?|gathered|matrix|multline\\*?|pmatrix|smallmatrix|split|subarray|Vmatrix|vmatrix';
const TEX_MATH_DELIMITER_REGEX = new RegExp(
  [
    String.raw`\$\$([\s\S]+?)\$\$`,
    String.raw`\$((?:\\.|[^$\\\n])+?)\$`,
    String.raw`\\\(([\s\S]+?)\\\)`,
    String.raw`\\\[([\s\S]+?)\\\]`,
    String.raw`\\begin\{(${TEX_MATH_ENVIRONMENT_NAMES})\}([\s\S]+?)\\end\{\5\}`,
  ].join('|'),
  'g',
);
const ASYMPTOTIC_COMPLEXITY_REGEX = /^(?:O|Θ|Ω|Theta|Omega)\s*\([^)]*[A-Za-z0-9][^)]*\)$/;

const cloneIntoDocument = (node: Node, targetDocument: Document): Node => targetDocument.importNode(node, true);

const isLikelyTexMath = (value: string): boolean => {
  const normalizedValue = value.trim();

  return (
    /^[A-Za-z](?:\s*,\s*[A-Za-z])*$/.test(normalizedValue) ||
    TEX_MATH_SIGNAL_REGEX.test(normalizedValue) ||
    ASYMPTOTIC_COMPLEXITY_REGEX.test(normalizedValue)
  );
};

const hasTexMathDelimiterCandidate = (value: string): boolean => {
  TEX_MATH_DELIMITER_REGEX.lastIndex = 0;
  const hasCandidate = TEX_MATH_DELIMITER_REGEX.test(value);
  TEX_MATH_DELIMITER_REGEX.lastIndex = 0;
  return hasCandidate;
};

const readTexMathMatch = (
  match: RegExpMatchArray,
): { latex: string; displayMode: boolean; shouldValidateMathSignal: boolean } => {
  if (match[1] !== undefined) {
    return { latex: match[1], displayMode: true, shouldValidateMathSignal: true };
  }

  if (match[2] !== undefined) {
    return { latex: match[2], displayMode: false, shouldValidateMathSignal: true };
  }

  if (match[3] !== undefined) {
    return { latex: match[3], displayMode: false, shouldValidateMathSignal: true };
  }

  if (match[4] !== undefined) {
    return { latex: match[4], displayMode: true, shouldValidateMathSignal: true };
  }

  return { latex: match[0], displayMode: true, shouldValidateMathSignal: false };
};

const createRenderedMathFragment = (targetDocument: Document, value: string): DocumentFragment | null => {
  TEX_MATH_DELIMITER_REGEX.lastIndex = 0;

  let lastIndex = 0;
  let rendered = false;
  const fragment = targetDocument.createDocumentFragment();

  for (const match of value.matchAll(TEX_MATH_DELIMITER_REGEX)) {
    const startIndex = match.index ?? 0;

    if (startIndex > 0 && value[startIndex - 1] === '\\') {
      continue;
    }

    const rawMatch = match[0];
    const { latex: rawLatex, displayMode, shouldValidateMathSignal } = readTexMathMatch(match);
    const latex = rawLatex.trim();

    if (!latex || (shouldValidateMathSignal && !isLikelyTexMath(latex))) {
      continue;
    }

    if (startIndex > lastIndex) {
      fragment.appendChild(targetDocument.createTextNode(value.slice(lastIndex, startIndex)));
    }

    try {
      if (!katexInstance) {
        continue;
      }
      const template = targetDocument.createElement('template');
      template.innerHTML = katexInstance.renderToString(latex, {
        displayMode,
        throwOnError: false,
        strict: false,
      });
      fragment.appendChild(template.content.cloneNode(true));
      rendered = true;
    } catch {
      fragment.appendChild(targetDocument.createTextNode(rawMatch));
    }

    lastIndex = startIndex + rawMatch.length;
  }

  if (!rendered) {
    return null;
  }

  if (lastIndex < value.length) {
    fragment.appendChild(targetDocument.createTextNode(value.slice(lastIndex)));
  }

  return fragment;
};

const renderMathInDocument = (targetDocument: Document): boolean => {
  if (!targetDocument.body) {
    return false;
  }

  const showText = targetDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = targetDocument.createTreeWalker(targetDocument.body, showText);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  let rendered = false;

  textNodes.forEach((textNode) => {
    if (textNode.parentElement?.closest(MATH_IGNORED_ANCESTOR_SELECTOR)) {
      return;
    }

    const renderedFragment = createRenderedMathFragment(targetDocument, textNode.data);
    if (!renderedFragment) {
      return;
    }

    textNode.replaceWith(renderedFragment);
    rendered = true;
  });

  return rendered;
};

const injectKatexStyles = (targetDocument: Document) => {
  if (targetDocument.head.querySelector(`style[${KATEX_STYLE_ATTRIBUTE}]`)) {
    return;
  }

  const styleElement = targetDocument.createElement('style');
  styleElement.setAttribute(KATEX_STYLE_ATTRIBUTE, 'true');
  styleElement.textContent = katexCss;
  targetDocument.head.appendChild(styleElement);
};

const renderPreviewMath = (srcDoc: string): string => {
  if (!hasTexMathDelimiterCandidate(srcDoc) || typeof DOMParser === 'undefined') {
    return srcDoc;
  }

  if (!katexInstance) {
    // First sight of a math delimiter in a preview: kick off the lazy KaTeX
    // load and return the untouched source this frame. ArtifactFrame subscribes
    // to whenKatexReady() and re-renders once the chunk has arrived, so the
    // formula appears a tick later instead of blocking every message on it.
    void loadKatex();
    return srcDoc;
  }

  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(srcDoc, 'text/html');

  if (renderMathInDocument(parsedDocument)) {
    injectKatexStyles(parsedDocument);
  }

  return `<!DOCTYPE html>${parsedDocument.documentElement.outerHTML}`;
};

/**
 * Inject head/body-end HTML into a parsed document via the DOM, then serialize.
 *
 * String-based injection (`srcDoc.replace(/<\/body>/i, …)`) is fragile: it
 * replaces the FIRST match, so if model-authored HTML contains the literal
 * `</body>` / `<head>` / `<html ` inside a <script> string, a comment, or
 * displayed source text in a <pre>, the bridge script or head resources land
 * inside that string and the page JS crashes (white screen). Parsing into a
 * real Document and appending elements keeps the injections anchored to the
 * true document structure no matter what the text content contains.
 *
 * DOMParser never executes scripts, and serializing via outerHTML does not
 * escape or rewrite script/style text content, so the round-trip matches what
 * the browser would have parsed from the original srcdoc.
 */
const injectIntoParsedDocument = (
  parsedDocument: Document,
  injections: { headElements?: string[]; bodyEndHtml?: string },
): string => {
  const doc = parsedDocument;

  injections.headElements?.forEach((html) => {
    const template = doc.createElement('template');
    template.innerHTML = html;
    doc.head.appendChild(template.content.cloneNode(true));
  });

  if (injections.bodyEndHtml) {
    const template = doc.createElement('template');
    template.innerHTML = injections.bodyEndHtml;
    doc.body.appendChild(template.content.cloneNode(true));
  }

  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
};

const parsePreviewDocument = (srcDoc: string): Document | null => {
  if (typeof DOMParser === 'undefined') {
    return null;
  }
  return new DOMParser().parseFromString(srcDoc, 'text/html');
};

const injectPreviewSecurityPolicy = (srcDoc: string): string => {
  const parsedDocument = parsePreviewDocument(srcDoc);
  if (!parsedDocument) {
    return srcDoc;
  }

  // Guard on the injected <meta> ELEMENT, not the raw policy string or the
  // attribute text: model prose that merely mentions "Content-Security-Policy"
  // (e.g. a tutorial showing the attribute, or a <pre> displaying the meta
  // syntax) must not suppress the restrictive preview CSP — that would leave
  // the artifact running without one.
  if (parsedDocument.head.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
    return srcDoc;
  }

  return injectIntoParsedDocument(parsedDocument, { headElements: [PREVIEW_CONTENT_SECURITY_POLICY_META] });
};

const resolvePreviewTheme = (themeId?: string) => {
  return (
    AVAILABLE_THEMES.find((theme) => theme.id === themeId) ??
    AVAILABLE_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID) ??
    AVAILABLE_THEMES[0]
  );
};

const APP_FONT_SANS_STACK =
  "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC','Noto Sans SC',sans-serif,'Apple Color Emoji','Segoe UI Emoji'";
const APP_FONT_SERIF_STACK =
  "Charter,'Bitstream Charter',Georgia,Cambria,'Times New Roman',Times,'Source Han Serif SC','Noto Serif CJK SC','Source Han Serif CN','Songti SC','STSong',SimSun,'Noto Serif SC',serif,'Apple Color Emoji','Segoe UI Emoji'";

const buildPreviewThemeStyle = (
  themeId?: string,
  options: {
    varsOnly?: boolean;
    baseFontSize?: number;
    readingFontFamily?: ReadingFontFamily;
    isExpanded?: boolean;
  } = {},
): string => {
  const theme = resolvePreviewTheme(themeId);
  const colorScheme = theme.isDark ? 'dark' : 'light';
  // Shared with themeDom.ts (host-document fallback rendering) so both channels
  // cannot drift; see liveArtifactThemeTokens.buildLiveArtifactThemeVars.
  const cssVars = buildLiveArtifactThemeVars(theme.colors);
  const readingFontChoice = options.readingFontFamily === 'serif' ? 'var(--app-font-serif)' : 'var(--app-font-sans)';
  const fontVars = `--app-font-sans:${APP_FONT_SANS_STACK};--app-font-serif:${APP_FONT_SERIF_STACK};--app-font-reading:${readingFontChoice};`;
  // Static snapshots (PNG / standalone HTML export) have no separate font-size
  // style element, so the size rides along in the vars block the chart hydrator
  // already parses. The live iframe injects it separately (see
  // buildPreviewBaseFontSizeStyle) and leaves this unset.
  const baseFontSize =
    typeof options.baseFontSize === 'number' && Number.isFinite(options.baseFontSize)
      ? `--amc-live-artifact-font-size:${Math.max(1, Math.round(options.baseFontSize))}px;`
      : '';

  if (options.varsOnly) {
    return `<style ${PREVIEW_THEME_ATTRIBUTE}="true">:root{color-scheme:${colorScheme};${cssVars};${fontVars}${baseFontSize}}</style>`;
  }

  // height/min-height auto: model CSS often uses min-height:100vh / height:100%, which
  // expands to the iframe viewport and reports a locked tall height (blank under content).
  // Surface tokens must be soft fills (bgInfo/bgSuccess/…), never solid interactive fills like bgAccent.
  // bgAccent equals textLink on pearl (#2563eb); pairing accent text on accent-surface would be invisible.
  //
  // Overflow guard: the frame height is measured from element rects (see
  // previewBridgeScript.measureContentHeight), which only sees VERTICAL extent. A
  // long unbroken string in a narrow grid cell (typically a metric-card value that
  // should have been a number) overflows horizontally and is clipped by the
  // frame's `overflow-hidden` with no scrollbar and no height growth — it just
  // disappears. Allowing descendants to shrink below their content width
  // (`min-width:0`) and to wrap long tokens makes that text reflow onto another
  // line instead of vanishing. Set on descendants only, so the artifact's own
  const overflowGuard = `body :where(div,section,article,main,aside,header,footer,li,td,th,p,h1,h2,h3,h4,h5,h6,span,strong,em,small,code){min-width:0;}body{overflow-wrap:anywhere;}`;
  const tableAndTagStyles = [
    'table td,table th{vertical-align:top;}',
    'table{border-collapse:collapse!important;width:100%!important;border:none!important;background-color:transparent!important;table-layout:auto;}',
    'table td,table th{border-left:none!important;border-right:none!important;border-top:none!important;}',
    'table thead th{background-color:transparent!important;color:var(--amc-live-artifact-muted)!important;font-weight:500!important;font-size:0.75em!important;text-transform:uppercase!important;letter-spacing:0.05em!important;text-align:left;padding:0.5rem 1rem!important;border:none!important;border-bottom:1px solid var(--amc-live-artifact-border)!important;white-space:nowrap;}',
    'table tbody td{padding:0.75rem 1rem!important;border:none!important;border-bottom:1px solid color-mix(in srgb,var(--amc-live-artifact-border) 40%,transparent)!important;line-height:1.6;font-variant-numeric:tabular-nums;color:inherit;}',
    'table tbody tr:last-child td{border-bottom:none!important;}',
    'table tbody tr:hover{background-color:color-mix(in srgb,var(--amc-live-artifact-surface-muted,rgba(0,0,0,0.03)) 40%,transparent);}',
    ':where(div,section,article):has(> table:only-child){border:none!important;background:transparent!important;box-shadow:none!important;}',
    'span[style*="border-radius"][style*="padding"]{white-space:nowrap;display:inline-block;}',
  ].join('');
  const scrollbarStyles = `*{scrollbar-width:thin;scrollbar-color:var(--amc-live-artifact-border) transparent;}*::-webkit-scrollbar{width:5px;height:5px;}*::-webkit-scrollbar-track{background:transparent;}*::-webkit-scrollbar-thumb{background:var(--amc-live-artifact-border);border-radius:9999px;}*::-webkit-scrollbar-thumb:hover{background:var(--amc-live-artifact-muted);}`;
  const graphvizStyles = `pre[data-amc-graphviz]{margin:0.5rem 0;white-space:normal;font-family:inherit;}[data-amc-graphviz][data-amc-graphviz-state="rendered"]{cursor:zoom-in;}[data-amc-graphviz][data-amc-graphviz-state="pending"]{min-height:96px;display:flex;align-items:center;justify-content:center;background:var(--amc-live-artifact-surface-muted,rgba(0,0,0,0.03));border-radius:0.5rem;color:transparent;overflow:hidden;user-select:none;}[data-amc-graphviz][data-amc-graphviz-state="pending"]::after{content:"";width:18px;height:18px;border:2px solid var(--amc-live-artifact-border,rgba(0,0,0,0.1));border-top-color:var(--amc-live-artifact-accent,#3b82f6);border-radius:50%;animation:amc-gv-spin 0.8s linear infinite;}@keyframes amc-gv-spin{to{transform:rotate(360deg);}}`;
  const gridSymmetryStyles = `@media (min-width: 520px){:where(div,section,article)[style*="grid"][style*="auto-fit"]:has(> :nth-child(4):last-child),:where(div,section,article)[style*="grid"][style*="auto-fill"]:has(> :nth-child(4):last-child){grid-template-columns:repeat(2,minmax(0,1fr))!important;}}@media (max-width: 519px){:where(div,section,article)[style*="grid"]:has(> :nth-child(4):last-child){grid-template-columns:1fr!important;}}`;
  const microComponentStyles = `@keyframes amc-bar-grow{from{transform:scaleX(0);}to{transform:scaleX(1);}}:where(div,section,article)>div[style*="position:absolute"][style*="width:"]{transform-origin:left;animation:amc-bar-grow 0.6s cubic-bezier(0.16,1,0.3,1) both;transition:width 0.5s cubic-bezier(0.16,1,0.3,1);}:where(div,section,article)[style*="border-radius"][style*="overflow:hidden"]>div[style*="width:"]{transform-origin:left;animation:amc-bar-grow 0.6s cubic-bezier(0.16,1,0.3,1) both;transition:width 0.5s cubic-bezier(0.16,1,0.3,1);}:where(div,section,article)>div[style*="flex:1"][title]{transition:transform 0.15s ease,opacity 0.15s ease;}:where(div,section,article)>div[style*="flex:1"][title]:hover{transform:scaleY(1.2);opacity:0.85;}@media(prefers-reduced-motion:reduce){:where(div,section,article)>div[style*="position:absolute"][style*="width:"],:where(div,section,article)[style*="border-radius"][style*="overflow:hidden"]>div[style*="width:"]{animation:none!important;transition:none!important;}}`;
  const layoutStyles = options.isExpanded
    ? `html,body{margin:0;padding:0;height:auto!important;min-height:0!important;max-height:none!important;background:transparent!important;color:var(--amc-live-artifact-text);}body{box-sizing:border-box;max-width:1120px;margin:0 auto!important;}@media (max-width:640px){body{padding:16px 16px 36px 16px!important;}}@media (min-width:641px){body{padding:28px 36px 56px 36px!important;}}`
    : `html,body{margin:0;padding:0;height:auto!important;min-height:0!important;max-height:none!important;background:transparent!important;color:var(--amc-live-artifact-text);}`;
  return `<style ${PREVIEW_THEME_ATTRIBUTE}="true">:root{color-scheme:${colorScheme};${cssVars};${fontVars}}${layoutStyles}body{overflow-x:auto;font-family:var(--app-font-reading);}${overflowGuard}${tableAndTagStyles}${scrollbarStyles}${graphvizStyles}${gridSymmetryStyles}${microComponentStyles}</style>`;
};

const injectPreviewTheme = (
  srcDoc: string,
  themeId?: string,
  options: { readingFontFamily?: ReadingFontFamily; isExpanded?: boolean } = {},
): string => {
  // Guard on the <style> ELEMENT carrying the theme marker, not the bare marker
  // string or the attribute text. A model output that merely references the
  // attribute (e.g. shows `data-amc-live-artifact-theme` in a demo) must not
  // skip the injection and leave every --amc-live-artifact-* variable
  // undefined.
  const parsedDocument = parsePreviewDocument(srcDoc);
  if (!parsedDocument) {
    return srcDoc;
  }
  if (parsedDocument.head.querySelector(`style[${PREVIEW_THEME_ATTRIBUTE}]`)) {
    return srcDoc;
  }

  return injectIntoParsedDocument(parsedDocument, { headElements: [buildPreviewThemeStyle(themeId, options)] });
};

const buildPreviewBaseFontSizeStyle = (baseFontSize?: number): string => {
  if (typeof baseFontSize !== 'number' || !Number.isFinite(baseFontSize)) {
    return '';
  }

  const fontSize = Math.max(1, Math.round(baseFontSize));
  return `<style ${PREVIEW_BASE_FONT_SIZE_ATTRIBUTE}="true">:root{--amc-live-artifact-font-size:${fontSize}px;font-size:var(--amc-live-artifact-font-size);}body{font-size:var(--amc-live-artifact-font-size);}</style>`;
};

const injectPreviewBaseFontSize = (srcDoc: string, baseFontSize?: number): string => {
  const style = buildPreviewBaseFontSizeStyle(baseFontSize);
  if (!style) {
    return srcDoc;
  }

  // Guard on the injected <style> element, not the bare marker string, so model
  // prose that mentions the attribute still gets the font-size injection.
  const parsedDocument = parsePreviewDocument(srcDoc);
  if (!parsedDocument) {
    return srcDoc;
  }
  if (parsedDocument.head.querySelector(`style[${PREVIEW_BASE_FONT_SIZE_ATTRIBUTE}]`)) {
    return srcDoc;
  }

  return injectIntoParsedDocument(parsedDocument, { headElements: [style] });
};

const ECHARTS_SCRIPT_TAG = `<script ${ECHARTS_SCRIPT_ATTRIBUTE}="true" src="${ECHARTS_SCRIPT_SRC}"></script>`;

const hasEchartsChart = (htmlOrDoc: string | Document): boolean => {
  if (typeof htmlOrDoc === 'string') {
    return /data-amc-(?:chart|echarts)\b/.test(htmlOrDoc);
  }
  return Boolean(htmlOrDoc.querySelector('[data-amc-chart], [data-amc-echarts]'));
};

const injectEchartsScript = (srcDoc: string): string => {
  const parsedDocument = parsePreviewDocument(srcDoc);
  if (!parsedDocument) {
    return srcDoc;
  }

  const hasChart = hasEchartsChart(parsedDocument);
  if (!hasChart) {
    return srcDoc;
  }

  if (
    parsedDocument.head.querySelector(`script[${ECHARTS_SCRIPT_ATTRIBUTE}]`) ||
    parsedDocument.head.querySelector(`script[src="${ECHARTS_SCRIPT_SRC}"]`)
  ) {
    return srcDoc;
  }

  return injectIntoParsedDocument(parsedDocument, { headElements: [ECHARTS_SCRIPT_TAG] });
};

const prepareHtmlPreviewSrcDoc = (
  srcDoc: string,
  options: {
    baseFontSize?: number;
    readingFontFamily?: ReadingFontFamily;
    themeId?: string;
    isExpanded?: boolean;
  } = {},
): string =>
  injectEchartsScript(
    renderPreviewMath(
      injectPreviewBaseFontSize(
        injectPreviewTheme(injectPreviewSecurityPolicy(srcDoc), options.themeId, {
          readingFontFamily: options.readingFontFamily,
          isExpanded: options.isExpanded,
        }),
        options.baseFontSize,
      ),
    ),
  );

/**
 * Normalizes 4-item grid containers that use auto-fit/auto-fill to a balanced 2x2 grid,
 * preventing 3+1 orphan card layouts when models ignore prompt instructions.
 */
export const balanceFourItemGrids = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>(':where(div,section,article)[style*="grid"]').forEach((element) => {
    if (element.children.length !== 4) return;
    const style = element.getAttribute('style') || '';
    if (!style) return;
    if (style.includes('auto-fit') || style.includes('auto-fill') || /repeat\s*\(\s*3\s*,/i.test(style)) {
      if (/grid-template-columns\s*:[^;]+/i.test(style)) {
        element.setAttribute(
          'style',
          style.replace(/grid-template-columns\s*:[^;]+/i, 'grid-template-columns:repeat(2,minmax(0,1fr))'),
        );
      } else {
        element.setAttribute('style', `${style.replace(/;?\s*$/, ';')}grid-template-columns:repeat(2,minmax(0,1fr));`);
      }
    }
  });
};

export const buildStreamingHtmlPreviewRenderPayload = (htmlContent: string): string => {
  const normalized = normalizeLiveUiHtmlForPreview(htmlContent, { isStreaming: true });
  return renderPreviewMath(normalized);
};

const sanitizePreviewHtml = (htmlContent: string): string => {
  if (typeof DOMParser === 'undefined') {
    return htmlContent;
  }

  const normalized = normalizeLiveUiHtmlForPreview(htmlContent);
  const parsedDocument = new DOMParser().parseFromString(normalized, 'text/html');
  sanitizeElementTree(parsedDocument);
  balanceFourItemGrids(parsedDocument);
  return `<!DOCTYPE html>${parsedDocument.documentElement.outerHTML}`;
};

/**
 * Append the preview bridge script at the end of a parsed document's <body> via
 * the DOM. Replaces the fragile `srcDoc.replace(/<\/body>/i, …)` which hit the
 * FIRST literal `</body>` — inside a <script> string or displayed <pre> text,
 * that dropped the bridge into the middle of JS and crashed the page (white
 * screen). DOMParser never executes scripts, so appending then serializing is
 * safe and stays anchored to the real body.
 */
const appendBridgeScriptToDocument = (parsedDocument: Document): string => {
  const template = parsedDocument.createElement('template');
  template.innerHTML = PREVIEW_BRIDGE_SCRIPT;
  parsedDocument.body.appendChild(template.content.cloneNode(true));
  return `<!DOCTYPE html>${parsedDocument.documentElement.outerHTML}`;
};

export type HtmlPreviewSrcDocOptions = {
  baseFontSize?: number;
  readingFontFamily?: ReadingFontFamily;
  themeId?: string;
  privilege?: HtmlPreviewPrivilege;
  isExpanded?: boolean;
};

const buildSanitizedHtmlPreviewSrcDoc = (htmlContent: string, options: HtmlPreviewSrcDocOptions = {}): string => {
  if (!htmlContent) {
    const srcDoc = `<!DOCTYPE html><html><body></body></html>`;
    return prepareHtmlPreviewSrcDoc(srcDoc, options);
  }

  const sanitized = sanitizePreviewHtml(htmlContent);
  const parsedDocument = parsePreviewDocument(sanitized);
  if (!parsedDocument) {
    return sanitized;
  }
  const srcDoc = appendBridgeScriptToDocument(parsedDocument);
  return prepareHtmlPreviewSrcDoc(srcDoc, options);
};

const buildUnrestrictedPreviewDocument = (htmlContent: string): string => {
  if (!htmlContent) {
    return `<!DOCTYPE html><html><head></head><body></body></html>`;
  }

  // Parse whatever the model produced. DOMParser auto-wraps fragments in a full
  // <html><head></head><body> document without rewriting existing markup, so no
  // `/<html[\s>]/` sniffing is needed — a fragment and a full document both end
  // up with the bridge appended to the real body. Unlike string replacement
  // (`replace(/<\/body>/i, …)`) this cannot land the bridge inside a `</body>`
  // literal in a <script> string or <pre> text.
  const normalized = normalizeLiveUiHtmlForPreview(htmlContent);
  const parsedDocument = parsePreviewDocument(normalized);
  if (!parsedDocument) {
    return htmlContent;
  }

  balanceFourItemGrids(parsedDocument);
  return injectEchartsScript(appendBridgeScriptToDocument(parsedDocument));
};

/**
 * One HTML preview runtime, two privilege tiers.
 *
 * Default `sanitized` is the Live Artifact widget (CSP, sanitizer, theme, KaTeX).
 * `unrestricted` is the code-block demo player (no sanitizer/CSP/theme/KaTeX).
 */
export const buildHtmlPreviewSrcDoc = (htmlContent: string, options: HtmlPreviewSrcDocOptions = {}): string => {
  if (options.privilege === 'unrestricted') {
    return buildUnrestrictedPreviewDocument(htmlContent);
  }

  return buildSanitizedHtmlPreviewSrcDoc(htmlContent, options);
};

export const buildStreamingHtmlPreviewSrcDoc = (
  options: {
    baseFontSize?: number;
    readingFontFamily?: ReadingFontFamily;
    themeId?: string;
    isExpanded?: boolean;
  } = {},
): string => {
  const srcDoc = `<!DOCTYPE html><html><body><div data-amc-stream-preview-root="true"></div></body></html>`;
  const parsedDocument = parsePreviewDocument(srcDoc);
  if (!parsedDocument) {
    return srcDoc;
  }
  const withBridge = appendBridgeScriptToDocument(parsedDocument);
  const withRunner = parsePreviewDocument(withBridge);
  if (!withRunner) {
    return withBridge;
  }
  const runnerTemplate = withRunner.createElement('template');
  runnerTemplate.innerHTML = STREAMING_PREVIEW_RUNNER_SCRIPT;
  withRunner.body.appendChild(runnerTemplate.content.cloneNode(true));
  return prepareHtmlPreviewSrcDoc(`<!DOCTYPE html>${withRunner.documentElement.outerHTML}`, options);
};

/**
 * Code-block demo player. Same runtime as `buildHtmlPreviewSrcDoc` with
 * `privilege: 'unrestricted'`.
 */
export const buildUnrestrictedHtmlPreviewSrcDoc = (
  htmlContent: string,
  options: { baseFontSize?: number; themeId?: string; readingFontFamily?: ReadingFontFamily } = {},
): string => {
  return buildHtmlPreviewSrcDoc(htmlContent, { ...options, privilege: 'unrestricted' });
};

export const createStaticPreviewSnapshotContainer = async (
  htmlContent: string,
  targetDocument: Document,
  options: { themeId?: string; sanitize?: boolean; baseFontSize?: number; readingFontFamily?: ReadingFontFamily } = {},
): Promise<{ container: HTMLElement; cleanup: () => void }> => {
  const parser = new DOMParser();
  const normalized = normalizeLiveUiHtmlForPreview(htmlContent);
  const parsedDocument = parser.parseFromString(normalized, 'text/html');

  const shouldSanitize = options.sanitize ?? true;
  if (shouldSanitize) {
    sanitizeElementTree(parsedDocument);
  }
  balanceFourItemGrids(parsedDocument);
  // Sanitize any modern CSS color functions in styles, inline attributes, and SVG attributes
  // so html2canvas doesn't crash on color(), oklab(), etc.
  sanitizeDocumentStylesForPngExport(parsedDocument);
  // Pre-render KaTeX math if formulas exist
  if (hasTexMathDelimiterCandidate(htmlContent)) {
    try {
      await whenKatexReady();
      if (renderMathInDocument(parsedDocument)) {
        injectKatexStyles(parsedDocument);
      }
    } catch {
      // Continue if KaTeX fails to load
    }
  }

  // Hydrate declarative charts as static SVG so the PNG export matches the
  // on-screen artifact. The theme style (varsOnly) is injected so chart SVG
  // colors resolve on the parent page, which never defines --amc-live-artifact-*.
  hydrateChartsIntoDocument(parsedDocument, {
    themeStyle: buildPreviewThemeStyle(options.themeId, {
      varsOnly: true,
      baseFontSize: options.baseFontSize,
      readingFontFamily: options.readingFontFamily,
    }),
  });
  // Graphviz hydration needs the lazy viz-js runtime, so the snapshot build is
  // async. Both are awaited before the container is measured and exported.
  await hydrateGraphvizIntoDocument(parsedDocument, {
    themeId: options.themeId,
    baseFontSize: options.baseFontSize,
  });

  const theme = resolvePreviewTheme(options.themeId);
  const container = targetDocument.createElement('div');
  container.className = 'is-exporting-png html-preview-snapshot';
  Object.assign(container.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '1200px',
    padding: '32px 36px',
    boxSizing: 'border-box',
    transform: 'translateX(-200vw)',
    pointerEvents: 'none',
    zIndex: '-1',
    overflow: 'hidden',
    background: theme.colors.bgPrimary,
    color: 'var(--amc-live-artifact-text)',
  });

  parsedDocument.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    container.appendChild(cloneIntoDocument(node, targetDocument));
  });

  // Inject the theme styles so that all --amc-live-artifact-* variables,
  // overflow guard, table and span badge styles are preserved in exported HTML and snapshots.
  const themeStyleMarkup = buildPreviewThemeStyle(options.themeId, {
    varsOnly: false,
    baseFontSize: options.baseFontSize,
    readingFontFamily: options.readingFontFamily,
  });
  const themeTemplate = targetDocument.createElement('template');
  themeTemplate.innerHTML = themeStyleMarkup;
  container.appendChild(themeTemplate.content.cloneNode(true));

  const bodyWrapper = targetDocument.createElement('div');
  const bodyElement = parsedDocument.body;
  bodyWrapper.className = `html-preview-body ${bodyElement?.className || ''}`.trim();
  const inlineBodyStyle = bodyElement?.getAttribute('style');
  if (inlineBodyStyle) {
    bodyWrapper.setAttribute('style', inlineBodyStyle);
  }
  bodyWrapper.style.color = 'var(--amc-live-artifact-text)';
  bodyWrapper.style.minWidth = '0';

  if (bodyElement) {
    Array.from(bodyElement.childNodes).forEach((node) => {
      bodyWrapper.appendChild(cloneIntoDocument(node, targetDocument));
    });
  }

  container.appendChild(bodyWrapper);
  targetDocument.body.appendChild(container);

  return {
    container,
    cleanup: () => {
      container.remove();
    },
  };
};

/**
 * Builds a self-contained, offline-ready HTML document for downloading a Live Artifact.
 * Pre-hydrates charts and Graphviz into vector SVGs, renders KaTeX math, and injects
 * complete theme CSS variables, ensuring the downloaded file renders identically in any browser.
 */
export const buildStandaloneHtmlArtifact = async (
  htmlContent: string,
  options: {
    themeId?: string;
    baseFontSize?: number;
    title?: string;
    sanitize?: boolean;
  } = {},
): Promise<string> => {
  const parser = new DOMParser();
  const normalized = normalizeLiveUiHtmlForPreview(htmlContent);
  const parsedDocument = parser.parseFromString(normalized, 'text/html');

  const shouldSanitize = options.sanitize ?? true;
  if (shouldSanitize) {
    sanitizeElementTree(parsedDocument);
  }

  // Pre-render KaTeX math if formulas are present
  if (hasTexMathDelimiterCandidate(htmlContent)) {
    try {
      await whenKatexReady();
      if (renderMathInDocument(parsedDocument)) {
        injectKatexStyles(parsedDocument);
        const cdnLink = parsedDocument.createElement('link');
        cdnLink.setAttribute('rel', 'stylesheet');
        cdnLink.setAttribute('href', 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css');
        cdnLink.setAttribute('crossorigin', 'anonymous');
        parsedDocument.head.appendChild(cdnLink);
      }
    } catch {
      // Continue without math rendering if KaTeX unavailable
    }
  }

  // Hydrate declarative charts as self-contained static SVG
  hydrateChartsIntoDocument(parsedDocument, {
    themeStyle: buildPreviewThemeStyle(options.themeId, {
      varsOnly: true,
      baseFontSize: options.baseFontSize,
    }),
  });

  // Hydrate Graphviz diagrams as self-contained static SVG
  await hydrateGraphvizIntoDocument(parsedDocument, {
    themeId: options.themeId,
    baseFontSize: options.baseFontSize,
  });

  // Ensure <head> exists
  let head = parsedDocument.head;
  if (!head) {
    head = parsedDocument.createElement('head');
    parsedDocument.documentElement.prepend(head);
  }

  // Ensure <meta charset="UTF-8"> exists
  if (!head.querySelector('meta[charset]')) {
    const metaCharset = parsedDocument.createElement('meta');
    metaCharset.setAttribute('charset', 'UTF-8');
    head.prepend(metaCharset);
  }

  // Ensure responsive <meta name="viewport"> exists
  if (!head.querySelector('meta[name="viewport"]')) {
    const metaViewport = parsedDocument.createElement('meta');
    metaViewport.setAttribute('name', 'viewport');
    metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
    head.appendChild(metaViewport);
  }

  // Set document title
  if (options.title) {
    let titleEl = head.querySelector('title');
    if (!titleEl) {
      titleEl = parsedDocument.createElement('title');
      head.appendChild(titleEl);
    }
    titleEl.textContent = options.title;
  }

  const theme = resolvePreviewTheme(options.themeId);
  const themeStyle = buildPreviewThemeStyle(options.themeId, {
    varsOnly: false,
    baseFontSize: options.baseFontSize,
    isExpanded: true,
  });
  const themeTemplate = parsedDocument.createElement('template');
  themeTemplate.innerHTML = `${themeStyle}<style>html,body{background-color:${theme.colors.bgPrimary}!important;}</style>`;
  head.appendChild(themeTemplate.content.cloneNode(true));

  return `<!DOCTYPE html>\n${parsedDocument.documentElement.outerHTML}`;
};
