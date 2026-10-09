/** Upper bound for reading metadata so a stalled decoder cannot hang the application. */
const DEFAULT_MEDIA_DURATION_PROBE_TIMEOUT_MS = 3_000;

export type ProbeMediaType = 'audio' | 'video';

/**
 * Best-effort media duration probe via a detached <audio> or <video> element.
 * Returns null when the duration cannot be determined (unsupported codec,
 * missing metadata, non-browser environment) so callers can skip guards
 * instead of blocking the pipeline.
 *
 * @param typeOrMimeType - Either 'audio' | 'video' or a MIME type string (e.g. 'video/mp4', 'audio/wav')
 * @param file - File or Blob instance containing the media
 * @param timeoutMs - Upper bound timeout in milliseconds (defaults to 3000ms)
 * @returns Duration in seconds, or null if it cannot be determined
 */
export const probeMediaDuration = async (
  typeOrMimeType: ProbeMediaType | string,
  file: File | Blob,
  timeoutMs: number = DEFAULT_MEDIA_DURATION_PROBE_TIMEOUT_MS,
): Promise<number | null> => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return null;
  }

  const isVideo = typeOrMimeType.toLowerCase().startsWith('video');
  const type: ProbeMediaType = isVideo ? 'video' : 'audio';

  if (type === 'audio' && typeof Audio === 'undefined') {
    return null;
  }

  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(file);
  } catch {
    return null;
  }

  try {
    return await new Promise<number | null>((resolve) => {
      const element: HTMLMediaElement = type === 'audio' ? new Audio() : document.createElement('video');
      let settled = false;

      const settle = (value: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        try {
          element.removeAttribute('src');
        } catch {
          // Ignore removal error
        }
        resolve(value);
      };

      const timeoutId = window.setTimeout(() => settle(null), timeoutMs);

      element.preload = 'metadata';
      element.addEventListener('loadedmetadata', () => {
        settle(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
      });
      element.addEventListener('error', () => settle(null));
      element.src = objectUrl;
    });
  } catch {
    return null;
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Ignore revocation error
    }
  }
};
