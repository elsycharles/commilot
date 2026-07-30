/** Base class for every error Commilot raises deliberately. */
export class CommilotError extends Error {
  /** Process exit code to use when this error reaches the top level. */
  readonly exitCode: number;
  /** Optional extra detail shown with `--verbose`. */
  readonly detail?: string;

  constructor(message: string, opts: { exitCode?: number; detail?: string } = {}) {
    super(message);
    this.name = new.target.name;
    this.exitCode = opts.exitCode ?? 1;
    this.detail = opts.detail;
  }
}

export class NotGitRepoError extends CommilotError {
  constructor() {
    super('Not a git repository. Run this command from inside a git repository.');
  }
}

export class NoDiffError extends CommilotError {
  constructor(message = 'No changes detected. Stage some changes first or use `--all` flag.') {
    super(message);
  }
}

export class DiffTooLargeError extends CommilotError {
  constructor(actual: number, maxDiffLines: number) {
    super(
      `Diff exceeds maximum size (${maxDiffLines} lines). Reduce changes or increase \`behaviour.maxDiffLines\`.`,
      { detail: `Diff contains ${actual} changed lines.` },
    );
  }
}

export class MissingApiKeyError extends CommilotError {
  constructor(provider: string) {
    super(
      `No API key configured for provider '${provider}'. Set \`${provider}.apiKey\` in \`.commilot.yml\` or export \`COMMILOT_${provider.toUpperCase()}_KEY\`.`,
    );
  }
}

export class UnsupportedProviderError extends CommilotError {
  constructor(name: string, available: string[], planned: string[]) {
    const upcoming = planned.length > 0 ? ` Coming soon: ${planned.join(', ')}.` : '';
    super(`Provider '${name}' is not supported. Available: ${available.join(', ')}.${upcoming}`);
  }
}

export class ApiAuthError extends CommilotError {
  constructor(provider: string, detail?: string) {
    super(`Invalid API key for ${provider}. Check your API key in \`.commilot.yml\`.`, {
      detail,
    });
  }
}

export class ApiRateLimitError extends CommilotError {
  constructor(detail?: string) {
    super('API rate limit exceeded. Wait and try again, or use a different API key.', { detail });
  }
}

export class ApiTimeoutError extends CommilotError {
  constructor(timeoutMs: number) {
    super(
      `API request timed out after ${Math.round(timeoutMs / 1000)}s. Try again or check your network connection.`,
    );
  }
}

export class ApiRequestError extends CommilotError {
  constructor(provider: string, status: number, detail?: string) {
    super(`${provider} API request failed with status ${status}.`, { detail });
  }
}

/**
 * A failure the user can act on directly. The hint *is* the message, because
 * `detail` is only shown with `--verbose` and would hide the fix.
 */
export class ProviderActionableError extends CommilotError {
  constructor(hint: string, detail?: string) {
    super(hint, { detail });
  }
}

export class MalformedResponseError extends CommilotError {
  constructor(detail?: string) {
    super('AI returned an unexpected response format. Try again with `--verbose` for details.', {
      detail,
    });
  }
}

export class ConfigValidationError extends CommilotError {
  constructor(details: string) {
    super(`Invalid configuration: ${details}. Run \`commilot init\` to create a valid config.`);
  }
}

/** Alias kept for readability at call sites that only failed to read/parse YAML. */
export class ConfigError extends ConfigValidationError {}

export class GitOperationError extends CommilotError {
  constructor(details: string) {
    super(`Git operation failed: ${details}. Check git status and try again.`);
  }
}

/** Raised when the user cancels an interactive prompt. Exits silently with 0. */
export class UserCancelError extends CommilotError {
  constructor() {
    super('', { exitCode: 0 });
  }
}
