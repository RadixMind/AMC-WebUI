import { describe, expect, it } from 'vitest';
import { CHERRY_MODEL_LOGOS, CHERRY_PROVIDER_LOGOS, resolveIconRef } from './modelIconRegistry';

describe('modelIconRegistry', () => {
  it('loads cherry models and providers via Vite glob', () => {
    const modelKeys = Object.keys(CHERRY_MODEL_LOGOS);
    const providerKeys = Object.keys(CHERRY_PROVIDER_LOGOS);

    // Sanity floor only: this must not pin the exact icon count, because unreachable
    // icons are pruned on purpose (see the reachability guard below).
    expect(modelKeys.length).toBeGreaterThan(50);
    expect(providerKeys.length).toBeGreaterThan(50);

    // Every globbed entry must resolve to a real, non-empty asset URL.
    for (const url of [...Object.values(CHERRY_MODEL_LOGOS), ...Object.values(CHERRY_PROVIDER_LOGOS)]) {
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    }
  });

  it('ships only icons that a lookup tier can actually reach', () => {
    // Every tier consults the provider map before the model map for aliases/templates,
    // so a model-dir icon whose basename also exists in the provider dir is dead weight.
    expect(CHERRY_PROVIDER_LOGOS).toHaveProperty('openai');
    expect(CHERRY_MODEL_LOGOS).not.toHaveProperty('openai');
    // `zai` was byte-identical to the reachable `glm` and is not a catalog key.
    expect(CHERRY_MODEL_LOGOS).toHaveProperty('glm');
    expect(CHERRY_MODEL_LOGOS).not.toHaveProperty('zai');
    // Icons only reachable through a pattern table must survive pruning.
    expect(CHERRY_MODEL_LOGOS).toHaveProperty('gpt-5-chat');
    expect(CHERRY_MODEL_LOGOS).toHaveProperty('claude');
    expect(CHERRY_PROVIDER_LOGOS).toHaveProperty('bailian');
  });

  describe('resolveIconRef pattern boundaries and dedicated marks', () => {
    it('matches exact GPT sub-series icons', () => {
      expect(resolveIconRef('gpt-5.6-sol').key).toBe('gpt-5-6-sol');
      expect(resolveIconRef('gpt-5-6-luna').key).toBe('gpt-5-6-luna');
      expect(resolveIconRef('gpt-4o').key).toBe('gpt-4o');
      expect(resolveIconRef('gpt-4o-mini').key).toBe('gpt-4o-mini');
      expect(resolveIconRef('gpt-4-turbo').key).toBe('gpt-4-turbo');
    });

    it('matches dedicated model families', () => {
      expect(resolveIconRef('claude-3-5-sonnet-20241022').key).toBe('claude');
      expect(resolveIconRef('dall-e-3').key).toBe('dalle');
      expect(resolveIconRef('sora-2').key).toBe('sora');
      expect(resolveIconRef('flux-1-schnell').key).toBe('flux');
      expect(resolveIconRef('ideogram-v2').key).toBe('ideogram');
      expect(resolveIconRef('kling-v1').key).toBe('kling');
      expect(resolveIconRef('kolors').key).toBe('kolors');
      expect(resolveIconRef('suno-v3').key).toBe('suno');
    });

    it('respects pattern boundary safety (avoiding misfires)', () => {
      // SensNova vs Nova
      expect(resolveIconRef('sensenova-v6').key).toBe('sensenova');
      expect(resolveIconRef('nova-pro').key).toBe('nova');

      // Wan vs Taiwan
      expect(resolveIconRef('wan-2-1').key).toBe('qwen');
      expect(resolveIconRef('taiwan-llm').key).not.toBe('qwen');

      // Ling vs Spring
      expect(resolveIconRef('ling-1t').key).toBe('ling');
      expect(resolveIconRef('spring-1t').key).not.toBe('ling');

      // Seed vs Linseed
      expect(resolveIconRef('seed-2.0-lite').key).toBe('doubao');
      expect(resolveIconRef('linseed-embedding').key).not.toBe('doubao');

      // Hunyuan / hy3
      expect(resolveIconRef('hy-role').key).toBe('hunyuan');
      expect(resolveIconRef('hy3-preview').key).toBe('hunyuan');
    });

    it('falls back to provider inference when no dedicated mark exists', () => {
      expect(resolveIconRef('meta-llama/llama-3.3-70b-instruct').key).toBe('meta');
      expect(resolveIconRef('mistralai/codestral-2501').key).toBe('mistral');
      expect(resolveIconRef('baai/bge-m3').key).toBe('baai');
    });

    it('falls back to provider/template ID for unknown models', () => {
      expect(resolveIconRef('my-arbitrary-model', 'openrouter').key).toBe('openrouter');
      expect(resolveIconRef('my-arbitrary-model', 'siliconflow').key).toBe('silicon');
      expect(resolveIconRef('my-arbitrary-model', undefined, 'kimi').key).toBe('moonshot');
      expect(resolveIconRef('my-arbitrary-model', 'custom').key).toBe('custom');
    });

    it('resolves anthropic provider icon with dark mode variant', () => {
      const resolved = resolveIconRef('arbitrary-model-without-mark', 'anthropic');
      expect(resolved.key).toBe('anthropic');
      expect(resolved.url).toBeTruthy();
      expect(resolved.darkUrl).toBeTruthy();
    });
  });
});
