import { MalformedResponseError } from '../utils/errors.js';
import type { ProviderContext } from './AIProvider.js';
import { BaseHttpProvider, type HttpRequest } from './BaseProvider.js';
import type { BuiltPrompt } from './PromptBuilder.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

/** Google Gemini backend — the default and only provider shipped in v1.0. */
export class GeminiProvider extends BaseHttpProvider {
  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  override getProviderName(): string {
    return 'Google Gemini';
  }

  protected override buildRequest(prompt: BuiltPrompt): HttpRequest {
    const base = this.ctx.settings.baseUrl ?? DEFAULT_BASE_URL;
    const model = this.ctx.settings.model;
    return {
      url: `${base}/models/${model}:generateContent?key=${encodeURIComponent(this.ctx.apiKey)}`,
      headers: {},
      body: {
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: {
          temperature: this.ctx.settings.temperature,
          responseMimeType: 'application/json',
        },
      },
    };
  }

  /**
   * Gemini answers a 429 with `RetryInfo.retryDelay` ("34s") and a
   * `QuotaFailure` naming the limit that was hit — both in the body, not in a
   * header. Reading them is what tells the user whether to wait a moment or
   * come back tomorrow.
   */
  protected override readRateLimit(
    headers: Headers,
    detail: string,
  ): { retryAfterSeconds?: number; quota?: string } {
    const fromHeader = super.readRateLimit(headers, detail);

    let payload: unknown;
    try {
      payload = JSON.parse(detail);
    } catch {
      return fromHeader;
    }

    const details = (payload as { error?: { details?: unknown[] } }).error?.details ?? [];
    let retryAfterSeconds = fromHeader.retryAfterSeconds;
    let quota: string | undefined;

    for (const entry of details as Array<Record<string, unknown>>) {
      const type = String(entry['@type'] ?? '');
      if (type.endsWith('RetryInfo') && typeof entry.retryDelay === 'string') {
        const seconds = Number.parseFloat(entry.retryDelay.replace(/s$/, ''));
        if (Number.isFinite(seconds)) retryAfterSeconds = seconds;
      }
      if (type.endsWith('QuotaFailure') && Array.isArray(entry.violations)) {
        const first = entry.violations[0] as { quotaMetric?: string; quotaId?: string } | undefined;
        quota = first?.quotaId ?? first?.quotaMetric;
      }
    }

    return { retryAfterSeconds, quota };
  }

  protected override extractText(payload: unknown): string {
    const response = payload as GeminiResponse;
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      throw new MalformedResponseError(`Gemini blocked the request: ${blockReason}`);
    }
    const text = response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new MalformedResponseError(
        `Gemini returned no text (finishReason: ${response.candidates?.[0]?.finishReason ?? 'unknown'})`,
      );
    }
    return text;
  }
}
