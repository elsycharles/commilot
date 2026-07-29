import { hasApiKey, resolveApiKey } from '../core/ConfigLoader.js';
import {
  PROVIDER_NAMES,
  type Config,
  type ProviderBlock,
  type ProviderInfo,
  type ProviderName,
} from '../types/config.js';
import { UnsupportedProviderError } from '../utils/errors.js';
import type { AIProvider } from './AIProvider.js';
import { ClaudeProvider } from './ClaudeProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

interface ProviderDescriptor {
  displayName: string;
  version: string;
  /** Providers not yet released are rejected by the factory. */
  available: boolean;
  create: (ctx: { settings: ProviderBlock; apiKey: string }) => AIProvider;
}

export const DEFAULT_PROVIDER: ProviderName = 'gemini';

const REGISTRY: Record<ProviderName, ProviderDescriptor> = {
  gemini: {
    displayName: 'Google Gemini',
    version: 'v1.0',
    available: true,
    create: (ctx) => new GeminiProvider(ctx),
  },
  openai: {
    displayName: 'OpenAI ChatGPT',
    version: 'v1.1',
    available: false,
    create: (ctx) => new OpenAIProvider(ctx),
  },
  claude: {
    displayName: 'Anthropic Claude',
    version: 'v1.2',
    available: false,
    create: (ctx) => new ClaudeProvider(ctx),
  },
  ollama: {
    displayName: 'Ollama (local)',
    version: 'v2.0',
    available: false,
    create: () => {
      throw new UnsupportedProviderError('ollama', availableNames(), plannedNames());
    },
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
  static createProvider(config: Config, override?: string): AIProvider {
    const name = (override ?? config.provider).trim().toLowerCase();
    if (!isKnownProvider(name) || !REGISTRY[name].available) {
      throw new UnsupportedProviderError(name, availableNames(), plannedNames());
    }
    const settings = config[name];
    const apiKey = resolveApiKey(name, config as unknown as Record<string, unknown>);
    return REGISTRY[name].create({ settings, apiKey });
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
        configured:
          descriptor.available && hasApiKey(name, config as unknown as Record<string, unknown>),
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
