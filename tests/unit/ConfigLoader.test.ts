import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_FILENAME,
  LEGACY_CONFIG_FILENAME,
  apiKeyEnvVar,
  coerceConfigValue,
  findProjectConfig,
  getByPath,
  getConfigPath,
  hasApiKey,
  loadConfig,
  mergeConfigs,
  readRawConfig,
  resolveApiKey,
  setByPath,
  writeRawConfig,
} from '../../src/core/ConfigLoader.js';
import { defaultConfig } from '../../src/types/config.js';
import { ConfigError, ConfigValidationError, MissingApiKeyError } from '../../src/utils/errors.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'commilot-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(target: string, yaml: string): string {
  const path = join(target, CONFIG_FILENAME);
  writeFileSync(path, yaml, 'utf8');
  return path;
}

describe('defaults', () => {
  it('produces a fully populated config with no files present', () => {
    const config = defaultConfig();
    // Ollama out of the box: no key, no quota, nothing leaves the machine.
    expect(config.provider).toBe('ollama');
    expect(config.ollama.model).toBe('llama3.1');
    expect(config.ollama.enabled).toBe(true);
    // Hosted backends stay implemented but switched off.
    expect(config.gemini.enabled).toBe(false);
    expect(config.gemini.model).toBe('gemini-2.0-flash');
    expect(config.gemini.temperature).toBe(0.3);
    expect(config.format.template).toBe('{type}({scope}) - {description}');
    expect(config.format.types).toEqual(['dev', 'feat', 'bug']);
    expect(config.format.descriptionMaxLength).toBe(72);
    expect(config.behaviour.maxDiffLines).toBe(5000);
    expect(config.behaviour.confirmBeforeCommit).toBe(true);
    expect(config.behaviour.excludePatterns).toContain('package-lock.json');
  });
});

describe('mergeConfigs', () => {
  it('lets the project config win over home and defaults (AC-05)', () => {
    const merged = mergeConfigs(
      { format: { types: ['chore'] } },
      { format: { language: 'fr' }, provider: 'gemini' },
      defaultConfig(),
    );
    expect(merged.format.types).toEqual(['chore']);
    expect(merged.format.language).toBe('fr');
    expect(merged.format.descriptionMaxLength).toBe(72);
  });

  it('replaces arrays instead of concatenating them', () => {
    const merged = mergeConfigs(
      { behaviour: { excludePatterns: ['*.snap'] } },
      {},
      defaultConfig(),
    );
    expect(merged.behaviour.excludePatterns).toEqual(['*.snap']);
  });

  it('rejects invalid values with a ConfigValidationError', () => {
    expect(() => mergeConfigs({ gemini: { temperature: 4 } }, {}, defaultConfig())).toThrow(
      ConfigValidationError,
    );
    expect(() => mergeConfigs({ behaviour: { maxDiffLines: -1 } }, {}, defaultConfig())).toThrow(
      ConfigValidationError,
    );
  });
});

describe('loadConfig', () => {
  it('reads a project config from the current directory', async () => {
    writeConfig(dir, 'provider: gemini\nformat:\n  language: fr\n');
    const config = await loadConfig(dir);
    expect(config.format.language).toBe('fr');
  });

  it('walks up to the project root to find the config', async () => {
    writeConfig(dir, 'format:\n  descriptionMaxLength: 50\n');
    const nested = join(dir, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    const config = await loadConfig(nested);
    expect(config.format.descriptionMaxLength).toBe(50);
  });

  it('stops the upward walk at the repository root', () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    const nested = join(dir, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    expect(findProjectConfig(nested)).toBeUndefined();
  });

  it('still reads the old filename, and says so', async () => {
    writeFileSync(join(dir, LEGACY_CONFIG_FILENAME), 'format:\n  language: es\n', 'utf8');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const config = await loadConfig(dir);

    expect(config.format.language).toBe('es');
    expect(warn.mock.calls.flat().join(' ')).toContain('old configuration name');
    warn.mockRestore();
  });

  it('prefers the current filename when both are present', async () => {
    writeFileSync(join(dir, LEGACY_CONFIG_FILENAME), 'format:\n  language: es\n', 'utf8');
    writeConfig(dir, 'format:\n  language: fr\n');

    expect((await loadConfig(dir)).format.language).toBe('fr');
  });

  it('falls back to built-in defaults when no file exists', async () => {
    const config = await loadConfig(dir);
    expect(config.provider).toBe('ollama');
  });

  it('reports unreadable YAML clearly', async () => {
    writeConfig(dir, 'provider: [unclosed\n');
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects a YAML file that is not a mapping', async () => {
    writeConfig(dir, '- just\n- a\n- list\n');
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('resolveApiKey', () => {
  it('prefers the environment variable over the config file (AC-06)', () => {
    const key = resolveApiKey(
      'gemini',
      { gemini: { apiKey: 'from-file' } },
      {
        COMMILOT_GEMINI_KEY: 'from-env',
      },
    );
    expect(key).toBe('from-env');
  });

  it('falls back to the config block', () => {
    expect(resolveApiKey('gemini', { gemini: { apiKey: 'from-file' } }, {})).toBe('from-file');
  });

  it('throws MissingApiKeyError when neither source has a key', () => {
    expect(() => resolveApiKey('gemini', { gemini: { apiKey: '  ' } }, {})).toThrow(
      MissingApiKeyError,
    );
    expect(hasApiKey('gemini', {}, {})).toBe(false);
  });

  it('derives the env var name from the provider', () => {
    expect(apiKeyEnvVar('openai')).toBe('COMMILOT_OPENAI_KEY');
  });
});

describe('config get/set helpers', () => {
  it('reads and writes dotted paths', () => {
    const raw: Record<string, unknown> = {};
    setByPath(raw, 'behaviour.autoStage', true);
    setByPath(raw, 'gemini.model', 'gemini-2.0-flash');
    expect(getByPath(raw, 'behaviour.autoStage')).toBe(true);
    expect(getByPath(raw, 'gemini.model')).toBe('gemini-2.0-flash');
    expect(getByPath(raw, 'nope.nothing')).toBeUndefined();
  });

  it('coerces CLI strings into the schema type', () => {
    expect(coerceConfigValue('behaviour.autoStage', 'true')).toBe(true);
    expect(coerceConfigValue('behaviour.maxDiffLines', '900')).toBe(900);
    expect(coerceConfigValue('format.types', 'feat, fix ,chore')).toEqual(['feat', 'fix', 'chore']);
    expect(coerceConfigValue('provider', 'gemini')).toBe('gemini');
    expect(() => coerceConfigValue('behaviour.autoStage', 'maybe')).toThrow(ConfigValidationError);
    expect(() => coerceConfigValue('behaviour.maxDiffLines', 'many')).toThrow(
      ConfigValidationError,
    );
  });

  it('round-trips a raw config file', () => {
    const path = getConfigPath('project', dir);
    writeRawConfig(path, { provider: 'gemini', format: { language: 'es' } });
    expect(readRawConfig(path)).toEqual({ provider: 'gemini', format: { language: 'es' } });
    expect(readRawConfig(join(dir, 'missing.yml'))).toEqual({});
  });
});
