import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRawDiff } from '../../src/core/DiffValidator.js';
import { ClaudeProvider } from '../../src/providers/ClaudeProvider.js';
import { GeminiProvider } from '../../src/providers/GeminiProvider.js';
import { OllamaProvider } from '../../src/providers/OllamaProvider.js';
import { OpenAIProvider } from '../../src/providers/OpenAIProvider.js';
import { configSchema, formatConfigSchema } from '../../src/types/config.js';
import { ApiAuthError, ApiRateLimitError, MalformedResponseError } from '../../src/utils/errors.js';
import { MULTI_AREA_DIFF, SIMPLE_DIFF } from '../fixtures/diffs.js';
import {
  GENERATE_JSON,
  GENERATE_JSON_FENCED,
  SPLIT_JSON,
  claudeEnvelope,
  geminiEnvelope,
  ollamaEnvelope,
  openAiEnvelope,
} from '../fixtures/responses.js';

const format = formatConfigSchema.parse({});
const diff = parseRawDiff(SIMPLE_DIFF);
const multiDiff = parseRawDiff(MULTI_AREA_DIFF);

// No real waiting between retries.
const settings = configSchema.parse({}).gemini;
const fastSettings = { ...settings, maxRetries: 2, timeoutMs: 50 };

function makeGemini(overrides: Partial<typeof settings> = {}) {
  return new GeminiProvider({ settings: { ...fastSettings, ...overrides }, apiKey: 'k' });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GeminiProvider', () => {
  it('posts to the generateContent endpoint with the key and JSON mode', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(geminiEnvelope(GENERATE_JSON)));

    const group = await makeGemini().generateCommitMessage(diff, format);

    expect(group).toMatchObject({ type: 'feat', scope: 'auth' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/models/gemini-2.0-flash:generateContent');
    expect(url).toContain('key=k');
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.systemInstruction.parts[0].text).toContain('commit message generator');
  });

  it('attaches the changed files to the generated group', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(geminiEnvelope(GENERATE_JSON)));
    const group = await makeGemini().generateCommitMessage(diff, format);
    expect(group.files).toEqual(diff.files.map((file) => file.path));
  });

  it('honours forced type and scope from CLI flags', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(geminiEnvelope(GENERATE_JSON)));
    const group = await makeGemini().generateCommitMessage(diff, format, {
      forceType: 'bug',
      forceScope: 'api',
    });
    expect(group).toMatchObject({ type: 'bug', scope: 'api' });
  });

  it('produces a commit plan for split mode', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(geminiEnvelope(SPLIT_JSON)));
    const plan = await makeGemini().generateCommitPlan(multiDiff, format, { maxCommits: 5 });
    expect(plan).toHaveLength(3);
    expect(plan.flatMap((group) => group.files)).toHaveLength(3);
  });

  it('recovers from markdown-fenced JSON', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(geminiEnvelope(GENERATE_JSON_FENCED)));
    await expect(makeGemini().generateCommitMessage(diff, format)).resolves.toMatchObject({
      type: 'feat',
    });
  });

  it('retries once when the model answers with prose (AC-12)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(geminiEnvelope('Sorry, I cannot do that.')))
      .mockResolvedValueOnce(jsonResponse(geminiEnvelope(GENERATE_JSON)));

    const group = await makeGemini().generateCommitMessage(diff, format);
    expect(group.type).toBe('feat');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up with MalformedResponseError after the repair attempt', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(geminiEnvelope('still prose')));
    await expect(makeGemini().generateCommitMessage(diff, format)).rejects.toBeInstanceOf(
      MalformedResponseError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries transient 503s with backoff and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse(geminiEnvelope(GENERATE_JSON)));

    const promise = makeGemini().generateCommitMessage(diff, format);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toMatchObject({ type: 'feat' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps 401 to ApiAuthError (AC-19)', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'bad key' }, 401));
    await expect(makeGemini().generateCommitMessage(diff, format)).rejects.toBeInstanceOf(
      ApiAuthError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an exhausted 429 to ApiRateLimitError (AC-19)', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'slow down' }, 429));
    const promise = makeGemini({ maxRetries: 1 }).generateCommitMessage(diff, format);
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiRateLimitError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it('surfaces a blocked prompt', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }),
    );
    await expect(makeGemini().generateCommitMessage(diff, format)).rejects.toBeInstanceOf(
      MalformedResponseError,
    );
  });

  it('reports itself as unconfigured without an API key', () => {
    const provider = new GeminiProvider({ settings: fastSettings, apiKey: '' });
    expect(provider.isConfigured()).toBe(false);
  });
});

