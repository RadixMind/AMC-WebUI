import type { LiveArtifactsPromptMode } from '@/types';
import { isLiveArtifactsSystemInstruction } from '@/features/prompts/promptRegistry';

/**
 * Determine if Live UI mode is active from the app settings and
 * current chat settings. This is a convenience wrapper for CommonComponentData.
 *
 * Marker recognition is delegated to promptRegistry.isLiveArtifactsSystemInstruction
 * so every caller agrees on which markers count.
 */
function isLiveUiModeFromSettings(args: {
  isLiveArtifactsEnabled?: boolean | null;
  isVisualFormattingActive?: boolean | null;
  systemInstruction?: string | null;
  promptMode?: LiveArtifactsPromptMode | null;
  liveArtifactsSystemPrompt?: string | null;
  liveArtifactsSystemPrompts?: Partial<Record<LiveArtifactsPromptMode, string>> | null;
}): boolean {
  const {
    isLiveArtifactsEnabled,
    isVisualFormattingActive,
    systemInstruction,
    promptMode,
    liveArtifactsSystemPrompt,
    liveArtifactsSystemPrompts,
  } = args;

  if (isVisualFormattingActive) {
    return true;
  }

  if (isLiveArtifactsEnabled) {
    return true;
  }

  if (isLiveArtifactsEnabled === false && !isVisualFormattingActive) {
    return false;
  }

  if (!systemInstruction) return false;

  if (isLiveArtifactsSystemInstruction(systemInstruction)) {
    return true;
  }

  if (promptMode && liveArtifactsSystemPrompts) {
    const overridePrompt = liveArtifactsSystemPrompts[promptMode];
    if (overridePrompt?.trim() && systemInstruction.trim() === overridePrompt.trim()) {
      return true;
    }
  }

  if (liveArtifactsSystemPrompt?.trim() && systemInstruction.trim() === liveArtifactsSystemPrompt.trim()) {
    return true;
  }

  return false;
}

// Backward-compatible alias
export const isLiveArtifactsModeFromSettings = isLiveUiModeFromSettings;
