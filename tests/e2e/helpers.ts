import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  claudeEnvelope,
  geminiEnvelope,
  ollamaEnvelope,
  openAiEnvelope,
} from '../fixtures/responses.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = join(REPO_ROOT, 'dist', 'index.js');

/** Build the CLI once, and only when dist is missing or older than src. */
export function ensureBuilt(): void {
  const srcNewest = newestMtime(join(REPO_ROOT, 'src'));
  if (existsSync(CLI) && statSync(CLI).mtimeMs >= srcNewest) return;
  // On Windows the executable is npm.cmd; execFileSync does not resolve it.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', '--silent', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/** Which provider a request belongs to, recognised from the URL it hit. */
export type ProviderKind = 'gemini' | 'openai' | 'claude' | 'ollama';

export interface RecordedRequest {
  provider: ProviderKind;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** Envelope each backend wraps the model's answer in. */
const ENVELOPES: Record<ProviderKind, (text: string) => unknown> = {
  gemini: geminiEnvelope,
  openai: openAiEnvelope,
  claude: claudeEnvelope,
  ollama: ollamaEnvelope,
};

function providerFromUrl(url: string): ProviderKind {
  if (url.includes('/chat/completions')) return 'openai';
  if (url.includes('/messages')) return 'claude';
  if (url.includes('/api/chat')) return 'ollama';
  return 'gemini';
}

/**
 * A stand-in for every supported backend. The provider is recognised from the
 * URL the CLI called, and the queued answer is wrapped in that provider's own
 * response envelope — so the routing is part of what the test exercises.
 */
export class FakeProviderServer {
  private server?: Server;
  private queue: Array<{ status: number; body?: unknown; text?: string }> = [];
  /** Every request the CLI sent, for prompt and routing assertions. */
  readonly requests: RecordedRequest[] = [];

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        const url = req.url ?? '';
        const provider = providerFromUrl(url);
        this.requests.push({
          provider,
          url,
          headers: req.headers,
          body: raw ? JSON.parse(raw) : null,
        });

        const next = this.queue.shift() ?? { status: 500, body: { error: 'no response queued' } };
        const body = next.text !== undefined ? ENVELOPES[provider](next.text) : next.body;
        res.writeHead(next.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });

    await new Promise<void>((done) => this.server?.listen(0, '127.0.0.1', done));
    const address = this.server?.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind a port');
    return `http://127.0.0.1:${address.port}`;
  }

  /** Queue a model answer, wrapped for whichever provider asks for it. */
  reply(text: string): this {
    this.queue.push({ status: 200, text });
    return this;
  }

  /** Bodies of the requests received, oldest first. */
  get bodies(): unknown[] {
    return this.requests.map((request) => request.body);
  }

  /** Queue a raw HTTP failure. */
  fail(status: number, body: unknown = { error: { message: 'failed' } }): this {
    this.queue.push({ status, body });
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((done) => {
      if (!this.server) return done();
      this.server.close(() => done());
    });
  }
}

/** Normalised subprocess result: strings, never undefined. */
export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TestRepo {
  dir: string;
  /** Run the built CLI inside the repo; never throws on a non-zero exit. */
  run: (args: string[], env?: Record<string, string>) => Promise<RunResult>;
  write: (name: string, content: string) => void;
  git: (...args: string[]) => string;
  cleanup: () => void;
}

/** Run the built CLI in `cwd`, normalising the result. */
export async function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const result = await execa('node', [CLI, ...args], {
    cwd,
    reject: false,
    env: {
      ...process.env,
      // A developer's real keys must not influence the tests.
      COMMILOT_GEMINI_KEY: '',
      COMMILOT_OPENAI_KEY: '',
      COMMILOT_CLAUDE_KEY: '',
      FORCE_COLOR: '0',
      ...env,
    },
  });
  return {
    exitCode: result.exitCode ?? 0,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

/**
 * Config pointing every backend at the fake server. Each provider keeps its
 * own base URL shape: Gemini appends `/v1beta/models/...`, OpenAI
 * `/chat/completions`, Claude `/messages`, Ollama `/api/chat`.
 */
export function testConfig(baseUrl: string, extraConfig = ''): string {
  return `provider: gemini
gemini:
  apiKey: "test-key"
  model: gemini-2.0-flash
  baseUrl: "${baseUrl}/v1beta"
  maxRetries: 0
openai:
  apiKey: "sk-test"
  model: gpt-4o-mini
  baseUrl: "${baseUrl}/v1"
  maxRetries: 0
claude:
  apiKey: "sk-ant-test"
  model: claude-sonnet-5
  baseUrl: "${baseUrl}/v1"
  maxRetries: 0
ollama:
  model: llama3.1
  baseUrl: "${baseUrl}"
  maxRetries: 0
${extraConfig}`;
}

/** Create a throwaway git repository with a Commilot config pointing at `baseUrl`. */
export function createTestRepo(baseUrl: string, extraConfig = ''): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), 'commilot-e2e-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  git('init', '--quiet');
  git('config', 'user.email', 'test@commilot.dev');
  git('config', 'user.name', 'Commilot Test');
  git('config', 'commit.gpgsign', 'false');

  const write = (name: string, content: string): void => {
    writeFileSync(join(dir, name), content, 'utf8');
  };

  write('.commitHelper.yml', testConfig(baseUrl, extraConfig));

  // A first commit so HEAD exists, mirroring a real repository. The config is
  // gitignored exactly as `commilot init` would leave it.
  write('.gitignore', '.commitHelper.yml\n');
  write('README.md', '# fixture\n');
  git('add', 'README.md', '.gitignore');
  git('commit', '--quiet', '-m', 'dev(init) - add readme');

  return {
    dir,
    write,
    git,
    run: (args, env = {}) => runCli(args, dir, env),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