describe('OllamaProvider', () => {
  const makeOllama = (overrides: Partial<typeof settings> = {}) =>
    new OllamaProvider({
      settings: { ...fastSettings, model: 'llama3.1', ...overrides },
      apiKey: '',
    });

  it('posts to the local chat endpoint in JSON mode', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(ollamaEnvelope(GENERATE_JSON)));

    const group = await makeOllama().generateCommitMessage(diff, format);

    expect(group).toMatchObject({ type: 'feat', scope: 'auth' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('llama3.1');
    expect(body.format).toBe('json');
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe('system');
  });

  it('sends no credentials at all', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(ollamaEnvelope(GENERATE_JSON)));
    await makeOllama().generateCommitMessage(diff, format);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('is configured without an api key', () => {
    expect(makeOllama().isConfigured()).toBe(true);
    expect(makeOllama().getProviderName()).toBe('Ollama (local)');
  });

  it('honours a custom baseUrl', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(ollamaEnvelope(GENERATE_JSON)));
    await makeOllama({ baseUrl: 'http://192.168.1.10:11434' }).generateCommitMessage(diff, format);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://192.168.1.10:11434/api/chat');
  });

  it('explains how to install a missing model on 404', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'model not found' }, 404));

    await expect(makeOllama().generateCommitMessage(diff, format)).rejects.toThrow(
      /ollama pull llama3\.1/,
    );
  });

  it('surfaces an error field returned with a 200', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'model is loading' }));
    await expect(makeOllama().generateCommitMessage(diff, format)).rejects.toBeInstanceOf(
      MalformedResponseError,
    );
  });

  it('tells the user Ollama is not running when the connection is refused', async () => {
    fetchMock.mockImplementation(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });

    await expect(makeOllama({ maxRetries: 0 }).generateCommitMessage(diff, format)).rejects.toThrow(
      /ollama serve/,
    );
  });

  it('splits a diff like any other provider', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(ollamaEnvelope(SPLIT_JSON)));
    const plan = await makeOllama().generateCommitPlan(multiDiff, format, { maxCommits: 5 });
    expect(plan).toHaveLength(3);
  });
});

describe('every provider implements the same interface', () => {
  it('OpenAIProvider talks to chat/completions', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(openAiEnvelope(GENERATE_JSON)));
    const provider = new OpenAIProvider({
      settings: { ...fastSettings, model: 'gpt-4o-mini' },
      apiKey: 'sk-test',
    });

    const group = await provider.generateCommitMessage(diff, format);

    expect(group.type).toBe('feat');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(provider.getProviderName()).toBe('OpenAI ChatGPT');
  });

  it('ClaudeProvider talks to the messages endpoint', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(claudeEnvelope(GENERATE_JSON)));
    const provider = new ClaudeProvider({
      settings: { ...fastSettings, model: 'claude-sonnet-5' },
      apiKey: 'sk-ant-test',
    });

    const group = await provider.generateCommitMessage(diff, format);

    expect(group.type).toBe('feat');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    expect(provider.getProviderName()).toBe('Anthropic Claude');
  });

  it('builds the same prompt regardless of provider', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(geminiEnvelope(GENERATE_JSON)));
    await makeGemini().generateCommitMessage(diff, format);
    const geminiBody = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => jsonResponse(openAiEnvelope(GENERATE_JSON)));
    await new OpenAIProvider({ settings: fastSettings, apiKey: 'x' }).generateCommitMessage(
      diff,
      format,
    );
    const openAiBody = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);

    expect(openAiBody.messages[0].content).toBe(geminiBody.systemInstruction.parts[0].text);
    expect(openAiBody.messages[1].content).toBe(geminiBody.contents[0].parts[0].text);
  });
});
