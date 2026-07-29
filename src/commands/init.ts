import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { CONFIG_FILENAME, getConfigPath } from '../core/ConfigLoader.js';
import { configSchema } from '../types/config.js';
import { ConfigValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface InitOptions {
  global?: boolean;
  force?: boolean;
  /** Add `.commitHelper.yml` to `.gitignore` (default: true, project scope). */
  gitignore?: boolean;
}

/** The commented starter config written by `commilot init` (spec §4.3). */
export const CONFIG_TEMPLATE = `# Commilot Configuration
# Docs: https://github.com/commilot/commilot#configuration

# AI Provider — which LLM to use for commit generation
# Available: gemini (default)
# Coming soon: openai, claude
provider: gemini

# Provider-specific settings
# Each provider has its own config block with API key and model
gemini:
  apiKey: ""                    # Required: your Google Gemini API key
  model: gemini-2.0-flash       # Model to use for analysis
  temperature: 0.3              # Lower = more deterministic

# Uncomment when available (v1.1):
# openai:
#   apiKey: ""                  # Your OpenAI API key
#   model: gpt-4o-mini          # Model to use
#   temperature: 0.3

# Uncomment when available (v1.2):
# claude:
#   apiKey: ""                  # Your Anthropic API key
#   model: claude-sonnet-5      # Model to use
#   temperature: 0.3

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
  language: en                   # Language for commit messages

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
`;

/** Sanity check: the shipped template must satisfy the runtime schema. */
export function validateTemplate(template: string = CONFIG_TEMPLATE): void {
  const parsed = yaml.load(template);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; '),
    );
  }
}

/** `commilot init` — create a starter `.commitHelper.yml`. */
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
