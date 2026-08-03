import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeProviderServer,
  createTestRepo,
  ensureBuilt,
  runCli,
  type TestRepo,
} from './helpers.js';
import { GENERATE_JSON } from '../fixtures/responses.js';

let server: FakeProviderServer;
let baseUrl: string;
let repo: TestRepo;

beforeAll(async () => {
  ensureBuilt();
  server = new FakeProviderServer();
  baseUrl = await server.start();
}, 120_000);

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  repo = createTestRepo(baseUrl);
});

afterEach(() => {
  repo.cleanup();
});

/** Commit subjects, newest first. */
function log(target: TestRepo = repo): string[] {
  return target.git('log', '--format=%s').split('\n').filter(Boolean);
}

describe('cli basics', () => {
  it('prints its version (AC-18)', async () => {
    const result = await repo.run(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help listing every command', async () => {
    const { stdout } = await repo.run(['--help']);
    for (const command of ['generate', 'split', 'init', 'config', 'hook', 'providers']) {
      expect(stdout).toContain(command);
    }
  });

  it('fails outside a git repository with exit code 1', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'commilot-plain-'));
    try {
      const result = await runCli(['generate'], plain);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Not a git repository');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('option parsing', () => {
  // These reach commander itself rather than our command bodies, so they are
  // what a major upgrade of it would break first.
  it('honours a negated flag', async () => {
    const fresh = createTestRepo(baseUrl);
    rmSync(join(fresh.dir, '.commilot.yml'));
    rmSync(join(fresh.dir, '.gitignore'));
    try {
      await fresh.run(['init', '--no-gitignore']);
      expect(existsSync(join(fresh.dir, '.gitignore'))).toBe(false);

      rmSync(join(fresh.dir, '.commilot.yml'));
      await fresh.run(['init']);
      expect(existsSync(join(fresh.dir, '.gitignore'))).toBe(true);
    } finally {
      fresh.cleanup();
    }
  });

  it('applies a global flag declared before the subcommand', async () => {
    const verbose = await repo.run(['--verbose', 'config', 'get', 'provider']);
    expect(verbose.stderr).toContain('debug');

    const quiet = await repo.run(['--quiet', 'config', 'get', 'provider']);
    expect(quiet.stdout.trim()).toBe('');
  });

  it('rejects a value its custom parser refuses', async () => {
    const result = await repo.run(['split', '--max-commits', 'abc']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('positive integer');
  });

  it('fails on an unknown command and on an unknown flag', async () => {
    expect((await repo.run(['nawak'])).exitCode).toBe(1);
    expect((await repo.run(['generate', '--nawak'])).exitCode).toBe(1);
  });

  it('accepts the short version alias and the command alias', async () => {
    expect((await repo.run(['-v'])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await repo.run(['gen', '--help'])).stdout).toContain('generate|gen');
  });
});

describe('init (AC-13)', () => {
  it('creates a valid config and gitignores it', async () => {
    const fresh = createTestRepo(baseUrl);
    rmSync(join(fresh.dir, '.commilot.yml'));
    try {
      const result = await fresh.run(['init']);
      expect(result.exitCode).toBe(0);

      const config = readFileSync(join(fresh.dir, '.commilot.yml'), 'utf8');
      expect(config).toContain('provider: ollama');
      expect(config).not.toMatch(/gemini|openai|claude/i);
      expect(config).toContain('{type}({scope}) - {description}');

      expect(readFileSync(join(fresh.dir, '.gitignore'), 'utf8')).toContain('.commilot.yml');
    } finally {
      fresh.cleanup();
    }
  });

  it('refuses to overwrite without --force', async () => {
    const result = await repo.run(['init']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('already exists');
    // The original config (with our baseUrl) survived.
    expect(readFileSync(join(repo.dir, '.commilot.yml'), 'utf8')).toContain('baseUrl');
  });
});

describe('providers (AC-14)', () => {
  it('shows Ollama and nothing else', async () => {
    const { stdout, exitCode } = await repo.run(['providers']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('ollama');
    expect(stdout).toContain('Ready — no API key needed');
    expect(stdout).toContain('ollama list');
  });

  it('keeps --provider out of the help', async () => {
    const { stdout } = await repo.run(['generate', '--help']);
    expect(stdout).not.toContain('--provider');
    expect(stdout).toContain('--model');
  });
});

describe('config get/set', () => {
  it('reads a merged value', async () => {
    const { stdout } = await repo.run(['config', 'get', 'format.descriptionMaxLength']);
    expect(stdout).toContain('72');
  });

  it('writes a value back to the project config', async () => {
    const set = await repo.run(['config', 'set', 'behaviour.splitMaxCommits', '4']);
    expect(set.exitCode).toBe(0);

    const get = await repo.run(['config', 'get', 'behaviour.splitMaxCommits']);
    expect(get.stdout).toContain('4');
  });

  it('masks API keys instead of printing them', async () => {
    const { stdout } = await repo.run(['config', 'get', 'gemini.apiKey']);
    expect(stdout).not.toContain('test-key');
    expect(stdout).toContain('•');
  });

  it('rejects unknown keys', async () => {
    const result = await repo.run(['config', 'get', 'nope.nothing']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not a known configuration key');
  });
});

describe('generate', () => {
  beforeEach(() => {
    repo.write('src.ts', 'export const a = 1;\n');
    repo.git('add', 'src.ts');
  });

  it('previews without committing in --dry-run (AC-09)', async () => {
    server.reply(GENERATE_JSON);
    const before = log();

    const result = await repo.run(['generate', '--dry-run']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('feat(auth) - add jwt token refresh mechanism');
    expect(result.stdout).toContain('Dry run');
    expect(log()).toEqual(before);
  });

  it('creates a commit in the configured format (AC-01, AC-03, AC-17)', async () => {
    server.reply(GENERATE_JSON);

    const result = await repo.run(['generate', '--yes']);

    expect(result.exitCode).toBe(0);
    expect(log()[0]).toBe('feat(auth) - add jwt token refresh mechanism');
    expect(repo.git('show', '--name-only', '--format=', 'HEAD')).toContain('src.ts');
  });

  it('sends the staged diff and the format rules to the provider', async () => {
    server.reply(GENERATE_JSON);
    await repo.run(['generate', '--yes']);

    const body = server.bodies.at(-1) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(body.systemInstruction.parts[0]?.text).toContain('{type}({scope}) - {description}');
    expect(body.contents[0]?.parts[0]?.text).toContain('src.ts');
  });

  it('honours --type and --scope overrides', async () => {
    server.reply(GENERATE_JSON);
    await repo.run(['generate', '--yes', '--type', 'dev', '--scope', 'build']);
    expect(log()[0]).toBe('dev(build) - add jwt token refresh mechanism');
  });

  it('reports when nothing is staged', async () => {
    repo.git('reset', '--quiet', 'HEAD');
    const result = await repo.run(['generate']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No staged changes detected');
  });

  it('refuses to prompt without a TTY unless --yes is given', async () => {
    server.reply(GENERATE_JSON);
    const result = await repo.run(['generate']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('requires a terminal');
  });

  it('rejects a diff larger than maxDiffLines (AC-10)', async () => {
    const big = createTestRepo(baseUrl, 'behaviour:\n  maxDiffLines: 3\n');
    try {
      big.write('big.ts', Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`).join('\n'));
      big.git('add', 'big.ts');

      const result = await big.run(['generate']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Diff exceeds maximum size (3 lines)');
    } finally {
      big.cleanup();
    }
  });

  it('excludes lockfiles from the analysed diff (AC-11)', async () => {
    server.reply(GENERATE_JSON);
    repo.write('package-lock.json', '{ "lockfileVersion": 3 }\n');
    repo.git('add', 'package-lock.json');

    await repo.run(['generate', '--yes']);

    const body = server.bodies.at(-1) as { contents: Array<{ parts: Array<{ text: string }> }> };
    expect(body.contents[0]?.parts[0]?.text).not.toContain('lockfileVersion');
  });

  it('surfaces an auth failure with an actionable message (AC-19)', async () => {
    server.fail(401);
    const result = await repo.run(['generate', '--yes']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid API key');
  });

  it('retries once and then reports a malformed response (AC-12)', async () => {
    server.reply('I am afraid I cannot do that').reply('still not json');
    const result = await repo.run(['generate', '--yes']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unexpected response format');
    expect(`${result.stdout}${result.stderr}`).toContain('--verbose');
  });

  it('writes the message to a file in hook mode', async () => {
    server.reply(GENERATE_JSON);
    const target = join(repo.dir, 'MSG');

    const result = await repo.run(['generate', '--yes', '--hook-output', target]);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(target, 'utf8').trim()).toBe(
      'feat(auth) - add jwt token refresh mechanism',
    );
    expect(log()).toHaveLength(1);
  });
});

describe('request economy', () => {
  // Free tiers are metered per request, so what matters is how many leave the
  // machine, not how many commands were run.
  it('serves an unchanged diff from cache instead of asking again', async () => {
    repo.write('src.ts', 'export const a = 1;\n');
    repo.git('add', 'src.ts');
    const before = server.requests.length;
    server.reply(GENERATE_JSON);

    const first = await repo.run(['generate', '--dry-run'], { COMMILOT_CACHE_MINUTES: '60' });
    const second = await repo.run(['generate', '--dry-run'], { COMMILOT_CACHE_MINUTES: '60' });

    expect(first.stdout).toContain('feat(auth)');
    expect(second.stdout).toContain('feat(auth)');
    // Two commands, one request: the second answer came from the cache.
    expect(server.requests.length - before).toBe(1);
  });

  it('always asks again with --no-cache', async () => {
    repo.write('src.ts', 'export const b = 2;\n');
    repo.git('add', 'src.ts');
    const before = server.requests.length;
    server.reply(GENERATE_JSON).reply(GENERATE_JSON);

    await repo.run(['generate', '--dry-run'], { COMMILOT_CACHE_MINUTES: '60' });
    await repo.run(['generate', '--dry-run', '--no-cache'], { COMMILOT_CACHE_MINUTES: '60' });

    expect(server.requests.length - before).toBe(2);
  });

  it('spends a single request when the provider reports a quota', async () => {
    repo.write('src.ts', 'export const c = 3;\n');
    repo.git('add', 'src.ts');
    const before = server.requests.length;
    server.fail(429, {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'RequestsPerDay' }],
          },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' },
        ],
      },
    });

    const result = await repo.run(['generate', '--dry-run']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('rate limit');
    expect(result.stderr).toContain('ollama');
    expect(server.requests.length - before).toBe(1);
  });
});

describe('provider selection (AC-06, AC-22)', () => {
  it('errors on an unsupported provider listing what is available', async () => {
    repo.write('src.ts', 'export const a = 1;\n');
    repo.git('add', 'src.ts');

    const result = await repo.run(['generate', '--provider', 'llama-at-home']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('is not supported');
    expect(result.stderr).toContain('Available: gemini, openai, claude, ollama');
  });

  it('runs every shipped provider through the same pipeline', async () => {
    repo.write('src.ts', 'export const a = 1;\n');
    repo.git('add', 'src.ts');

    for (const provider of ['gemini', 'openai', 'claude', 'ollama'] as const) {
      server.reply(GENERATE_JSON);
      const result = await repo.run(['generate', '--dry-run', '--provider', provider]);

      expect(result.exitCode, `${provider} exit code`).toBe(0);
      expect(result.stdout).toContain('feat(auth) - add jwt token refresh mechanism');
      expect(result.stdout).toContain(`provider: ${provider}`);
      expect(server.requests.at(-1)?.provider).toBe(provider);
    }
  });

  it('sends the credentials each provider expects', async () => {
    repo.write('src.ts', 'export const a = 1;\n');
    repo.git('add', 'src.ts');

    server.reply(GENERATE_JSON);
    await repo.run(['generate', '--dry-run', '--provider', 'openai']);
    expect(server.requests.at(-1)?.headers.authorization).toBe('Bearer sk-test');

    server.reply(GENERATE_JSON);
    await repo.run(['generate', '--dry-run', '--provider', 'claude']);
    expect(server.requests.at(-1)?.headers['x-api-key']).toBe('sk-ant-test');
    expect(server.requests.at(-1)?.headers['anthropic-version']).toBe('2023-06-01');

    server.reply(GENERATE_JSON);
    await repo.run(['generate', '--dry-run', '--provider', 'ollama']);
    const ollama = server.requests.at(-1);
    expect(ollama?.headers.authorization).toBeUndefined();
    expect(ollama?.headers['x-api-key']).toBeUndefined();
  });

  it('runs ollama with no API key configured anywhere', async () => {
    const local = createTestRepo(baseUrl);
    try {
      local.write(
        '.commilot.yml',
        `provider: ollama\nollama:\n  model: llama3.1\n  baseUrl: "${baseUrl}"\n  maxRetries: 0\n`,
      );
      local.write('src.ts', 'export const a = 1;\n');
      local.git('add', 'src.ts');
      server.reply(GENERATE_JSON);

      const result = await local.run(['generate', '--yes']);

      expect(result.exitCode).toBe(0);
      expect(log(local)[0]).toBe('feat(auth) - add jwt token refresh mechanism');
    } finally {
      local.cleanup();
    }
  });

  it('reports a missing API key with both configuration options', async () => {
    const keyless = createTestRepo(baseUrl);
    try {
      keyless.write(
        '.commilot.yml',
        `provider: gemini\ngemini:\n  enabled: true\n  apiKey: ""\n  baseUrl: "${baseUrl}/v1beta"\n`,
      );
      keyless.write('src.ts', 'export const a = 1;\n');
      keyless.git('add', 'src.ts');

      const result = await keyless.run(['generate']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No API key configured');
      expect(result.stderr).toContain('COMMILOT_GEMINI_KEY');
    } finally {
      keyless.cleanup();
    }
  });

  it('accepts the API key from the environment (AC-06)', async () => {
    server.reply(GENERATE_JSON);
    const envRepo = createTestRepo(baseUrl);
    try {
      envRepo.write(
        '.commilot.yml',
        `provider: gemini\ngemini:\n  enabled: true\n  apiKey: ""\n  baseUrl: "${baseUrl}/v1beta"\n  maxRetries: 0\n`,
      );
      envRepo.write('src.ts', 'export const a = 1;\n');
      envRepo.git('add', 'src.ts');

      const result = await envRepo.run(['generate', '--yes'], {
        COMMILOT_GEMINI_KEY: 'env-key',
      });

      expect(result.exitCode).toBe(0);
      expect(log(envRepo)[0]).toBe('feat(auth) - add jwt token refresh mechanism');
    } finally {
      envRepo.cleanup();
    }
  });
});

describe('split (AC-02, AC-20, AC-21)', () => {
  function writeThreeAreas(): void {
    repo.write('auth.ts', 'export const login = () => null;\n');
    repo.write('dashboard.tsx', 'export const Stats = () => null;\n');
    repo.write('.eslintrc.json', '{ "extends": ["eslint:recommended"] }\n');
  }

  const planFor = (): string =>
    JSON.stringify([
      { type: 'feat', scope: 'auth', description: 'add login endpoint', files: ['auth.ts'] },
      {
        type: 'feat',
        scope: 'dashboard',
        description: 'add user stats widget',
        files: ['dashboard.tsx'],
      },
      {
        type: 'dev',
        scope: 'config',
        description: 'update eslint rules',
        files: ['.eslintrc.json'],
      },
    ]);

  it('creates one commit per group with the right files', async () => {
    server.reply(planFor());
    writeThreeAreas();

    const result = await repo.run(['split', '--all', '--yes']);

    expect(result.exitCode).toBe(0);
    expect(log().slice(0, 3)).toEqual([
      'dev(config) - update eslint rules',
      'feat(dashboard) - add user stats widget',
      'feat(auth) - add login endpoint',
    ]);

    expect(repo.git('show', '--name-only', '--format=', 'HEAD~2')).toContain('auth.ts');
    expect(repo.git('show', '--name-only', '--format=', 'HEAD~1')).toContain('dashboard.tsx');
    expect(repo.git('show', '--name-only', '--format=', 'HEAD')).toContain('.eslintrc.json');
    expect(repo.git('status', '--porcelain').trim()).toBe('');
  });

  it('never puts a file in two commits (AC-21)', async () => {
    server.reply(planFor());
    writeThreeAreas();
    await repo.run(['split', '--all', '--yes']);

    const files = repo.git('log', '--name-only', '--format=', '-3').split('\n').filter(Boolean);
    expect(new Set(files).size).toBe(files.length);
    expect(files.sort()).toEqual(['.eslintrc.json', 'auth.ts', 'dashboard.tsx']);
  });

  it('previews the plan without committing in --dry-run (AC-09)', async () => {
    server.reply(planFor());
    writeThreeAreas();
    const before = log();

    const result = await repo.run(['split', '--all', '--dry-run']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Commit Plan (3 commits)');
    expect(log()).toEqual(before);
    expect(repo.git('status', '--porcelain')).toContain('auth.ts');
  });

  it('caps the plan at --max-commits', async () => {
    server.reply(planFor());
    writeThreeAreas();

    const result = await repo.run(['split', '--all', '--yes', '--max-commits', '2']);

    expect(result.exitCode).toBe(0);
    expect(log()).toHaveLength(3); // 2 new + the fixture commit
    const body = server.bodies.at(-1) as {
      systemInstruction: { parts: Array<{ text: string }> };
    };
    expect(body.systemInstruction.parts[0]?.text).toContain('Maximum 2 groups');
  });

  it('assigns files the AI forgot to a fallback commit', async () => {
    server.reply(
      JSON.stringify([
        { type: 'feat', scope: 'auth', description: 'add login endpoint', files: ['auth.ts'] },
      ]),
    );
    writeThreeAreas();

    const result = await repo.run(['split', '--all', '--yes']);

    expect(result.exitCode).toBe(0);
    expect(repo.git('status', '--porcelain').trim()).toBe('');
    expect(log()[0]).toContain('misc');
  });
});

describe('hook install/uninstall (AC-15)', () => {
  it('installs and removes the prepare-commit-msg hook', async () => {
    const hookPath = join(repo.dir, '.git', 'hooks', 'prepare-commit-msg');

    const install = await repo.run(['hook', 'install']);
    expect(install.exitCode).toBe(0);
    expect(existsSync(hookPath)).toBe(true);
    expect(readFileSync(hookPath, 'utf8')).toContain('commilot generate');

    const uninstall = await repo.run(['hook', 'uninstall']);
    expect(uninstall.exitCode).toBe(0);
    expect(existsSync(hookPath)).toBe(false);
  });

  it('leaves a foreign hook alone', async () => {
    const hookPath = join(repo.dir, '.git', 'hooks', 'prepare-commit-msg');
    repo.write('hook.sh', '');
    rmSync(join(repo.dir, 'hook.sh'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(hookPath, '#!/bin/sh\necho mine\n', { mode: 0o755 });

    const install = await repo.run(['hook', 'install']);
    expect(install.stderr).toContain('not created by Commilot');
    expect(readFileSync(hookPath, 'utf8')).toContain('echo mine');

    const uninstall = await repo.run(['hook', 'uninstall']);
    expect(uninstall.stderr).toContain('not installed by Commilot');
    expect(existsSync(hookPath)).toBe(true);
  });
});
