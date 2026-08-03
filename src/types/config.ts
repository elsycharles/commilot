import { z } from 'zod';

/** Providers known to the CLI. Only `gemini` is implemented in v1.0. */
export const PROVIDER_NAMES = ['gemini', 'openai', 'claude', 'ollama'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

const providerBlockSchema = z.object({
  apiKey: z.string().default(''),
  model: z.string().min(1),
  temperature: z.number().min(0).max(1).default(0.3),
  timeoutMs: z.number().int().positive().default(30_000),
  maxRetries: z.number().int().min(0).max(10).default(3),
  /** Optional override of the provider base URL (proxies, self-hosted). */
  baseUrl: z.string().url().optional(),
  /**
   * Hosted backends are off by default: they need a key and are metered, and
   * a quota error on every run is a bad first experience. Their code is intact
   * and one setting away — see the per-provider defaults below.
   */
  enabled: z.boolean().default(false),
});

/**
 * A field the user invented, named in `format.template`. The model is told what
 * it means, so `{title}` produces a title rather than the word "title".
 */
export const customFieldSchema = z.object({
  /** What to ask the model for. Without it, only the field name is a hint. */
  description: z.string().default(''),
  /** Restrict the answer to this list. */
  values: z.array(z.string()).default([]),
  maxLength: z.number().int().positive().optional(),
});

export type CustomField = z.infer<typeof customFieldSchema>;

export const formatConfigSchema = z.object({
  template: z.string().default('{type}({scope}) - {description}'),
  types: z.array(z.string().min(1)).min(1).default(['dev', 'feat', 'bug']),
  scopes: z.array(z.string().min(1)).default([]),
  descriptionMaxLength: z.number().int().positive().default(72),
  language: z.string().min(2).default('en'),
  /** Meaning of the placeholders in `template` beyond type, scope and description. */
  fields: z.record(z.string(), customFieldSchema).default({}),
});

export const behaviourConfigSchema = z.object({
  autoStage: z.boolean().default(false),
  maxDiffLines: z.number().int().positive().default(5000),
  excludePatterns: z
    .array(z.string())
    .default(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '*.min.js', '*.min.css']),
  splitMaxCommits: z.number().int().positive().max(50).default(10),
  confirmBeforeCommit: z.boolean().default(true),
  /** Reuse an identical answer for this long instead of paying a request. 0 disables. */
  cacheMinutes: z.number().int().min(0).default(60),
});

export const configSchema = z.object({
  provider: z.string().default('ollama'),
  gemini: providerBlockSchema
    .extend({ model: z.string().default('gemini-2.0-flash') })
    .prefault({}),
  openai: providerBlockSchema.extend({ model: z.string().default('gpt-4o-mini') }).prefault({}),
  claude: providerBlockSchema.extend({ model: z.string().default('claude-sonnet-5') }).prefault({}),
  ollama: providerBlockSchema
    .extend({
      // The only backend enabled out of the box: no key, no quota, no network.
      enabled: z.boolean().default(true),
      model: z.string().default('llama3.1'),
      // Local inference on CPU is far slower than a hosted API.
      timeoutMs: z.number().int().positive().default(120_000),
    })
    .prefault({}),
  format: formatConfigSchema.prefault({}),
  behaviour: behaviourConfigSchema.prefault({}),
});

export type Config = z.infer<typeof configSchema>;
export type ProviderBlock = z.infer<typeof providerBlockSchema>;
export type FormatConfig = z.infer<typeof formatConfigSchema>;
export type BehaviourConfig = z.infer<typeof behaviourConfigSchema>;

/** A partially filled config as read from a YAML file, before defaults apply. */
export type RawConfig = Record<string, unknown>;

/** Built-in defaults, i.e. the config you get with no YAML file at all. */
export function defaultConfig(): Config {
  return configSchema.parse({});
}

/** Availability of a provider in the current release. */
export type ProviderStatus = 'available' | 'planned';

export interface ProviderInfo {
  name: ProviderName;
  displayName: string;
  status: ProviderStatus;
  /** Version in which the provider ships / is planned to ship. */
  version: string;
  model: string;
  /** False for local backends, which need no credentials. */
  requiresApiKey: boolean;
  /** Whether this backend may be selected at all. */
  enabled: boolean;
  configured: boolean;
  isDefault: boolean;
  isCurrent: boolean;
}
