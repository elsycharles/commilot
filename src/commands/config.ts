import chalk from 'chalk';
import yaml from 'js-yaml';
import {
  coerceConfigValue,
  getByPath,
  getConfigPath,
  loadConfigWithSources,
  readRawConfig,
  setByPath,
  writeRawConfig,
} from '../core/ConfigLoader.js';
import { configSchema, defaultConfig } from '../types/config.js';
import { ConfigValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface ConfigCommandOptions {
  global?: boolean;
}

function assertKnownKey(key: string): void {
  if (getByPath(defaultConfig(), key) === undefined) {
    throw new ConfigValidationError(`'${key}' is not a known configuration key`);
  }
}

/** Mask secrets so `config get gemini.apiKey` never prints a full key. */
function maskIfSecret(key: string, value: unknown): unknown {
  if (!/apikey$/i.test(key) || typeof value !== 'string' || value.length === 0) return value;
  return `${value.slice(0, 4)}${'•'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function render(value: unknown): string {
  if (value === undefined) return chalk.dim('(unset)');
  if (typeof value === 'string') return value;
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return `\n${yaml.dump(value, { indent: 2 }).trimEnd()}`;
  }
  return String(value);
}

/** `commilot config get <key>` — print the effective, merged value. */
export async function configGetCommand(key: string, cwd: string = process.cwd()): Promise<void> {
  assertKnownKey(key);
  const { config, sources } = await loadConfigWithSources(cwd);
  const value = getByPath(config, key);
  logger.info(`${chalk.cyan(key)} = ${render(maskIfSecret(key, value))}`);
  const from = [
    sources.project && `project: ${sources.project}`,
    sources.home && `home: ${sources.home}`,
  ]
    .filter(Boolean)
    .join('  ');
  if (from) logger.debug(`merged from — ${from}`);
}

/** `commilot config set <key> <value>` — write to the project or home file. */
export async function configSetCommand(
  key: string,
  rawValue: string,
  opts: ConfigCommandOptions,
  cwd: string = process.cwd(),
): Promise<void> {
  assertKnownKey(key);
  const value = coerceConfigValue(key, rawValue);
  const path = getConfigPath(opts.global ? 'global' : 'project', cwd);

  const raw = readRawConfig(path);
  setByPath(raw, key, value);

  // Validate the file as a whole so we never persist something unloadable.
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; '),
    );
  }

  writeRawConfig(path, raw);
  logger.success(
    `${chalk.cyan(key)} = ${render(maskIfSecret(key, value))}  ${chalk.dim(`→ ${path}`)}`,
  );
}

/** `commilot config list` — dump the effective configuration. */
export async function configListCommand(cwd: string = process.cwd()): Promise<void> {
  const { config, sources } = await loadConfigWithSources(cwd);
  const redacted = JSON.parse(JSON.stringify(config)) as Record<string, Record<string, unknown>>;
  for (const provider of ['gemini', 'openai', 'claude', 'ollama']) {
    const block = redacted[provider];
    if (block && typeof block.apiKey === 'string' && block.apiKey) {
      block.apiKey = String(maskIfSecret('apiKey', block.apiKey));
    }
  }
  if (sources.project) logger.info(chalk.dim(`# project: ${sources.project}`));
  if (sources.home) logger.info(chalk.dim(`# home:    ${sources.home}`));
  logger.info(yaml.dump(redacted, { indent: 2 }).trimEnd());
}
