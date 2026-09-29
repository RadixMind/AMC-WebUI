import { escapeHtml } from '@/utils/format/escapeHtml';
import { AVAILABLE_THEMES, DEFAULT_THEME_ID } from '@/constants/themeRegistry';
import { buildLiveArtifactThemeVars } from '@/utils/live-ui/liveUiThemeTokens';
import { convertHtmlToMarkdown } from '@/utils/markdown/htmlToMarkdown';
import { isLikelyHtml } from '@/utils/markdown/previewMarkupPatterns';
import { buildHtmlExportStyles } from './htmlExportStyles';
import { buildHtmlExportRuntime } from './htmlExportRuntime';

interface ExportHtmlLabels {
  copyText: string;
  copyTitle: string;
  copiedText: string;
  printText: string;
  printTitle: string;
}

const EXPORT_HTML_LABELS: Record<string, ExportHtmlLabels> = {
  zh: {
    copyText: '复制',
    copyTitle: '复制正文',
    copiedText: '已复制',
    printText: '打印 (PDF)',
    printTitle: '打印 (PDF)',
  },
  en: {
    copyText: 'Copy',
    copyTitle: 'Copy Content',
    copiedText: 'Copied',
    printText: 'Print (PDF)',
    printTitle: 'Print (PDF)',
  },
  ja: {
    copyText: 'コピー',
    copyTitle: '本文をコピー',
    copiedText: 'コピー完了',
    printText: '印刷 (PDF)',
    printTitle: '印刷 (PDF)',
  },
  ko: {
    copyText: '복사',
    copyTitle: '본문 복사',
    copiedText: '복사됨',
    printText: '인쇄 (PDF)',
    printTitle: '인쇄 (PDF)',
  },
  es: {
    copyText: 'Copiar',
    copyTitle: 'Copiar contenido',
    copiedText: 'Copiado',
    printText: 'Imprimir (PDF)',
    printTitle: 'Imprimir (PDF)',
  },
  fr: {
    copyText: 'Copier',
    copyTitle: 'Copier le contenu',
    copiedText: 'Copié',
    printText: 'Imprimer (PDF)',
    printTitle: 'Imprimer (PDF)',
  },
  de: {
    copyText: 'Kopieren',
    copyTitle: 'Inhalt kopieren',
    copiedText: 'Kopiert',
    printText: 'Drucken (PDF)',
    printTitle: 'Drucken (PDF)',
  },
};

