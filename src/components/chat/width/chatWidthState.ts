/** localStorage key for the dragged chat content width preference (px). */
export const CHAT_WIDTH_PREF_KEY = 'amc.chat.contentWidth.v4';

/** Floor for dragged content width (px). */
const CHAT_CONTENT_MIN = 640;

/** Horizontal margin budget reserved for safe edge distance (px). 16px reserves balanced 8px margin on each side. */
const CHAT_CONTENT_EDGE_BUDGET = 16;

/** Default adaptive width bounds. */
export const CHAT_DEFAULT_MIN = 640;
const CHAT_DEFAULT_MAX = 2560;

const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const FALLBACK_WHEEL_LINE_PX = 16;

/** Read persisted width preference, or null when absent or invalid. */
export function readChatWidthPreference(): number | null {
  try {
    const raw = localStorage.getItem(CHAT_WIDTH_PREF_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Max allowable width within container. */
function maxChatContentWidth(containerWidth: number): number {
  return Math.max(CHAT_CONTENT_MIN, containerWidth - CHAT_CONTENT_EDGE_BUDGET);
}

/** Default adaptive width: fills available column leaving 20px margin on each side. */
function defaultAdaptiveChatWidth(containerWidth: number): number {
  const max = maxChatContentWidth(containerWidth);
  return Math.min(max, CHAT_DEFAULT_MAX);
}

/** Resolve the effective width for a given container width and optional user preference. */
export function resolveChatContentWidth(containerWidth: number, preference: number | null): number {
  const max = maxChatContentWidth(containerWidth);
  if (preference !== null) {
    return Math.min(Math.max(preference, CHAT_CONTENT_MIN), max);
  }
  return defaultAdaptiveChatWidth(containerWidth);
}

/** Convert a wheel event's delta to vertical scroll pixels. */
export function wheelDeltaY(event: React.WheelEvent, scroller: HTMLElement): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(scroller).lineHeight);
    return event.deltaY * (Number.isFinite(lineHeight) ? lineHeight : FALLBACK_WHEEL_LINE_PX);
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE) {
    return event.deltaY * scroller.clientHeight;
  }
  return event.deltaY;
}
