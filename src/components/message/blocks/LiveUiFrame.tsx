import { logService } from '@/services/logService';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import { useWindowContext } from '@/contexts/WindowContext';
import { SMALL_ICON_BUTTON_CLASS } from '@/constants/buttonClasses';
import { hashString } from '@/utils/format/stringHash';
import {
  buildStreamingHtmlPreviewRenderPayload,
  buildHtmlPreviewSrcDoc,
  buildStreamingHtmlPreviewSrcDoc,
  isKatexLoaded,
  whenKatexReady,
  HTML_PREVIEW_CLEAR_SELECTION_EVENT,
  HTML_PREVIEW_MESSAGE_CHANNEL,
  HTML_PREVIEW_STREAM_RENDER_EVENT,
} from '@/utils/html-preview/previewDocument';
import { HTML_PREVIEW_SANDBOX } from '@/utils/html-preview/previewPrivilege';
import { useHtmlPreviewBridge } from '@/hooks/ui/useHtmlPreviewBridge';
import { useHtmlPreviewGraphvizRelay } from '@/hooks/ui/useHtmlPreviewGraphvizRelay';
import { type LiveArtifactFollowupPayload } from '@/utils/live-ui/liveUiFollowup';
import { LIVE_ARTIFACT_CLEAR_SELECTION_EVENT } from '@/utils/text-selection/liveUiSelection';
import { dispatchMediaSeekFromBridge } from '@/utils/media-nav/mediaNavBridgeDispatch';
import { type ReadingFontFamily, type UploadedFile } from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { svgToUploadedFile } from '@/utils/export/svgToUploadedFile';
import { copyTextToClipboard } from '@/utils/clipboard';

export interface LiveUiFrameProps {
  html: string;
  cacheKey?: string;
  isLoading?: boolean;
  baseFontSize?: number;
  readingFontFamily?: ReadingFontFamily;
  themeId?: string;
  onFollowUp?: (payload: LiveArtifactFollowupPayload) => void;
  onOpenPreview?: () => void;
  onImageClick?: (file: UploadedFile) => void;
}

const MIN_FRAME_HEIGHT = 120;
const DEFAULT_FRAME_HEIGHT = 320;
const MAX_FRAME_HEIGHT_CACHE_ENTRIES = 200;
const STREAMING_SRC_DOC_THROTTLE_MS = 120;
const frameHeightCache = new Map<string, number>();
const runnerModeArtifacts = new Set<string>();

const normalizeFrameHeight = (height: number) => Math.max(MIN_FRAME_HEIGHT, Math.ceil(height));

const getContentFrameHeightCacheKey = (html: string, cacheKey?: string): string => {
  const contentHash = `${html.length}:${hashString(html)}`;
  return cacheKey ? `${cacheKey}:${contentHash}` : `html:${contentHash}`;
};

const getStreamingFrameHeightCacheKey = (cacheKey?: string): string | undefined => {
  return cacheKey ? `stream:${cacheKey}` : undefined;
};

const readCachedFrameHeight = (
  heightCacheKey: string,
  fallbackHeightCacheKey?: string,
  prefixCacheKey?: string,
): number => {
  return (
    frameHeightCache.get(heightCacheKey) ??
    (fallbackHeightCacheKey ? frameHeightCache.get(fallbackHeightCacheKey) : undefined) ??
    (prefixCacheKey ? frameHeightCache.get(prefixCacheKey) : undefined) ??
    DEFAULT_FRAME_HEIGHT
  );
};

const cacheFrameHeight = (heightCacheKey: string, height: number) => {
  if (frameHeightCache.has(heightCacheKey)) {
    frameHeightCache.delete(heightCacheKey);
  }

  frameHeightCache.set(heightCacheKey, height);

  if (frameHeightCache.size > MAX_FRAME_HEIGHT_CACHE_ENTRIES) {
    const oldestKey = frameHeightCache.keys().next().value;
    if (oldestKey) {
      frameHeightCache.delete(oldestKey);
    }
  }
};

