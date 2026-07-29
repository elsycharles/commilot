import { MalformedResponseError } from '../utils/errors.js';
import type { ProviderContext } from './AIProvider.js';
import { BaseHttpProvider, type HttpRequest } from './BaseProvider.js';
import type { BuiltPrompt } from './PromptBuilder.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * OpenAI / ChatGPT backend — planned for v1.1.
 *
 * The transport is implemented against the same {@link BaseHttpProvider}
 * plumbing as Gemini, but the provider is not yet enabled in
 * {@link ProviderFactory}; it ships behind the release gate so the interface
 * can be exercised by tests.
 */
export class OpenAIProvider extends BaseHttpProvider {
  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  override getProviderName(): string {
    return 'OpenAI ChatGPT';
  }

  protected override buildRequest(prompt: BuiltPrompt): HttpRequest {
    const base = this.ctx.settings.baseUrl ?? DEFAULT_BASE_URL;
    return {
      url: `${base}/chat/completions`,
      headers: { authorization: `Bearer ${this.ctx.apiKey}` },
      body: {
        model: this.ctx.settings.model,
        temperature: this.ctx.settings.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      },
    };
  }

  protected override extractText(payload: unknown): string {
    const text = (payload as OpenAIResponse).choices?.[0]?.message?.content?.trim();
    if (!text) throw new MalformedResponseError('OpenAI returned an empty completion');
    return text;
  }
}
