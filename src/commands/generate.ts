import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { formatCommitMessage } from '../core/ResponseParser.js';
import { assertInteractive, preparePipeline, type CommonOptions } from '../core/pipeline.js';
import { ReviewUI } from '../ui/ReviewUI.js';
import { withSpinner } from '../ui/Spinner.js';
import { summariseDiff } from '../ui/DiffDisplay.js';
import type { CommitGroup } from '../types/commit.js';
import { UserCancelError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface GenerateOptions extends CommonOptions {
  type?: string;
  scope?: string;
  /** Write the accepted message to this file instead of committing (git hook). */
  hookOutput?: string;
}

/** `commilot generate` — one commit message for the current changes. */
export async function generateCommand(
  opts: GenerateOptions,
  cwd: string = process.cwd(),
): Promise<void> {
  const ctx = await preparePipeline(opts, 'staged', cwd);
  const { git, config, provider, providerName, diff } = ctx;
  const review = new ReviewUI(config.format);

  const askAi = (): Promise<CommitGroup> =>
    provider.generateCommitMessage(diff, config.format, {
      forceType: opts.type,
      forceScope: opts.scope,
    });

  logger.blank();
  const label = ctx.source === 'staged' ? 'staged changes' : 'all changes';
  const group = await withSpinner(
    `Analysing ${label}... ${chalk.dim(`(provider: ${providerName})`)}`,
    askAi,
    `Analysed ${summariseDiff(diff)} ${chalk.dim(`(provider: ${providerName})`)}`,
  );

  logger.blank();

  if (opts.dryRun) {
    review.printProposal(group, diff);
    logger.info(chalk.dim('  Dry run — no commit was created.'));
    return;
  }

  assertInteractive(opts);
  const confirmed = opts.yes
    ? group
    : await review.reviewSingle(group, diff, { regenerate: askAi });
  const message = formatCommitMessage(confirmed, config.format);

  if (opts.hookOutput) {
    // git is doing the committing; we only supply the message.
    writeFileSync(opts.hookOutput, `${message}\n`, 'utf8');
    logger.success(`Commit message prepared: ${message}`);
    return;
  }

  if (config.behaviour.confirmBeforeCommit && !opts.yes) {
    const ok = await review.confirm(`Create commit "${message}"?`);
    if (!ok) throw new UserCancelError();
  }

  if (ctx.needsStaging) await git.stageFiles(confirmed.files);

  const { sha } = await git.commit(message);
  const short = await git.getShortSha(sha);
  logger.blank();
  logger.success(`Commit created: ${chalk.yellow(short)}  ${message}`);
}
