import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderFactory } from '../../src/providers/ProviderFactory.js';
import { ClaudeProvider } from '../../src/providers/ClaudeProvider.js';
import { GeminiProvider } from '../../src/providers/GeminiProvider.js';
import { OllamaProvider } from '../../src/providers/OllamaProvider.js';
import { OpenAIProvider } from '../../src/providers/OpenAIProvider.js';
import { configSchema } from '../../src/types/config.js';
import {
  MissingApiKeyError,
  ProviderDisabledError,
  UnsupportedProviderError,
} from '../../src/utils/errors.js';

function config(overrides: Record<string, unknown> = {}) {
  return configSchema.parse({
    provider: 'gemini',
    gemini: { apiKey: 'test-key', enabled: true },
    ...overrides,
  });
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
  it('defaults to Ollama, with no key and nothing to enable', () => {
    const provider = ProviderFactory.createProvider(configSchema.parse({}));
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.isConfigured()).toBe(true);
  });

  it('refuses a backend that is not part of the product surface', () => {
    // The code is still there and still tested, but a user cannot reach it.
    const off = configSchema.parse({ provider: 'gemini', gemini: { apiKey: 'k' } });
    expect(() => ProviderFactory.createProvider(off)).toThrow(ProviderDisabledError);
    expect(() => ProviderFactory.createProvider(off)).toThrow(/runs on Ollama/);
  });

  it('uses a model passed for this run only', () => {
    const provider = ProviderFactory.createProvider(
      configSchema.parse({}),
      undefined,
      'qwen2.5-coder:7b',
    );
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it('returns a Gemini instance when it is enabled', () => {
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
      expect((err as Error).message).toContain('Available: gemini, openai, claude, ollama');
      // Nothing is planned-but-unreleased any more, so no dangling clause.
      expect((err as Error).message).not.toContain('Coming soon');
    }
  });

  it('builds every shipped provider', () => {
    const keys = {
      openai: { apiKey: 'sk', enabled: true },
      claude: { apiKey: 'sk-ant', enabled: true },
    };
    expect(ProviderFactory.createProvider(config({ provider: 'openai', ...keys }))).toBeInstanceOf(
      OpenAIProvider,
    );
    expect(ProviderFactory.createProvider(config({ provider: 'claude', ...keys }))).toBeInstanceOf(
      ClaudeProvider,
    );
    expect(ProviderFactory.createProvider(config({ provider: 'ollama' }))).toBeInstanceOf(
      OllamaProvider,
    );
  });

  it('builds ollama without any api key', () => {
    const provider = ProviderFactory.createProvider(configSchema.parse({ provider: 'ollama' }));
    expect(provider.getProviderName()).toBe('Ollama (local)');
    expect(provider.isConfigured()).toBe(true);
  });

  it('refuses hosted providers before it ever asks for a key', () => {
    // Being switched off comes first: telling someone to set a key for a
    // backend they cannot select would send them down the wrong path.
    for (const name of ['openai', 'claude']) {
      expect(() => ProviderFactory.createProvider(configSchema.parse({ provider: name }))).toThrow(
        ProviderDisabledError,
      );
    }
  });

  it('requires an API key once a hosted provider is enabled', () => {
    const bare = configSchema.parse({ provider: 'gemini', gemini: { enabled: true } });
    expect(() => ProviderFactory.createProvider(bare)).toThrow(MissingApiKeyError);
  });
});

describe('listProviders', () => {
  it('reports status, model and configuration state for every provider', () => {
    const list = ProviderFactory.listProviders(config());
    expect(list.map((info) => info.name)).toEqual(['gemini', 'openai', 'claude', 'ollama']);

    // Enabled by the fixture, so it reports as usable and current.
    expect(list[0]).toMatchObject({
      name: 'gemini',
      status: 'available',
      enabled: true,
      configured: true,
      isCurrent: true,
      model: 'gemini-2.0-flash',
    });

    // Implemented, but off until the user asks for them.
    expect(list[1]).toMatchObject({ name: 'openai', enabled: false, configured: false });
    expect(list[2]).toMatchObject({ name: 'claude', enabled: false, configured: false });

    expect(list[3]).toMatchObject({
      name: 'ollama',
      status: 'available',
      enabled: true,
      requiresApiKey: false,
      // Local inference needs no credentials, so it is ready by default.
      configured: true,
      isDefault: true,
    });
  });

  it('marks a provider without a key as unconfigured', () => {
    const list = ProviderFactory.listProviders(configSchema.parse({}));
    expect(list[0]?.configured).toBe(false);
  });
});
