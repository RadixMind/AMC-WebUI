import DOMPurify from 'dompurify';
import { logService } from '@/services/logService';
import { AVAILABLE_THEMES, DEFAULT_THEME_ID, SEMANTIC_SURFACE_MIN_ALPHA } from '@/constants/themeRegistry';
import type { Theme } from '@/types/theme';
import { getErrorMessage } from '@/utils/errorMessage';
import { hashString } from '@/utils/format/stringHash';
import { DOT_MAX_CHARS, DOT_MAX_EDGES, DOT_MAX_NODES, countDotEdges, countDotNodes } from './graphvizLimits';

/**
 * Shared Graphviz (viz-js) runtime used by three render paths so they all lay
 * out the same DOT through one cache and one sanitizer:
 *
 *  1. `GraphvizBlock` — the ```graphviz``` code-block renderer (lazy layout
 *     toggle, JPG export, side panel).
 *  2. Live Artifacts `data-amc-graphviz` nodes — the sandboxed iframe asks the
 *     parent page to render (viz.js is WASM and cannot run inside the opaque
 *     origin), and the parent replies through the preview bridge.
 *  3. PNG export hydration — the same runtime renders static SVG into the
 *     export snapshot so the exported transcript matches the on-screen bubble.
 *
 * `loadVizInstance` keeps the dynamic `@viz-js/viz` import (and its ~MB WASM
 * chunk) lazy: it is only fetched the first time a diagram actually renders.
 */

type DotRenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: 'empty'; message?: never }
  | { ok: false; error: 'too-large'; message?: string }
  | { ok: false; error: 'render-failed'; message: string };

interface DotRenderOptions {
  themeId?: string;
  /**
   * Forced layout. When omitted the DOT's own rankdir wins; when no rankdir is
   * present it defaults to LR (the Live Artifacts DSL default). GraphvizBlock
   * passes the user's manual LR/TB toggle here.
   */
  layout?: 'LR' | 'TB';
  /**
   * Preserves author hex and named colors. Defaults to true so custom pastel fills,
   * cluster backgrounds, and status colors render faithfully. Pass false to force
   * scrubbing hardcoded colors down to the theme palette.
   */
  preserveAuthorColors?: boolean;
  /**
   * Live Artifacts base font size in px. Graphviz labels are host-rendered, so
   * they do not inherit the preview document's font size the way model-authored
   * `em` styles do; without this the artifact font size setting grew the prose
   * while node labels stayed at graphviz's own 14pt default.
   */
  baseFontSize?: number;
}

type VizInstance = {
  renderSVGElement: (code: string) => SVGSVGElement | Promise<SVGSVGElement>;
};

let vizInstancePromise: Promise<VizInstance> | null = null;

export const getVizInstance = async (): Promise<VizInstance> => {
  if (!vizInstancePromise) {
    vizInstancePromise = import('@viz-js/viz')
      .then(({ instance }) => instance())
      .catch((error) => {
        vizInstancePromise = null;
        throw error;
      });
  }
  return vizInstancePromise;
};

const GRAPHVIZ_CACHE_LIMIT = 64;
const graphvizCache = new Map<string, string>();

// LRU eviction: Map preserves insertion order, so deleting the oldest entry
// before re-inserting on access keeps the cache bounded.
const touchGraphvizCache = (key: string, value: string) => {
  graphvizCache.delete(key);
  graphvizCache.set(key, value);
  while (graphvizCache.size > GRAPHVIZ_CACHE_LIMIT) {
    const oldestKey = graphvizCache.keys().next().value;
    if (oldestKey === undefined) break;
    graphvizCache.delete(oldestKey);
  }
};

const THEME_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const resolveGraphvizTheme = (themeId?: string): Theme => {
  if (themeId && THEME_ID_PATTERN.test(themeId)) {
    const theme = AVAILABLE_THEMES.find((candidate) => candidate.id === themeId);
    if (theme) return theme;
  }
  return AVAILABLE_THEMES.find((candidate) => candidate.id === DEFAULT_THEME_ID) ?? AVAILABLE_THEMES[0];
};

/**
 * Derives the effective layout from a DOT string: an explicit rankdir wins,
 * otherwise TB (native Graphviz default, matching GraphvizOnline).
 */
