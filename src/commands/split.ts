import chalk from 'chalk';
import { formatCommitMessage } from '../core/ResponseParser.js';
import {
  assertInteractive,
  bypassCache,
  preparePipeline,
  type CommonOptions,
} from '../core/pipeline.js';
import type { GitService } from '../core/GitService.js';
import { summariseDiff } from '../ui/DiffDisplay.js';
import { ReviewUI } from '../ui/ReviewUI.js';
import { withSpinner } from '../ui/Spinner.js';
import type { CommitPlan, CommitResult } from '../types/commit.js';
import type { Config } from '../types/config.js';
import { GitOperationError, NoDiffError, UserCancelError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface SplitOptions extends CommonOptions {
  maxCommits?: number;
  /** Ask for at least this many commits instead of accepting one big group. */
  minCommits?: number;
}

/** `commilot split` — group the diff into N logically coherent commits. */
export async function splitCommand(opts: SplitOptions, cwd: string = process.cwd()): Promise<void> {
  const ctx = await preparePipeline(opts, 'all', cwd);
  const { git, config, provider, providerName, diff } = ctx;
  const review = new ReviewUI(config.format);
  const maxCommits = opts.maxCommits ?? config.behaviour.splitMaxCommits;
  // Never ask for more groups than there are files to put in them.
  const minCommits = Math.min(
    opts.minCommits ?? config.behaviour.splitMinCommits,
    maxCommits,
    diff.files.length,
  );

  // Remember the staging state so cancelling leaves the repo untouched.
  const originalStaged = await git.getStagedFiles();
  const headBefore = await git.getHeadSha();

  logger.blank();
  logger.info(`  ${chalk.cyan('•')} Analysing all changes... ${chalk.dim(summariseDiff(diff))}`);

  const plan = await withSpinner(
    `Splitting into logical commits... ${chalk.dim(`(provider: ${providerName})`)}`,
    () =>
      provider.generateCommitPlan(diff, config.format, { maxCommits, minCommits, noCache: bypassCache(opts) }),
    `Split into logical commits ${chalk.dim(`(provider: ${providerName})`)}`,
  );

  logger.blank();
  review.printPlan(plan, diff);

  if (opts.dryRun) {
    logger.info(chalk.dim('  Dry run — no commits were created.'));
    return;
  }

  assertInteractive(opts);

  let confirmed: CommitPlan;
  if (opts.yes) {
    confirmed = plan;
  } else {
    try {
      confirmed = await review.reviewPlan(plan, diff, {
        regenerate: () => provider.generateCommitMessage(diff, config.format, { noCache: true }),
        regenerateMerged: async (files) => {
          const subset = {
            ...diff,
            files: diff.files.filter((file) => files.includes(file.path)),
          };
          return provider.generateCommitMessage(subset, config.format, { noCache: true });
        },
      });
    } catch (err) {
      if (err instanceof UserCancelError) await restoreStaging(git, originalStaged);
      throw err;
    }
  }

  if (confirmed.length === 0) {
    logger.warn('No commits were accepted — nothing to do.');
    await restoreStaging(git, originalStaged);
    return;
  }

  if (config.behaviour.confirmBeforeCommit && !opts.yes) {
    const ok = await review.confirm(
      `Create ${confirmed.length} commit${confirmed.length === 1 ? '' : 's'}?`,
    );
    if (!ok) {
      await restoreStaging(git, originalStaged);
      throw new UserCancelError();
    }
  }

  await executePlan(git, config, confirmed, headBefore);
}

/** Stage and commit each group in order, reporting progress as it goes. */
export async function executePlan(
  git: GitService,
  config: Config,
  plan: CommitPlan,
  headBefore: string | undefined,
): Promise<CommitResult[]> {
  const results: CommitResult[] = [];
  logger.blank();

  // Start from a clean index so each commit contains exactly its own files.
  await git.unstageAll();

  for (const [index, group] of plan.entries()) {
    const message = formatCommitMessage(group, config.format);
    const position = `${index + 1}/${plan.length}`;
    try {
      await git.stageFiles(group.files);
      const { sha } = await git.commit(message);
      const short = await git.getShortSha(sha);
      results.push({ sha: short, message, files: group.files });
      logger.success(`Commit ${position} created: ${chalk.yellow(short)}  ${message}`);
    } catch (err) {
      logger.blank();
      logger.error(`Commit ${position} failed: ${(err as Error).message}`);
      printRecovery(results.length, headBefore);
      throw err instanceof GitOperationError ? err : new GitOperationError((err as Error).message);
    }
  }

  logger.blank();
  logger.success(
    chalk.bold(
      `All ${results.length} commit${results.length === 1 ? '' : 's'} created successfully.`,
    ),
  );
  return results;
}

/** Tell the user exactly how to undo a partially applied split (risk R08). */
function printRecovery(created: number, headBefore: string | undefined): void {
  if (created === 0) {
    logger.info('  No commits were created; your changes are untouched.');
    return;
  }
  logger.warn(`${created} commit(s) were already created.`);
  logger.info(
    `  Undo them with: ${chalk.cyan(`git reset --soft ${headBefore ? headBefore.slice(0, 10) : `HEAD~${created}`}`)}`,
  );
}

async function restoreStaging(git: GitService, originalStaged: string[]): Promise<void> {
  try {
    await git.unstageAll();
    if (originalStaged.length > 0) await git.stageFiles(originalStaged);
    logger.debug('restored original staging state');
  } catch (err) {
    if (err instanceof NoDiffError) return;
    logger.debug(`could not restore staging state: ${(err as Error).message}`);
  }
}
