import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dump, load } from 'js-yaml';
import { ZodError } from 'zod';
import { configSchema, defaultConfig, type Config, type RawConfig } from '../types/config.js';
import { ConfigError, ConfigValidationError, MissingApiKeyError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const CONFIG_FILENAME = '.commilot.yml';

export type ConfigScope = 'project' | 'global';

/** Where each layer of the merged config came from. Useful for `config get`. */
export interface ConfigSources {
  project?: string;
  home?: string;
}

export interface LoadedConfig {
  config: Config;
  sources: ConfigSources;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep merge where the earlier argument wins. Arrays replace rather than
 * concatenate, so a project config can shrink the list of allowed types.
 */
function deepMerge<T extends Record<string, unknown>>(high: RawConfig, low: T): T {
  const out: Record<string, unknown> = { ...low };
  for (const [key, value] of Object.entries(high)) {
    if (value === undefined || value === null) continue;
    const existing = out[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      out[key] = deepMerge(value, existing);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function readYamlFile(path: string): RawConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`could not read ${path} (${(err as Error).message})`);
  }
  let parsed: unknown;
  try {
    parsed = load(text);
  } catch (err) {
    throw new ConfigError(`${path} is not valid YAML — ${(err as Error).message}`);
  }
  if (parsed === undefined || parsed === null) return {};
  if (!isPlainObject(parsed)) {
    throw new ConfigError(`${path} must contain a YAML mapping at the top level`);
  }
  return parsed;
}

/** Name used before the file was renamed after the tool itself. */
export const LEGACY_CONFIG_FILENAME = '.commitHelper.yml';

/**
 * Accept the old filename so an existing setup keeps working, but say so once,
 * rather than silently ignoring a config the user believes is being read.
 */
function resolveConfigFile(dir: string): string | undefined {
  const current = join(dir, CONFIG_FILENAME);
  if (existsSync(current)) return current;

  const legacy = join(dir, LEGACY_CONFIG_FILENAME);
  if (existsSync(legacy)) {
    logger.warn(
      `${legacy} is the old configuration name. Rename it to ${CONFIG_FILENAME}; support for the old name will be dropped.`,
    );
    return legacy;
  }
  return undefined;
}

/** Walk up from `cwd` looking for a project-level config file. */
export function findProjectConfig(cwd: string = process.cwd()): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = resolveConfigFile(dir);
    if (candidate) return candidate;
    // Stop at the repository root so we never pick up a sibling project's file.
    if (existsSync(join(dir, '.git'))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function getHomeConfigPath(): string {
  return resolveConfigFile(homedir()) ?? join(homedir(), CONFIG_FILENAME);
}

/** Resolved path a config file would live at for the given scope. */
export function getConfigPath(scope: ConfigScope, cwd: string = process.cwd()): string {
  return scope === 'global' ? getHomeConfigPath() : join(resolve(cwd), CONFIG_FILENAME);
}

/**
 * Merge raw config layers and validate the result.
 * Precedence: project > home > built-in defaults.
 */
export function mergeConfigs(project: RawConfig, home: RawConfig, defaults: Config): Config {
  const merged = deepMerge(project, deepMerge(home, defaults as unknown as RawConfig));
  try {
    return configSchema.parse(merged);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new ConfigValidationError(details);
    }
    throw err;
  }
}

/**
 * Load the project config (searching upwards from `cwd`), merge it over the
 * home config and the built-in defaults, then validate with Zod.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  return (await loadConfigWithSources(cwd)).config;
}

export async function loadConfigWithSources(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const sources: ConfigSources = {};
  const projectPath = findProjectConfig(cwd);
  const homePath = getHomeConfigPath();

  const project = projectPath ? readYamlFile(projectPath) : {};
  if (projectPath) {
    sources.project = projectPath;
    logger.debug(`loaded project config: ${projectPath}`);
  }

  // A home config that happens to be the project config must not be applied twice.
  const home = existsSync(homePath) && homePath !== projectPath ? readYamlFile(homePath) : {};
  if (sources.project !== homePath && existsSync(homePath)) {
    sources.home = homePath;
    logger.debug(`loaded home config: ${homePath}`);
  }

  return { config: mergeConfigs(project, home, defaultConfig()), sources };
}

/** Environment variable holding the API key for a provider. */
export function apiKeyEnvVar(provider: string): string {
  return `COMMILOT_${provider.toUpperCase()}_KEY`;
}

/**
 * Resolve a provider API key from the environment first, then the config file.
 * @throws {MissingApiKeyError} when neither source has a key.
 */
export function resolveApiKey(
  provider: string,
  config: RawConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env[apiKeyEnvVar(provider)];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const block = config[provider];
  if (isPlainObject(block)) {
    const key = block.apiKey;
    if (typeof key === 'string' && key.trim()) return key.trim();
  }
  throw new MissingApiKeyError(provider);
}

/** True when a key exists for the provider, without throwing. */
export function hasApiKey(
  provider: string,
  config: RawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    resolveApiKey(provider, config, env);
    return true;
  } catch {
    return false;
  }
}

/** Read a raw (unmerged) config file, returning `{}` when it does not exist. */
export function readRawConfig(path: string): RawConfig {
  return existsSync(path) ? readYamlFile(path) : {};
}

/** Write a raw config object back to disk as YAML. */
export function writeRawConfig(path: string, raw: RawConfig): void {
  writeFileSync(path, dump(raw, { indent: 2, lineWidth: 100, noRefs: true }), 'utf8');
}

/** Read a dotted key path (`format.types`) out of an object. */
export function getByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (!isPlainObject(acc)) return undefined;
    return acc[segment];
  }, source);
}

/** Set a dotted key path, creating intermediate objects as needed. */
export function setByPath(target: RawConfig, path: string, value: unknown): void {
  const segments = path.split('.');
  const last = segments.pop();
  if (!last) throw new ConfigValidationError(`'${path}' is not a valid config key`);
  let cursor: Record<string, unknown> = target;
  for (const segment of segments) {
    const next = cursor[segment];
    if (!isPlainObject(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[last] = value;
}

/**
 * Coerce a CLI string into the type the schema expects for that key, so
 * `config set behaviour.autoStage true` stores a boolean, not the text.
 */
export function coerceConfigValue(path: string, value: string): unknown {
  const current = getByPath(defaultConfig(), path);
  if (typeof current === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new ConfigValidationError(`'${path}' expects true or false`);
  }
  if (typeof current === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) throw new ConfigValidationError(`'${path}' expects a number`);
    return num;
  }
  if (Array.isArray(current)) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}
