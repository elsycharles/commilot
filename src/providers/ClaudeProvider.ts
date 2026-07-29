import { MalformedResponseError } from '../utils/errors.js';
import type { ProviderContext } from './AIProvider.js';
import { BaseHttpProvider, type HttpRequest } from './BaseProvider.js';
import type { BuiltPrompt } from './PromptBuilder.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

interface ClaudeResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
}

/**
 * Anthropic / Claude backend — planned for v1.2.
 *
 * Like {@link OpenAIProvider} the transport is written, but the provider is
 * not yet enabled in {@link ProviderFactory}.
 */
export class ClaudeProvider extends BaseHttpProvider {
  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  override getProviderName(): string {
    return 'Anthropic Claude';
  }

  protected override buildRequest(prompt: BuiltPrompt): HttpRequest {
    const base = this.ctx.settings.baseUrl ?? DEFAULT_BASE_URL;
    return {
      url: `${base}/messages`,
      headers: {
        'x-api-key': this.ctx.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: {
        model: this.ctx.settings.model,
        max_tokens: 2048,
        temperature: this.ctx.settings.temperature,
        system: prompt.system,
        messages: [
          { role: 'user', content: prompt.user },
          // Prefilling the assistant turn keeps the answer to bare JSON.
          { role: 'assistant', content: '{' },
        ],
      },
    };
  }

  protected override extractText(payload: unknown): string {
    const response = payload as ClaudeResponse;
    const text = response.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();
    if (!text) throw new MalformedResponseError('Claude returned an empty message');
    // Re-attach the prefilled brace when the model continued from it.
    return text.startsWith('{') || text.startsWith('[') ? text : `{${text}`;
  }
}
