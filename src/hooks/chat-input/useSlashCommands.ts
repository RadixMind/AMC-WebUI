import { type Dispatch, type RefObject, type SetStateAction, useState, useMemo, useCallback, useEffect } from 'react';
import { type translations } from '@/i18n/translations';
import { type AttachmentAction, type ModelOption, type ThinkingLevel } from '@/types';
import type { SlashCommand as Command } from '@/types/slashCommands';
import type { ChatToolToggleStates } from '@/types/chatTools';
import { getChatToolsForSurface } from '@/features/chat-tools/toolRegistry';
import { getCachedModelCapabilities } from '@/stores/modelCapabilitiesStore';
import { useMultimodalSearchStore } from '@/stores/multimodalSearchStore';
import {
  type SlashCommandState,
  CLOSED_SLASH_COMMAND_STATE,
  INPUT_POPULATING_COMMANDS,
  getSlashCursor,
  findSlashAnchor,
  sortSlashCommandsByGroup,
  buildModelCommands,
} from './slashCommandCursor';
import { useSlashCommandActions, type CommandDefinition } from './useSlashCommandActions';

export type { SlashCommandState };

const matchesModelKeyword = (model: ModelOption, keyword: string): boolean => {
  if (!keyword) return true;
  const kw = keyword.toLowerCase();
  const nameLower = model.name.toLowerCase();
  const idLower = model.id.toLowerCase();
  if (nameLower.includes(kw) || idLower.includes(kw)) {
    return true;
  }
  const normKw = kw.replace(/[-_]/g, ' ');
  const normName = nameLower.replace(/[-_]/g, ' ');
  const normId = idLower.replace(/[-_]/g, ' ');
  return normName.includes(normKw) || normId.includes(normKw);
};

interface UseSlashCommandsProps {
  t: (key: keyof typeof translations) => string;
  toolStates: ChatToolToggleStates;
  onClearChat: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onToggleLiveArtifactsPrompt: () => void;
  onTogglePinCurrentSession: () => void;
  onRetryLastTurn: () => void;
  onAttachmentAction: (action: AttachmentAction) => void;
  availableModels: ModelOption[];
  onSelectModel: (modelId: string) => void;
  onMessageSent: () => void;
  setIsHelpModalOpen: (isOpen: boolean) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onEditLastUserMessage: () => void;
  onTogglePip: () => void;
  setInputText: Dispatch<SetStateAction<string>>;
  currentModelId: string;
  /** Active session routing — Gemini built-in tool commands are hidden on third-party routes. */
  providerId?: string;
  onSetThinkingLevel: (level: ThinkingLevel) => void;
  thinkingLevel?: ThinkingLevel;
  inputText?: string;
}