export const resolveDotLayout = (dot: string, forced?: 'LR' | 'TB'): 'LR' | 'TB' => {
  if (forced === 'LR' || forced === 'TB') return forced;
  const match = dot.match(/rankdir\s*=\s*(["']?)(LR|TB|RL|BT)\1/i);
  if (match) {
    const dir = match[2].toUpperCase();
    if (dir === 'TB' || dir === 'BT') return 'TB';
    if (dir === 'LR' || dir === 'RL') return 'LR';
  }
  return 'TB';
};

export const getGraphvizCacheKey = (dot: string, options: DotRenderOptions = {}): string => {
  const layout = resolveDotLayout(dot, options.layout);
  const colorMode = options.preserveAuthorColors === false ? 'theme' : 'author';
  // The themed DOT embeds a scaled fontsize, so the key must separate sizes or a
  // 16px SVG would be reused for a 24px artifact.
  return `${RENDER_STYLE_VERSION}:${options.themeId ?? ''}:${options.baseFontSize ?? ''}:${layout}:${colorMode}:${hashString(dot)}`;
};

// Semantic color names allowed by the Live Artifacts graphviz DSL. Strokes and
// text map to the theme's readable text colors; fills are flattened onto the
// theme surface so a data-amc-graphviz diagram stays on-theme without washing
// out on a transparent canvas.
const SEMANTIC_COLOR_ATTRS = ['color', 'fontcolor', 'fillcolor', 'bgcolor', 'bordercolor'];
const SEMANTIC_COLOR_NAMES = ['accent', 'success', 'warning', 'danger', 'muted', 'subtle'];
const SEMANTIC_TEXT_MAP: Record<string, keyof Theme['colors']> = {
  accent: 'textLink',
  success: 'textSuccess',
  warning: 'textWarning',
  danger: 'textDanger',
  muted: 'textSecondary',
  subtle: 'textTertiary',
};
const SEMANTIC_FILL_MAP: Record<string, keyof Theme['colors']> = {
  accent: 'bgInfo',
  success: 'bgSuccess',
  warning: 'bgWarning',
  danger: 'bgErrorMessage',
  // Neutral fills use the muted artifact surface, not bgInput: bgInput is pure
  // white in the light themes, so a neutral node rendered as a white card on a
  // #fefefe page (and clashed with the warm sepia canvas).
  muted: 'bgSurfaceMuted',
  subtle: 'bgTertiary',
};

// Matches `rgb(r, g, b)` and `rgba(r, g, b, a)` with integer channels and an
// optional float alpha. Theme surface colors are authored in this CSS function
// form; Graphviz does not understand it.
const RGBA_CSS_COLOR_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;

const toHexByte = (value: number): string =>
  Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, '0');

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type RgbaColor = { r: number; g: number; b: number; a: number };

const parseCssColor = (color: string): RgbaColor | null => {
  const trimmed = color.trim();
  const rgba = RGBA_CSS_COLOR_PATTERN.exec(trimmed);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  const hex = HEX_COLOR_PATTERN.exec(trimmed);
  if (!hex) return null;
  let digits = hex[1];
  if (digits.length === 3) {
    digits = `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
  }
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
  };
};

/**
 * Graphviz accepts X11 color names, `#hex`, HSV triples, and float rgb lists —
 * but not CSS `rgb()/rgba()` functions. An unrecognized color silently falls
 * back to opaque black, which is how a semantic fill (`fillcolor=accent`) turned
 * into a black node. Theme surface colors are rgba strings, so every color
 * injected into the DOT must be normalized to 8-digit hex (`#RRGGBBAA`, an alpha
 * channel Graphviz does support) first. Values that are already Graphviz-safe
 * (hex, names) pass through untouched. Only the integer-channel `rgba()` form is
 * handled; percentage channels and `hsl()` are not used by any current theme and
 * would need this function extended.
 */
export const normalizeGraphvizColor = (color: string): string => {
  const trimmed = color.trim();
  const match = RGBA_CSS_COLOR_PATTERN.exec(trimmed);
  if (!match) return trimmed;

  const [, r, g, b, a] = match;
  const alpha = a === undefined ? 255 : Math.round(parseFloat(a) * 255);
  return `#${toHexByte(Number(r))}${toHexByte(Number(g))}${toHexByte(Number(b))}${toHexByte(alpha)}`;
};

/** Graphviz nodes are small; HTML surface alphas (~0.06–0.1) read as almost white.
 *  Shared with the HTML channel so a tag and a node never disagree. */
const GRAPHVIZ_MIN_FILL_ALPHA = SEMANTIC_SURFACE_MIN_ALPHA;

/**
 * Flatten a (possibly translucent) theme surface onto an opaque base so Graphviz
 * fills stay visible against `bgcolor=transparent`. Already-opaque hex passes
 * through. Used for semantic fillcolor/bgcolor, not for strokes.
 */
export const flattenGraphvizFill = (color: string, onto: string): string => {
  const foregroundColor = parseCssColor(color);
  if (!foregroundColor) return normalizeGraphvizColor(color);
  if (foregroundColor.a >= 0.999) {
    return `#${toHexByte(foregroundColor.r)}${toHexByte(foregroundColor.g)}${toHexByte(foregroundColor.b)}`;
  }
  const backgroundColor = parseCssColor(onto) ?? { r: 255, g: 255, b: 255, a: 1 };
  const alpha = Math.max(foregroundColor.a, GRAPHVIZ_MIN_FILL_ALPHA);
  const mix = (channel: number, base: number) => channel * alpha + base * (1 - alpha);
  return `#${toHexByte(mix(foregroundColor.r, backgroundColor.r))}${toHexByte(mix(foregroundColor.g, backgroundColor.g))}${toHexByte(mix(foregroundColor.b, backgroundColor.b))}`;
};

const GRAPHVIZ_SVG_FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Helvetica, sans-serif';

// Bump when the injected default styling changes so cached SVGs rendered with
// the previous style are never reused (see getGraphvizCacheKey).
const RENDER_STYLE_VERSION = 'v14';

/**
 * Resolves CSS variables (e.g. `var(--amc-live-artifact-*)`) and CSS `rgba?()` functions
 * in Graphviz color attributes into valid hex colors.
 * Unrecognized color values silently default to black (#000000) in Graphviz WASM,
 * causing dark text on cards to become completely unreadable.
 */
export const resolveCssVariablesInDot = (dot: string, colors: Theme['colors']): string => {
  // Matches attr = "var(--...)" or attr = var(--...)
  const cssVarPattern = new RegExp(
    `\\b(${SEMANTIC_COLOR_ATTRS.join('|')})\\s*=\\s*["']?\\s*var\\(\\s*(--[a-zA-Z0-9_-]+)\\s*\\)\\s*["']?`,
    'gi',
  );

  let out = dot.replace(cssVarPattern, (_match, attr: string, varName: string) => {
    const isFill = attr.toLowerCase() === 'fillcolor' || attr.toLowerCase() === 'bgcolor';
    let resolvedHex: string;

    switch (varName) {
      case '--amc-live-artifact-accent-surface':
        resolvedHex = flattenGraphvizFill(colors.bgInfo, colors.bgInput);
        break;
      case '--amc-live-artifact-success-surface':
        resolvedHex = flattenGraphvizFill(colors.bgSuccess, colors.bgInput);
        break;
      case '--amc-live-artifact-warning-surface':
        resolvedHex = flattenGraphvizFill(colors.bgWarning, colors.bgInput);
        break;
      case '--amc-live-artifact-danger-surface':
        resolvedHex = flattenGraphvizFill(colors.bgErrorMessage, colors.bgInput);
        break;
      case '--amc-live-artifact-surface-muted':
        resolvedHex = flattenGraphvizFill(colors.bgSurfaceMuted, colors.bgInput);
        break;
      case '--amc-live-artifact-surface':
        resolvedHex = flattenGraphvizFill(colors.bgTertiary, colors.bgInput);
        break;
      case '--amc-live-artifact-accent':
        resolvedHex = isFill
          ? flattenGraphvizFill(colors.bgInfo, colors.bgInput)
          : normalizeGraphvizColor(colors.textLink);
        break;
      case '--amc-live-artifact-success':
        resolvedHex = isFill
          ? flattenGraphvizFill(colors.bgSuccess, colors.bgInput)
          : normalizeGraphvizColor(colors.textSuccess);
        break;
      case '--amc-live-artifact-warning':
        resolvedHex = isFill
          ? flattenGraphvizFill(colors.bgWarning, colors.bgInput)
          : normalizeGraphvizColor(colors.textWarning);
        break;
      case '--amc-live-artifact-danger':
        resolvedHex = isFill
          ? flattenGraphvizFill(colors.bgErrorMessage, colors.bgInput)
          : normalizeGraphvizColor(colors.textDanger);
        break;
      case '--amc-live-artifact-text':
        resolvedHex = normalizeGraphvizColor(colors.textPrimary);
        break;
      case '--amc-live-artifact-muted':
        resolvedHex = normalizeGraphvizColor(colors.textSecondary);
        break;
      case '--amc-live-artifact-subtle':
        resolvedHex = normalizeGraphvizColor(colors.textTertiary);
        break;
      case '--amc-live-artifact-border':
        resolvedHex = normalizeGraphvizColor(colors.borderSecondary);
        break;
      default:
        // Safe fallback for any unknown CSS variable so Graphviz WASM never defaults to opaque black
        resolvedHex = isFill
          ? flattenGraphvizFill(colors.bgSurfaceMuted, colors.bgInput)
          : normalizeGraphvizColor(colors.textPrimary);
        break;
    }

    return `${attr}="${resolvedHex}"`;
  });

  // Matches attr = "rgba(...)" or attr = rgb(...)
  const rgbPattern = new RegExp(
    `\\b(${SEMANTIC_COLOR_ATTRS.join('|')})\\s*=\\s*["']?\\s*(rgba?\\([^)]+\\))\\s*["']?`,
    'gi',
  );
  out = out.replace(rgbPattern, (match, attr: string, rgbVal: string) => {
    const isFill = attr.toLowerCase() === 'fillcolor' || attr.toLowerCase() === 'bgcolor';
    const parsed = parseCssColor(rgbVal);
    if (!parsed) return match;
    const hex = isFill ? flattenGraphvizFill(rgbVal, colors.bgInput) : normalizeGraphvizColor(rgbVal);
    return `${attr}="${hex}"`;
  });

  return out;
};

const DEFAULT_GRAPHVIZ_BASE_FONT_SIZE = 16;
// Ratios keep the 16px baseline pixel-identical to what shipped before (node and
// edge text at graphviz's own 14pt default, lane labels at the previous 11pt).
const GRAPHVIZ_LABEL_FONT_RATIO = 0.875;
const GRAPHVIZ_CLUSTER_LABEL_FONT_RATIO = 0.6875;

const resolveGraphvizFontSizes = (baseFontSize?: number): { label: number; clusterLabel: number } => {
  const base =
    typeof baseFontSize === 'number' && Number.isFinite(baseFontSize) && baseFontSize > 0
      ? baseFontSize
      : DEFAULT_GRAPHVIZ_BASE_FONT_SIZE;
  return {
    label: Math.round(base * GRAPHVIZ_LABEL_FONT_RATIO),
    clusterLabel: Math.round(base * GRAPHVIZ_CLUSTER_LABEL_FONT_RATIO),
  };
};

/**
 * Clean theme defaults injected before the model's own DOT for font and contrast.
 * Preserves native Graphviz shapes (ellipse, diamond, etc.) and native routing,
 * mirroring pure GraphvizOnline output without opinionated card/spline distortion.
 */
export const buildThemeDefaults = (colors: Theme['colors'], baseFontSize?: number): string => {
  const fontSize = resolveGraphvizFontSizes(baseFontSize);

  return `
  graph [
    bgcolor="transparent"
    pad="0.2"
    fontname="Helvetica"
    fontcolor="${normalizeGraphvizColor(colors.textPrimary)}"
  ];
  node [
    fontname="Helvetica"
    fontcolor="${normalizeGraphvizColor(colors.textPrimary)}"
    color="${normalizeGraphvizColor(colors.borderSecondary)}"
    fontsize="${fontSize.label}"
  ];
  edge [
    fontname="Helvetica"
    color="${normalizeGraphvizColor(colors.textSecondary)}"
    fontcolor="${normalizeGraphvizColor(colors.textSecondary)}"
    fontsize="${fontSize.label}"
  ];
`;
};

/**
 * After hardcoded color attributes are deleted, comma-separated lists often
 * become `label="x", , , shape=box` or `[penwidth=2, ]`. Graphviz treats an
 * empty attribute as a syntax error (commonly reported near `,` or `;`).
 * Commas inside quoted labels / font stacks must be left alone.
 */
const cleanupEmptyDotAttributes = (dot: string): string => {
  let out = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let charIndex = 0; charIndex < dot.length; charIndex += 1) {
    const char = dot[charIndex];

    if (quote) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }

    if (char === ',') {
      let nextIndex = charIndex + 1;
      while (nextIndex < dot.length && /\s/.test(dot[nextIndex])) {
        nextIndex += 1;
      }
      const next = dot[nextIndex];
      if (next === ',' || next === ']') {
        continue;
      }
      if (out.trimEnd().endsWith('[')) {
        continue;
      }
    }

    out += char;
  }

  return out;
};

/**
 * Recognizes CJK unified ideographs, extensions, and standard CJK punctuation/brackets.
 */
export const isCjkText = (str: string): boolean =>
  /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff01-\uff60\u2018-\u201f]/.test(str);

/**
 * WebAssembly Graphviz compiles without system TrueType/FreeType font metrics and
 * falls back to Latin (Helvetica) Adobe Font Metrics (~0.5em/char). Browser fonts
 * (PingFang SC, Microsoft YaHei) render CJK characters at 1.0em squares, which causes
 * Chinese labels to overflow / burst through node boundaries by ~20-40px on both sides.
 *
 * This function calculates the true rendered bounding width in inches so Graphviz
 * can layout cards with sufficient width and comfortable breathing margins.
 */
export const estimateCjkNodeWidth = (label: string, fontSize = 14): number => {
  const lines = label.split(/\\n|\n|<br\s*\/?>/i);
  let maxPt = 0;
  for (const line of lines) {
    let cjk = 0;
    let latin = 0;
    for (const char of line) {
      if (isCjkText(char)) {
        cjk += 1;
      } else {
        latin += 1;
      }
    }
    const lineWidthPt = cjk * fontSize * 1.05 + latin * fontSize * 0.58;
    if (lineWidthPt > maxPt) maxPt = lineWidthPt;
  }
  // 28pt padding (~0.39 in) provides safe breathing margin around text
  const widthInches = (maxPt + 28) / 72;
  return Math.max(0.75, Number(widthInches.toFixed(2)));
};

const DOT_DECLARATION_KEYWORDS = new Set(['graph', 'node', 'edge', 'subgraph', 'strict', 'digraph']);

/**
 * Scans DOT statements and dynamically injects or updates `width="..."` on any node
 * containing CJK characters, preventing text from clipping or bursting through borders.
 */
export const compensateCjkNodeWidths = (dot: string): string => {
  let out = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let inBracket = false;
  let bracketContent = '';
  let lastIdent = '';
  let sawSpaceAfterIdent = false;
  let isEdgeStatement = false;

  for (let charIndex = 0; charIndex < dot.length; charIndex += 1) {
    const char = dot[charIndex];

    if (quote) {
      if (inBracket) {
        bracketContent += char;
      } else {
        out += char;
      }

      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      if (inBracket) {
        bracketContent += char;
      } else {
        out += char;
      }
      continue;
    }

    if (!inBracket) {
      if (char === '[' && lastIdent) {
        inBracket = true;
        bracketContent = '';
        continue;
      }

      out += char;

      if (char === ';' || char === '{' || char === '}' || char === '\n') {
        lastIdent = '';
        sawSpaceAfterIdent = false;
        isEdgeStatement = false;
      } else if (char === '-' && (dot[charIndex + 1] === '>' || dot[charIndex + 1] === '-')) {
        isEdgeStatement = true;
      } else if (/[a-zA-Z0-9_\u4e00-\u9fa5]/.test(char)) {
        if (sawSpaceAfterIdent) {
          lastIdent = char;
          sawSpaceAfterIdent = false;
        } else {
          lastIdent += char;
        }
      } else if (/\s/.test(char)) {
        if (lastIdent) sawSpaceAfterIdent = true;
      } else {
        lastIdent = '';
        sawSpaceAfterIdent = false;
      }
    } else {
      if (char === ']') {
        inBracket = false;
        const nodeId = lastIdent.trim();
        lastIdent = '';
        sawSpaceAfterIdent = false;

        if (!isEdgeStatement && !DOT_DECLARATION_KEYWORDS.has(nodeId.toLowerCase())) {
          const labelMatch = bracketContent.match(/\blabel\s*=\s*"([^"]*)"/);
          const textToMeasure = labelMatch ? labelMatch[1] : isCjkText(nodeId) ? nodeId : '';

          if (textToMeasure && isCjkText(textToMeasure)) {
            const fontSizeMatch = bracketContent.match(/\bfontsize\s*=\s*["']?([0-9.]+)["']?/i);
            const fontSize = fontSizeMatch ? parseFloat(fontSizeMatch[1]) : 14;
            const requiredWidth = estimateCjkNodeWidth(textToMeasure, fontSize);
            const existingWidthMatch = bracketContent.match(/\bwidth\s*=\s*["']?([0-9.]+)["']?/i);

            if (existingWidthMatch) {
              const existingWidth = parseFloat(existingWidthMatch[1]);
              if (existingWidth < requiredWidth) {
                bracketContent = bracketContent.replace(/\bwidth\s*=\s*["']?[0-9.]+["']?/i, `width="${requiredWidth}"`);
              }
            } else {
              bracketContent = `${bracketContent.trimEnd()} width="${requiredWidth}"`;
            }
          }
        }

        out += `[${bracketContent}]`;
      } else {
        bracketContent += char;
      }
    }
  }

  return out;
};

/**
 * Calculates high-contrast fontcolor (dark slate `#0F172A` or off-white `#F8FAFC`)
 * for a given hex fill color based on standard sRGB relative luminance.
 * Ensures text remains crisp and readable across both light and dark themes.
 */
export const getContrastFontColor = (hex: string): string => {
  let sanitizedHex = hex.replace('#', '').trim();
  if (sanitizedHex.length === 3)
    sanitizedHex = sanitizedHex
      .split('')
      .map((char) => char + char)
      .join('');
  const red = parseInt(sanitizedHex.slice(0, 2), 16);
  const green = parseInt(sanitizedHex.slice(2, 4), 16);
  const blue = parseInt(sanitizedHex.slice(4, 6), 16);
  if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return '#0F172A';
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  return luminance > 140 ? '#0F172A' : '#F8FAFC';
};

/**
 * Graphviz C-engine ignores `fillcolor="..."` on nodes and clusters unless `style`
 * includes `filled` (e.g. `style="filled"` or `style="rounded,filled"`).
 *
 * This function scans DOT attribute brackets `[...]` and cluster definitions `{ ... }`
 * where `fillcolor=` is specified:
 * - If `style=` is missing, it appends `style="filled"`.
 * - If `style=` is present but does not contain `filled`, it prepends `filled,` to the style value.
 * - If `fillcolor` is a hex color and no `fontcolor` is set, it computes and injects a high-contrast
 *   text color so light pastel cards do not wash out with white text in dark themes.
 */
export const ensureFilledStyleOnFillcolor = (dot: string): string => {
  let out = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let inBracket = false;
  let bracketContent = '';

  // 1. Process attribute brackets [...]
  for (let charIndex = 0; charIndex < dot.length; charIndex += 1) {
    const char = dot[charIndex];
    if (quote) {
      if (inBracket) {
        bracketContent += char;
      } else {
        out += char;
      }
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      if (inBracket) {
        bracketContent += char;
      } else {
        out += char;
      }
      continue;
    }

    if (!inBracket) {
      if (char === '[') {
        inBracket = true;
        bracketContent = '';
        continue;
      }
      out += char;
    } else {
      if (char === ']') {
        inBracket = false;
        // Strip quoted strings to inspect attributes without false positives in label text
        const unquoted = bracketContent.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
        if (/\bfillcolor\s*=/i.test(unquoted)) {
          const styleMatch = bracketContent.match(/\bstyle\s*=\s*(["']?)([^"',\]\s]+(?:\s*,\s*[^"',\]\s]+)*)\1/i);
          if (styleMatch) {
            const currentStyles = (styleMatch[2] ?? '').split(',').map((styleName: string) => styleName.trim());
            if (!currentStyles.includes('filled')) {
              const newStyle = ['filled', ...currentStyles].join(',');
              bracketContent = bracketContent.replace(styleMatch[0], `style="${newStyle}"`);
            }
          } else {
            bracketContent = `${bracketContent.trimEnd()} style="filled"`;
          }

          // If a hex fillcolor is provided and no explicit fontcolor is set, ensure high contrast
          // so light pastel cards don't wash out with white text in dark themes
          if (!/\bfontcolor\s*=/i.test(unquoted)) {
            const hexMatch = bracketContent.match(/\bfillcolor\s*=\s*["']?(#[0-9a-fA-F]{3,8})["']?/i);
            if (hexMatch) {
              const contrastColor = getContrastFontColor(hexMatch[1]);
              bracketContent = `${bracketContent.trimEnd()} fontcolor="${contrastColor}"`;
            }
          }
        }
        out += `[${bracketContent}]`;
      } else {
        bracketContent += char;
      }
    }
  }

  // 2. Process bare fillcolor statements in cluster or graph scope outside brackets:
  // e.g. fillcolor = "#F1F5F9"; or fillcolor=warning
  let tokenized = '';
  quote = null;
  escaped = false;
  inBracket = false;
  let currentStmt = '';

  for (let charIndex = 0; charIndex < out.length; charIndex += 1) {
    const char = out[charIndex];
    if (quote) {
      currentStmt += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      currentStmt += char;
      continue;
    }

    if (char === '[') {
      inBracket = true;
      currentStmt += char;
      continue;
    }

    if (char === ']') {
      inBracket = false;
      currentStmt += char;
      continue;
    }

    if (!inBracket) {
      if (char === ';' || char === '\n' || char === '\r' || char === '}' || char === '{') {
        const trimmed = currentStmt.trim();
        if (/^fillcolor\s*=\s*(["']?)([^";\n\r]+)\1/i.test(trimmed)) {
          tokenized += `${currentStmt}; style="filled"${char}`;
        } else {
          tokenized += `${currentStmt}${char}`;
        }
        currentStmt = '';
        continue;
      }
    }

    currentStmt += char;
  }
  tokenized += currentStmt;

  return tokenized;
};

export const applyThemeAndLayout = (dot: string, options: DotRenderOptions): string => {
  let code = dot;
  const colors = resolveGraphvizTheme(options.themeId).colors;

  // Resolve CSS variables (e.g. var(--amc-live-artifact-*)) and CSS rgba?() functions to valid hex colors
  // Graphviz WASM treats any unrecognized var(...) or rgb(...) syntax as opaque black (#000000)
  code = resolveCssVariablesInDot(code, colors);

  // Compensate CJK node widths so WebAssembly Graphviz accurately sizes card boundaries for Chinese text
  code = compensateCjkNodeWidths(code);

  // Ensure style="filled" (or style="...,filled") whenever fillcolor is specified on nodes or clusters
  code = ensureFilledStyleOnFillcolor(code);

  // Normalize style="rounded" to style="rounded,filled" so fillcolor is never ignored when the model specifies rounded style
  code = code.replace(/\bstyle\s*=\s*(["'])rounded\1/gi, 'style=$1rounded,filled$1');

  // Layout: when options.layout is explicitly set (e.g. user toggled LR/TB),
  // rewrite an existing rankdir or inject it. When omitted, leave the DOT's native layout alone.
  if (options.layout) {
    const rankdirRegex = /(rankdir\s*=\s*)(["']?)(LR|TB|RL|BT)\2/gi;
    if (rankdirRegex.test(code)) {
      code = code.replace(rankdirRegex, `$1"${options.layout}"`);
    } else {
      const graphMatch = code.match(/(\s*(?:di)?graph\s+[\w\d_"]*\s*\{)/i);
      if (graphMatch) {
        code = code.replace(graphMatch[0], `${graphMatch[0]}\n  rankdir="${options.layout}";`);
      }
    }
  }

  // Semantic color names → theme values. The regex is anchored to a known
  // color attribute so `label="accent"` prose is never rewritten. Fills are
  // flattened onto the theme surface; strokes/text use the readable text palette.
  // fillcolor/bgcolor also pair a matching color+fontcolor so a lone
  // `fillcolor=success` is not a pale box with a gray border.
  const semanticColorPattern = new RegExp(
    `\\b(${SEMANTIC_COLOR_ATTRS.join('|')})\\s*=\\s*["']?(${SEMANTIC_COLOR_NAMES.join('|')})["']?`,
    'gi',
  );

  // Strip hardcoded color values when preserveAuthorColors is explicitly false.
  // By default (undefined or true), author hex/named colors are preserved faithfully.
  // The negative lookahead excludes semantic names, which the next pass maps to theme colors.
  const namedColorValue = `(?!(?:${SEMANTIC_COLOR_NAMES.join('|')})\\b)[a-zA-Z][a-zA-Z0-9-]*`;
  const attrName = `(?<!["'\\w])(?:${SEMANTIC_COLOR_ATTRS.join('|')})`;
  const hardcodedColorPattern = new RegExp(
    // rgba?() first so `rgb` is not consumed as a bare word by the named branch.
    `${attrName}\\s*=\\s*["']?(?:rgba?\\([^)]*\\)|#[0-9a-fA-F]{3,8}|${namedColorValue})["']?`,
    'gi',
  );
  if (options.preserveAuthorColors === false) {
    code = cleanupEmptyDotAttributes(code.replace(hardcodedColorPattern, ''));
  }

  code = code.replace(semanticColorPattern, (_match, attr: string, name: string) => {
    const semantic = name.toLowerCase();
    const stroke = normalizeGraphvizColor(colors[SEMANTIC_TEXT_MAP[semantic] ?? 'textPrimary']);
    const isFill = attr.toLowerCase() === 'fillcolor' || attr.toLowerCase() === 'bgcolor';
    if (isFill) {
      const fillKey = SEMANTIC_FILL_MAP[semantic] ?? 'bgInput';
      const fill = flattenGraphvizFill(colors[fillKey], colors.bgInput);
      return `${attr}="${fill}" color="${stroke}" fontcolor="${normalizeGraphvizColor(colors.textPrimary)}"`;
    }
    return `${attr}="${stroke}"`;
  });

  // Theme defaults are injected after the opening brace and after semantic color
  // replacement (they only carry concrete hex values, so nothing is rewritten).
  const themeDefaults = buildThemeDefaults(colors, options.baseFontSize);

  const openBraceIndex = code.indexOf('{');
  if (openBraceIndex !== -1) {
    code = code.slice(0, openBraceIndex + 1) + themeDefaults + code.slice(openBraceIndex + 1);
  }

  code = injectClusterDefaults(code, colors, options.baseFontSize);

  return code;
};

const injectClusterDefaults = (dot: string, colors: Theme['colors'], baseFontSize?: number): string => {
  const fontSize = resolveGraphvizFontSizes(baseFontSize);
  const clusterStyle = `
    color="${normalizeGraphvizColor(colors.borderSecondary)}"
    fontcolor="${normalizeGraphvizColor(colors.textSecondary)}"
    margin="16"
    fontsize="${fontSize.clusterLabel}"
    fontname="Helvetica"
`;
  return dot.replace(/\bsubgraph\s+(cluster\w*)\s*\{/gi, (match) => `${match}${clusterStyle}`);
};

const applyGraphvizSvgFonts = (svg: SVGSVGElement): void => {
  const rewrite = (el: Element) => {
    if (el.hasAttribute('font-family')) {
      el.setAttribute('font-family', GRAPHVIZ_SVG_FONT_FAMILY);
    }
    const style = el.getAttribute('style');
    if (style && /font-family\s*:/i.test(style)) {
      el.setAttribute('style', style.replace(/font-family\s*:\s*[^;]+/gi, `font-family: ${GRAPHVIZ_SVG_FONT_FAMILY}`));
    }
  };
  svg.setAttribute('font-family', GRAPHVIZ_SVG_FONT_FAMILY);
  rewrite(svg);
  svg.querySelectorAll('[font-family], [style]').forEach(rewrite);
};

const enhanceGraphvizSvg = (svg: SVGSVGElement, colors: Theme['colors']): void => {
  // Apply edge label text halo for high contrast against intersecting lines
  // Text halo uses paint-order: stroke fill with theme-aware background stroke
  const edgeTexts = svg.querySelectorAll('.edge text');
  if (edgeTexts.length > 0) {
    const haloColor = flattenGraphvizFill(colors.bgSurfaceMuted, colors.bgInput);
    edgeTexts.forEach((text) => {
      text.setAttribute('paint-order', 'stroke fill');
      text.setAttribute('stroke', haloColor);
      text.setAttribute('stroke-width', '3.5px');
      text.setAttribute('stroke-linejoin', 'round');
      text.setAttribute('stroke-linecap', 'round');
    });
  }
};

const sanitizeSvg = (svg: string): string => {
  // viz output is not trusted (HTML-like labels can carry event handlers), so
  // sanitize with the SVG profile and strip on* / non-https hrefs. The hook is
  // scoped to this call and removed afterwards so other sanitizers (Mermaid)
  // keep the default behavior.
  const stripDangerousAttributes = (
    _node: Element,
    data: { attrName: string; attrValue: string; keepAttr: boolean },
  ) => {
    if (data.attrName.startsWith('on')) {
      data.keepAttr = false;
      return;
    }
    if (
      (data.attrName === 'href' || data.attrName === 'xlink:href') &&
      data.attrValue &&
      !/^https:/i.test(data.attrValue.trim())
    ) {
      data.keepAttr = false;
    }
  };
  DOMPurify.addHook('uponSanitizeAttribute', stripDangerousAttributes);
  try {
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'a'],
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', stripDangerousAttributes);
  }
};

/**
 * Renders DOT to a sanitized SVG string. Never throws for invalid input — the
 * result carries a machine-readable error so the Live Artifacts bridge can show
 * the DOT source as a fallback and the export path can skip the node.
 */
export const renderDotToSvg = async (dot: string, options: DotRenderOptions = {}): Promise<DotRenderResult> => {
  const code = dot.trim();
  if (!code) {
    return { ok: false, error: 'empty' };
  }
  if (code.length > DOT_MAX_CHARS) {
    return {
      ok: false,
      error: 'too-large',
      message: `DOT length exceeds limit (${code.length}/${DOT_MAX_CHARS} chars)`,
    };
  }
  const nodeCount = countDotNodes(code);
  if (nodeCount > DOT_MAX_NODES) {
    return {
      ok: false,
      error: 'too-large',
      message: `Diagram node count exceeds limit (${nodeCount}/${DOT_MAX_NODES} nodes)`,
    };
  }
  const edgeCount = countDotEdges(code);
  if (edgeCount > DOT_MAX_EDGES) {
    return {
      ok: false,
      error: 'too-large',
      message: `Diagram edge count exceeds limit (${edgeCount}/${DOT_MAX_EDGES} edges)`,
    };
  }

  try {
    const vizInstance = await getVizInstance();
    const theme = resolveGraphvizTheme(options.themeId);
    const processedCode = applyThemeAndLayout(code, options);
    const svgElement = await vizInstance.renderSVGElement(processedCode);
    applyGraphvizSvgFonts(svgElement);
    enhanceGraphvizSvg(svgElement, theme.colors);

    // Keep the SVG at its natural width so narrow diagrams center via
    // margin:auto and wide ones scroll in the container instead of being
    // proportionally squashed into the available width.
    svgElement.style.maxWidth = 'none';
    svgElement.style.margin = '0 auto';
    svgElement.style.height = 'auto';
    svgElement.style.display = 'block';

    return { ok: true, svg: sanitizeSvg(svgElement.outerHTML) };
  } catch (renderError) {
    const message = getErrorMessage(renderError, 'Graphviz render failed');
    logService.error('Failed to render Graphviz diagram', renderError);
    return { ok: false, error: 'render-failed', message };
  }
};

/**
 * Cached twin of `renderDotToSvg`, shared by the Live Artifacts bridge and the
 * export path. The cache key includes theme + layout, so a diagram rendered for
 * one theme never leaks a stale color into another theme's snapshot.
 */
export const renderDotToSvgCached = async (dot: string, options: DotRenderOptions = {}): Promise<DotRenderResult> => {
  const key = getGraphvizCacheKey(dot, options);
  const cached = graphvizCache.get(key);
  if (cached !== undefined) {
    touchGraphvizCache(key, cached);
    return { ok: true, svg: cached };
  }

  const result = await renderDotToSvg(dot, options);
  if (result.ok) {
    touchGraphvizCache(key, result.svg);
  }
  return result;
};

/**
 * Hydrates every `data-amc-graphviz` node in a detached document (the PNG-export
 * snapshot) as static SVG. Failures leave the node untouched so the export never
 * breaks on a bad diagram — it just shows the inert placeholder.
 */
export const hydrateGraphvizIntoDocument = async (doc: Document, options: DotRenderOptions = {}): Promise<void> => {
  const nodes = Array.from(doc.querySelectorAll('[data-amc-graphviz]'));
  if (nodes.length === 0) {
    return;
  }

  await Promise.all(
    nodes.map(async (node) => {
      const htmlEl = node as HTMLElement;
      const dot = (htmlEl.getAttribute('data-amc-graphviz') || htmlEl.textContent)?.trim() ?? '';
      const result = await renderDotToSvgCached(dot, options);
      if (!result.ok) return;

      try {
        const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
        if (parsed.querySelector('parsererror')) return;

        const svgEl = parsed.documentElement;
        const existingStyle = svgEl.getAttribute('style') || '';
        const responsiveStyle = 'max-width: 100%; height: auto; display: block; margin: 0 auto;';
        svgEl.setAttribute('style', existingStyle ? `${existingStyle}; ${responsiveStyle}` : responsiveStyle);

        const htmlEl = node as HTMLElement;
        htmlEl.style.overflowX = 'auto';
        htmlEl.style.maxWidth = '100%';
        htmlEl.style.display = 'block';
        htmlEl.style.cursor = 'zoom-in';
        htmlEl.setAttribute('data-amc-graphviz-state', 'rendered');
        htmlEl.setAttribute('title', '点击放大查看 / Click to zoom');

        node.replaceChildren(svgEl);
      } catch {
        // Leave the node as-is; it stays an inert placeholder in the snapshot.
      }
    }),
  );
};
