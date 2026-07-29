import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { GitService } from '../core/GitService.js';
import { GitOperationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const HOOK_NAME = 'prepare-commit-msg';
/** Marker used to recognise a hook we installed (and may safely remove). */
export const HOOK_MARKER = '# >>> commilot managed hook >>>';

export const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Generates a commit message with Commilot when none was supplied.
# Remove with: commilot hook uninstall

MSG_FILE="$1"
COMMIT_SOURCE="$2"

# Skip merges, squashes, -m/-F messages, amends and templates.
case "$COMMIT_SOURCE" in
  message|template|merge|squash|commit) exit 0 ;;
esac

# Only run when we have a terminal to prompt on.
if [ ! -t 1 ]; then
  exit 0
fi

commilot generate --staged --hook-output "$MSG_FILE" < /dev/tty || exit 0
# <<< commilot managed hook <<<
`;

async function hooksDir(cwd: string): Promise<string> {
  const git = new GitService(cwd);
  await git.assertInsideRepo();
  const root = await git.getRepoRoot();
  const dir = join(root, '.git', 'hooks');
  if (!existsSync(dir)) {
    throw new GitOperationError(`hooks directory not found at ${dir}`);
  }
  return dir;
}

/** `commilot hook install` */
export async function hookInstallCommand(
  opts: { force?: boolean } = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const path = join(await hooksDir(cwd), HOOK_NAME);

  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8');
    if (!existing.includes(HOOK_MARKER) && !opts.force) {
      logger.warn(
        `A ${HOOK_NAME} hook already exists and was not created by Commilot. Re-run with --force to replace it.`,
      );
      return;
    }
  }

  writeFileSync(path, HOOK_SCRIPT, 'utf8');
  chmodSync(path, 0o755);
  logger.success(`Installed ${chalk.cyan(HOOK_NAME)} hook at ${chalk.dim(path)}`);
  logger.info(`  ${chalk.dim('Run `git commit` with no -m to have Commilot draft the message.')}`);
}

/** `commilot hook uninstall` */
export async function hookUninstallCommand(cwd: string = process.cwd()): Promise<void> {
  const path = join(await hooksDir(cwd), HOOK_NAME);

  if (!existsSync(path)) {
    logger.info(`No ${HOOK_NAME} hook installed.`);
    return;
  }
  if (!readFileSync(path, 'utf8').includes(HOOK_MARKER)) {
    logger.warn(`${HOOK_NAME} was not installed by Commilot — leaving it in place.`);
    return;
  }

  unlinkSync(path);
  logger.success(`Removed ${chalk.cyan(HOOK_NAME)} hook.`);
}
