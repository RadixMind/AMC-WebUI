import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/contexts/I18nContext';
import { interpolate } from '@/i18n/interpolate';
import type { UploadedFile } from '@/types';
import { useMediaNavStore } from '@/stores/mediaNavStore';
import { useChatStore } from '@/stores/chatStore';
import { formatTimestamp } from '@/utils/media-nav/timestamp';
import { extractTimelineMarkers } from '@/utils/media-nav/timelineMarkers';
import { type VideoAnnotation } from './VideoHighlightOverlay';
import { VideoPlayer, type VideoPlayerHandle } from '@/components/shared/file-preview/VideoPlayer';
import { VideoSegmentBar } from '@/components/shared/file-preview/video/VideoSegmentBar';
import { isYoutubeVideoFile } from '@/utils/media-nav/sessionMediaFiles';
import { YoutubeNavPlayer } from './YoutubeNavPlayer';
import { focusChatInput } from '@/utils/chat-input/focus';
import { getCachedSubtitles } from '@/utils/video-subtitles/subtitleCacheService';

interface MediaNavViewProps {
  file: UploadedFile;
  kind: 'video' | 'audio';
}

/**
 * Media player inside the media navigation panel (video or audio).
 * For video, delegates playback, HUD, letterbox-compensation, and frame stepping
 * to the shared VideoPlayer component while coordinating with the media navigation store.
 * For audio, coordinates playback, seeking, and segment looping with full segment banner controls.
 */
