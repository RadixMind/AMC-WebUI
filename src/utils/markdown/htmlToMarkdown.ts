import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import { logService } from '@/services/logService';
import { normalizeConvertedMarkdown } from './normalizeConvertedMarkdown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

turndownService.use(gfm);

turndownService.remove(['script', 'style', 'noscript', 'iframe', 'object', 'video', 'audio']);

turndownService.addRule('removeSvg', {
  filter: (node) => node.nodeName.toLowerCase() === 'svg',
  replacement: () => '',
});

interface TurndownBlankRuleContainer {
  blankRule: {
    replacement: (content: string, node: Node, options: unknown) => string;
  };
}

const turndownRules = (turndownService as any).rules as TurndownBlankRuleContainer;
const defaultBlankReplacement = turndownRules.blankRule.replacement;

turndownRules.blankRule.replacement = (content: string, node: Node, options: unknown) => {
  if (['DIV', 'PRE'].includes(node.nodeName) && (node as HTMLElement).hasAttribute('data-amc-graphviz')) {
    const el = node as HTMLElement;
    const dot = el.getAttribute('data-amc-graphviz')?.trim() || el.textContent?.trim();
    if (dot) return `\n\n\`\`\`graphviz\n${dot}\n\`\`\`\n\n`;
  }
  if (
    node.nodeName === 'DIV' &&
    ((node as HTMLElement).hasAttribute('data-amc-echarts') || (node as HTMLElement).hasAttribute('data-amc-chart'))
  ) {
    const spec =
      (node as HTMLElement).getAttribute('data-amc-echarts')?.trim() ||
      (node as HTMLElement).getAttribute('data-amc-chart')?.trim();
    if (spec) return `\n\n\`\`\`echarts\n${spec}\n\`\`\`\n\n`;
  }
  return defaultBlankReplacement.call(turndownRules.blankRule, content, node, options);
};

turndownService.addRule('graphvizBlock', {
  filter: (node) => ['DIV', 'PRE'].includes(node.nodeName) && (node as HTMLElement).hasAttribute('data-amc-graphviz'),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const dot = el.getAttribute('data-amc-graphviz')?.trim() || el.textContent?.trim();
    return dot ? `\n\n\`\`\`graphviz\n${dot}\n\`\`\`\n\n` : '';
  },
});

turndownService.addRule('echartsBlock', {
  filter: (node) =>
    node.nodeName === 'DIV' && (node.hasAttribute('data-amc-echarts') || node.hasAttribute('data-amc-chart')),
  replacement: (_content, node) => {
    const spec =
      (node as HTMLElement).getAttribute('data-amc-echarts')?.trim() ||
      (node as HTMLElement).getAttribute('data-amc-chart')?.trim();
    return spec ? `\n\n\`\`\`echarts\n${spec}\n\`\`\`\n\n` : '';
  },
});

turndownService.addRule('copyButton', {
  filter: (node) =>
    node.nodeName === 'BUTTON' &&
    ((node as HTMLElement).hasAttribute('data-amc-copy') || (node as HTMLElement).classList.contains('copy-btn')),
  replacement: () => '',
});

turndownService.addRule('katex', {
  filter: (node) => {
    return node.nodeName === 'SPAN' && node.classList.contains('katex');
  },
  replacement: (content, node) => {
    const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) {
      const latex = annotation.textContent || '';
      const isDisplay = node.classList.contains('katex-display') || node.querySelector('.katex-display') !== null;

      return isDisplay ? `$$ ${latex} $$` : `$${latex}$`;
    }
    return content;
  },
});

const firstSrcsetUrl = (srcset: string): string => srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? '';

const imageSourceFromNode = (node: HTMLElement): string => {
  const src = node.getAttribute('src')?.trim() || '';
  if (src) return src;

  const dataSrc = node.getAttribute('data-src')?.trim() || '';
  if (dataSrc) return dataSrc;

  return firstSrcsetUrl(node.getAttribute('srcset') || node.getAttribute('data-srcset') || '');
};

const escapeMarkdownAlt = (alt: string): string => alt.replace(/[[\]]/g, '');

turndownService.addRule('lightboxImage', {
  filter: (node) => {
    if (node.nodeName !== 'A') return false;
    const hasImage = Boolean(node.querySelector('img'));
    const isLightbox =
      node.classList.contains('lightbox') || Boolean(node.querySelector('.meta, .informations, .lightbox-wrapper'));
    return hasImage && isLightbox;
  },
  replacement: (_content, node) => {
    const image = node.querySelector('img');
    if (!image) return '';

    const src = imageSourceFromNode(image) || node.getAttribute('href')?.trim() || '';
    if (!src) return '';

    return `![${escapeMarkdownAlt(image.getAttribute('alt') || '')}](${src})`;
  },
});

turndownService.addRule('contentImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const src = imageSourceFromNode(node);
    if (!src) return '';

    return `![${escapeMarkdownAlt(node.getAttribute('alt') || '')}](${src})`;
  },
});

const restoreReadableHeadingNumberPunctuation = (markdown: string): string =>
  markdown.replace(/^(#{1,6}\s+\d+)\\\./gm, '$1.');

export const convertHtmlToMarkdown = (html: string): string => {
  try {
    return normalizeConvertedMarkdown(restoreReadableHeadingNumberPunctuation(turndownService.turndown(html)));
  } catch (conversionError) {
    logService.error('Failed to convert HTML to Markdown:', conversionError);
    return '';
  }
};
