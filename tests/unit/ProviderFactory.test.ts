import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderFactory } from '../../src/providers/ProviderFactory.js';
import { GeminiProvider } from '../../src/providers/GeminiProvider.js';
import { configSchema } from '../../src/types/config.js';
import { MissingApiKeyError, UnsupportedProviderError } from '../../src/utils/errors.js';

function config(overrides: Record<string, unknown> = {}) {
  return configSchema.parse({ gemini: { apiKey: 'test-key' }, ...overrides });
}

// A developer's real key in the environment must not change these results.
beforeEach(() => {
  for (const name of ['GEMINI', 'OPENAI', 'CLAUDE', 'OLLAMA']) {
    vi.stubEnv(`COMMILOT_${name}_KEY`, '');
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createProvider', () => {
  it('returns a Gemini instance for the default provider', () => {
    const provider = ProviderFactory.createProvider(config());
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.getProviderName()).toBe('Google Gemini');
    expect(provider.isConfigured()).toBe(true);
  });

  it('honours a --provider override', () => {
    const provider = ProviderFactory.createProvider(config({ provider: 'openai' }), 'gemini');
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('rejects unknown providers with the available list (AC-22)', () => {
    expect(() => ProviderFactory.createProvider(config({ provider: 'llama-at-home' }))).toThrow(
      UnsupportedProviderError,
    );
    try {
      ProviderFactory.createProvider(config({ provider: 'llama-at-home' }));
    } catch (err) {
      expect((err as Error).message).toContain('Available: gemini');
      expect((err as Error).message).toContain('Coming soon: openai, claude');
    }
  });

  it('rejects providers that are known but not yet released', () => {
    expect(() => ProviderFactory.createProvider(config({ provider: 'claude' }))).toThrow(
      UnsupportedProviderError,
    );
  });

  it('requires an API key', () => {
    const bare = configSchema.parse({});
    expect(() => ProviderFactory.createProvider(bare)).toThrow(MissingApiKeyError);
  });
});

describe('listProviders', () => {
  it('reports status, model and configuration state for every provider', () => {
    const list = ProviderFactory.listProviders(config());
    expect(list.map((info) => info.name)).toEqual(['gemini', 'openai', 'claude', 'ollama']);

    const gemini = list[0];
    expect(gemini).toMatchObject({
      status: 'available',
      configured: true,
      isDefault: true,
      isCurrent: true,
      model: 'gemini-2.0-flash',
    });

    expect(list[1]).toMatchObject({ name: 'openai', status: 'planned', version: 'v1.1' });
    expect(list[2]).toMatchObject({ name: 'claude', status: 'planned', version: 'v1.2' });
    expect(list.every((info) => (info.status === 'planned' ? !info.configured : true))).toBe(true);
  });

  it('marks a provider without a key as unconfigured', () => {
    const list = ProviderFactory.listProviders(configSchema.parse({}));
    expect(list[0]?.configured).toBe(false);
  });
});
