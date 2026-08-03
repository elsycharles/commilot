# Contributing to Commilot

Thanks for helping out. Commilot is a small, dependency-light TypeScript CLI — the bar for a change
is that it stays that way.

## Getting set up

```bash
git clone https://github.com/commilot/commilot
cd commilot
npm install
npm run build
npm link            # `commilot` now points at your working copy
```

You need Node.js 20+ and git. No API key is required to run the test suite.

## Everyday commands

| Command                           | What it does                           |
| --------------------------------- | -------------------------------------- |
| `npm run build`                   | Bundle to `dist/` with tsup            |
| `npm run dev`                     | Same, in watch mode                    |
| `npm test`                        | Unit + E2E tests                       |
| `npm run test:unit`               | Unit tests only (fast)                 |
| `npm run coverage`                | Tests with the 80% thresholds enforced |
| `npm run lint` / `npm run format` | ESLint / Prettier                      |
| `npm run typecheck`               | `tsc --noEmit`                         |
| `npm run docs`                    | TypeDoc API docs into `docs/`          |

## Layout

```
src/
  index.ts        commander wiring, global flags, error → exit code mapping
  commands/       one file per CLI command
  core/           ConfigLoader, GitService, DiffValidator, ResponseParser, pipeline
  providers/      AIProvider interface, factory, per-provider transports, PromptBuilder
  ui/             ReviewUI, DiffDisplay, Spinner
  types/          Zod schemas and shared interfaces
  utils/          logger, typed errors
tests/
  unit/           module tests, plus in-process command tests
  e2e/            the built CLI as a subprocess against a fake provider server
  fixtures/       sample diffs and canned AI responses
```

## Ollama is the product; the other backends are dormant code

Gemini, OpenAI and Claude are fully implemented and covered by tests, but they
are **not part of what Commilot offers**. They are absent from the README, from
`commilot providers`, from the generated config and from `--help`; selecting
one reports that it is not available.

They are kept because the `AIProvider` interface is only worth having if more
than one backend implements it — they are what keeps the abstraction honest,
and what makes adding a backend a small change rather than a rewrite.

A maintainer can still reach one:

```bash
commilot config set gemini.enabled true   # then --provider gemini
```

Treat that as a development affordance, not a feature. If you add a backend,
leave `enabled` defaulting to false unless it works with no account, no quota
and no network.

## Adding an AI provider

1. Subclass `BaseHttpProvider` (`src/providers/`) and implement `buildRequest` and `extractText`.
   Retry, backoff, timeouts, error mapping and JSON repair are inherited. Override
   `networkErrorHint()` and `mapHttpError()` when the backend has a failure worth explaining
   (`OllamaProvider` does both).
2. Register it in `REGISTRY` in `ProviderFactory.ts`, with `requiresApiKey: false` if it runs
   locally.
3. Add its name to `PROVIDER_NAMES` and its defaults (model, temperature, timeouts) to
   `configSchema` in `src/types/config.ts`.
4. Add transport tests in `tests/unit/providers.test.ts`, and its response envelope to
   `tests/fixtures/responses.ts` plus the `ENVELOPES` map in `tests/e2e/helpers.ts` — the fake
   server then answers it automatically, keyed on the URL the provider calls.

Prompts are deliberately provider-agnostic: they live in `PromptBuilder` and must not be forked per
provider. If a provider needs different phrasing, that is a bug in the prompt.

## Tests

- Anything touching git uses a throwaway repository in `os.tmpdir()`; never the working repo.
- Never call a real AI API. Unit tests stub `fetch`; E2E tests use `FakeProviderServer`.
- New behaviour needs a test. Coverage thresholds (80% lines/statements/functions, 70% branches)
  are enforced in `vitest.config.ts`.

## Commit messages

Commilot dog-foods itself. Commits follow `type(scope) - description` with types `dev`, `feat` and
`bug`, per the repository's own `.commilot.yml`:

```bash
export COMMILOT_GEMINI_KEY=...
commilot split
```

## Dependency overrides

`package.json` carries one `overrides` entry:

```json
"overrides": { "esbuild": "^0.28.1" }
```

`tsup` still pins `esbuild ^0.27`, which carries a dev-server advisory. Commilot never runs that
server — tsup only bundles — but pulling the patched line keeps `npm audit` clean. **Remove the
override once tsup ships with esbuild 0.28+**, and check `npm audit` and `npm run build` after.

## Dependencies we deliberately hold back

| Package       | Held at | Why                                                                                                                                                                              |
| ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`  | 5.x     | `typescript-eslint` refuses TS 7 outright (`does not support TS 7.0`), and tsup's declaration build crashes on it. Revisit once typescript-eslint ships TS 7 support.            |
| `@types/node` | 20.x    | `engines.node` is `>=20`. Newer types would let code compile against APIs that do not exist on the oldest Node we claim to support. Bump this only together with `engines.node`. |

## Branches and pull requests

| Branch                          | Role                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `main`                          | Released code. Protected: pull request + maintainer approval + green CI.          |
| `dev`                           | Integration branch. Protected: pull request + green CI. **Target your PRs here.** |
| `feature/…`, `bug/…`, `chore/…` | Your work, branched from `dev`.                                                   |

Neither `main` nor `dev` accepts a direct push, and neither can be force-pushed or deleted.
External contributors work from a fork; the flow is the same.

Run `npm run lint && npm run typecheck && npm test` before opening a PR, and describe the
user-facing change. CI runs the same on Linux, macOS and Windows against Node 20 and 22, and every
job must be green before a PR can be merged.

Commits follow `type(scope) - description` (see above). Squash or merge, either is accepted.
