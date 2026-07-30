# Commilot

> _commit + copilot_

Your AI copilot for git commits — generates structured messages and intelligently **splits large diffs into clean, scoped commits**. Powered by Google Gemini (ChatGPT & Claude coming soon).

```
$ commilot split

  • Analysing all changes... 12 files changed, +398 -47
  ✔ Split into logical commits (provider: gemini)

  ┌── Commit Plan (3 commits) ─────────────────────────┐
  │                                                    │
  │  1. feat(auth) - add login endpoint                │
  │     A  src/controllers/auth.controller.ts  (+89)   │
  │     M  src/services/auth.service.ts   (+45, -2)    │
  │                                                    │
  │  2. feat(dashboard) - add user stats widget        │
  │     A  src/components/stats-widget.tsx    (+112)   │
  │                                                    │
  │  3. dev(config) - update eslint and prettier rules │
  │     M  .eslintrc.json                  (+8, -4)    │
  │                                                    │
  └────────────────────────────────────────────────────┘

  ? Review commit 1/3: feat(auth) - add login endpoint
    ❯ ✔ Accept
      ✎ Edit message
      ⇅ Merge with next commit
      ⤫ Skip this commit
      ✖ Cancel all
```

---

## Why Commilot

Other AI commit tools write **one** message for everything you have staged. Commilot's core
differentiator is **smart splitting**: it reads the whole diff, groups files that belong together,
and proposes a separate commit per group — automating what you would otherwise do by hand with
`git add -p`.

|                                 | Commilot            | aicommits       | OpenCommit      |
| ------------------------------- | ------------------- | --------------- | --------------- |
| Single commit generation        | ✅                  | ✅              | ✅              |
| Smart commit splitting          | ✅ **core feature** | ❌              | ❌              |
| Custom format template          | ✅ YAML             | type only       | limited         |
| Scopes registry                 | ✅                  | ❌              | ❌              |
| Interactive edit / merge / skip | ✅                  | accept / reject | accept / reject |
| Multi-provider switching        | ✅ one config line  | ❌              | limited         |

---

## Install

```bash
npm install -g commilot
```

Requires **Node.js 22+** and `git` on your `PATH`. Works on macOS, Linux and Windows.

Or run it without installing:

```bash
npx commilot generate
```

## Quick start

```bash
# 1. Create a config in your project
commilot init

# 2. Add your Gemini API key (the free tier is plenty) — https://aistudio.google.com/apikey
export COMMILOT_GEMINI_KEY="your-key"

# 3. Stage something and let Commilot write the message
git add .
commilot generate

# …or let it split everything into separate, coherent commits
commilot split
```

---

## Commands

| Command                               | Description                                        |
| ------------------------------------- | -------------------------------------------------- |
| `commilot generate`                   | One commit message for the staged changes          |
| `commilot split`                      | Group all changes into N commits, one message each |
| `commilot init`                       | Create `.commitHelper.yml` (and gitignore it)      |
| `commilot config get <key>`           | Print the effective value of a key                 |
| `commilot config set <key> <value>`   | Write a value to the project or global config      |
| `commilot config list`                | Print the full merged configuration                |
| `commilot providers`                  | List AI providers and their status                 |
| `commilot hook install` / `uninstall` | Manage the `prepare-commit-msg` git hook           |

### `commilot generate`

| Flag                   | Description                                        |
| ---------------------- | -------------------------------------------------- |
| `--staged`             | Analyse staged changes (default)                   |
| `--all`                | Analyse staged + unstaged + untracked changes      |
| `--dry-run`            | Print the proposed message, change nothing         |
| `--type <type>`        | Force the type instead of letting the AI choose    |
| `--scope <scope>`      | Force the scope instead of letting the AI choose   |
| `--provider <name>`    | Override the configured provider for this run      |
| `-y, --yes`            | Accept the proposal without the interactive review |
| `--hook-output <file>` | Write the message to a file instead of committing  |

In the review prompt you can **accept**, **edit**, **regenerate** or **cancel**.

### `commilot split`

| Flag                | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `--all`             | Analyse staged + unstaged + untracked changes (default) |
| `--staged`          | Only split what is already staged                       |
| `--dry-run`         | Print the commit plan, change nothing                   |
| `--max-commits <n>` | Cap the number of proposed commits                      |
| `--provider <name>` | Override the configured provider for this run           |
| `-y, --yes`         | Accept the whole plan without reviewing each commit     |

