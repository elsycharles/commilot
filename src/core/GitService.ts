import { simpleGit, type SimpleGit } from 'simple-git';
import type { FileStatus } from '../types/diff.js';
import { GitOperationError, NotGitRepoError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface DiffOptions {
  /** Read the staged diff (`git diff --staged`) instead of the working tree. */
  staged?: boolean;
}

/** Thin, typed wrapper around the git CLI used across the pipeline. */
export class GitService {
  private readonly git: SimpleGit;

  constructor(private readonly cwd: string = process.cwd()) {
    this.git = simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 });
  }

  private async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      logger.debug(`git ${label} failed: ${(err as Error).message}`);
      throw new GitOperationError(`${label} — ${(err as Error).message.trim()}`);
    }
  }

  async isInsideRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  /** Throws {@link NotGitRepoError} unless the cwd is inside a git repository. */
  async assertInsideRepo(): Promise<void> {
    if (!(await this.isInsideRepo())) throw new NotGitRepoError();
  }

  async getRepoRoot(): Promise<string> {
    const root = await this.run('rev-parse --show-toplevel', () =>
      this.git.revparse(['--show-toplevel']),
    );
    return root.trim();
  }

  /** Raw unified diff for the staged area or the working tree. */
  async getDiff(opts: DiffOptions = {}): Promise<string> {
    const args = ['--no-color', '--no-ext-diff'];
    if (opts.staged) args.push('--staged');
    return this.run(`diff${opts.staged ? ' --staged' : ''}`, () => this.git.diff(args));
  }

  /** Diff of files that are untracked, rendered as an "added file" diff. */
  async getUntrackedDiff(): Promise<string> {
    const files = await this.getUntrackedFiles();
    if (files.length === 0) return '';
    const chunks: string[] = [];
    for (const file of files) {
      try {
        // `--no-index` against /dev/null yields a normal unified diff for new
        // files. git exits 1 because differences were found, which simple-git
        // surfaces as either a resolved value or an error carrying stdout.
        const output = await this.git.raw(['diff', '--no-color', '--no-index', '/dev/null', file]);
        if (output) chunks.push(output);
      } catch (err) {
        const output = (err as { stdout?: string }).stdout;
        if (output) chunks.push(output);
        else logger.debug(`could not diff untracked file ${file}: ${(err as Error).message}`);
      }
    }
    return chunks.join('');
  }

  async getUntrackedFiles(): Promise<string[]> {
    const status = await this.run('status', () => this.git.status());
    return status.not_added.slice();
  }

  async getStatus(): Promise<FileStatus[]> {
    const status = await this.run('status --porcelain', () => this.git.status());
    return status.files.map((file) => ({
      path: file.path,
      index: file.index,
      workingTree: file.working_dir,
      staged: file.index !== ' ' && file.index !== '?',
    }));
  }

  async hasStagedChanges(): Promise<boolean> {
    return (await this.getStatus()).some((file) => file.staged);
  }

  async stageFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.run(`add ${paths.length} file(s)`, () => this.git.add(paths));
  }

  async stageAll(): Promise<void> {
    await this.run('add --all', () => this.git.raw(['add', '--all']));
  }

  async commit(message: string): Promise<{ sha: string }> {
    const result = await this.run('commit', () => this.git.commit(message));
    if (!result.commit) {
      throw new GitOperationError('commit produced no SHA (nothing was staged?)');
    }
    return { sha: result.commit };
  }

  /** Unstage everything, used to roll back after a failed split. */
  async unstageAll(): Promise<void> {
    if (await this.getHeadSha()) {
      await this.run('reset HEAD', () => this.git.raw(['reset', '--quiet', 'HEAD']));
      return;
    }
    // Unborn branch: there is no HEAD to reset against, so empty the index.
    await this.run('rm --cached', async () => {
      try {
        await this.git.raw(['rm', '-r', '--cached', '--quiet', '.']);
      } catch {
        // Nothing was staged — the index is already empty.
      }
    });
  }

  async unstageFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.run('reset HEAD <paths>', () => this.git.raw(['reset', 'HEAD', '--', ...paths]));
  }

  /** Files currently in the index, used to restore staging state on cancel. */
  async getStagedFiles(): Promise<string[]> {
    const out = await this.run('diff --staged --name-only', () =>
      this.git.diff(['--staged', '--name-only']),
    );
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async getHeadSha(): Promise<string | undefined> {
    try {
      return (await this.git.revparse(['HEAD'])).trim();
    } catch {
      // No commits yet.
      return undefined;
    }
  }

  async getShortSha(sha: string): Promise<string> {
    try {
      return (await this.git.revparse(['--short', sha])).trim();
    } catch {
      return sha.slice(0, 7);
    }
  }

  get workingDir(): string {
    return this.cwd;
  }
}