export const generateExportHtmlTemplate = ({
  title,
  date,
  model,
  contentHtml,
  styles,
  themeId,
  language,
  rootBgColor,
  bodyClasses,
}: {
  title: string;
  date: string;
  model: string;
  contentHtml: string;
  styles: string;
  themeId: string;
  language: string;
  rootBgColor: string;
  bodyClasses: string;
}) => {
  const safeTitle = escapeHtml(title);
  const safeDate = escapeHtml(date);
  const safeModel = escapeHtml(model);
  const safeLanguage = escapeHtml(language);
  const safeThemeId = escapeHtml(themeId);
  const safeBodyClasses = escapeHtml(bodyClasses);
  const selectedTheme =
    AVAILABLE_THEMES.find((theme) => theme.id === themeId) ??
    AVAILABLE_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID) ??
    AVAILABLE_THEMES[0];
  const langKey = language?.toLowerCase().slice(0, 2) || 'en';
  const labels = EXPORT_HTML_LABELS[langKey] || EXPORT_HTML_LABELS.en;
  const safeCopyTitle = escapeHtml(labels.copyTitle);
  const safeCopyText = escapeHtml(labels.copyText);
  const safePrintTitle = escapeHtml(labels.printTitle);
  const safePrintText = escapeHtml(labels.printText);
  const jsonCopiedText = JSON.stringify(labels.copiedText);
  const liveArtifactThemeVars = buildLiveArtifactThemeVars(selectedTheme.colors);
  const fallbackBgColor = selectedTheme.colors.bgPrimary;
  const trimmedRootBgColor = rootBgColor?.trim() ?? '';
  const safeRootBgColor =
    /^(#[0-9a-fA-F]{3,8}|rgb\([^()]*\)|rgba\([^()]*\)|hsl\([^()]*\)|hsla\([^()]*\)|oklch\([^()]*\)|currentColor|[a-z]+)$/i.test(
      trimmedRootBgColor,
    ) && trimmedRootBgColor !== 'transparent'
      ? trimmedRootBgColor
      : fallbackBgColor;

  const exportStyles = buildHtmlExportStyles({ liveArtifactThemeVars, safeRootBgColor });
  const exportRuntime = buildHtmlExportRuntime(jsonCopiedText);

  return `
        <!DOCTYPE html>
        <html lang="${safeLanguage}">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Chat Export: ${safeTitle}</title>
            ${styles}
            <style>
${exportStyles}
            </style>
        </head>
        <body class="${safeBodyClasses} theme-${safeThemeId} is-exporting-png">
            <div class="exported-chat-container">
                <header class="exported-chat-header">
                    <div class="exported-topbar">
                        <div class="exported-breadcrumb-nav">
                            <div class="exported-brand-badge">
                                <svg class="exported-brand-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                                    <polyline points="2 17 12 22 22 17"></polyline>
                                    <polyline points="2 12 12 17 22 12"></polyline>
                                </svg>
                                <span>AMC WebUI</span>
                            </div>
                            <span class="exported-breadcrumb-sep">/</span>
                            <h1 class="exported-breadcrumb-title" title="${safeTitle}">${safeTitle}</h1>
                        </div>
                        <div class="exported-topbar-actions">
                            <button type="button" class="exported-action-btn" id="amc-copy-btn" title="${safeCopyTitle}" aria-label="${safeCopyTitle}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                <span id="amc-copy-text">${safeCopyText}</span>
                            </button>
                            <button type="button" class="exported-action-btn" id="amc-print-btn" onclick="window.print()" title="${safePrintTitle}" aria-label="${safePrintTitle}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                                <span>${safePrintText}</span>
                            </button>
                        </div>
                    </div>
                    <div class="exported-chat-meta">
                        <div class="exported-meta-pill">
                            <span class="exported-meta-dot"></span>
                            <span class="exported-meta-val">${safeDate}</span>
                        </div>
                        <span class="exported-meta-divider">•</span>
                        <div class="exported-meta-pill">
                            <span class="exported-meta-dot meta-dot-model"></span>
                            <span class="exported-meta-val">${safeModel}</span>
                        </div>
                    </div>
                </header>
                <div class="exported-chat-content">
                    ${contentHtml}
                </div>
                <footer class="exported-chat-footer">
                    <div class="exported-footer-content">
                        <span>Generated by <strong>AMC WebUI</strong></span>
                        <span>•</span>
                        <span>${safeDate}</span>
                    </div>
                </footer>
            </div>
            <script>
${exportRuntime}
            </script>
        </body>
        </html>
    `;
};

/**
 * Normalizes message content for plain-text (.txt) export.
 * If the message contains Live UI HTML or is a raw HTML fragment, converts it to
 * readable Markdown/text rather than dumping raw HTML DOM markup and style tags.
 */
export const formatMessageContentForTxt = (content: string): string => {
  if (!content) return '';

  let formatted = content;

  if (formatted.includes('```amc-live-artifact-html')) {
    formatted = formatted.replace(/```amc-live-artifact-html\n([\s\S]*?)\n?```/g, (_match, html) => {
      const converted = convertHtmlToMarkdown(html);
      return converted.trim() ? converted.trim() : _match;
    });
  }

  const trimmed = formatted.trimStart();
  if (
    isLikelyHtml(trimmed) ||
    /^<(!DOCTYPE\s+html|html|div|p|h[1-6]|table|article|section|main|header|footer)\b/i.test(trimmed)
  ) {
    const converted = convertHtmlToMarkdown(formatted);
    if (converted.trim()) {
      return converted.trim();
    }
  }

  return formatted;
};

export const generateExportTxtTemplate = ({
  title,
  date,
  model,
  messages,
}: {
  title: string;
  date: string;
  model: string;
  messages: Array<{
    role: string;
    timestamp: Date | number | string;
    content?: string;
    thoughts?: string;
    files?: Array<{ name: string }>;
  }>;
}) => {
  const separator = '-'.repeat(40);

  const header = [`Chat: ${title}`, `Date: ${date}`, `Model: ${model}`, '='.repeat(40), ''].join('\n');

  const body = messages
    .map((message) => {
      const roleTitle = message.role.toUpperCase();
      const timestampDate = message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp);
      const timestampText = Number.isNaN(timestampDate.getTime()) ? '' : ` [${timestampDate.toLocaleString()}]`;
      let text = `### ${roleTitle}${timestampText}\n`;

      if (message.files && message.files.length > 0) {
        message.files.forEach((file) => {
          text += `[Attachment: ${file.name}]\n`;
        });
      }

      if (message.thoughts && message.thoughts.trim()) {
        text += `[Thinking Process]\n${message.thoughts.trim()}\n\n`;
      }

      text += formatMessageContentForTxt(message.content || '');
      return text;
    })
    .join(`\n\n${separator}\n\n`);

  return header + body;
};