Each commit is reviewed on its own: **accept**, **edit**, **merge with the next one**, **skip**, or
**cancel everything**. Commits are then created sequentially, staging exactly the files of each
group. If something fails halfway through, Commilot prints the `git reset --soft <sha>` command that
undoes exactly what it created.

### Global flags

`--verbose` (debug output, including raw AI responses), `--quiet` (errors only), `-v, --version`.

---

## Configuration

Commilot reads `.commitHelper.yml`. Values are resolved in this order:

```
CLI flags  >  ./.commitHelper.yml  >  ~/.commitHelper.yml  >  built-in defaults
```

The project file is searched upwards from the current directory and never past the repository root,
so it works from any subdirectory. Nested keys merge; **lists replace**.

```yaml
# AI Provider — which LLM to use for commit generation
# One of: gemini (default), openai, claude, ollama
provider: gemini

gemini:
  apiKey: '' # Prefer COMMILOT_GEMINI_KEY instead
  model: gemini-2.0-flash
  temperature: 0.3

openai:
  apiKey: '' # or COMMILOT_OPENAI_KEY
  model: gpt-4o-mini

claude:
  apiKey: '' # or COMMILOT_CLAUDE_KEY
  model: claude-sonnet-5

ollama: # local — no API key, nothing leaves your machine
  model: llama3.1
  baseUrl: 'http://127.0.0.1:11434'

format:
  template: '{type}({scope}) - {description}'
  types: [dev, feat, bug]
  scopes: [] # e.g. [login, auth, dashboard] — empty = the AI infers
  descriptionMaxLength: 72
  language: en # ISO 639-1; the AI writes in this language

behaviour:
  autoStage: false # git add -A before analysing
  maxDiffLines: 5000 # reject anything bigger
  excludePatterns: # never sent to the AI
    - 'package-lock.json'
    - 'yarn.lock'
    - '*.min.js'
    - '*.min.css'
  splitMaxCommits: 10
  confirmBeforeCommit: true
```

### Reference

| Key                  | Type   | Default                  | Notes                                                     |
| -------------------- | ------ | ------------------------ | --------------------------------------------------------- |
| `provider`           | string | `gemini`                 | `gemini`, `openai`, `claude` or `ollama`                  |
| `gemini.apiKey`      | string | —                        | Or `COMMILOT_GEMINI_KEY`                                  |
| `gemini.model`       | string | `gemini-2.0-flash`       | Any Gemini model id                                       |
| `gemini.temperature` | 0–1    | `0.3`                    | Lower = more deterministic                                |
| `gemini.timeoutMs`   | number | `30000`                  | Per request                                               |
| `gemini.maxRetries`  | number | `3`                      | Backoff 1s / 3s / 9s on 429, 5xx and timeouts             |
| `gemini.baseUrl`     | url    | Google endpoint          | For proxies                                               |
| `openai.model`       | string | `gpt-4o-mini`            | Any chat-completions model                                |
| `claude.model`       | string | `claude-sonnet-5`        | Any Messages API model                                    |
| `ollama.model`       | string | `llama3.1`               | Must be pulled first: `ollama pull <model>`               |
| `ollama.baseUrl`     | url    | `http://127.0.0.1:11434` | Where your Ollama server listens                          |
| `ollama.timeoutMs`   | number | `120000`                 | Higher than the hosted default: local inference is slower |

Every provider block accepts the same keys (`apiKey`, `model`, `temperature`, `timeoutMs`, `maxRetries`, `baseUrl`); only the defaults differ.
| `format.template` | string | `{type}({scope}) - {description}` | `{type}`, `{scope}`, `{description}` |
| `format.types` | string[] | `[dev, feat, bug]` | The AI is constrained to these |
| `format.scopes` | string[] | `[]` | Empty = the AI infers a scope |
| `format.descriptionMaxLength` | number | `72` | Longer answers are truncated at a word boundary |
| `format.language` | string | `en` | ISO 639-1 |
| `behaviour.autoStage` | bool | `false` | |
| `behaviour.maxDiffLines` | number | `5000` | Above this the run is rejected |
| `behaviour.excludePatterns` | string[] | lockfiles, minified | Globs, matched at any depth |
| `behaviour.splitMaxCommits` | number | `10` | |
| `behaviour.confirmBeforeCommit` | bool | `true` | Set `false` to skip the final y/n |

### API key

Two options, in priority order:

1. `export COMMILOT_GEMINI_KEY="..."` — **recommended**, nothing secret ever reaches the repo.
2. `gemini.apiKey` in `.commitHelper.yml`. `commilot init` adds that file to `.gitignore` for you,
   and `commilot config get gemini.apiKey` masks the value when printing.

