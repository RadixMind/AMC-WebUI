import React, { useState } from 'react';
import { useI18n } from '@/contexts/I18nContext';
import {
  SquarePen,
  Trash2,
  Pin,
  PinOff,
  Download,
  Copy,
  FolderInput,
  Folder,
  Check,
  Sparkles,
  Link,
} from 'lucide-react';
import { type ChatGroup, type SavedChatSession } from '@/types';
import { useCopyToClipboard } from '@/hooks/ui/useCopyToClipboard';
import { toastSuccess } from '@/stores/toastStore';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/shared/DropdownMenu';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/shared/ContextMenu';

export interface SessionMenuItemsProps {
  variant: 'dropdown' | 'context';
  session: SavedChatSession;
  groups: ChatGroup[];
  onMoveSessionToGroup: (sessionId: string, groupId: string | null) => void;
  onStartEdit: () => void;
  onTogglePin: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onRegenerateTitle?: () => void;
  isGeneratingTitle?: boolean;
}

export const SessionMenuItems: React.FC<SessionMenuItemsProps> = ({
  variant,
  session,
  groups,
  onMoveSessionToGroup,
  onStartEdit,
  onTogglePin,
  onDuplicate,
  onExport,
  onDelete,
  onRegenerateTitle,
  isGeneratingTitle = false,
}) => {
  const { t } = useI18n();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const { copyToClipboard } = useCopyToClipboard();

  const handleCopyLink = async () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/chat/${session.id}` : `/chat/${session.id}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      toastSuccess(t('historyLinkCopied'));
    }
  };

  const Item = variant === 'dropdown' ? DropdownMenuItem : ContextMenuItem;
  const Separator = variant === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator;
  const Shortcut = variant === 'dropdown' ? DropdownMenuShortcut : ContextMenuShortcut;
  const Sub = variant === 'dropdown' ? DropdownMenuSub : ContextMenuSub;
  const SubTrigger = variant === 'dropdown' ? DropdownMenuSubTrigger : ContextMenuSubTrigger;
  const SubContent = variant === 'dropdown' ? DropdownMenuSubContent : ContextMenuSubContent;

  return (
    <>
      <Item onSelect={onStartEdit}>
        <SquarePen size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
        <span>{t('edit')}</span>
        <Shortcut>Enter</Shortcut>
      </Item>

      {onRegenerateTitle && (
        <Item onSelect={onRegenerateTitle} disabled={isGeneratingTitle}>
          <Sparkles size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
          <span>{t('regenerateTitle')}</span>
        </Item>
      )}

      <Separator />

      <Item onSelect={onTogglePin}>
        {session.isPinned ? (
          <PinOff size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
        ) : (
          <Pin size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
        )}
        <span>{session.isPinned ? t('historyUnpin') : t('historyPin')}</span>
        <Shortcut>⌘P</Shortcut>
      </Item>

      <Item onSelect={handleCopyLink} title={t('historyCopyLink')}>
        <Link size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
        <span>{t('historyCopyLink')}</span>
      </Item>

      <Item onSelect={onDuplicate}>
        <Copy size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
        <span>{t('historyDuplicate')}</span>
        <Shortcut>⌘D</Shortcut>
      </Item>

      <Item onSelect={onExport} title={t('exportChat')}>
        <Download size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
        <span>{t('exportChat')}</span>
        <Shortcut>⌘E</Shortcut>
      </Item>

      <Sub>
        <SubTrigger>
          <span className="flex items-center gap-2">
            <FolderInput size={14} className="text-[var(--theme-text-secondary)] shrink-0" />
            <span>{t('historyMoveToGroup')}</span>
          </span>
        </SubTrigger>
        <SubContent className="w-48 p-1 max-h-56 overflow-y-auto custom-scrollbar">
          <Item onSelect={() => onMoveSessionToGroup(session.id, null)}>
            <Folder size={13} className="text-[var(--theme-text-secondary)] shrink-0" />
            <span className="truncate">{t('historyMoveToUngrouped')}</span>
            {session.groupId == null && <Check className="ml-auto h-3.5 w-3.5 text-[var(--theme-text-link)]" />}
          </Item>
          {groups.map((group) => (
            <Item key={group.id} onSelect={() => onMoveSessionToGroup(session.id, group.id)} title={group.title}>
              <Folder size={13} className="shrink-0 text-[var(--theme-text-secondary)] shrink-0" />
              <span className="truncate">{group.title}</span>
              {session.groupId === group.id && <Check className="ml-auto h-3.5 w-3.5 text-[var(--theme-text-link)]" />}
            </Item>
          ))}
        </SubContent>
      </Sub>

      <Separator />

      {isConfirmingDelete ? (
        <div
          data-testid="inline-delete-confirm"
          className="flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--theme-bg-danger)]/15 border border-[var(--theme-text-danger)]/30 text-xs animate-in fade-in zoom-in-95 duration-100"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="font-medium text-[var(--theme-text-danger)] truncate pr-1">{t('historyConfirmDelete')}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              autoFocus
              onClick={(event) => {
                event.stopPropagation();
                setIsConfirmingDelete(false);
              }}
              className="px-1.5 py-0.5 rounded text-[11px] font-medium text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] transition-colors cursor-pointer"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--theme-text-danger)] text-white hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
            >
              {t('delete')}
            </button>
          </div>
        </div>
      ) : (
        <Item
          variant="danger"
          onSelect={(event: Event) => {
            event.preventDefault();
            setIsConfirmingDelete(true);
          }}
        >
          <Trash2 size={14} className="shrink-0" />
          <span>{t('delete')}</span>
          <Shortcut>⌫</Shortcut>
        </Item>
      )}
    </>
  );
};
