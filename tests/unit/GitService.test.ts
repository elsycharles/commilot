import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitService } from '../../src/core/GitService.js';
import { GitOperationError, NotGitRepoError } from '../../src/utils/errors.js';

let repo: string;
let git: GitService;

async function initRepo(dir: string): Promise<void> {
  const raw = simpleGit({ baseDir: dir });
  await raw.init();
  await raw.addConfig('user.email', 'test@commilot.dev');
  await raw.addConfig('user.name', 'Commilot Test');
  await raw.addConfig('commit.gpgsign', 'false');
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'commilot-git-'));
  await initRepo(repo);
  git = new GitService(repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  writeFileSync(join(repo, name), content, 'utf8');
}

describe('repository detection', () => {
  it('detects a git repository', async () => {
    expect(await git.isInsideRepo()).toBe(true);
    await expect(git.assertInsideRepo()).resolves.toBeUndefined();
  });

  it('rejects a plain directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'commilot-plain-'));
    try {
      const service = new GitService(plain);
      expect(await service.isInsideRepo()).toBe(false);
      await expect(service.assertInsideRepo()).rejects.toBeInstanceOf(NotGitRepoError);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('returns the repository root', async () => {
    expect(await git.getRepoRoot()).toContain('commilot-git-');
  });
});

describe('diff and status', () => {
  it('returns an empty diff for a clean tree', async () => {
    expect(await git.getDiff({ staged: true })).toBe('');
  });

  it('reads the staged diff only when --staged is used', async () => {
    write('a.txt', 'first\n');
    await git.stageFiles(['a.txt']);
    await git.commit('dev(init) - add a');

    write('a.txt', 'second\n');
    expect(await git.getDiff({ staged: true })).toBe('');
    expect(await git.getDiff({ staged: false })).toContain('second');

    await git.stageFiles(['a.txt']);
    expect(await git.getDiff({ staged: true })).toContain('second');
  });

  it('renders untracked files as an added-file diff', async () => {
    write('new.txt', 'brand new\n');
    const diff = await git.getUntrackedDiff();
    expect(diff).toContain('new.txt');
    expect(diff).toContain('+brand new');
    expect(await git.getUntrackedFiles()).toEqual(['new.txt']);
  });

  it('reports structured status entries', async () => {
    write('a.txt', 'one\n');
    write('b.txt', 'two\n');
    await git.stageFiles(['a.txt']);

    const status = await git.getStatus();
    expect(status.find((file) => file.path === 'a.txt')?.staged).toBe(true);
    expect(status.find((file) => file.path === 'b.txt')?.staged).toBe(false);
    expect(await git.hasStagedChanges()).toBe(true);
  });
});

describe('staging and committing', () => {
  it('commits staged files and returns a SHA', async () => {
    write('a.txt', 'hello\n');
    await git.stageFiles(['a.txt']);

    const { sha } = await git.commit('feat(core) - add greeting');
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(await git.getHeadSha()).toBeDefined();
    expect((await git.getShortSha(sha)).length).toBeGreaterThanOrEqual(7);
  });

  it('commits only the staged subset of the working tree', async () => {
    write('a.txt', 'a\n');
    write('b.txt', 'b\n');
    await git.stageFiles(['a.txt']);
    await git.commit('dev(core) - add a');

    const log = await simpleGit({ baseDir: repo }).raw([
      'show',
      '--name-only',
      '--format=',
      'HEAD',
    ]);
    expect(log).toContain('a.txt');
    expect(log).not.toContain('b.txt');
  });

  it('lists and clears the staged files', async () => {
    write('a.txt', 'a\n');
    write('b.txt', 'b\n');
    await git.stageFiles(['a.txt', 'b.txt']);
    expect((await git.getStagedFiles()).sort()).toEqual(['a.txt', 'b.txt']);

    await git.unstageAll();
    expect(await git.getStagedFiles()).toEqual([]);
  });

  it('stages everything with stageAll', async () => {
    write('a.txt', 'a\n');
    write('b.txt', 'b\n');
    await git.stageAll();
    expect((await git.getStagedFiles()).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('wraps git failures in GitOperationError', async () => {
    await expect(git.stageFiles(['does-not-exist.txt'])).rejects.toBeInstanceOf(GitOperationError);
    await expect(git.commit('nothing staged')).rejects.toBeInstanceOf(GitOperationError);
  });

  it('reports no HEAD before the first commit', async () => {
    expect(await git.getHeadSha()).toBeUndefined();
  });
});
