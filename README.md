# Commilot

> _commit + copilot_

Writes your commit messages, and **splits a large diff into several clean commits**.

Runs locally on [Ollama](https://ollama.com): **no API key, no quota, your code never leaves your machine.**

```
$ commilot split

  ┌── Commit Plan (3 commits) ──────────────────────────────────────┐
  │                                                                 │
  │   1. feat(auth) - add auth middleware to protect routes         │
  │      A  src/middleware/auth.js  (+42)                           │
  │                                                                 │
  │   2. feat(api) - add users endpoint                             │
  │      A  src/routes/users.js  (+28)                              │
  │                                                                 │
  │   3. dev(config) - tighten eslint rules                         │
  │      M  .eslintrc.json  (+8, -4)                                │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘

  ? Review commit 1/3: ❯ Accept · Edit · Merge with next · Skip · Cancel
```

---

## 1. Install

**Ollama** (once):

```bash
brew install ollama          # or: https://ollama.com/download
ollama serve                 # leave it running in a terminal
ollama pull llama3.1         # ~5 GB, once
```

**Commilot**:

```bash
git clone https://github.com/elsycharles/commilot
cd commilot
npm ci && npm run build
npm link                     # makes `commilot` available everywhere
```

> Would rather not `npm link`? Use the full path instead:
> `node /path/to/commilot/dist/index.js` — everything works the same.

Check it:

```bash
commilot --version
commilot providers           # ollama should say "Ready"
```

---

## 2. Use it

No configuration needed. In any git repository:

### One message for what you staged

```bash
git add .
commilot generate
```

### Split your work into several commits

```bash
commilot split
```

Commilot reads **all** your changes, groups them by subject, and proposes one commit per group. You review each one before it is created.

### Look without creating anything

```bash
commilot generate --dry-run
commilot split --dry-run
```

The recommended first move. The answer is cached for an hour, so the real run right after is instant.

---

## 3. During the review

| Choice              | What it does                               |
| ------------------- | ------------------------------------------ |
| **Accept**          | creates the commit                         |
| **Edit**            | fix the type, the scope or the description |
| **Regenerate**      | ask for another proposal _(generate)_      |
| **Merge with next** | fold into the next commit _(split)_        |
| **Skip**            | leave those files alone _(split)_          |
| **Cancel**          | abort everything, nothing is created       |

**Nothing is ever committed without your say-so.** And if a `split` fails midway, Commilot prints the exact command to undo it.

---

## 4. Change the model

Every Ollama model works. See yours with `ollama list`.

```bash
# for a single run
commilot generate --model qwen2.5-coder:7b

# permanently
commilot config set ollama.model qwen2.5-coder:7b
```

Some reference points:

| Model              | Size  | Notes                           |
| ------------------ | ----- | ------------------------------- |
| `llama3.1`         | ~5 GB | default, good balance           |
| `qwen2.5-coder:7b` | ~5 GB | better at splitting and at code |
| `llama3.2:3b`      | ~2 GB | faster, less precise            |

A local model is less precise than a hosted one: you will sometimes see a `misc` commit holding whatever it could not classify. **No file is ever lost** — that part is guaranteed, unlike the quality of the split.

---

## 5. Fit it to your project

```bash
commilot init
```

Creates `.commilot.yml` (and adds it to your `.gitignore`). The setting worth your time is **your** scopes:

```yaml
provider: ollama

ollama:
  model: llama3.1
  temperature: 0.3 # lower = more predictable

format:
  template: '{type}({scope}) - {description}'
  types: [dev, feat, bug] # or [feat, fix, chore, docs]
  scopes: [auth, api, ui] # ⚠️ yours — empty means the AI invents them
  descriptionMaxLength: 72
  language: en # commit messages in this language

behaviour:
  excludePatterns:
    - 'package-lock.json'
    - '.env*' # ⚠️ keep this if you enable a hosted provider
    - '*.min.js'
  splitMaxCommits: 10
  confirmBeforeCommit: true
  cacheMinutes: 60 # reuse the answer for an identical diff
```

Filling in `scopes` is what improves message quality the most. Without that list, every commit invents its own vocabulary.

---

## 6. All the commands

| Command                            | What it does                           |
| ---------------------------------- | -------------------------------------- |
| `commilot generate`                | one message for the staged changes     |
| `commilot split`                   | split all changes into several commits |
| `commilot init`                    | create `.commilot.yml`                 |
| `commilot config get\|set\|list`   | read or change the configuration       |
| `commilot providers`               | state of each backend                  |
| `commilot hook install\|uninstall` | wire Commilot into `git commit`        |

**Useful options**

| Option               | What it does                                     |
| -------------------- | ------------------------------------------------ |
| `--dry-run`          | show without creating anything                   |
| `--all`              | include unstaged files (the default for `split`) |
| `--staged`           | staged only (the default for `generate`)         |
| `--model <name>`     | use another model for this run                   |
| `--type` / `--scope` | force the type or the scope                      |
| `--max-commits <n>`  | cap the number of commits                        |
| `-y, --yes`          | accept without reviewing                         |
| `--no-cache`         | force a fresh call                               |
| `--verbose`          | show what is going on                            |

---

## 7. When something goes wrong

| Message                                  | What to do                                                   |
| ---------------------------------------- | ------------------------------------------------------------ |
| `No staged changes detected`             | `git add` first, or use `--all`                              |
| `Cannot reach Ollama…`                   | run `ollama serve`                                           |
| `Ollama does not have the model 'x'`     | `ollama pull x`                                              |
| `Interactive review requires a terminal` | add `--yes` or `--dry-run`                                   |
| `Diff exceeds maximum size`              | commit some of it by hand, or raise `behaviour.maxDiffLines` |

Add `--verbose` to see the exchange with the model.

---

## 8. Using a hosted model _(optional)_

Gemini, ChatGPT and Claude are implemented but **switched off**: each needs an API key, comes with a quota, and sends your diff to a third party. Ollama avoids all three.

To turn one on anyway:

```bash
commilot config set gemini.enabled true
export COMMILOT_GEMINI_KEY="your-key"
commilot generate --provider gemini
```

| Provider | Default model      | Key                           |
| -------- | ------------------ | ----------------------------- |
| `ollama` | `llama3.1`         | none — **enabled by default** |
| `gemini` | `gemini-2.0-flash` | `COMMILOT_GEMINI_KEY`         |
| `openai` | `gpt-4o-mini`      | `COMMILOT_OPENAI_KEY`         |
| `claude` | `claude-sonnet-5`  | `COMMILOT_CLAUDE_KEY`         |

The prompt is identical for all four; only the transport differs.

**If you enable a hosted provider**, your diff leaves your machine. Check that this is allowed for that code, and keep `.env*` in `excludePatterns`.

---

## How it works

```
config → provider → git diff → validation → prompt → AI → parsing → review → commit
```

Worth knowing:

- **Nothing is lost.** If the model forgets files, they land in a fallback commit instead of being dropped. If a file is listed twice, only the first assignment counts.
- **Ollama is driven with a JSON schema.** Without it, a local model answers a single object where an array is needed, and the split collapses.
- **Large diffs are summarised** rather than cut at random: the full diff up to 500 changed lines, shortened hunks up to 2000, file statistics beyond that, refused past 5000.
- **API keys are never logged**, not even with `--verbose`, and `config get` masks them.

---

## Development

```bash
npm test           # 251 tests
npm run coverage   # thresholds at 80%
npm run lint && npm run typecheck
```

Tests never call a real API: a fake server replays each backend's responses. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE).
