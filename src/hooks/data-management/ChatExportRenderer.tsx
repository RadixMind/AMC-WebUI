import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { AppSettings, SavedChatSession, SideViewContent, UploadedFile } from '@/types';
import { DEFAULT_APP_SETTINGS } from '@/constants/settingsDefaults';
import { I18nProvider } from '@/contexts/I18nContext';
import { MessageContent } from '@/components/message/MessageContent';
import { getVisibleChatMessages } from '@/utils/chat/visibility';
import { normalizeThemeId } from '@/utils/theme/themeMode';

const CHAT_EXPORT_RENDER_SETTLE_DELAY_MS = 100;
const CHAT_EXPORT_MAX_SETTLE_TIMEOUT_MS = 3000;

const waitForExportContentToSettle = async (host: HTMLElement): Promise<void> => {
  const startTime = Date.now();
  // Minimum settle time for react flush and initial microtasks
  await new Promise((resolve) => window.setTimeout(resolve, CHAT_EXPORT_RENDER_SETTLE_DELAY_MS));

  while (Date.now() - startTime < CHAT_EXPORT_MAX_SETTLE_TIMEOUT_MS) {
    const hasPending = host.querySelector('[data-export-pending="true"], [data-diagram-rendering="true"]');
    if (!hasPending) {
      // Allow an extra tick for DOM commits
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
};

const noop = () => {};

const createExportAppSettings = (session: SavedChatSession, themeId: string): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  ...session.settings,
  themeId: normalizeThemeId(themeId),
  showThoughts: false,
});

interface ChatExportRendererProps {
  session: SavedChatSession;
  themeId: string;
}

const ChatExportRenderer: React.FC<ChatExportRendererProps> = ({ session, themeId }) => {
  const appSettings = createExportAppSettings(session, themeId);
  const appThemeId = appSettings.themeId;
  const visibleMessages = getVisibleChatMessages(session.messages);

  return (
    <I18nProvider>
      <div className="export-chat-transcript" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {visibleMessages.map((message) => (
          <article
            key={message.id}
            data-message-id={message.id}
            data-message-role={message.role}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
              breakInside: 'avoid',
            }}
          >
            <div
              className="message-content-container"
              style={{
                maxWidth: '100%',
                color: message.role === 'user' ? 'var(--theme-bg-user-message-text)' : 'var(--theme-text-primary)',
                background: message.role === 'user' ? 'var(--theme-bg-user-message)' : 'transparent',
                borderRadius: message.role === 'user' ? '1rem 0.25rem 1rem 1rem' : '0',
                padding: message.role === 'user' ? '0.75rem 1rem' : '0',
              }}
            >
              <MessageContent
                message={message}
                onImageClick={noop}
                onOpenHtmlPreview={noop}
                showThoughts={appSettings.showThoughts}
                baseFontSize={appSettings.baseFontSize}
                expandCodeBlocksByDefault={appSettings.expandCodeBlocksByDefault}
                isMermaidRenderingEnabled={appSettings.isMermaidRenderingEnabled}
                isGraphvizRenderingEnabled={appSettings.isGraphvizRenderingEnabled ?? true}
                onSuggestionClick={noop}
                appSettings={appSettings}
                themeId={appThemeId}
                onOpenSidePanel={noop as (content: SideViewContent) => void}
                onConfigureFile={noop as (file: UploadedFile, messageId: string) => void}
                isGemini3={false}
                diagramLoadMode="eager"
              />
            </div>
          </article>
        ))}
      </div>
    </I18nProvider>
  );
};

export const createChatExportElement = async (
  session: SavedChatSession,
  themeId: string,
): Promise<{ element: HTMLElement; cleanup: () => void }> => {
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left = '-9999px';
  host.style.top = '0';
  host.style.width = '800px';
  host.className = `theme-${themeId}`;
  document.body.appendChild(host);

  const root = createRoot(host);

  flushSync(() => {
    root.render(React.createElement(ChatExportRenderer, { session, themeId }));
  });

  await waitForExportContentToSettle(host);

  const element = host.querySelector('.export-chat-transcript') as HTMLElement | null;
  if (!element) {
    root.unmount();
    document.body.removeChild(host);
    throw new Error('Failed to render chat export content.');
  }

  return {
    element,
    cleanup: () => {
      root.unmount();
      if (document.body.contains(host)) {
        document.body.removeChild(host);
      }
    },
  };
};
