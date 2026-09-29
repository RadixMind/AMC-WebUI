import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import type { SupportedLanguage } from '@/i18n/languageRegistry';
import { isLiveArtifactsSystemInstruction, loadLiveArtifactsSystemPrompt } from '@/features/prompts/promptRegistry';
import { stripLegacyFeatureMarkers } from '@/features/prompts/promptCompositor';
import { logService } from '@/services/logService';
import { focusChatInput } from '@/utils/chat-input/focus';
import { getLiveArtifactsSystemPromptOverride } from '@/utils/live-ui/liveUiPromptSettings';
import { useChatStore } from '@/stores/chatStore';
import { updateSessionById as updateSessionByIdInSessions } from '@/utils/chat/sessionMutations';
import type { AppSettings, ChatSettings, SavedChatSession } from '@/types';

interface PendingLiveArtifactsPromptActivation {
  systemInstruction: string;
  targetSessionId: string | null;
}

interface LiveArtifactsPromptOverrideState {
  active: boolean;
  targetSessionId: string | null;
}

export interface UseLiveUiPromptModeOptions {
  language?: SupportedLanguage;
  appSettings: {
    systemInstruction?: string | null;
    isLiveArtifactsEnabled?: boolean;
    isVisualFormattingActive?: boolean;
    liveArtifactsPromptMode?: AppSettings['liveArtifactsPromptMode'];
    liveArtifactsSystemPrompt?: string | null;
    liveArtifactsSystemPrompts?: AppSettings['liveArtifactsSystemPrompts'];
  };
  setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  activeChat: SavedChatSession | undefined;
  activeSessionId: string | null;
  currentChatSettings: ChatSettings;
  setCurrentChatSettings: (updater: (prev: ChatSettings) => ChatSettings) => void;
  loadLiveArtifactsPrompt?: (
    language: SupportedLanguage,
    mode: AppSettings['liveArtifactsPromptMode'],
  ) => Promise<string>;
}