export const LiveUiFrame: React.FC<LiveUiFrameProps> = ({
  html,
  cacheKey,
  isLoading = false,
  baseFontSize,
  readingFontFamily,
  themeId,
  onFollowUp,
  onOpenPreview,
  onImageClick,
}) => {
  const { t } = useI18n();
  const { window: targetWindow } = useWindowContext();
  const storeReadingFont = useSettingsStore((state) => state.appSettings.readingFontFamily);
  const resolvedReadingFont = readingFontFamily ?? storeReadingFont ?? 'sans';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useHtmlPreviewGraphvizRelay({
    iframeRef,
    privilege: 'sanitized',
    themeId,
    baseFontSize,
  });
  const latestStreamingHtmlRef = useRef(html);
  const isLoadingRef = useRef(isLoading);
  const lastPostedStreamingHtmlRef = useRef<string | null>(null);
  const streamingFlushTimeoutRef = useRef<number | null>(null);

  const prefixCacheKey = useMemo(() => {
    const prefix = cacheKey?.split(':')[0];
    return prefix ? `stream:${prefix}` : undefined;
  }, [cacheKey]);

  const isRunnerModeInstanceRef = useRef(false);
  const checkInitialRunnerMode = useCallback(() => {
    if (isLoading) return true;
    if (cacheKey && runnerModeArtifacts.has(cacheKey)) return true;
    const prefix = cacheKey?.split(':')[0];
    if (prefix && runnerModeArtifacts.has(prefix)) return true;
    return false;
  }, [cacheKey, isLoading]);

  const [isRunnerMode, setIsRunnerMode] = useState(checkInitialRunnerMode);
  const [prevCacheKey, setPrevCacheKey] = useState(cacheKey);

  if (isLoading || isRunnerMode) {
    isRunnerModeInstanceRef.current = true;
    if (!isRunnerMode) {
      setIsRunnerMode(true);
    }
    if (cacheKey) {
      runnerModeArtifacts.add(cacheKey);
      const prefix = cacheKey.split(':')[0];
      if (prefix) runnerModeArtifacts.add(prefix);
    }
  }

  if (cacheKey !== prevCacheKey) {
    setPrevCacheKey(cacheKey);
    if (isRunnerModeInstanceRef.current) {
      if (!isRunnerMode) setIsRunnerMode(true);
      if (cacheKey) {
        runnerModeArtifacts.add(cacheKey);
        const prefix = cacheKey.split(':')[0];
        if (prefix) runnerModeArtifacts.add(prefix);
      }
    } else {
      const nextRunner = checkInitialRunnerMode();
      if (nextRunner !== isRunnerMode) {
        setIsRunnerMode(nextRunner);
      }
    }
  }

  const isRunnerModeRef = useRef(isRunnerMode);
  useLayoutEffect(() => {
    isRunnerModeRef.current = isRunnerMode;
  }, [isRunnerMode]);

  const contentHeightCacheKey = useMemo(() => getContentFrameHeightCacheKey(html, cacheKey), [cacheKey, html]);
  const streamingHeightCacheKey = useMemo(() => getStreamingFrameHeightCacheKey(cacheKey), [cacheKey]);
  const heightCacheKey = isLoading && streamingHeightCacheKey ? streamingHeightCacheKey : contentHeightCacheKey;
  const streamingSrcDoc = useMemo(
    () => buildStreamingHtmlPreviewSrcDoc({ baseFontSize, themeId, readingFontFamily: resolvedReadingFont }),
    [baseFontSize, resolvedReadingFont, themeId],
  );
  const [frameHeightState, setFrameHeightState] = useState(() => ({
    heightCacheKey,
    height: readCachedFrameHeight(heightCacheKey, streamingHeightCacheKey, prefixCacheKey),
  }));
  // Incremented when KaTeX finishes loading so the final srcDoc (which embeds
  // rendered math) is recomputed after the first render skipped the formulas.
  const [katexReadyTick, setKatexReadyTick] = useState(0);
  const finalSrcDoc = useMemo(() => {
    // Guard: while in runner mode, the iframe renders `streamingSrcDoc` (live,
    // in-place via postMessage) and `finalSrcDoc` is unused. Deferring or skipping
    // it keeps the heavy DOMParser + sanitize + inject pipeline off the hot path.
    if (isRunnerMode) {
      return '';
    }
    // katexReadyTick is an intentional invalidation token: reading it ties the
    // memo to the lazy KaTeX load so the first render (which skips formulas)
    // is recomputed once the chunk has arrived.
    void katexReadyTick;
    return buildHtmlPreviewSrcDoc(html, { baseFontSize, themeId, readingFontFamily: resolvedReadingFont });
  }, [baseFontSize, html, isRunnerMode, katexReadyTick, resolvedReadingFont, themeId]);
  const frameHeight =
    frameHeightState.heightCacheKey === heightCacheKey || (isRunnerMode && frameHeightState.height > 0)
      ? frameHeightState.height
      : readCachedFrameHeight(heightCacheKey, streamingHeightCacheKey, prefixCacheKey);
  const srcDoc = isRunnerMode ? streamingSrcDoc : finalSrcDoc;
  // Stable key preserves the iframe DOM node across chunk updates AND across
  // the stream completion boundary (isLoading: true -> false), eliminating iframe
  // reload, blank flicker, and scroll reset. It only invalidates when theme,
  // base font size, or (for static messages) content changes.
  const iframeKey = isRunnerMode
    ? `streaming:${themeId ?? ''}:${baseFontSize ?? ''}:${resolvedReadingFont}`
    : `final:${katexReadyTick}:${themeId ?? ''}:${baseFontSize ?? ''}:${resolvedReadingFont}:${contentHeightCacheKey}`;

  useLayoutEffect(() => {
    latestStreamingHtmlRef.current = html;
  }, [html]);

  useLayoutEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const clearStreamingFlushTimeout = useCallback(() => {
    if (streamingFlushTimeoutRef.current === null) {
      return;
    }

    targetWindow.clearTimeout(streamingFlushTimeoutRef.current);
    streamingFlushTimeoutRef.current = null;
  }, [targetWindow]);

  // Returns false when the iframe is not ready yet so callers can retry.
  const postStreamingHtml = useCallback((nextHtml: string, force = false): boolean => {
    if (!force && lastPostedStreamingHtmlRef.current === nextHtml) {
      return true;
    }

    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) {
      return false;
    }

    try {
      iframeWindow.postMessage(
        {
          channel: HTML_PREVIEW_MESSAGE_CHANNEL,
          event: HTML_PREVIEW_STREAM_RENDER_EVENT,
          html: buildStreamingHtmlPreviewRenderPayload(nextHtml),
        },
        '*',
      );
      lastPostedStreamingHtmlRef.current = nextHtml;
      return true;
    } catch (postMessageError) {
      logService.warn('Failed to post Live Artifact streaming html:', postMessageError);
      return false;
    }
  }, []);

  const scheduleStreamingHtmlFlush = useCallback(
    (force = false) => {
      if (streamingFlushTimeoutRef.current !== null) {
        return;
      }

      // Named retry loop avoids a useCallback self-reference (react-hooks/immutability).
      const attemptFlush = () => {
        streamingFlushTimeoutRef.current = null;
        if (!isRunnerModeRef.current) {
          return;
        }

        const posted = postStreamingHtml(latestStreamingHtmlRef.current, force);
        // contentWindow can appear after the first timeout (Virtuoso remount / slow srcDoc).
        if (!posted) {
          streamingFlushTimeoutRef.current = targetWindow.setTimeout(attemptFlush, STREAMING_SRC_DOC_THROTTLE_MS);
        }
      };

      streamingFlushTimeoutRef.current = targetWindow.setTimeout(attemptFlush, STREAMING_SRC_DOC_THROTTLE_MS);
    },
    [postStreamingHtml, targetWindow],
  );

  const flushStreamingHtmlNow = useCallback(
    (force = false) => {
      if (!isRunnerModeRef.current) {
        return;
      }

      const posted = postStreamingHtml(latestStreamingHtmlRef.current, force);
      if (!posted) {
        scheduleStreamingHtmlFlush(force);
      }
    },
    [postStreamingHtml, scheduleStreamingHtmlFlush],
  );

  useEffect(() => {
    if (!isRunnerMode) {
      return;
    }

    if (isLoading) {
      scheduleStreamingHtmlFlush();
    } else {
      clearStreamingFlushTimeout();
      // When streaming finishes, flush the final HTML payload immediately
      // with force=true so the final DOM is reconciled in-place without reloading.
      flushStreamingHtmlNow(true);
    }
  }, [clearStreamingFlushTimeout, flushStreamingHtmlNow, html, isLoading, isRunnerMode, scheduleStreamingHtmlFlush]);

  useEffect(() => {
    return () => clearStreamingFlushTimeout();
  }, [clearStreamingFlushTimeout]);

  useEffect(() => {
    if (isLoading || isKatexLoaded()) {
      return;
    }
    // When the final srcDoc first meets a TeX delimiter, renderPreviewMath
    // returns it unrendered and kicks off the lazy KaTeX load. Re-render once
    // the chunk is available so embedded formulas appear. The promise resolves
    // immediately after the first load, so this is a no-op on later frames.
    let cancelled = false;
    void whenKatexReady()
      .then(() => {
        if (!cancelled) {
          setKatexReadyTick((tick) => tick + 1);
        }
      })
      .catch(() => {
        // The lazy KaTeX load failed (offline / chunk error). Nothing to tick:
        // the next render that sees a math delimiter will attempt the load
        // again, so the failure is not permanent.
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading]);

  useEffect(() => {
    if (isRunnerMode && katexReadyTick > 0) {
      flushStreamingHtmlNow(true);
    }
  }, [flushStreamingHtmlNow, isRunnerMode, katexReadyTick]);

  const flushStreamingHtmlOnBridgeReady = useCallback(() => {
    // Prefer refs so remount/load races always flush the latest streaming html.
    flushStreamingHtmlNow(true);
  }, [flushStreamingHtmlNow]);

  const copyToParentClipboard = useCallback(
    (text: string) => {
      // The sandboxed iframe lacks allow-same-origin, so navigator.clipboard
      // is unavailable there; the parent page writes to the clipboard instead.
      void copyTextToClipboard(text, targetWindow.document);
    },
    [targetWindow],
  );

  const handleBridgeResize = useCallback(
    (height: number) => {
      const nextHeight = normalizeFrameHeight(height);
      cacheFrameHeight(heightCacheKey, nextHeight);
      if (contentHeightCacheKey && heightCacheKey !== contentHeightCacheKey) {
        cacheFrameHeight(contentHeightCacheKey, nextHeight);
      }
      if (streamingHeightCacheKey && heightCacheKey !== streamingHeightCacheKey) {
        cacheFrameHeight(streamingHeightCacheKey, nextHeight);
      }
      if (prefixCacheKey) {
        cacheFrameHeight(prefixCacheKey, nextHeight);
      }
      setFrameHeightState((currentState) =>
        currentState.height === nextHeight && currentState.heightCacheKey === heightCacheKey
          ? currentState
          : { heightCacheKey, height: nextHeight },
      );
    },
    [contentHeightCacheKey, heightCacheKey, prefixCacheKey, streamingHeightCacheKey],
  );

  const handleDiagramClick = useCallback(
    ({ svg, title }: { svg: string; title?: string }) => {
      if (!onImageClick || !svg) return;
      const diagramId = `artifact-diagram-${Math.random().toString(36).substring(2, 9)}`;
      const file = svgToUploadedFile(svg, {
        id: diagramId,
        name: title ? `${title}.svg` : 'diagram.svg',
      });
      onImageClick(file);
    },
    [onImageClick],
  );

  useHtmlPreviewBridge({
    iframeRef,
    targetWindow,
    privilege: 'sanitized',
    handlers: {
      onReady: flushStreamingHtmlOnBridgeReady,
      onResize: handleBridgeResize,
      onCopy: copyToParentClipboard,
      onFollowUp,
      onDiagramClick: handleDiagramClick,
      onMediaSeek: (payload) => dispatchMediaSeekFromBridge(payload),
    },
  });

  useEffect(() => {
    const handleClearSelection = () => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          channel: HTML_PREVIEW_MESSAGE_CHANNEL,
          event: HTML_PREVIEW_CLEAR_SELECTION_EVENT,
        },
        '*',
      );
    };

    targetWindow.addEventListener(LIVE_ARTIFACT_CLEAR_SELECTION_EVENT, handleClearSelection);
    return () => targetWindow.removeEventListener(LIVE_ARTIFACT_CLEAR_SELECTION_EVENT, handleClearSelection);
  }, [targetWindow]);

  return (
    <div
      data-live-artifact-frame="true"
      data-artifact-source={html}
      // Read back by the export pipeline (replaceLiveArtifactIframes) so a static
      // snapshot renders charts and diagrams at the same scale as the live frame.
      data-live-artifact-font-size={baseFontSize}
      className="group/artifact relative my-3 w-full overflow-visible"
    >
      <div
        data-live-artifact-viewport="true"
        className="relative overflow-hidden rounded-lg bg-transparent"
        style={{ height: frameHeight }}
      >
        <iframe
          key={iframeKey}
          ref={iframeRef}
          srcDoc={srcDoc}
          title={t('htmlPreviewTitle')}
          className={`h-full w-full border-0 bg-transparent ${isLoading ? 'pointer-events-none' : ''}`}
          // SECURITY: allow-same-origin is intentionally omitted (opaque origin).
          // allow-popups enables target="_blank" external links in Live Artifacts.
          sandbox={HTML_PREVIEW_SANDBOX.sanitized}
          allow="clipboard-write"
          scrolling="no"
          onLoad={() => {
            // Prefer refs so remount/load races always flush the latest streaming html.
            flushStreamingHtmlNow(true);
          }}
        />
      </div>
      {!isLoading && onOpenPreview && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover/artifact:opacity-100 sm:focus-visible:opacity-100 sm:group-focus-within/artifact:opacity-100">
          <button
            type="button"
            className={`${SMALL_ICON_BUTTON_CLASS} border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/90 shadow-sm`}
            title={t('htmlPreviewOpenLarger')}
            aria-label={t('htmlPreviewOpenLarger')}
            onClick={onOpenPreview}
          >
            <Maximize2 size={16} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
};
