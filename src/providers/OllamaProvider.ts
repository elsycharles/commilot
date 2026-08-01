import { MalformedResponseError, ProviderActionableError } from '../utils/errors.js';
import type { ProviderContext } from './AIProvider.js';
import { BaseHttpProvider, type HttpRequest } from './BaseProvider.js';
import type { BuiltPrompt, ExpectedShape } from './PromptBuilder.js';

/**
 * Ollama's `format: "json"` guarantees valid JSON but not its shape: asked for
 * an array of commit groups, llama3.1 answers a single object, and the split
 * collapses to one group plus a fallback. Passing a JSON schema instead
 * constrains the decoder, and the same model then assigns every file correctly.
 */
function jsonSchemaFor(expects: ExpectedShape): unknown {
  const group = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: expects.types },
      scope: { type: 'string' },
      description: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
    },
    required: ['type', 'scope', 'description'],
  };

  return expects.kind === 'array'
    ? { type: 'array', items: { ...group, required: [...group.required, 'files'] } }
    : group;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

interface OllamaResponse {
  message?: { role?: string; content?: string };
  done?: boolean;
  error?: string;
}

/**
 * Ollama backend — runs a model on the developer's own machine.
 *
 * The only provider that needs no API key: nothing leaves the machine, which
 * is the point for code that must not reach a third party.
 */
export class OllamaProvider extends BaseHttpProvider {
  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  override getProviderName(): string {
    return 'Ollama (local)';
  }

  /** Local inference needs no credentials, so it is always usable. */
  override isConfigured(): boolean {
    return true;
  }

  private get baseUrl(): string {
    return this.ctx.settings.baseUrl ?? DEFAULT_BASE_URL;
  }

  protected override buildRequest(prompt: BuiltPrompt): HttpRequest {
    return {
      url: `${this.baseUrl}/api/chat`,
      headers: {},
      body: {
        model: this.ctx.settings.model,
        stream: false,
        // A schema rather than plain 'json': the shape is what local models
        // get wrong, not the syntax.
        format: jsonSchemaFor(prompt.expects),
        options: { temperature: this.ctx.settings.temperature },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      },
    };
  }

  protected override extractText(payload: unknown): string {
    const response = payload as OllamaResponse;
    if (response.error) throw new MalformedResponseError(`Ollama error: ${response.error}`);
    const text = response.message?.content?.trim();
    if (!text) throw new MalformedResponseError('Ollama returned an empty message');
    return text;
  }

  /** A missing model is the usual Ollama failure, and it has a one-line fix. */
  protected override mapHttpError(status: number, detail: string): Error {
    if (status === 404) {
      return new ProviderActionableError(
        `Ollama does not have the model '${this.ctx.settings.model}'. Install it with: ollama pull ${this.ctx.settings.model}`,
        detail,
      );
    }
    return super.mapHttpError(status, detail);
  }

  protected override networkErrorHint(): string {
    return `Cannot reach Ollama at ${this.baseUrl}. Start it with \`ollama serve\`, or set \`ollama.baseUrl\` in .commilot.yml.`;
  }
}
