import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import chalk from 'chalk';
import { load } from 'js-yaml';
import { CONFIG_FILENAME, getConfigPath } from '../core/ConfigLoader.js';
import { configSchema } from '../types/config.js';
import { ConfigValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface InitOptions {
  global?: boolean;
  force?: boolean;
  /** Add `.commilot.yml` to `.gitignore` (default: true, project scope). */
  gitignore?: boolean;
}

/** The commented starter config written by `commilot init` (spec §4.3). */
export const CONFIG_TEMPLATE = `# Commilot Configuration
# Docs: https://github.com/elsycharles/commilot#readme

# Which model writes your commit messages.
# Commilot runs on Ollama: local, no API key, no quota, no code leaves your machine.
provider: ollama

ollama:
  model: llama3.1               # any model you have pulled: ollama list
  temperature: 0.3              # lower = more predictable
  # baseUrl: "http://127.0.0.1:11434"
  # timeoutMs: 120000           # local inference is slower than an API

# Commit Format
format:
  template: "{type}({scope}) - {description}"
  types:
    - dev                        # Development/refactoring tasks
    - feat                       # New features
    - bug                        # Bug fixes
  scopes: []                     # Project-specific scopes; empty = the AI infers them freely.
  # Uncomment and adapt to constrain the AI to your own feature areas:
  # scopes:
  #   - login
  #   - logout
  #   - dashboard
  #   - auth
  #   - api
  descriptionMaxLength: 72       # Max chars for description line
  language: en                   # ISO 639-1 (en, fr, es…). Applies to the
                                 # description and to your free-text fields;
                                 # not to type, scope, or fixed values.

  # The template accepts any placeholder. {type}, {scope} and {description} are
  # filled by Commilot; anything else becomes a field the model must produce.
  # Describe it here so it knows what to write:
  #
  # template: "{summary} ({title}) : {type} | {area}"
  # fields:
  #   title:   { description: "a short Title Case name" }
  #   summary: { description: "a one-line summary", maxLength: 40 }
  #   area:    { description: "the part touched", values: [frontend, backend] }

# Behaviour
behaviour:
  autoStage: false              # If true, auto git-add before commit
  maxDiffLines: 5000            # Skip AI if diff exceeds this (too large)
  excludePatterns:              # Glob patterns to exclude from diff
    - "package-lock.json"
    - "yarn.lock"
    - "*.min.js"
    - "*.min.css"
  splitMaxCommits: 10           # Max commits when using split command
  confirmBeforeCommit: true     # Always ask before executing git commit
  cacheMinutes: 60              # Reuse an identical answer instead of paying a
                                # request. 0 disables. --no-cache skips it once.
`;

/** Sanity check: the shipped template must satisfy the runtime schema. */
export function validateTemplate(template: string = CONFIG_TEMPLATE): void {
  const parsed = load(template);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; '),
    );
  }
}

/** `commilot init` — create a starter `.commilot.yml`. */
export async function initCommand(opts: InitOptions, cwd: string = process.cwd()): Promise<void> {
  const scope = opts.global ? 'global' : 'project';
  const path = getConfigPath(scope, cwd);

  if (existsSync(path) && !opts.force) {
    logger.warn(`${path} already exists. Re-run with --force to overwrite it.`);
    return;
  }

  validateTemplate();
  writeFileSync(path, CONFIG_TEMPLATE, 'utf8');
  logger.success(`Created ${chalk.cyan(displayPath(path, cwd))}`);

  if (scope === 'project' && opts.gitignore !== false) {
    ensureGitignored(cwd);
  }

  logger.blank();
  logger.info(`  Next: add your API key.`);
  logger.info(
    `    ${chalk.dim('•')} export ${chalk.cyan('COMMILOT_GEMINI_KEY=<your key>')} ${chalk.dim('(recommended)')}`,
  );
  logger.info(`    ${chalk.dim('•')} or set ${chalk.cyan('gemini.apiKey')} in the file above`);
  logger.info(`  Then run ${chalk.cyan('commilot generate')} on some staged changes.`);
}

/**
 * Keep the config out of git so an API key stored in it can never be pushed
 * to a public repository (risk R09).
 */
function ensureGitignored(cwd: string): void {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = CONFIG_FILENAME;
  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf8');
    const alreadyListed = content
      .split('\n')
      .map((line) => line.trim())
      .includes(entry);
    if (alreadyListed) return;
  }

  const prefix = content && !content.endsWith('\n') ? '\n' : '';
  writeFileSync(
    gitignorePath,
    `${content}${prefix}\n# Commilot config — may contain an API key\n${entry}\n`,
    'utf8',
  );
  logger.info(`  ${chalk.dim(`Added ${entry} to .gitignore`)}`);
}

function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith('..') ? rel : path;
}

/** Directory a config path lives in — exported for tests. */
export function configDirectory(path: string): string {
  return dirname(path);
}