export const useSlashCommands = ({
  t,
  toolStates,
  onClearChat,
  onNewChat,
  onOpenSettings,
  onToggleLiveArtifactsPrompt,
  onTogglePinCurrentSession,
  onRetryLastTurn,
  onAttachmentAction,
  availableModels,
  onSelectModel,
  onMessageSent,
  setIsHelpModalOpen,
  textareaRef,
  onEditLastUserMessage,
  onTogglePip,
  setInputText,
  currentModelId,
  providerId,
  onSetThinkingLevel,
  thinkingLevel,
  inputText,
}: UseSlashCommandsProps) => {
  const [slashCommandState, setSlashCommandState] = useState<SlashCommandState>(CLOSED_SLASH_COMMAND_STATE);

  const commandDefinitions = useMemo<CommandDefinition[]>(() => {
    const capabilities = getCachedModelCapabilities(currentModelId);
    const toolCommands = getChatToolsForSurface({
      surface: 'slash-command',
      capabilities,
      providerId,
    })
      .filter((tool) => Boolean(tool.slashCommand))
      .map((tool) => ({
        name: tool.slashCommand!.name,
        description: t(tool.slashCommand!.descriptionKey as keyof typeof translations),
        icon: tool.slashCommand!.icon,
      }));

    const canAcceptAttachments = capabilities.permissions.canAcceptAttachments;
    const canUseThinking =
      capabilities.supportsThinkingLevel && !capabilities.isTtsModel && !capabilities.isImageGenerationModel;

    return [
      { name: 'model', description: t('helpCmdModel'), icon: 'bot' },
      { name: 'help', description: t('helpCmdHelp'), icon: 'help' },
      { name: 'edit', description: t('helpCmdEdit'), icon: 'edit' },
      { name: 'pin', description: t('helpCmdPin'), icon: 'pin' },
      { name: 'retry', description: t('helpCmdRetry'), icon: 'retry' },
      ...toolCommands,
      ...(canAcceptAttachments ? [{ name: 'file', description: t('helpCmdFile'), icon: 'paperclip' }] : []),
      { name: 'find', description: t('helpCmdFind'), icon: 'find' },
      { name: 'library', description: t('helpCmdLibrary'), icon: 'library' },
      { name: 'clear', description: t('helpCmdClear'), icon: 'clear' },
      { name: 'new', description: t('helpCmdNew'), icon: 'new' },
      { name: 'settings', description: t('helpCmdSettings'), icon: 'settings' },
      ...(capabilities.permissions.canGenerateSuggestions
        ? [{ name: 'artifacts', description: t('helpCmdArtifacts'), icon: 'artifacts' }]
        : []),
      { name: 'pip', description: t('helpCmdPip'), icon: 'pip' },
      ...(canUseThinking ? [{ name: 'fast', description: t('helpCmdFast'), icon: 'fast' }] : []),
    ];
  }, [t, currentModelId, providerId]);

  const { commands, allCommandsForHelp } = useSlashCommandActions({
    commandDefinitions,
    currentModelId,
    toolStates,
    onClearChat,
    onNewChat,
    onOpenSettings,
    onToggleLiveArtifactsPrompt,
    onTogglePinCurrentSession,
    onRetryLastTurn,
    onAttachmentAction,
    setIsHelpModalOpen,
    textareaRef,
    onEditLastUserMessage,
    onTogglePip,
    setInputText,
    onSetThinkingLevel,
    thinkingLevel,
  });

  const resetSlashCommandState = useCallback(() => {
    setSlashCommandState(CLOSED_SLASH_COMMAND_STATE);
  }, []);

  // Close panel when slash trigger is removed via any setInputText path
  useEffect(() => {
    if (inputText === undefined || !slashCommandState.isOpen) return;
    if (!inputText.includes('/')) {
      setSlashCommandState(CLOSED_SLASH_COMMAND_STATE);
      return;
    }
    const cursor = getSlashCursor(textareaRef.current, inputText);
    if (findSlashAnchor(inputText, cursor) === -1) {
      setSlashCommandState(CLOSED_SLASH_COMMAND_STATE);
    }
  }, [inputText, slashCommandState.isOpen, textareaRef]);

  const openModelCommandList = useCallback(() => {
    const modelCommands = buildModelCommands(availableModels, onSelectModel, setInputText, onMessageSent);

    setSlashCommandState({
      isOpen: true,
      query: 'model',
      filteredCommands: modelCommands,
      selectedIndex: 0,
    });
  }, [availableModels, onMessageSent, onSelectModel, setInputText]);

  const handleCommandSelect = useCallback(
    (command: Command) => {
      if (!command) return;

      command.action();

      if (command.name === 'model') {
        openModelCommandList();
        return;
      }

      resetSlashCommandState();

      const isDynamicModelCommand = availableModels.some((model) => model.name === command.name);

      if (!INPUT_POPULATING_COMMANDS.has(command.name) && !isDynamicModelCommand) {
        setTimeout(() => {
          setInputText('');
        }, 0);
      }
    },
    [availableModels, openModelCommandList, resetSlashCommandState, setInputText],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputText(value);

      const cursor = getSlashCursor(textareaRef.current, value);
      const nextChar = value.slice(cursor, cursor + 1);
      const isCursorAtEnd = nextChar.length === 0 || /\s/.test(nextChar);
      const anchor = findSlashAnchor(value, cursor);

      if (anchor === -1) {
        resetSlashCommandState();
        return;
      }

      const searchText = value.slice(anchor, cursor);
      if (!searchText.startsWith('/')) {
        resetSlashCommandState();
        return;
      }

      if (searchText.slice(1).includes('/')) {
        resetSlashCommandState();
        return;
      }

      if (!isCursorAtEnd) {
        resetSlashCommandState();
        return;
      }

      const lowerSearch = searchText.toLowerCase();
      const isModelQuery = lowerSearch === '/model' || lowerSearch.startsWith('/model ');

      if (!isModelQuery && /\s/.test(searchText.slice(1))) {
        resetSlashCommandState();
        return;
      }

      if (isModelQuery) {
        const keyword = searchText.slice(6).trim();
        const filteredModels = availableModels.filter((model) => matchesModelKeyword(model, keyword));
        const modelCommands = buildModelCommands(filteredModels, onSelectModel, setInputText, onMessageSent);
        setSlashCommandState({
          isOpen: true,
          query: 'model',
          filteredCommands: modelCommands,
          selectedIndex: 0,
        });
        return;
      }

      const query = searchText.slice(1).toLowerCase();
      const fuzzyPattern = query
        .split('')
        .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      const fuzzyRegex = query ? new RegExp(fuzzyPattern, 'i') : null;
      const filtered = sortSlashCommandsByGroup(
        commands.filter((cmd) => {
          const name = cmd.name.toLowerCase();
          const desc = cmd.description.toLowerCase();
          if (name.startsWith(query) || name.includes(query) || desc.includes(query)) return true;
          if (fuzzyRegex && (fuzzyRegex.test(cmd.name) || fuzzyRegex.test(cmd.description))) return true;
          return false;
        }),
      );
      setSlashCommandState({
        isOpen: true,
        query,
        filteredCommands: filtered,
        selectedIndex: 0,
      });
    },
    [availableModels, commands, onMessageSent, onSelectModel, resetSlashCommandState, setInputText, textareaRef],
  );

  const handleSlashCommandExecution = useCallback(
    (text: string) => {
      const exactCommandMatch = text.match(/^\/(\S+)$/);
      if (exactCommandMatch) {
        const commandName = exactCommandMatch[1].toLowerCase();
        const command = commands.find((cmd) => cmd.name === commandName);
        if (!command) {
          return false;
        }

        handleCommandSelect(command);
        return true;
      }

      const findCommandMatch = text.match(/^\/find\s+(.+)$/i);
      if (findCommandMatch) {
        const query = findCommandMatch[1].trim();
        if (query) {
          useMultimodalSearchStore.getState().openModal(query);
          setInputText('');
          resetSlashCommandState();
          return true;
        }
      }

      const modelCommandMatch = text.match(/^\/model\s+(.+)$/i);
      if (!modelCommandMatch) {
        return false;
      }

      const rawKeyword = modelCommandMatch[1].trim();
      if (!rawKeyword) {
        return false;
      }

      const keyword = rawKeyword.toLowerCase();
      const model =
        availableModels.find((availableModel) => availableModel.id.toLowerCase() === keyword) ??
        availableModels.find((availableModel) => availableModel.name.toLowerCase() === keyword) ??
        availableModels.find((availableModel) => matchesModelKeyword(availableModel, rawKeyword));
      if (!model) {
        return false;
      }

      onSelectModel(model.id);
      setInputText('');
      onMessageSent();
      resetSlashCommandState();
      return true;
    },
    [
      availableModels,
      commands,
      handleCommandSelect,
      onMessageSent,
      onSelectModel,
      resetSlashCommandState,
      setInputText,
    ],
  );

  return {
    slashCommandState,
    setSlashCommandState,
    allCommandsForHelp,
    handleCommandSelect,
    handleInputChange,
    handleSlashCommandExecution,
  };
};