export const useLiveUiPromptMode = ({
  language = 'zh',
  appSettings,
  setAppSettings,
  activeChat,
  activeSessionId,
  currentChatSettings,
  setCurrentChatSettings,
  loadLiveArtifactsPrompt,
}: UseLiveUiPromptModeOptions) => {
  const [pendingLiveArtifactsPromptActivation, setPendingLiveArtifactsPromptActivation] =
    useState<PendingLiveArtifactsPromptActivation | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const activatingSessionIdRef = useRef<string | null | undefined>(undefined);
  const isMountedRef = useRef(true);
  const operationVersionRef = useRef(0);
  const deactivationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Backup store for legacy sessions where a prompt was already merged in older formats
  const previousAppSystemInstructionRef = useRef<string | null>(null);
  const previousSessionSystemInstructionsRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (deactivationTimerRef.current) {
        clearTimeout(deactivationTimerRef.current);
      }
    };
  }, []);

  const [liveArtifactsPromptBusySessionId, setLiveArtifactsPromptBusySessionId] = useState<string | null | undefined>(
    undefined,
  );
  const [liveArtifactsPromptOverrideState, setLiveArtifactsPromptOverrideState] =
    useState<LiveArtifactsPromptOverrideState | null>(null);

  const liveArtifactsPromptMode = appSettings.liveArtifactsPromptMode ?? 'inline';
  const configuredLiveArtifactsSystemPrompt = getLiveArtifactsSystemPromptOverride(
    appSettings,
    liveArtifactsPromptMode,
  );
  const isConfiguredLiveArtifactsSystemInstruction = useCallback(
    (instruction?: string | null) =>
      isLiveArtifactsSystemInstruction(instruction) ||
      (!!configuredLiveArtifactsSystemPrompt && instruction?.trim() === configuredLiveArtifactsSystemPrompt),
    [configuredLiveArtifactsSystemPrompt],
  );

  const currentLiveArtifactsPromptTargetSessionId = activeSessionId ?? null;
  const liveArtifactsPromptOverrideActive =
    liveArtifactsPromptOverrideState?.targetSessionId === currentLiveArtifactsPromptTargetSessionId
      ? liveArtifactsPromptOverrideState.active
      : null;
  const liveArtifactsPromptBusy =
    liveArtifactsPromptBusySessionId !== undefined &&
    liveArtifactsPromptBusySessionId === currentLiveArtifactsPromptTargetSessionId;

  const resolvePersistedActive = useCallback(
    () =>
      Boolean(
        currentChatSettings.isLiveArtifactsEnabled ??
        (Boolean(currentChatSettings.isVisualFormattingActive) ||
          isConfiguredLiveArtifactsSystemInstruction(currentChatSettings.systemInstruction)),
      ),
    [
      currentChatSettings.isLiveArtifactsEnabled,
      currentChatSettings.isVisualFormattingActive,
      currentChatSettings.systemInstruction,
      isConfiguredLiveArtifactsSystemInstruction,
    ],
  );

  // Button reflects active session settings: explicit boolean takes precedence over prompt markers.
  const persistedLiveArtifactsPromptActive = resolvePersistedActive();

  const isLiveArtifactsPromptActive = liveArtifactsPromptOverrideActive ?? persistedLiveArtifactsPromptActive;
  const loadBuiltInLiveArtifactsPrompt = useCallback(
    () =>
      loadLiveArtifactsPrompt
        ? loadLiveArtifactsPrompt(language, liveArtifactsPromptMode)
        : loadLiveArtifactsSystemPrompt(language, liveArtifactsPromptMode),
    [language, liveArtifactsPromptMode, loadLiveArtifactsPrompt],
  );

  // Clear stale busy or override states when active session changes so they never
  // leak into another session or cause deadlocks.
  useEffect(() => {
    if (deactivationTimerRef.current) {
      clearTimeout(deactivationTimerRef.current);
      deactivationTimerRef.current = null;
    }
    setLiveArtifactsPromptBusySessionId((current) => (current !== activeSessionId ? undefined : current));
    setLiveArtifactsPromptOverrideState((current) =>
      current && current.targetSessionId !== (activeSessionId ?? null) ? null : current,
    );
  }, [activeSessionId]);

  // Reconcile override state once persisted settings match.
  useEffect(() => {
    if (
      !liveArtifactsPromptOverrideState ||
      liveArtifactsPromptOverrideState.targetSessionId !== currentLiveArtifactsPromptTargetSessionId
    ) {
      return;
    }

    const actualActive = resolvePersistedActive();

    if (actualActive === liveArtifactsPromptOverrideState.active) {
      setLiveArtifactsPromptOverrideState(null);
      if (!liveArtifactsPromptOverrideState.active && !deactivationTimerRef.current) {
        setLiveArtifactsPromptBusySessionId(undefined);
      }
    }
  }, [currentLiveArtifactsPromptTargetSessionId, liveArtifactsPromptOverrideState, resolvePersistedActive]);

  // When an activation occurs while activeChat is still loading/stabilizing in the session store,
  // re-apply to currentChatSettings as soon as activeChat is available.
  useEffect(() => {
    if (!pendingLiveArtifactsPromptActivation) {
      return;
    }

    const { targetSessionId } = pendingLiveArtifactsPromptActivation;

    // If user switched away from target session, discard pending activation so it doesn't leak.
    if (targetSessionId !== null && targetSessionId !== activeSessionId) {
      setPendingLiveArtifactsPromptActivation(null);
      return;
    }

    // Target session is active, but activeChat is still stabilizing. Wait for it.
    if (activeSessionId && !activeChat) {
      return;
    }

    setCurrentChatSettings((prev) => ({
      ...prev,
      isLiveArtifactsEnabled: true,
      systemInstruction: stripLegacyFeatureMarkers(prev.systemInstruction),
    }));

    setPendingLiveArtifactsPromptActivation(null);
  }, [activeChat, activeSessionId, pendingLiveArtifactsPromptActivation, setCurrentChatSettings]);

  const activateLiveArtifactsPrompt = useCallback(
    async (targetSessionId: string | null) => {
      const opId = ++operationVersionRef.current;

      // Only execute async built-in prompt loader if no custom override is set
      if (!configuredLiveArtifactsSystemPrompt && loadBuiltInLiveArtifactsPrompt) {
        try {
          await loadBuiltInLiveArtifactsPrompt();
        } catch (promptLoadError) {
          logService.warn('Live UI prompt load skipped or failed:', promptLoadError);
        }
      }

      // If user cancelled, toggled off, or switched sessions while the prompt was loading asynchronously, discard!
      if (opId !== operationVersionRef.current || !isMountedRef.current) {
        return '';
      }

      setAppSettings((prev) => ({
        ...prev,
        isLiveArtifactsEnabled: true,
        systemInstruction: stripLegacyFeatureMarkers(prev.systemInstruction),
      }));

      const currentActiveId = activeSessionIdRef.current;
      const isTargetActive = targetSessionId === null || targetSessionId === currentActiveId;
      if (isTargetActive) {
        if (targetSessionId !== null && !activeChat) {
          setPendingLiveArtifactsPromptActivation({
            systemInstruction: '',
            targetSessionId,
          });
        }
        setCurrentChatSettings((prev) => ({
          ...prev,
          isLiveArtifactsEnabled: true,
          systemInstruction: stripLegacyFeatureMarkers(prev.systemInstruction),
        }));
      } else if (targetSessionId !== null) {
        useChatStore.getState().updateAndPersistSessions((prevSessions) =>
          updateSessionByIdInSessions(prevSessions, targetSessionId, (session) => ({
            ...session,
            settings: {
              ...session.settings,
              isLiveArtifactsEnabled: true,
              systemInstruction: stripLegacyFeatureMarkers(session.settings.systemInstruction),
            },
          })),
        );
      }

      return '';
    },
    [
      activeChat,
      configuredLiveArtifactsSystemPrompt,
      loadBuiltInLiveArtifactsPrompt,
      setAppSettings,
      setCurrentChatSettings,
    ],
  );

  const handleDeactivateLiveArtifactsPrompt = useCallback(() => {
    const targetSessionId = activeSessionId ?? null;
    const isCurrentlyLiveArtifactsPrompt = liveArtifactsPromptOverrideActive ?? persistedLiveArtifactsPromptActive;
    const isAppLiveArtifacts = Boolean(
      appSettings.isLiveArtifactsEnabled || isConfiguredLiveArtifactsSystemInstruction(appSettings.systemInstruction),
    );
    const isSessionLiveArtifacts = Boolean(
      currentChatSettings.isLiveArtifactsEnabled ||
      currentChatSettings.isVisualFormattingActive ||
      isConfiguredLiveArtifactsSystemInstruction(currentChatSettings.systemInstruction),
    );

    if (!isCurrentlyLiveArtifactsPrompt && !isAppLiveArtifacts && !isSessionLiveArtifacts) {
      return;
    }

    // Invalidate any in-flight activation operation so delayed async loads cannot re-enable.
    const opId = ++operationVersionRef.current;

    const previousAppPrompt = previousAppSystemInstructionRef.current;
    const previousSessionPrompt = targetSessionId
      ? previousSessionSystemInstructionsRef.current.get(targetSessionId)
      : previousAppPrompt;

    setPendingLiveArtifactsPromptActivation(null);
    setLiveArtifactsPromptBusySessionId(targetSessionId);
    setLiveArtifactsPromptOverrideState({
      active: false,
      targetSessionId,
    });

    if (deactivationTimerRef.current) {
      clearTimeout(deactivationTimerRef.current);
    }
    deactivationTimerRef.current = setTimeout(() => {
      deactivationTimerRef.current = null;
      if (isMountedRef.current && operationVersionRef.current === opId) {
        setLiveArtifactsPromptBusySessionId(undefined);
      }
    }, 200);

    setAppSettings((prev) => {
      const isLegacyPrompt = isConfiguredLiveArtifactsSystemInstruction(prev.systemInstruction);
      const strippedPrompt = stripLegacyFeatureMarkers(prev.systemInstruction);
      return {
        ...prev,
        isLiveArtifactsEnabled: false,
        systemInstruction: isLegacyPrompt ? strippedPrompt || previousAppPrompt || '' : prev.systemInstruction,
      };
    });

    const currentActiveId = activeSessionIdRef.current;
    const isTargetActive = targetSessionId === null || targetSessionId === currentActiveId;

    if (isTargetActive) {
      setCurrentChatSettings((prev) => {
        const isLegacyPrompt = isConfiguredLiveArtifactsSystemInstruction(prev.systemInstruction);
        const strippedPrompt = stripLegacyFeatureMarkers(prev.systemInstruction);
        return {
          ...prev,
          isLiveArtifactsEnabled: false,
          isVisualFormattingActive: false,
          systemInstruction: isLegacyPrompt ? strippedPrompt || previousSessionPrompt || '' : prev.systemInstruction,
        };
      });
    } else if (targetSessionId !== null) {
      useChatStore.getState().updateAndPersistSessions((prevSessions) =>
        updateSessionByIdInSessions(prevSessions, targetSessionId, (session) => {
          const isLegacyPrompt = isConfiguredLiveArtifactsSystemInstruction(session.settings.systemInstruction);
          const strippedPrompt = stripLegacyFeatureMarkers(session.settings.systemInstruction);
          return {
            ...session,
            settings: {
              ...session.settings,
              isLiveArtifactsEnabled: false,
              isVisualFormattingActive: false,
              systemInstruction: isLegacyPrompt
                ? strippedPrompt || previousSessionPrompt || ''
                : session.settings.systemInstruction,
            },
          };
        }),
      );
    }
  }, [
    activeSessionId,
    appSettings.isLiveArtifactsEnabled,
    appSettings.systemInstruction,
    currentChatSettings.isLiveArtifactsEnabled,
    currentChatSettings.isVisualFormattingActive,
    currentChatSettings.systemInstruction,
    isConfiguredLiveArtifactsSystemInstruction,
    liveArtifactsPromptOverrideActive,
    persistedLiveArtifactsPromptActive,
    setAppSettings,
    setCurrentChatSettings,
  ]);

  const toggleLiveArtifactsPrompt = useCallback(
    async (options?: { focusDelay?: number; focusCaret?: 'end' }) => {
      const targetSessionId = activeSessionId ?? null;

      if (
        (activatingSessionIdRef.current !== undefined && activatingSessionIdRef.current === targetSessionId) ||
        liveArtifactsPromptBusy
      ) {
        return;
      }

      const isCurrentlyLiveArtifactsPrompt = liveArtifactsPromptOverrideActive ?? persistedLiveArtifactsPromptActive;

      // Remember pre-existing custom prompt if session previously had one
      if (!isCurrentlyLiveArtifactsPrompt) {
        if (
          appSettings.systemInstruction &&
          !isConfiguredLiveArtifactsSystemInstruction(appSettings.systemInstruction)
        ) {
          previousAppSystemInstructionRef.current = appSettings.systemInstruction;
        }
        if (
          targetSessionId &&
          currentChatSettings.systemInstruction &&
          !isConfiguredLiveArtifactsSystemInstruction(currentChatSettings.systemInstruction)
        ) {
          previousSessionSystemInstructionsRef.current.set(targetSessionId, currentChatSettings.systemInstruction);
        }
      }

      if (isCurrentlyLiveArtifactsPrompt) {
        handleDeactivateLiveArtifactsPrompt();
        if (options?.focusDelay !== undefined) {
          focusChatInput(options.focusDelay, options.focusCaret ? { caret: options.focusCaret } : undefined);
        } else {
          focusChatInput();
        }
        return;
      }

      activatingSessionIdRef.current = targetSessionId;
      setLiveArtifactsPromptBusySessionId(targetSessionId);
      setLiveArtifactsPromptOverrideState({
        active: true,
        targetSessionId,
      });

      try {
        await activateLiveArtifactsPrompt(targetSessionId);
      } catch (activationError) {
        if (isMountedRef.current) {
          setLiveArtifactsPromptOverrideState(null);
        }
        logService.error('Failed to toggle Live Artifacts prompt:', activationError);
      } finally {
        if (activatingSessionIdRef.current === targetSessionId) {
          activatingSessionIdRef.current = undefined;
        }
        if (isMountedRef.current) {
          setLiveArtifactsPromptBusySessionId(undefined);
        }
      }

      if (options?.focusDelay !== undefined) {
        focusChatInput(options.focusDelay, options.focusCaret ? { caret: options.focusCaret } : undefined);
      } else {
        focusChatInput();
      }
    },
    [
      activateLiveArtifactsPrompt,
      activeSessionId,
      appSettings.systemInstruction,
      currentChatSettings.systemInstruction,
      handleDeactivateLiveArtifactsPrompt,
      isConfiguredLiveArtifactsSystemInstruction,
      liveArtifactsPromptBusy,
      liveArtifactsPromptOverrideActive,
      persistedLiveArtifactsPromptActive,
    ],
  );

  const handleLoadLiveArtifactsPromptAndSave = useCallback(async () => {
    await toggleLiveArtifactsPrompt();
  }, [toggleLiveArtifactsPrompt]);

  return {
    isLiveArtifactsPromptActive,
    isLiveArtifactsPromptBusy: liveArtifactsPromptBusy,
    handleLoadLiveArtifactsPromptAndSave,
    handleDeactivateLiveArtifactsPrompt,
    toggleLiveArtifactsPrompt,
  };
};
