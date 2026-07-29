import chalk from 'chalk';
import inquirer from 'inquirer';
import { formatCommitMessage } from '../core/ResponseParser.js';
import type { CommitGroup, CommitPlan } from '../types/commit.js';
import type { FormatConfig } from '../types/config.js';
import type { ParsedDiff } from '../types/diff.js';
import { UserCancelError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { highlightMessage, renderBox, renderFileList, renderGroupFiles } from './DiffDisplay.js';

export type GenerateAction = 'accept' | 'edit' | 'regenerate' | 'cancel';
export type SplitAction = 'accept' | 'edit' | 'merge' | 'skip' | 'cancel';

export interface ReviewCallbacks {
  /** Re-run the AI for the same diff (generate mode). */
  regenerate: () => Promise<CommitGroup>;
  /** Re-run the AI for a merged pair of groups (split mode). */
  regenerateMerged?: (files: string[]) => Promise<CommitGroup>;
}

function isCancel(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  return name === 'ExitPromptError' || name === 'AbortPromptError';
}

async function prompt<T>(questions: Parameters<typeof inquirer.prompt>[0]): Promise<T> {
  try {
    return (await inquirer.prompt(questions)) as T;
  } catch (err) {
    // Ctrl-C / Ctrl-D inside a prompt is a cancellation, not a crash.
    if (isCancel(err)) throw new UserCancelError();
    throw err;
  }
}

/** Interactive review of proposed commits (spec §5.6). */
export class ReviewUI {
  constructor(private readonly format: FormatConfig) {}

  message(group: CommitGroup): string {
    return formatCommitMessage(group, this.format);
  }

  /** Render the single-commit proposal box. */
  printProposal(group: CommitGroup, diff: ParsedDiff): void {
    const files = renderGroupFiles(group, diff, '  ');
    const lines = [
      '',
      `  ${highlightMessage(this.message(group))}`,
      '',
      `  ${chalk.dim(`Files changed (${group.files.length}):`)}`,
      ...files,
      '',
    ];
    logger.info(renderBox(lines, { title: 'Proposed Commit' }));
    logger.blank();
  }

  /** Render the full commit plan for split mode. */
  printPlan(plan: CommitPlan, diff: ParsedDiff): void {
    const lines: string[] = [''];
    plan.forEach((group, index) => {
      lines.push(`  ${chalk.bold(`${index + 1}.`)} ${highlightMessage(this.message(group))}`);
      lines.push(...renderGroupFiles(group, diff, '     '));
      lines.push('');
    });
    logger.info(
      renderBox(lines, {
        title: `Commit Plan (${plan.length} commit${plan.length === 1 ? '' : 's'})`,
      }),
    );
    logger.blank();
  }

  /** Plain (non-boxed) rendering used by `--dry-run` and non-TTY output. */
  printPlain(plan: CommitPlan, diff: ParsedDiff): void {
    plan.forEach((group, index) => {
      const prefix = plan.length > 1 ? `${index + 1}. ` : '';
      logger.info(`  ${prefix}${highlightMessage(this.message(group))}`);
      logger.info(renderGroupFiles(group, diff, plan.length > 1 ? '     ' : '  ').join('\n'));
      logger.blank();
    });
  }

  printDiffSummary(diff: ParsedDiff): void {
    logger.info(renderFileList(diff.files, '  ').join('\n'));
  }

  /** Generate-mode loop: accept / edit / regenerate / cancel. */
  async reviewSingle(
    initial: CommitGroup,
    diff: ParsedDiff,
    callbacks: ReviewCallbacks,
  ): Promise<CommitGroup> {
    let group = initial;
    for (;;) {
      this.printProposal(group, diff);
      const { action } = await prompt<{ action: GenerateAction }>([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: `${chalk.green('✔')} Accept and commit`, value: 'accept' },
            { name: `${chalk.yellow('✎')} Edit message`, value: 'edit' },
            { name: `${chalk.cyan('↻')} Regenerate`, value: 'regenerate' },
            { name: `${chalk.red('✖')} Cancel`, value: 'cancel' },
          ],
        },
      ]);

      switch (action) {
        case 'accept':
          return group;
        case 'edit':
          group = await this.editGroup(group);
          break;
        case 'regenerate':
          group = { ...(await callbacks.regenerate()), files: group.files };
          break;
        case 'cancel':
          throw new UserCancelError();
      }
    }
  }

  /**
   * Split-mode loop: walks the plan group by group, supporting merge with the
   * next group and skipping. Returns the confirmed plan.
   */
  async reviewPlan(
    plan: CommitPlan,
    diff: ParsedDiff,
    callbacks: ReviewCallbacks,
  ): Promise<CommitPlan> {
    const working = plan.map((group) => ({ ...group, files: [...group.files] }));
    const confirmed: CommitPlan = [];
    let index = 0;

    while (index < working.length) {
      const group = working[index];
      if (!group) break;

      const position = `${index + 1}/${working.length}`;
      const canMerge = index + 1 < working.length;
      const { action } = await prompt<{ action: SplitAction }>([
        {
          type: 'list',
          name: 'action',
          message: `Review commit ${position}: ${this.message(group)}`,
          choices: [
            { name: `${chalk.green('✔')} Accept`, value: 'accept' },
            { name: `${chalk.yellow('✎')} Edit message`, value: 'edit' },
            ...(canMerge
              ? [{ name: `${chalk.cyan('⇅')} Merge with next commit`, value: 'merge' as const }]
              : []),
            { name: `${chalk.dim('⤫')} Skip this commit`, value: 'skip' },
            { name: `${chalk.red('✖')} Cancel all`, value: 'cancel' },
          ],
        },
      ]);

      switch (action) {
        case 'accept':
          confirmed.push(group);
          index += 1;
          break;
        case 'edit':
          working[index] = await this.editGroup(group);
          break;
        case 'merge': {
          const next = working[index + 1];
          if (!next) break;
          const files = [...group.files, ...next.files];
          let merged: CommitGroup;
          if (callbacks.regenerateMerged) {
            merged = { ...(await callbacks.regenerateMerged(files)), files };
          } else {
            merged = {
              ...group,
              description: `${group.description} and ${next.description}`.slice(
                0,
                this.format.descriptionMaxLength,
              ),
              files,
            };
          }
          working.splice(index, 2, merged);
          this.printPlan(working, diff);
          break;
        }
        case 'skip':
          logger.warn(`Skipped: ${this.message(group)} (${group.files.length} file(s) left alone)`);
          index += 1;
          break;
        case 'cancel':
          throw new UserCancelError();
      }
    }

    return confirmed;
  }

  /** Edit type, scope and description, keeping the configured constraints. */
  async editGroup(group: CommitGroup): Promise<CommitGroup> {
    const typeQuestion =
      this.format.types.length > 0
        ? {
            type: 'list' as const,
            name: 'type',
            message: 'Type:',
            choices: this.format.types,
            default: group.type,
          }
        : { type: 'input' as const, name: 'type', message: 'Type:', default: group.type };

    const scopeQuestion =
      this.format.scopes.length > 0
        ? {
            type: 'list' as const,
            name: 'scope',
            message: 'Scope:',
            choices: [...this.format.scopes, new inquirer.Separator(), 'other…'],
            default: this.format.scopes.includes(group.scope) ? group.scope : undefined,
          }
        : { type: 'input' as const, name: 'scope', message: 'Scope:', default: group.scope };

    const answers = await prompt<{ type: string; scope: string; description: string }>([
      typeQuestion,
      scopeQuestion,
      {
        type: 'input',
        name: 'description',
        message: `Description (max ${this.format.descriptionMaxLength}):`,
        default: group.description,
        validate: (value: string) => {
          const trimmed = value.trim();
          if (!trimmed) return 'Description cannot be empty';
          if (trimmed.length > this.format.descriptionMaxLength) {
            return `Description must be at most ${this.format.descriptionMaxLength} characters`;
          }
          return true;
        },
      },
    ]);

    let scope = answers.scope;
    if (scope === 'other…') {
      const custom = await prompt<{ scope: string }>([
        { type: 'input', name: 'scope', message: 'Custom scope:', default: group.scope },
      ]);
      scope = custom.scope;
    }

    return {
      ...group,
      type: answers.type.trim(),
      scope: scope.trim(),
      description: answers.description.trim().replace(/\.+$/, ''),
    };
  }

  /** Final yes/no gate before touching the repository. */
  async confirm(message: string, defaultValue = true): Promise<boolean> {
    const { confirmed } = await prompt<{ confirmed: boolean }>([
      { type: 'confirm', name: 'confirmed', message, default: defaultValue },
    ]);
    return confirmed;
  }
}
