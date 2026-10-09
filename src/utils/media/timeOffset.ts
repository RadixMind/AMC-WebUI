/**
 * Parses a media time offset string (e.g. "10s", "1.250s", or optionally without "s" like "10")
 * into fractional seconds.
 *
 * Used for Gemini API videoMetadata start/end offsets and subtitle word timing.
 * Returns null if the offset string is undefined, empty, or not a valid second offset.
 *
 * @param offset - Time offset string (e.g. "1.250s", "10s", "10.5")
 * @returns Parsed number of seconds or null if invalid
 */
export const parseTimeOffsetSeconds = (offset?: string | null): number | null => {
  if (!offset || typeof offset !== 'string') return null;
  const match = offset.trim().match(/^(\d+(?:\.\d+)?)s?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/**
 * Parses a media time offset string, returning 0 if invalid or absent.
 * Useful for subtitle cue offsets where 0s is the safe fallback.
 *
 * @param offset - Time offset string (e.g. "1.250s", "12s")
 * @returns Parsed number of seconds, defaulting to 0
 */
export const parseTimeOffsetSecondsOrZero = (offset?: string | null): number => parseTimeOffsetSeconds(offset) ?? 0;
