import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configGetCommand,
  configListCommand,
  configSetCommand,
} from '../../src/commands/config.js';
import { generateCommand } from '../../src/commands/generate.js';
import { hookInstallCommand, hookUninstallCommand } from '../../src/commands/hook.js';
import { initCommand } from '../../src/commands/init.js';
import { providersCommand } from '../../src/commands/providers.js';
import { splitCommand } from '../../src/commands/split.js';
import {
  CommilotError,
  DiffTooLargeError,
  NoDiffError,
  NotGitRepoError,
  UnsupportedProviderError,
} from '../../src/utils/errors.js';
import { GENERATE_JSON, geminiEnvelope } from '../fixtures/responses.js';

let repo: string;
let fetchMock: ReturnType<typeof vi.fn>;
let stdout: string[];

const CONFIG = `provider: gemini
gemini:
  apiKey: "test-key"
  maxRetries: 0
`;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function write(name: string, content: string): void {
  writeFileSync(join(repo, name), content, 'utf8');
}

/** Captured output without ANSI, so assertions hold with or without colour. */
function plainOutput(): string {
  // eslint-disable-next-line no-control-regex
  return stdout.join('\n').replace(/\u001B\[[0-9;]*m/g, '');
}

function log(): string[] {
  return git('log', '--format=%s').split('\n').filter(Boolean);
}

function reply(text: string): void {
  fetchMock.mockImplementationOnce(
    async () =>
      new Response(JSON.stringify(geminiEnvelope(text)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'commilot-cmd-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@commilot.dev');
  git('config', 'user.name', 'Commilot Test');
  git('config', 'commit.gpgsign', 'false');
  write('.gitignore', '.commilot.yml\n');
  write('README.md', '# fixture\n');
  git('add', 'README.md', '.gitignore');
  git('commit', '--quiet', '-m', 'dev(init) - add readme');
  write('.commilot.yml', CONFIG);

  vi.stubEnv('COMMILOT_GEMINI_KEY', '');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  stdout = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(' '));
  });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateCommand', () => {
  beforeEach(() => {
    write('src.ts', 'export const a = 1;\n');
    git('add', 'src.ts');
  });

  it('commits the AI proposal with --yes (AC-01, AC-03)', async () => {
    reply(GENERATE_JSON);
    await generateCommand({ yes: true }, repo);
    expect(log()[0]).toBe('feat(auth) - add jwt token refresh mechanism');
  });

  it('leaves the repository untouched in dry-run mode (AC-09)', async () => {
    reply(GENERATE_JSON);
    const before = log();
    await generateCommand({ dryRun: true }, repo);
    expect(log()).toEqual(before);
    expect(stdout.join('\n')).toContain('Dry run');
  });

  it('writes to the hook file instead of committing', async () => {
    reply(GENERATE_JSON);
    const target = join(repo, 'MSG');
    await generateCommand({ yes: true, hookOutput: target }, repo);
    expect(readFileSync(target, 'utf8').trim()).toBe(
      'feat(auth) - add jwt token refresh mechanism',
    );
    expect(log()).toHaveLength(1);
  });

  it('analyses unstaged and untracked work with --all', async () => {
    reply(GENERATE_JSON);
    git('reset', '--quiet', 'HEAD');
    write('untracked.ts', 'export const b = 2;\n');

    await generateCommand({ all: true, yes: true }, repo);

    const committed = git('show', '--name-only', '--format=', 'HEAD');
    expect(committed).toContain('src.ts');
    expect(committed).toContain('untracked.ts');
  });

  it('refuses to run outside a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'commilot-plain-'));
    try {
      await expect(generateCommand({ yes: true }, plain)).rejects.toBeInstanceOf(NotGitRepoError);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('reports an empty staging area', async () => {
    git('reset', '--quiet', 'HEAD');
    await expect(generateCommand({ yes: true }, repo)).rejects.toBeInstanceOf(NoDiffError);
  });

  it('rejects an oversized diff (AC-10)', async () => {
    write('.commilot.yml', `${CONFIG}behaviour:\n  maxDiffLines: 2\n`);
    write('big.ts', Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`).join('\n'));
    git('add', 'big.ts');
    await expect(generateCommand({ yes: true }, repo)).rejects.toBeInstanceOf(DiffTooLargeError);
  });

  it('rejects an unsupported provider (AC-22)', async () => {
    await expect(
      generateCommand({ yes: true, provider: 'llama-at-home' }, repo),
    ).rejects.toBeInstanceOf(UnsupportedProviderError);
  });

  it('needs a TTY or --yes for the interactive review', async () => {
    reply(GENERATE_JSON);
    await expect(generateCommand({}, repo)).rejects.toBeInstanceOf(CommilotError);
  });

  it('stages everything first when behaviour.autoStage is on', async () => {
    reply(GENERATE_JSON);
    git('reset', '--quiet', 'HEAD');
    write('.commilot.yml', `${CONFIG}behaviour:\n  autoStage: true\n`);

    await generateCommand({ yes: true }, repo);

    expect(git('show', '--name-only', '--format=', 'HEAD')).toContain('src.ts');
  });
});

describe('splitCommand', () => {
  const plan = JSON.stringify([
    { type: 'feat', scope: 'auth', description: 'add login endpoint', files: ['auth.ts'] },
    { type: 'dev', scope: 'config', description: 'update eslint rules', files: ['.eslintrc.json'] },
  ]);

  beforeEach(() => {
    write('auth.ts', 'export const login = () => null;\n');
    write('.eslintrc.json', '{ "extends": ["eslint:recommended"] }\n');
  });

  it('creates one commit per group (AC-02, AC-21)', async () => {
    reply(plan);
    await splitCommand({ all: true, yes: true }, repo);

    expect(log().slice(0, 2)).toEqual([
      'dev(config) - update eslint rules',
      'feat(auth) - add login endpoint',
    ]);
    expect(git('show', '--name-only', '--format=', 'HEAD~1')).toContain('auth.ts');
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  it('previews the plan without committing (AC-09)', async () => {
    reply(plan);
    const before = log();
    await splitCommand({ all: true, dryRun: true }, repo);
    expect(log()).toEqual(before);
    expect(stdout.join('\n')).toContain('Commit Plan (2 commits)');
  });

  it('falls back to a single commit when the AI groups nothing (AC-21)', async () => {
    reply(JSON.stringify([]));

    await splitCommand({ all: true, yes: true }, repo);

    expect(log()).toHaveLength(2);
    expect(log()[0]).toContain('misc');
    const committed = git('show', '--name-only', '--format=', 'HEAD');
    expect(committed).toContain('auth.ts');
    expect(committed).toContain('.eslintrc.json');
  });

  it('splits only the staged changes with --staged', async () => {
    reply(JSON.stringify([{ ...JSON.parse(plan)[0] }]));
    git('add', 'auth.ts');

    await splitCommand({ staged: true, yes: true }, repo);

    expect(log()[0]).toBe('feat(auth) - add login endpoint');
    expect(git('status', '--porcelain')).toContain('.eslintrc.json');
  });
});

describe('initCommand (AC-13)', () => {
  it('creates a config and gitignores it', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'commilot-init-'));
    try {
      await initCommand({}, fresh);
      const config = readFileSync(join(fresh, '.commilot.yml'), 'utf8');
      expect(config).toContain('provider: gemini');
      expect(config).toContain('# openai:');
      expect(readFileSync(join(fresh, '.gitignore'), 'utf8')).toContain('.commilot.yml');
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing config unless forced', async () => {
    await initCommand({}, repo);
    expect(readFileSync(join(repo, '.commilot.yml'), 'utf8')).toBe(CONFIG);

    await initCommand({ force: true }, repo);
    expect(readFileSync(join(repo, '.commilot.yml'), 'utf8')).toContain('# Commilot Configuration');
  });

  it('creates the current filename even when the old one is present', async () => {
    // Resolving to the legacy path here would make the rename impossible to
    // escape: init would report "already exists" forever.
    const fresh = mkdtempSync(join(tmpdir(), 'commilot-init-'));
    try {
      writeFileSync(join(fresh, '.commitHelper.yml'), 'format:\n  language: es\n', 'utf8');

      await initCommand({ gitignore: false }, fresh);

      expect(existsSync(join(fresh, '.commilot.yml'))).toBe(true);
      // The old file is left alone rather than overwritten.
      expect(readFileSync(join(fresh, '.commitHelper.yml'), 'utf8')).toContain('language: es');
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('skips the .gitignore entry when asked to', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'commilot-init-'));
    try {
      await initCommand({ gitignore: false }, fresh);
      expect(existsSync(join(fresh, '.gitignore'))).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe('config commands', () => {
  it('gets, sets and lists values', async () => {
    await configSetCommand('format.language', 'fr', {}, repo);
    await configGetCommand('format.language', repo);
    expect(stdout.join('\n')).toContain('fr');

    stdout = [];
    await configListCommand(repo);
    const dump = stdout.join('\n');
    expect(dump).toContain('provider: gemini');
    expect(dump).not.toContain('test-key');
  });

  it('writes to the file already in use rather than creating a second one', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'commilot-set-'));
    try {
      writeFileSync(join(fresh, '.commitHelper.yml'), 'format:\n  language: es\n', 'utf8');

      await configSetCommand('format.language', 'it', {}, fresh);

      expect(readFileSync(join(fresh, '.commitHelper.yml'), 'utf8')).toContain('language: it');
      expect(existsSync(join(fresh, '.commilot.yml'))).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('rejects an unknown key', async () => {
    await expect(configGetCommand('not.a.key', repo)).rejects.toThrow();
    await expect(configSetCommand('not.a.key', 'x', {}, repo)).rejects.toThrow();
  });

  it('refuses a value the schema rejects', async () => {
    await expect(configSetCommand('gemini.temperature', '9', {}, repo)).rejects.toThrow();
  });
});

describe('providersCommand (AC-14)', () => {
  it('lists every shipped provider with its state', async () => {
    await providersCommand(repo);
    const output = plainOutput();

    expect(output).toContain('gemini (default)');
    expect(output).toContain('API key configured');
    for (const provider of ['openai', 'claude', 'ollama']) {
      expect(output, `${provider} listed`).toContain(provider);
    }
    expect(output).toContain('Current provider: gemini');
  });

  it('says which providers still need a key, and that ollama needs none', async () => {
    await providersCommand(repo);
    const output = plainOutput();

    expect(output).toContain('Ready — no API key needed');
    expect(output).toContain('COMMILOT_OPENAI_KEY');
    expect(output).not.toContain('Coming in');
  });
});

describe('hook commands (AC-15)', () => {
  it('installs and uninstalls cleanly', async () => {
    const path = join(repo, '.git', 'hooks', 'prepare-commit-msg');

    await hookInstallCommand({}, repo);
    expect(readFileSync(path, 'utf8')).toContain('commilot generate');

    await hookUninstallCommand(repo);
    expect(existsSync(path)).toBe(false);
  });

  it('is a no-op when no hook is installed', async () => {
    await hookUninstallCommand(repo);
    expect(stdout.join('\n')).toContain('No prepare-commit-msg hook installed');
  });
});
