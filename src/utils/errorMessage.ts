import { safeJsonParse } from './safeJsonParse';

/**
 * Safely extracts a displayable error message from an unknown thrown value or rejection.
 * Handles Error instances, strings, nullish values, and custom error shapes.
 *
 * @param error - The caught value (Error, string, or unknown)
 * @param fallbackMessage - Default message if extracted error is empty
 * @returns Human-readable error string
 */
export const getErrorMessage = (error: unknown, fallbackMessage?: string): string => {
  if (error instanceof Error) {
    return error.message || fallbackMessage || '';
  }
  if (error === undefined || error === null) {
    return fallbackMessage ?? '';
  }
  const errorString = String(error);
  return errorString || (fallbackMessage ?? '');
};

/**
 * Normalizes an unknown thrown value into a standard JavaScript Error instance.
 *
 * @param error - Caught value
 * @param fallbackMessage - Fallback message if error has no readable string representation
 */
export const toError = (error: unknown, fallbackMessage?: string): Error => {
  if (error instanceof Error) return error;
  const errorString = error === undefined || error === null ? '' : String(error);
  return new Error(errorString || fallbackMessage || 'Unknown error');
};

/**
 * Reads an error message from an HTTP response body. Tries `{ error: { message } }`
 * (Anthropic / OpenAI-compatible shape), then `{ error: string }` (MCP shape),
 * falling back to the raw body, then to a status-only summary. Used by every
 * provider API client + the MCP client — keep the fallback ladder intact.
 */
export const readResponseErrorMessage = async (response: Response, fallbackLabel: string): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return `${fallbackLabel} failed with status ${response.status}`;
  }
  const parsed = safeJsonParse<{ error?: { message?: string } | string } | null>(text, null);
  if (parsed && typeof parsed === 'object') {
    const error = parsed.error;
    if (typeof error === 'string') return error || text;
    if (error && typeof error.message === 'string') return error.message;
  }
  return text;
};
