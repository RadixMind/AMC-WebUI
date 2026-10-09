import { SERVER_MANAGED_API_KEY } from '../../../shared/serverManagedApiKey.js';

export interface ApiKeyPrecedenceOptions {
  browserKey?: string | null;
  serverKey?: string | null;
  serverKeyPriority?: boolean;
}

export interface ResolvedApiKey {
  apiKey: string;
  isBrowserKey: boolean;
}

/**
 * Resolves upstream API key precedence between client-supplied keys (BYOK) and server-configured keys:
 * 1. If `serverKeyPriority` is true and a non-empty server key exists, the server key wins.
 * 2. If a valid `browserKey` is provided (and is not the placeholder sentinel `SERVER_MANAGED_API_KEY`),
 *    the browser key wins.
 * 3. Otherwise, falls back to the server key if present.
 * 4. Returns null if no key is available.
 */
export function resolveApiKeyPrecedence({
  browserKey,
  serverKey,
  serverKeyPriority = false,
}: ApiKeyPrecedenceOptions): ResolvedApiKey | null {
  const trimmedServerKey = serverKey?.trim() || '';
  const trimmedBrowserKey = browserKey && browserKey !== SERVER_MANAGED_API_KEY ? browserKey.trim() : '';

  if (serverKeyPriority && trimmedServerKey) {
    return { apiKey: trimmedServerKey, isBrowserKey: false };
  }

  if (trimmedBrowserKey) {
    return { apiKey: trimmedBrowserKey, isBrowserKey: true };
  }

  if (trimmedServerKey) {
    return { apiKey: trimmedServerKey, isBrowserKey: false };
  }

  return null;
}
