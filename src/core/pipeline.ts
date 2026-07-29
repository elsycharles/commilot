import { loadConfig } from './ConfigLoader.js';
import { validateDiff } from './DiffValidator.js';
import { GitService } from './GitService.js';
import type { AIProvider } from '../providers/AIProvider.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import type { Config } from '../types/config.js';
import type { ParsedDiff } from '../types/diff.js';
import { CommilotError, NoDiffError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface CommonOptions {
  staged?: boolean;
  all?: boolean;
  dryRun?: boolean;
  provider?: string;
  verbose?: boolean;
  /** Accept the AI proposal without the interactive review. */
  yes?: boolean;
}

/**
 * Interactive review needs a terminal. Rather than hanging on a prompt that
 * nobody can answer, tell the caller how to run non-interactively.
 */
export function assertInteractive(opts: CommonOptions): void {
  if (opts.yes || process.stdin.isTTY) return;
  throw new CommilotError(
    'Interactive review requires a terminal. Use `--yes` to accept the AI proposal, or `--dry-run` to preview it.',
  );
}

export type DiffSource = 'staged' | 'all';

export interface PipelineContext {
  git: GitService;
  config: Config;
  provider: AIProvider;
  providerName: string;
  diff: ParsedDiff;
  source: DiffSource;
  /** True when files still need staging before committing. */
  needsStaging: boolean;
}

/** Resolve which changes to analyse from the flags and the config default. */
export function resolveSource(opts: CommonOptions, fallback: DiffSource): DiffSource {
  if (opts.all) return 'all';
  if (opts.staged) return 'staged';
  return fallback;
}

/** Read the raw diff for the requested source, including untracked files. */
export async function readDiff(git: GitService, source: DiffSource): Promise<string> {
  if (source === 'staged') return git.getDiff({ staged: true });

  const [staged, working, untracked] = await Promise.all([
    git.getDiff({ staged: true }),
    git.getDiff({ staged: false }),
    git.getUntrackedDiff(),
  ]);
  return [staged, working, untracked].filter((chunk) => chunk.trim()).join('\n');
}

/**
 * Shared front half of `generate` and `split`: config, provider, git checks
 * and a validated diff.
 */
export async function preparePipeline(
  opts: CommonOptions,
  fallbackSource: DiffSource,
  cwd: string = process.cwd(),
): Promise<PipelineContext> {
  const git = new GitService(cwd);
  await git.assertInsideRepo();

  const config = await loadConfig(cwd);
  const providerName = ProviderFactory.resolveProviderName(config, opts.provider);
  const provider = ProviderFactory.createProvider(config, opts.provider);

  const source = resolveSource(opts, fallbackSource);

  if (config.behaviour.autoStage && !opts.dryRun) {
    logger.debug('behaviour.autoStage is on — staging all changes');
    await git.stageAll();
  }

  const raw = await readDiff(git, source);
  const emptyMessage =
    source === 'staged'
      ? 'No staged changes detected. Stage some changes first or use `--all` flag.'
      : 'No changes detected. Make some changes first.';

  if (!raw.trim()) throw new NoDiffError(emptyMessage);

  const { diff, excluded } = validateDiff(raw, config.behaviour, { emptyMessage });
  if (excluded.length > 0) {
    logger.debug(`ignored ${excluded.length} file(s) via behaviour.excludePatterns`);
  }

  return {
    git,
    config,
    provider,
    providerName,
    diff,
    source,
    needsStaging: source === 'all' || config.behaviour.autoStage,
  };
}
