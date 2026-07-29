import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { generateCommand } from './commands/generate.js';
import { CommilotError, UserCancelError } from './utils/errors.js';
import { logger } from './utils/logger.js';

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../package.json
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Apply global flags before a command body runs. */
function applyGlobalFlags(command: Command): void {
  const opts = command.optsWithGlobals<{ verbose?: boolean; quiet?: boolean }>();
  if (opts.quiet) logger.setLevel('error');
  else if (opts.verbose) logger.setVerbose(true);
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name('commilot')
    .description('AI-powered commit message generator & splitter (commit + copilot)')
    .version(readVersion(), '-v, --version', 'Print the installed version')
    .option('--verbose', 'Print debug information, including raw AI responses')
    .option('--quiet', 'Only print errors')
    .showHelpAfterError();

  program
    .command('generate', { isDefault: false })
    .alias('gen')
    .description('Generate a single commit message for the staged changes')
    .option('--staged', 'Analyse staged changes (default)')
    .option('--all', 'Analyse staged, unstaged and untracked changes')
    .option('--dry-run', 'Preview the message without committing')
    .option('--type <type>', 'Force the commit type instead of letting the AI pick')
    .option('--scope <scope>', 'Force the commit scope instead of letting the AI pick')
    .option('--provider <name>', 'Override the configured AI provider')
    .option('-y, --yes', 'Accept the generated message without the interactive review')
    .option('--hook-output <file>', 'Write the message to a file instead of committing')
    .action(async (opts: Parameters<typeof generateCommand>[0], command: Command) => {
      applyGlobalFlags(command);
      await generateCommand(opts);
    });

  return program;
}

/** Map a thrown error onto a message and a process exit code (spec §5.7). */
export function reportError(err: unknown): number {
  if (err instanceof UserCancelError) {
    logger.blank();
    logger.info(chalk.dim('  Cancelled — no changes were made.'));
    return err.exitCode;
  }
  if (err instanceof CommilotError) {
    logger.blank();
    logger.error(err.message);
    if (err.detail) {
      if (logger.verbose) logger.debug(err.detail);
      else logger.info(chalk.dim('  Re-run with --verbose for details.'));
    }
    return err.exitCode;
  }
  logger.blank();
  logger.error((err as Error)?.message ?? String(err));
  if (logger.verbose && err instanceof Error && err.stack) logger.debug(err.stack);
  return 1;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  try {
    await buildCli().parseAsync(argv);
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

// Only auto-run when executed as a binary, not when imported by tests.
if (process.argv[1] && import.meta.url.startsWith('file:')) {
  const invoked = process.argv[1];
  const self = fileURLToPath(import.meta.url);
  if (invoked === self || invoked.endsWith('commilot')) {
    main().then((code) => {
      process.exitCode = code;
    });
  }
}

export { generateCommand } from './commands/generate.js';
export * from './types/commit.js';
export * from './types/config.js';
export * from './types/diff.js';
