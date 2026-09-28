import type { ModelCapabilities, ModelOption } from '@/types';
import { KNOWN_MODELS_CATALOG } from './catalogs';

export { KNOWN_MODELS_CATALOG };

/**
 * Format token count into human-friendly representation (e.g. 128000 -> 128K, 1048576 -> 1M)
 */
export const formatContextWindow = (tokens?: number | null): string => {
  if (!tokens || tokens <= 0) return '';
  if (tokens >= 1_000_000) {
    const millions = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${millions}M`;
  }
  if (tokens >= 1_000) {
    const thousands = Math.round(tokens / 1_000);
    return `${thousands}K`;
  }
  return String(tokens);
};

/**
 * Normalize model ID by stripping vendor/host prefixes and release-date / variant suffixes.
 * Inspired by Cherry Studio's normalizeModelId pipeline.
 */
export const normalizeModelId = (rawId: string): string => {
  if (!rawId) return '';
  let id = rawId.trim().toLowerCase();

  // 1. Strip org / provider prefix (e.g. "openai/gpt-4o", "anthropic/claude-3-5-sonnet")
  if (id.includes('/')) {
    const parts = id.split('/');
    id = parts[parts.length - 1];
  }

  // 2. Strip aws/bedrock prefix (e.g. "us.anthropic.claude-3-5-sonnet-20241022-v2:0")
  id = id.replace(/^(us|eu|apac)\.anthropic\./, '').replace(/^anthropic\./, '');

  // 3. Strip bedrock/openrouter tag suffixes like ":free", ":nitro", ":extended"
  id = id.replace(/:(free|nitro|extended|default)$/, '');

  // 4. Strip bedrock version tag like -v1:0, -v2:0
  id = id.replace(/[-_]v\d+:\d+$/, '');

  // 5. Strip date suffixes like -20241022, -20250219, -2024-07-18, -20240806
  id = id.replace(/[-_](202\d{5}|202\d{1}-\d{2}-\d{2})$/, '');

  return id;
};

/**
 * Heuristically infer capabilities and context window when model is not in KNOWN_MODELS_CATALOG.
 */
export const inferModelCapabilities = (
  rawId: string,
): {
  capabilities: ModelCapabilities;
  contextWindow?: number;
  ownedBy?: string;
} => {
  const lower = rawId.toLowerCase();

  const isPureAudio = /tts|transcribe|live-translate/i.test(lower);
  const isImageGen =
    /dall-e|midjourney|flux|stable-diffusion|sdxl|imagen|cogview|nano-?banana/i.test(lower) ||
    /-(image|image-preview)$/i.test(lower);

  const thinking =
    /r1|o1|o3|o4|claude-3-7|thinking|reasoner|reasoning|qwq|zero/i.test(lower) ||
    (!isPureAudio && /gemini-3|gemini-2\.5|gemma-4|robotics/i.test(lower));
  const vision = !isPureAudio && /vision|vl|-v-|4v|4o|pixtral|claude-3|gemini|gemma|multimodal/i.test(lower);
  const tools = !/embed|rerank|moderation|tts|whisper|dall-e|transcribe|live-translate/i.test(lower) && !isImageGen;
  const image = isImageGen;
  const embedding = /embed|bge|text-embedding/i.test(lower);
  const audio = /tts|whisper|speech|audio|cosyvoice|transcribe|live-translate|-live/i.test(lower);
  const free =
    /:free($|[:/])|(\/free$)/i.test(lower) ||
    lower.includes(':free') ||
    lower.includes('gemini-2.0-flash') ||
    lower.includes('ollama');

  // Guess context window if present in string (e.g. 128k, 32k, 1m)
  let contextWindow: number | undefined;
  if (/(\d+)m/i.test(lower)) {
    const match = lower.match(/(\d+)m/i);
    if (match) {
      contextWindow = parseInt(match[1], 10) * 1_000_000;
    }
  } else if (/(\d+)k/i.test(lower)) {
    const match = lower.match(/(\d+)k/i);
    if (match) {
      contextWindow = parseInt(match[1], 10) * 1_000;
    }
  }

  // Guess owner
  let ownedBy: string | undefined;
  if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) ownedBy = 'openai';
  else if (lower.includes('claude')) ownedBy = 'anthropic';
  else if (lower.includes('deepseek')) ownedBy = 'deepseek';
  else if (lower.includes('qwen') || lower.includes('qwq')) ownedBy = 'qwen';
  else if (lower.includes('llama')) ownedBy = 'meta';
  else if (lower.includes('mistral') || lower.includes('pixtral') || lower.includes('codestral')) ownedBy = 'mistral';
  else if (lower.includes('gemini') || lower.includes('gemma')) ownedBy = 'google';
  else if (lower.includes('grok')) ownedBy = 'xai';
  else if (lower.includes('moonshot') || lower.includes('kimi')) ownedBy = 'moonshot';
  else if (lower.includes('glm')) ownedBy = 'zhipu';

  return {
    capabilities: { vision, thinking, tools, image, embedding, audio, free },
    contextWindow,
    ownedBy,
  };
};

/**
 * Helper to resolve or infer capabilities for an existing or incoming model option.
 */
export const getOrInferModelCapabilities = (model: {
  id: string;
  name?: string;
  capabilities?: ModelCapabilities;
  enableThinking?: boolean;
}): ModelCapabilities => {
  const normalizedId = normalizeModelId(model.id);
  const catalogEntry = KNOWN_MODELS_CATALOG[normalizedId] || KNOWN_MODELS_CATALOG[model.id.toLowerCase()];
  const inferred = inferModelCapabilities(model.id).capabilities;
  const baseCaps = catalogEntry ? { ...inferred, ...catalogEntry.capabilities } : inferred;
  return {
    ...baseCaps,
    ...(model.capabilities || {}),
    thinking: model.capabilities?.thinking ?? model.enableThinking ?? baseCaps.thinking,
    free: model.capabilities?.free ?? baseCaps.free,
    image: model.capabilities?.image ?? baseCaps.image,
    embedding: model.capabilities?.embedding ?? baseCaps.embedding,
    audio: model.capabilities?.audio ?? baseCaps.audio,
  };
};

/**
 * Match a raw remote model to the known catalog or heuristically enrich its metadata.
 */
export const enrichModelMetadata = (remote: { id: string; name?: string; owned_by?: string }): ModelOption => {
  const normalizedId = normalizeModelId(remote.id);
  const catalogEntry = KNOWN_MODELS_CATALOG[normalizedId] || KNOWN_MODELS_CATALOG[remote.id.toLowerCase()];
  const inferred = inferModelCapabilities(remote.id);

  if (catalogEntry) {
    return {
      id: remote.id,
      name: remote.name && remote.name !== remote.id ? remote.name : catalogEntry.name,
      contextWindow: catalogEntry.contextWindow,
      maxOutputTokens: catalogEntry.maxOutputTokens,
      capabilities: { ...inferred.capabilities, ...catalogEntry.capabilities },
      ownedBy: catalogEntry.ownedBy,
      enableThinking: catalogEntry.capabilities.thinking ?? inferred.capabilities.thinking ?? false,
      enableTools: catalogEntry.capabilities.tools ?? inferred.capabilities.tools ?? true,
      visibleInSelector: true,
    };
  }

  // Fallback to heuristics
  return {
    id: remote.id,
    name: remote.name || remote.id,
    contextWindow: inferred.contextWindow,
    capabilities: inferred.capabilities,
    ownedBy: inferred.ownedBy || remote.owned_by,
    enableThinking: inferred.capabilities.thinking ?? false,
    enableTools: inferred.capabilities.tools ?? true,
    visibleInSelector: true,
  };
};
