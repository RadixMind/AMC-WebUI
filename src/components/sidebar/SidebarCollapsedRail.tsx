import React from 'react';
import { Library, Search, Settings } from 'lucide-react';
import { IconNewChat, IconSidebarToggle } from '@/components/icons';
import { useI18n } from '@/contexts/I18nContext';
import { CollapsedRecentChatsButton } from './CollapsedRecentChatsButton';
import { SIDEBAR_CLICKABLE_ICON_BUTTON_CLASS, SIDEBAR_ICON_LINK_BUTTON_CLASS } from './sidebarStyles';
import type { SavedChatSession } from '@/types';

const MiniSidebarButton: React.FC<{
  onClick: () => void;
  icon: React.ElementType;
  title: string;
  href?: string;
  className?: string;
  strokeWidth?: number;
}> = ({ onClick, icon: Icon, title, href, className = '', strokeWidth = 2 }) => {
  if (href) {
    return (
      <a
        href={href}
        onClick={(event) => {
          if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          }
        }}
        className={[SIDEBAR_ICON_LINK_BUTTON_CLASS, className].filter(Boolean).join(' ')}
        title={title}
        aria-label={title}
      >
        <Icon size={20} strokeWidth={strokeWidth} />
      </a>
    );
  }
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={[SIDEBAR_CLICKABLE_ICON_BUTTON_CLASS, className].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
    >
      <Icon size={20} strokeWidth={strokeWidth} />
    </button>
  );
};

export interface SidebarCollapsedRailProps {
  onToggle: () => void;
  onNewChat: () => void;
  newChatShortcut: string;
  brandHref?: string;
  activeView: string;
  setActiveView: (view: 'chat' | 'library') => void;
  onMiniSearchClick: () => void;
  searchChatsShortcut: string;
  sessions: SavedChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onOpenSettingsModal: () => void;
}

export const SidebarCollapsedRail: React.FC<SidebarCollapsedRailProps> = ({
  onToggle,
  onNewChat,
  newChatShortcut,
  brandHref = '/',
  activeView,
  setActiveView,
  onMiniSearchClick,
  searchChatsShortcut,
  sessions,
  activeSessionId,
  onSelectSession,
  onOpenSettingsModal,
}) => {
  const { t } = useI18n();
  const searchTitle = t('historySearchButton') + (searchChatsShortcut ? ` (${searchChatsShortcut})` : '');

  return (
    <>
      <MiniSidebarButton
        onClick={onToggle}
        icon={IconSidebarToggle}
        title={t('historySidebarOpen')}
        className="-translate-y-1"
        strokeWidth={2.2}
      />

      <div className="w-8 h-px bg-[var(--theme-border-primary)] my-1" />

      <MiniSidebarButton
        href={brandHref}
        onClick={onNewChat}
        icon={IconNewChat}
        title={t('newChat') + (newChatShortcut ? ` (${newChatShortcut})` : '')}
      />
      <MiniSidebarButton
        href="/library"
        onClick={() => setActiveView('library')}
        icon={Library}
        title={t('libraryTitle')}
        className={activeView === 'library' ? 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)]' : ''}
      />
      <MiniSidebarButton onClick={onMiniSearchClick} icon={Search} title={searchTitle} />
      <CollapsedRecentChatsButton
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
      />

      <div className="mt-auto">
        <MiniSidebarButton onClick={onOpenSettingsModal} icon={Settings} title={t('settingsTitle')} />
      </div>
    </>
  );
};