Get a free key at <https://aistudio.google.com/apikey>.

---

## Git hook

```bash
commilot hook install     # writes .git/hooks/prepare-commit-msg
```

A plain `git commit` (no `-m`) then opens your editor pre-filled with a Commilot message. The hook
skips merges, squashes, amends and `-m`/`-F` commits, and does nothing without a terminal.
`commilot hook uninstall` removes it — and refuses to touch a hook it did not create.

---

## How it works

```
config → provider → git diff → validate → prompt → AI → parse/repair → review → git add + commit
```

1. **ConfigLoader** merges `~/.commitHelper.yml`, `./.commitHelper.yml` and the defaults, validating
   with Zod.
2. **ProviderFactory** turns `provider:` into a concrete `AIProvider`.
3. **GitService** reads the diff (`simple-git`); untracked files are rendered as added-file diffs.
4. **DiffValidator** parses it (`parse-diff`), drops excluded and binary files and enforces
   `maxDiffLines`.
5. **PromptBuilder** builds provider-agnostic prompts within a token budget:

   | Changed lines | What is sent                                 |
   | ------------- | -------------------------------------------- |
   | ≤ 500         | the full diff                                |
   | 501 – 2000    | file stats + the first 10 lines of each hunk |
   | 2001 – 5000   | file names and stats only                    |
   | > 5000        | rejected                                     |

6. **ResponseParser** strips markdown fences, validates with Zod and repairs: unknown types map to
   the closest allowed one, over-long descriptions are truncated at a word boundary, duplicated file
   assignments keep their first group, and files the model forgot land in a fallback commit — so
   **no file is ever lost or committed twice**.
7. **ReviewUI** asks before anything is written.
8. **GitService** stages each group's files and commits.

### Providers

| Provider | Default model      | API key  | Notes                                       |
| -------- | ------------------ | -------- | ------------------------------------------- |
| `gemini` | `gemini-2.0-flash` | required | Default. Generous free tier                 |
| `openai` | `gpt-4o-mini`      | required | Chat Completions, JSON mode                 |
| `claude` | `claude-sonnet-5`  | required | Messages API, answer prefilled to bare JSON |
| `ollama` | `llama3.1`         | **none** | Runs locally — no code leaves your machine  |

Switching is one line:

```bash
commilot config set provider ollama     # persistent
commilot generate --provider claude     # just this run
```

Each provider keeps its own block, so several can be configured at once and you swap freely. The
prompt is identical for all four — only the transport differs.

Adding another means implementing a single interface (`generateCommitMessage`, `generateCommitPlan`,
`validateResponse`, `getProviderName`, `isConfigured`) — the pipeline and the prompts stay the same.

### Running fully offline with Ollama

```bash
ollama serve                 # start the local server
ollama pull llama3.1         # once per model
commilot config set provider ollama
commilot split --all
```

No API key, no network call, **no code sent to a third party** — the answer to the confidentiality
question below. Local models are slower and follow the JSON format less reliably than hosted ones,
which is what the response-repair layer above is for. Commilot tells you what to do if the server is
not running or the model is not installed.

---

## Exit codes

`0` on success or user cancellation, `1` on any error. Every failure prints an actionable message:

| Error                                                    | Message                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `NotGitRepoError`                                        | Not a git repository.                                        |
| `NoDiffError`                                            | No staged changes detected — stage something or use `--all`. |
| `DiffTooLargeError`                                      | Diff exceeds `behaviour.maxDiffLines`.                       |
| `MissingApiKeyError`                                     | Set `<provider>.apiKey` or `COMMILOT_<PROVIDER>_KEY`.        |
| `UnsupportedProviderError`                               | Lists available and upcoming providers.                      |
| `ApiAuthError` / `ApiRateLimitError` / `ApiTimeoutError` | What failed and what to do about it.                         |
| `MalformedResponseError`                                 | The AI answer could not be parsed; retry with `--verbose`.   |
| `ConfigValidationError`                                  | Which key is wrong.                                          |
| `GitOperationError`                                      | The underlying git failure.                                  |

---

## Development

```bash
npm install
npm run build        # tsup → dist/
npm test             # vitest (unit + e2e)
npm run coverage     # thresholds enforced at 80%
npm run lint
npm run typecheck
npm link             # use your local build as the global `commilot`
```

E2E tests run the built CLI as a subprocess against a fake provider server, so no API key or network
access is needed. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE).
