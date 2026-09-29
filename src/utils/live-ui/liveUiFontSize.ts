import type { AppSettings } from '@/types';

const LIVE_UI_CUSTOM_FONT_SIZE_MIN = 10;
const LIVE_UI_CUSTOM_FONT_SIZE_MAX = 32;

const clampLiveUiCustomFontSize = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 16;
  }

  return Math.min(LIVE_UI_CUSTOM_FONT_SIZE_MAX, Math.max(LIVE_UI_CUSTOM_FONT_SIZE_MIN, Math.round(value)));
};

const resolveLiveUiFontSize = (settings: Pick<AppSettings, 'liveArtifactsCustomFontSize'>): number => {
  return clampLiveUiCustomFontSize(settings.liveArtifactsCustomFontSize ?? 16);
};

// Backward-compatible aliases
export const LIVE_ARTIFACTS_CUSTOM_FONT_SIZE_MIN = LIVE_UI_CUSTOM_FONT_SIZE_MIN;
export const LIVE_ARTIFACTS_CUSTOM_FONT_SIZE_MAX = LIVE_UI_CUSTOM_FONT_SIZE_MAX;
export const clampLiveArtifactsCustomFontSize = clampLiveUiCustomFontSize;
export const resolveLiveArtifactsFontSize = resolveLiveUiFontSize;
