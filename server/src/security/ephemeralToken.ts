import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../cors.js';
import { resolveGeminiRequestApiKey } from '../proxy/proxyHeaders.js';

export const EPHEMERAL_TOKEN_PATH = '/api/live/ephemeral-token';

export interface EphemeralTokenConfig {
  geminiApiBase: string;
  geminiApiKey?: string;
  liveGeminiApiKey?: string;
  allowedOrigins: string[];
  serverKeyPriority?: boolean;
}

const readRequestBodyJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  return new Promise((resolve) => {
    let body = '';
    let settled = false;
    const finish = (result: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    request.on('data', (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        finish({});
      }
    });
    request.on('end', () => {
      try {
        finish(body ? JSON.parse(body) : {});
      } catch {
        finish({});
      }
    });
    request.on('error', () => finish({}));
  });
};

export async function handleEphemeralTokenRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: EphemeralTokenConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const method = request.method?.toUpperCase();
  if (method !== 'POST') {
    sendJson(request, response, 405, { error: 'Method not allowed' }, config.allowedOrigins);
    return;
  }

  const serverFallbackKey = config.liveGeminiApiKey || config.geminiApiKey;
  const apiKey = resolveGeminiRequestApiKey(request, serverFallbackKey, config.serverKeyPriority);
  if (!apiKey) {
    sendJson(request, response, 401, { error: 'Live API key is not configured' }, config.allowedOrigins);
    return;
  }

  const body = await readRequestBodyJson(request);
  const targetBase = config.geminiApiBase.replace(/\/$/, '');
  const upstreamUrl = `${targetBase}/v1beta/auth_tokens`;

  // Default token constraints: expires in 30 minutes, 1 use if not specified
  const now = Date.now();
  const defaultExpireTime = new Date(now + 30 * 60 * 1000).toISOString();
  const requestPayload: Record<string, unknown> = {
    uses: typeof body.uses === 'number' ? body.uses : 1,
    expireTime: body.expireTime || defaultExpireTime,
  };
  if (typeof body.newSessionExpireTime === 'string' && body.newSessionExpireTime) {
    requestPayload.newSessionExpireTime = body.newSessionExpireTime;
  }

  if (body.bidiGenerateContentSetup) {
    requestPayload.bidiGenerateContentSetup = body.bidiGenerateContentSetup;
  } else if (body.liveConnectConstraints) {
    requestPayload.bidiGenerateContentSetup = body.liveConnectConstraints;
  } else if (body.model) {
    requestPayload.bidiGenerateContentSetup = {
      model: typeof body.model === 'string' && !body.model.startsWith('models/') ? `models/${body.model}` : body.model,
      generationConfig: body.config || body.generationConfig,
    };
  }

  try {
    const upstreamRes = await fetchImpl(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestPayload),
    });

    const upstreamData = await upstreamRes.json().catch(() => ({}));
    if (!upstreamRes.ok) {
      const errorMsg =
        (upstreamData as { error?: { message?: string } })?.error?.message ||
        `Upstream auth_tokens failed with status ${upstreamRes.status}`;
      sendJson(request, response, upstreamRes.status, { error: errorMsg }, config.allowedOrigins);
      return;
    }

    const tokenName = (upstreamData as { name?: string }).name || '';
    const token = tokenName.startsWith('authTokens/') ? tokenName.slice('authTokens/'.length) : tokenName;

    sendJson(
      request,
      response,
      200,
      {
        token,
        name: tokenName,
        expireTime: (upstreamData as { expireTime?: string }).expireTime || requestPayload.expireTime,
        newSessionExpireTime: (upstreamData as { newSessionExpireTime?: string }).newSessionExpireTime,
      },
      config.allowedOrigins,
    );
  } catch (upstreamTokenError) {
    const message = upstreamTokenError instanceof Error ? upstreamTokenError.message : 'Unknown upstream error';
    sendJson(request, response, 502, { error: `Failed to create ephemeral token: ${message}` }, config.allowedOrigins);
  }
}
