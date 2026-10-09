import { describe, expect, it } from 'vitest';
import { SERVER_MANAGED_API_KEY } from '../../../shared/serverManagedApiKey.js';
import { resolveApiKeyPrecedence } from './apiKeyPrecedence.js';

describe('resolveApiKeyPrecedence', () => {
  it('gives precedence to browser key by default when both are present', () => {
    const result = resolveApiKeyPrecedence({
      browserKey: 'user-key-123',
      serverKey: 'server-key-456',
      serverKeyPriority: false,
    });
    expect(result).toEqual({ apiKey: 'user-key-123', isBrowserKey: true });
  });

  it('gives precedence to server key when serverKeyPriority is true and server key exists', () => {
    const result = resolveApiKeyPrecedence({
      browserKey: 'user-key-123',
      serverKey: 'server-key-456',
      serverKeyPriority: true,
    });
    expect(result).toEqual({ apiKey: 'server-key-456', isBrowserKey: false });
  });

  it('falls back to server key when browser key is SERVER_MANAGED_API_KEY sentinel', () => {
    const result = resolveApiKeyPrecedence({
      browserKey: SERVER_MANAGED_API_KEY,
      serverKey: 'server-key-456',
      serverKeyPriority: false,
    });
    expect(result).toEqual({ apiKey: 'server-key-456', isBrowserKey: false });
  });

  it('falls back to server key when browser key is missing', () => {
    const result = resolveApiKeyPrecedence({
      browserKey: '',
      serverKey: 'server-key-456',
    });
    expect(result).toEqual({ apiKey: 'server-key-456', isBrowserKey: false });
  });

  it('returns null when neither key is available', () => {
    const result = resolveApiKeyPrecedence({
      browserKey: '',
      serverKey: undefined,
    });
    expect(result).toBeNull();
  });
});
