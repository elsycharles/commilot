import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRawDiff } from '../../src/core/DiffValidator.js';
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

  it('produces a diff the parser understands, on every platform', async () => {
    write('one.txt', 'alpha\nbeta\n');
    mkdirSync(join(repo, 'nested'), { recursive: true });
    writeFileSync(join(repo, 'nested', 'two.txt'), 'gamma\n', 'utf8');

    const parsed = parseRawDiff(await git.getUntrackedDiff());

    expect(parsed.files.map((file) => file.path).sort()).toEqual(['nested/two.txt', 'one.txt']);
    expect(parsed.files.every((file) => file.status === 'added')).toBe(true);
    expect(parsed.totalAdditions).toBe(3);
    expect(parsed.files.every((file) => file.binary)).toBe(false);
  });

  it('handles a file with no trailing newline', async () => {
    write('no-newline.txt', 'last line without newline');
    const parsed = parseRawDiff(await git.getUntrackedDiff());
    expect(parsed.files[0]?.additions).toBe(1);
  });

  it('normalises CRLF line endings', async () => {
    write('crlf.txt', 'first\r\nsecond\r\n');
    const diff = await git.getUntrackedDiff();
    expect(diff).toContain('+first\n');
    expect(diff).not.toContain('\r');
    expect(parseRawDiff(diff).files[0]?.additions).toBe(2);
  });

  it('reports an untracked binary file as binary', async () => {
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const diff = await git.getUntrackedDiff();
    expect(diff).toContain('Binary files /dev/null and b/logo.png differ');
    expect(parseRawDiff(diff).files[0]?.binary).toBe(true);
  });

  it('emits a header with no hunk for an empty file', async () => {
    write('empty.txt', '');
    const diff = await git.getUntrackedDiff();
    expect(diff).toContain('diff --git a/empty.txt b/empty.txt');
    expect(diff).not.toContain('@@');
  });

  it('returns nothing when there are no untracked files', async () => {
    expect(await git.getUntrackedDiff()).toBe('');
  });

  it('marks the mode of an executable file', async () => {
    write('script.sh', '#!/bin/sh\necho hi\n');
    chmodSync(join(repo, 'script.sh'), 0o755);

    // Windows has no execute bit, so chmod is a no-op there and git itself
    // reports 100644 for every file.
    const expected = process.platform === 'win32' ? '100644' : '100755';
    expect(await git.getUntrackedDiff()).toContain(`new file mode ${expected}`);
  });

  it('marks a regular file as non-executable', async () => {
    write('plain.txt', 'text\n');
    chmodSync(join(repo, 'plain.txt'), 0o644);
    expect(await git.getUntrackedDiff()).toContain('new file mode 100644');
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
