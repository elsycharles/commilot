import { hasApiKey, resolveApiKey } from '../core/ConfigLoader.js';
import {
  PROVIDER_NAMES,
  type Config,
  type ProviderBlock,
  type ProviderInfo,
  type ProviderName,
} from '../types/config.js';
import { ProviderDisabledError, UnsupportedProviderError } from '../utils/errors.js';
import type { AIProvider } from './AIProvider.js';
import { ClaudeProvider } from './ClaudeProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { OllamaProvider } from './OllamaProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

interface ProviderDescriptor {
  displayName: string;
  /** Release the provider shipped in. */
  version: string;
  /** Providers not yet released are rejected by the factory. */
  available: boolean;
  /** Local backends need no credentials. */
  requiresApiKey: boolean;
  create: (ctx: { settings: ProviderBlock; apiKey: string; cacheMinutes: number }) => AIProvider;
}

export const DEFAULT_PROVIDER: ProviderName = 'ollama';

const REGISTRY: Record<ProviderName, ProviderDescriptor> = {
  gemini: {
    displayName: 'Google Gemini',
    version: 'v1.0',
    available: true,
    requiresApiKey: true,
    create: (ctx) => new GeminiProvider(ctx),
  },
  openai: {
    displayName: 'OpenAI ChatGPT',
    version: 'v1.1',
    available: true,
    requiresApiKey: true,
    create: (ctx) => new OpenAIProvider(ctx),
  },
  claude: {
    displayName: 'Anthropic Claude',
    version: 'v1.2',
    available: true,
    requiresApiKey: true,
    create: (ctx) => new ClaudeProvider(ctx),
  },
  ollama: {
    displayName: 'Ollama (local)',
    version: 'v2.0',
    available: true,
    // Runs on the developer's own machine: nothing to authenticate against.
    requiresApiKey: false,
    create: (ctx) => new OllamaProvider(ctx),
  },
};

function availableNames(): string[] {
  return PROVIDER_NAMES.filter((name) => REGISTRY[name].available);
}

function plannedNames(): string[] {
  return PROVIDER_NAMES.filter((name) => !REGISTRY[name].available);
}

function isKnownProvider(name: string): name is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(name);
}

/** Turns `config.provider` into a concrete, ready-to-use provider instance. */
export class ProviderFactory {
  /**
   * @throws {UnsupportedProviderError} for unknown or not-yet-released providers.
   * @throws {MissingApiKeyError} when the selected provider has no API key.
   */
  static createProvider(config: Config, override?: string, model?: string): AIProvider {
    const name = (override ?? config.provider).trim().toLowerCase();
    if (!isKnownProvider(name) || !REGISTRY[name].available) {
      throw new UnsupportedProviderError(name, availableNames(), plannedNames());
    }

    const descriptor = REGISTRY[name];
    if (!config[name].enabled) throw new ProviderDisabledError(name);

    // `--model` overrides the configured model for this run only.
    const settings = model ? { ...config[name], model } : config[name];
    // A local backend has nothing to authenticate against, so demanding a key
    // would make it unusable.
    const apiKey = descriptor.requiresApiKey
      ? resolveApiKey(name, config as unknown as Record<string, unknown>)
      : '';
    return descriptor.create({ settings, apiKey, cacheMinutes: config.behaviour.cacheMinutes });
  }

  /** Everything `commilot providers` needs to render its table. */
  static listProviders(config: Config): ProviderInfo[] {
    return PROVIDER_NAMES.map((name) => {
      const descriptor = REGISTRY[name];
      return {
        name,
        displayName: descriptor.displayName,
        status: descriptor.available ? ('available' as const) : ('planned' as const),
        version: descriptor.version,
        model: config[name].model,
        requiresApiKey: descriptor.requiresApiKey,
        enabled: config[name].enabled,
        configured:
          descriptor.available &&
          config[name].enabled &&
          (!descriptor.requiresApiKey ||
            hasApiKey(name, config as unknown as Record<string, unknown>)),
        isDefault: name === DEFAULT_PROVIDER,
        isCurrent: name === config.provider,
      };
    });
  }

  /** Name shown in spinners, e.g. `provider: gemini`. */
  static resolveProviderName(config: Config, override?: string): string {
    return (override ?? config.provider).trim().toLowerCase();
  }
}
