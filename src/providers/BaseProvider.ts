import { cacheKey, readCache, resolveTtlMinutes, writeCache } from '../core/ResponseCache.js';
import { parseCommitGroup, parseCommitPlan, stripFences } from '../core/ResponseParser.js';
import type { CommitGroup, CommitPlan } from '../types/commit.js';
import type { FormatConfig } from '../types/config.js';
import type { ParsedDiff } from '../types/diff.js';
import {
  ApiAuthError,
  ApiRateLimitError,
  ApiRequestError,
  ApiTimeoutError,
  MalformedResponseError,
  ProviderActionableError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { AIProvider, GenerateOptions, ProviderContext } from './AIProvider.js';
import { PromptBuilder, type BuiltPrompt } from './PromptBuilder.js';

/**
 * 429 is deliberately absent: a rate limit means the request was counted and
 * refused, so blind retries burn more of the very quota that is exhausted.
 * They get their own path below.
 */
const RETRY_STATUSES = new Set([408, 500, 502, 503, 504]);

/**
 * Only wait out a rate limit the provider says is this short. Beyond it,
 * failing immediately is both faster for the user and cheaper on the quota.
 */
const MAX_RATE_LIMIT_WAIT_SECONDS = 20;
/** Exponential backoff delays in milliseconds (spec §5.3). */
const BACKOFF_MS = [1000, 3000, 9000];

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared plumbing for HTTP-based providers: prompt construction, retry with
 * exponential backoff, error mapping and response validation. Concrete
 * providers only describe their request shape and how to read their response.
 */
export abstract class BaseHttpProvider implements AIProvider {
  protected constructor(protected readonly ctx: ProviderContext) {}

  abstract getProviderName(): string;

  /** Build the HTTP request for a prompt pair. */
  protected abstract buildRequest(prompt: BuiltPrompt): HttpRequest;

  /** Pull the model's text output out of the provider's response envelope. */
  protected abstract extractText(payload: unknown): string;

  isConfigured(): boolean {
    return this.ctx.apiKey.trim().length > 0;
  }

  async generateCommitMessage(
    diff: ParsedDiff,
    config: FormatConfig,
    opts: GenerateOptions = {},
  ): Promise<CommitGroup> {
    const prompt = new PromptBuilder(config).buildGeneratePrompt(diff);
    logger.debug(`${this.getProviderName()} generate — strategy: ${prompt.strategy}`);
    const raw = await this.requestWithRepair(prompt, opts.noCache);
    const group = parseCommitGroup(raw, config, diff);
    return {
      ...group,
      type: opts.forceType ?? group.type,
      scope: opts.forceScope ?? group.scope,
      files: diff.files.map((file) => file.path),
    };
  }

  async generateCommitPlan(
    diff: ParsedDiff,
    config: FormatConfig,
    opts: GenerateOptions = {},
  ): Promise<CommitPlan> {
    const maxCommits = opts.maxCommits ?? 10;
    const prompt = new PromptBuilder(config).buildSplitPrompt(diff, maxCommits);
    logger.debug(`${this.getProviderName()} split — strategy: ${prompt.strategy}`);
    const raw = await this.requestWithRepair(prompt, opts.noCache);
    return parseCommitPlan(raw, config, diff, maxCommits);
  }

  validateResponse(raw: unknown): CommitGroup | CommitPlan {
    if (typeof raw !== 'string') throw new MalformedResponseError('response was not text');
    const trimmed = raw.trim();
    return trimmed.startsWith('[') ? parseCommitPlan(trimmed) : parseCommitGroup(trimmed);
  }

  /**
   * One API call plus a single retry when the model returns something that is
   * not parseable JSON (spec AC-12).
   */
  private async requestWithRepair(prompt: BuiltPrompt, noCache = false): Promise<string> {
    const key = cacheKey({
      provider: this.getProviderName(),
      model: this.ctx.settings.model,
      system: prompt.system,
      user: prompt.user,
    });
    const ttl = noCache ? 0 : resolveTtlMinutes(this.ctx.cacheMinutes);

    const cached = readCache(key, ttl);
    if (cached) return cached;

    const text = await this.request(prompt);
    if (looksLikeJson(text)) {
      writeCache(key, text, ttl);
      return text;
    }

    logger.debug(`non-JSON response, retrying once: ${text.slice(0, 200)}`);
    const retry = await this.request({
      ...prompt,
      system: `${prompt.system}\n\nYour previous answer was not valid JSON. Respond with JSON only, no prose and no markdown fences.`,
    });
    if (looksLikeJson(retry)) {
      writeCache(key, retry, ttl);
      return retry;
    }
    throw new MalformedResponseError(`raw response: ${retry.slice(0, 500)}`);
  }

  /** Perform the HTTP call with retries on transient failures. */
  protected async request(prompt: BuiltPrompt): Promise<string> {
    const { url, headers, body } = this.buildRequest(prompt);
    const maxRetries = this.ctx.settings.maxRetries;

    let lastError: Error | undefined;
    let rateLimitRetried = false;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 9000;
        logger.debug(`retry ${attempt}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.ctx.settings.timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 1000);

          if (response.status === 429) {
            const limit = this.readRateLimit(response.headers, detail);
            const error = new ApiRateLimitError({ ...limit, detail });
            // Retry only when the provider itself promises a short wait, and
            // only once: anything else spends quota to be refused again.
            const waitable =
              limit.retryAfterSeconds !== undefined &&
              limit.retryAfterSeconds <= MAX_RATE_LIMIT_WAIT_SECONDS;
            if (waitable && !rateLimitRetried && attempt < maxRetries) {
              rateLimitRetried = true;
              logger.debug(`rate limited; provider asks for ${limit.retryAfterSeconds}s`);
              await sleep((limit.retryAfterSeconds ?? 0) * 1000 + 250);
              continue;
            }
            throw error;
          }

          const error = this.mapHttpError(response.status, detail);
          if (RETRY_STATUSES.has(response.status) && attempt < maxRetries) {
            lastError = error;
            continue;
          }
          throw error;
        }

        return this.extractText(await response.json());
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          const timeout = new ApiTimeoutError(this.ctx.settings.timeoutMs);
          if (attempt < maxRetries) {
            lastError = timeout;
            continue;
          }
          throw timeout;
        }
        // A refused connection or a DNS failure surfaces as a plain TypeError
        // from fetch; on its own it reads as "fetch failed", which tells the
        // user nothing about what to do.
        if (isNetworkError(err)) {
          const unreachable = new ProviderActionableError(
            this.networkErrorHint(),
            `${this.getProviderName()}: ${describeCause(err)}`,
          );
          if (attempt < maxRetries) {
            lastError = unreachable;
            continue;
          }
          throw unreachable;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new ApiRequestError(this.getProviderName(), 0, 'request failed');
  }

  protected mapHttpError(status: number, detail: string): Error {
    if (status === 401 || status === 403) return new ApiAuthError(this.getProviderName(), detail);
    // 429 never reaches here: `request` handles it, so the wait and the quota
    // it reports are not lost.
    if (status === 429) return new ApiRateLimitError({ detail });
    return new ApiRequestError(this.getProviderName(), status, detail);
  }

  /**
   * What the provider says about a rate limit: how long to wait, and which
   * quota was hit. The `retry-after` header is the common case; providers that
   * put it in the body override this.
   */
  protected readRateLimit(
    headers: Headers,
    _detail: string,
  ): { retryAfterSeconds?: number; quota?: string } {
    const header = headers.get('retry-after');
    if (!header) return {};
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return { retryAfterSeconds: seconds };
    // The header may also be an HTTP date.
    const at = Date.parse(header);
    if (!Number.isNaN(at)) {
      return { retryAfterSeconds: Math.max(0, (at - Date.now()) / 1000) };
    }
    return {};
  }

  /** What to tell the user when the endpoint could not be reached at all. */
  protected networkErrorHint(): string {
    return `Could not reach the ${this.getProviderName()} API. Check your network connection.`;
  }
}

function looksLikeJson(text: string): boolean {
  const stripped = stripFences(text);
  return stripped.startsWith('{') || stripped.startsWith('[');
}

/** fetch reports transport failures as a TypeError carrying a `cause`. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && err.message.toLowerCase().includes('fetch');
}

function describeCause(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return cause?.code ?? cause?.message ?? (err as Error).message;
}
