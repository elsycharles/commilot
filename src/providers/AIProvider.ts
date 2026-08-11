import type { CommitGroup, CommitPlan } from '../types/commit.js';
import type { FormatConfig, ProviderBlock } from '../types/config.js';
import type { ParsedDiff } from '../types/diff.js';

export interface GenerateOptions {
  /** Maximum number of groups in split mode. */
  maxCommits?: number;
  /** Forces the AI to use this type instead of picking one. */
  forceType?: string;
  /** Forces the AI to use this scope instead of picking one. */
  forceScope?: string;
  /** Skip the response cache — what `regenerate` needs to get a new answer. */
  noCache?: boolean;
  /** Fewest groups a split may return. */
  minCommits?: number;
}

/**
 * Contract every AI backend implements. Adding a provider means writing one
 * class against this interface — nothing in the pipeline changes.
 */
export interface AIProvider {
  /** Single commit message for the whole diff. */
  generateCommitMessage(
    diff: ParsedDiff,
    config: FormatConfig,
    opts?: GenerateOptions,
  ): Promise<CommitGroup>;

  /** Diff split into N logically grouped commits. */
  generateCommitPlan(
    diff: ParsedDiff,
    config: FormatConfig,
    opts?: GenerateOptions,
  ): Promise<CommitPlan>;

  /** Zod-validate a raw AI response. Throws `MalformedResponseError`. */
  validateResponse(raw: unknown): CommitGroup | CommitPlan;

  /** Human-readable name, e.g. "Google Gemini". */
  getProviderName(): string;

  /** True when the provider has everything it needs to make a request. */
  isConfigured(): boolean;
}

/** Everything a concrete provider needs at construction time. */
export interface ProviderContext {
  /** Provider config block (model, temperature, timeouts, base URL). */
  settings: ProviderBlock;
  /** Resolved API key; empty string when none is configured. */
  apiKey: string;
  /** How long an identical answer may be reused. 0 disables the cache. */
  cacheMinutes?: number;
}