const MediaNavViewComponent: React.FC<MediaNavViewProps> = ({ file, kind }) => {
  const { t } = useI18n();
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [isMetadataReady, setIsMetadataReady] = useState(false);
  const [segment, setSegment] = useState<{ start: number; end: number } | null>(null);
  const [isSegmentLoopEnabled, setIsSegmentLoopEnabled] = useState(true);

  const [annotation, setAnnotation] = useState<VideoAnnotation | null>(null);
  const [annotationTargetTime, setAnnotationTargetTime] = useState<number | null>(null);
  const [isAnnotationVisible, setIsAnnotationVisible] = useState(false);
  const [subtitleVttBlobUrl, setSubtitleVttBlobUrl] = useState<string | null>(null);

  const seekTarget = useMediaNavStore((state) => state.videoTarget);
  const consumeTarget = useMediaNavStore((state) => state.consumeVideoTarget);

  const activeMessages = useChatStore((state) => state.activeMessages);
  const timelineMarkers = useMemo(
    () => extractTimelineMarkers(activeMessages, file, kind),
    [activeMessages, file, kind],
  );

  // Load cached subtitles for video playback
  useEffect(() => {
    let isMounted = true;
    if (kind !== 'video') {
      setSubtitleVttBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    const loadSubtitles = () => {
      getCachedSubtitles(file)
        .then((cached) => {
          if (!isMounted) return;
          if (cached?.vttContent) {
            const vttContentToUse = cached.bilingualVttContent || cached.vttContent;
            const vttBlob = new Blob([vttContentToUse], { type: 'text/vtt;charset=utf-8' });
            const vttUrl = URL.createObjectURL(vttBlob);
            setSubtitleVttBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return vttUrl;
            });
          } else {
            setSubtitleVttBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }
        })
        .catch(() => {
          if (!isMounted) return;
          setSubtitleVttBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        });
    };

    loadSubtitles();

    const handleCacheUpdated = () => {
      loadSubtitles();
    };

    window.addEventListener('subtitles-cache-updated', handleCacheUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener('subtitles-cache-updated', handleCacheUpdated);
    };
  }, [file, kind]);

  // Clean up subtitle blob URL on unmount
  useEffect(() => {
    return () => {
      if (subtitleVttBlobUrl) {
        URL.revokeObjectURL(subtitleVttBlobUrl);
      }
    };
  }, [subtitleVttBlobUrl]);

  // Clear active playback time on unmount or file switch
  useEffect(() => {
    return () => {
      useMediaNavStore.getState().setCurrentPlayTime(null);
    };
  }, [file.id]);

  const handleSegmentChange = useCallback((newSeg: { start: number; end: number } | null) => {
    setSegment(newSeg);
    if (!newSeg) {
      setIsAnnotationVisible(false);
      useMediaNavStore.getState().consumeVideoTarget();
    }
  }, []);

  // Reset state on file switch
  useEffect(() => {
    setSegment(null);
    setIsSegmentLoopEnabled(true);
    setAnnotation(null);
    setAnnotationTargetTime(null);
    setIsAnnotationVisible(false);
    setIsMetadataReady(false);
  }, [file.id]);

  // Sync ready state if already available
  useEffect(() => {
    if (kind === 'audio' && audioRef.current && audioRef.current.readyState >= 1) {
      setIsMetadataReady(true);
    } else if (kind === 'video') {
      const videoEl = playerRef.current?.getVideoElement();
      if (videoEl && videoEl.readyState >= 1) {
        setIsMetadataReady(true);
      }
    }
  }, [kind, file.id]);

  // Handle incoming seek requests from store
  useEffect(() => {
    if (!seekTarget) return;
    if (!isMetadataReady) return;

    const hasSegment = seekTarget.end !== undefined;
    const targetSeconds = seekTarget.seconds;

    if (kind === 'video') {
      playerRef.current?.seekTo(targetSeconds, true);
    } else if (audioRef.current) {
      const media = audioRef.current;
      media.currentTime = Math.max(0, targetSeconds);
      try {
        const playPromise = media.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            // Autoplay may be blocked by browser policy
          });
        }
      } catch {
        // Fallback for mock environments
      }
    }

    setSegment(hasSegment ? { start: targetSeconds, end: seekTarget.end! } : null);
    setIsSegmentLoopEnabled(true);

    if (seekTarget.box2d || seekTarget.point) {
      setAnnotation({
        box2d: seekTarget.box2d,
        point: seekTarget.point,
        snippet: seekTarget.snippet,
      });
      setAnnotationTargetTime(targetSeconds);
      setIsAnnotationVisible(true);
    } else {
      setAnnotation(null);
      setAnnotationTargetTime(null);
      setIsAnnotationVisible(false);
    }

    consumeTarget();
  }, [seekTarget, isMetadataReady, consumeTarget, kind]);

  // Audio loadedmetadata handler
  const handleAudioLoadedMetadata = () => {
    setIsMetadataReady(true);
  };

  const isHandlingSegmentLoopRef = useRef(false);
  const handleAudioTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const currentTime = audio.currentTime;
    useMediaNavStore.getState().setCurrentPlayTime(currentTime);

    if (!segment) return;

    // If user manually scrubbed outside active segment bounds, exit segment
    if (currentTime < segment.start - 0.5 || currentTime > segment.end + 0.5) {
      if (!isHandlingSegmentLoopRef.current) {
        setSegment(null);
      }
      return;
    }

    // If audio reached or passed segment end
    if (currentTime >= segment.end) {
      if (isSegmentLoopEnabled) {
        isHandlingSegmentLoopRef.current = true;
        audio.currentTime = segment.start;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
        setTimeout(() => {
          isHandlingSegmentLoopRef.current = false;
        }, 100);
      } else {
        audio.pause();
      }
    }
  }, [segment, isSegmentLoopEnabled]);

  const isYoutube = useMemo(() => isYoutubeVideoFile(file), [file]);

  return (
    <div className="h-full w-full flex flex-col bg-black select-none relative">
      {kind === 'video' ? (
        isYoutube ? (
          <YoutubeNavPlayer key={file.id} file={file} />
        ) : (
          <VideoPlayer
            key={file.id}
            ref={playerRef}
            src={file.dataUrl || ''}
            file={file}
            subtitlesSrc={subtitleVttBlobUrl ?? undefined}
            testId="media-nav-video"
            segment={segment}
            onSegmentChange={handleSegmentChange}
            isSegmentLoopEnabled={isSegmentLoopEnabled}
            onSegmentLoopChange={setIsSegmentLoopEnabled}
            annotation={annotation}
            annotationTargetTime={annotationTargetTime}
            isAnnotationVisible={isAnnotationVisible}
            onAnnotationVisibilityChange={setIsAnnotationVisible}
            onAnnotationDismiss={() => setIsAnnotationVisible(false)}
            timelineMarkers={timelineMarkers}
            onTimeUpdate={(currentTime) => useMediaNavStore.getState().setCurrentPlayTime(currentTime)}
            onLoadedMetadata={() => setIsMetadataReady(true)}
          />
        )
      ) : (
        <div className="h-full w-full flex flex-col select-none relative">
          {segment && (
            <VideoSegmentBar
              segment={segment}
              isLoopEnabled={isSegmentLoopEnabled}
              onToggleLoop={() => setIsSegmentLoopEnabled((prev) => !prev)}
              onExit={() => handleSegmentChange(null)}
            />
          )}

          <div className="flex-grow min-h-0 flex items-center justify-center p-2 sm:p-3 relative overflow-hidden">
            <div className="w-full max-w-md flex flex-col items-center gap-4 rounded-xl bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] p-6 shadow-xl">
              <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]" title={file.name}>
                {file.name}
              </span>
              <audio
                key={file.id}
                ref={audioRef}
                src={file.dataUrl}
                controls
                onLoadedMetadata={handleAudioLoadedMetadata}
                onTimeUpdate={handleAudioTimeUpdate}
                className="w-full outline-none"
                data-testid="media-nav-audio"
              />

              {timelineMarkers.length > 0 && (
                <div className="w-full flex flex-col gap-2 pt-3 mt-1 border-t border-[var(--theme-border-secondary)]/60">
                  <div className="flex items-center justify-between text-xs text-[var(--theme-text-secondary)]">
                    <span className="font-medium flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {t('mediaNavTimelineMarkers')}
                    </span>
                    <span className="font-mono text-[11px] opacity-75">
                      {interpolate(t('mediaNavMarkerCount'), { count: timelineMarkers.length })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                    {timelineMarkers.map((marker) => (
                      <button
                        key={marker.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          if (audioRef.current) {
                            audioRef.current.currentTime = Math.max(0, marker.time);
                            try {
                              const playPromise = audioRef.current.play();
                              if (playPromise && typeof playPromise.catch === 'function') {
                                playPromise.catch(() => {});
                              }
                            } catch {
                              // Fallback for mock environments
                            }
                          }
                          focusChatInput(0, { caret: 'end', retries: 4 });
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-bg-accent)] hover:text-white transition-all cursor-pointer border border-[var(--theme-border-secondary)] shadow-sm"
                        title={marker.snippet}
                      >
                        <span className="font-semibold text-amber-500 dark:text-amber-400">
                          {formatTimestamp(marker.time)}
                        </span>
                        {marker.snippet && (
                          <span className="max-w-[140px] truncate font-sans text-[var(--theme-text-secondary)] hover:text-inherit">
                            {marker.snippet}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const MediaNavView = React.memo(MediaNavViewComponent);
