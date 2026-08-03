# Commilot

> Writes your git commit messages, and splits a large diff into several clean commits — locally, with no API key.

Commilot reads your changes, groups the related ones together, and proposes one commit per
group. You review each one before anything is written. It runs on [Ollama](https://ollama.com) on
your own machine: no account, no quota, and your code is never sent anywhere.

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

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [Choosing a model](#choosing-a-model)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Contributing](#contributing)
- [Licence](#licence)

## Background

Most AI commit tools write one message for everything you have staged, and send your diff to a
hosted service. Commilot does neither.

Its point is **splitting**: after an hour of work touching three unrelated things, it proposes three
commits instead of one vague message. And because it runs against a local model, using it on private
or client code raises no question about where that code went.

## Install

Commilot needs two things: **Ollama** (the local model runner) and **Node.js 20 or newer**.

### 1. Ollama

<details open>
<summary><b>macOS</b></summary>

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Or download [Ollama.dmg](https://ollama.com/download/Ollama.dmg). The app starts the server for you.

</details>

<details>
<summary><b>Linux</b></summary>

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

The installer sets up a systemd service. If it is not running:

```bash
ollama serve
```

</details>

<details>
<summary><b>Windows</b></summary>

```powershell
irm https://ollama.com/install.ps1 | iex
```

Or download [OllamaSetup.exe](https://ollama.com/download/OllamaSetup.exe). Ollama runs in the
background once installed. Commilot works in PowerShell, in Git Bash and in WSL.

</details>

Then pull a model, once (about 5 GB):

```bash
ollama pull llama3.1
```

### 2. Commilot

```bash
git clone https://github.com/elsycharles/commilot
cd commilot
npm ci
npm run build
npm link
```

`npm link` makes `commilot` available from any directory. If you would rather not, skip it and call
the built file directly — everything below works the same:

```bash
node /path/to/commilot/dist/index.js generate      # macOS, Linux, WSL, Git Bash
node C:\path\to\commilot\dist\index.js generate    # Windows PowerShell
```

### 3. Check it

```bash
commilot --version
commilot providers     # should print: ollama … Ready — no API key needed
```

## Usage

No configuration is required. In any git repository:

### Write one commit message

```bash
git add .
commilot generate
```

`generate` looks at what you have **staged** — the same thing `git diff --staged` shows. If you get
`No staged changes detected`, either `git add` first or pass `--all`.

### Split your work into several commits

```bash
commilot split
```

`split` looks at **everything**: staged, unstaged and untracked. It proposes a plan, you review each
commit, and it creates them one by one.

### Preview without touching anything

```bash
commilot generate --dry-run
commilot split --dry-run
```

Worth making a habit of. The answer is cached for an hour, so the real run straight after is
instant.

### Reviewing

| Choice              | What it does                                 |
| ------------------- | -------------------------------------------- |
| **Accept**          | create the commit                            |
| **Edit**            | change the type, scope or description        |
| **Regenerate**      | ask for a different proposal _(generate)_    |
| **Merge with next** | fold this commit into the next one _(split)_ |
| **Skip**            | leave these files alone _(split)_            |
| **Cancel**          | abort; nothing is created                    |

Nothing is committed without your say-so. If a `split` fails halfway through, Commilot prints the
exact `git reset` command to undo what it created.

### Every command

| Command                            | What it does                                 |
| ---------------------------------- | -------------------------------------------- |
| `commilot generate`                | one message for the staged changes           |
| `commilot split`                   | split all changes into several commits       |
| `commilot init`                    | create `.commilot.yml`                       |
| `commilot config get\|set\|list`   | read or change the configuration             |
| `commilot providers`               | show the backend and how to change the model |
| `commilot hook install\|uninstall` | wire Commilot into plain `git commit`        |

| Option                              | What it does                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| `--dry-run`                         | show the proposal, change nothing                          |
| `--all`                             | include unstaged and untracked files (default for `split`) |
| `--staged`                          | staged only (default for `generate`)                       |
| `--model <name>`                    | use another model, just for this run                       |
| `--type <type>` / `--scope <scope>` | force the type or the scope                                |
| `--max-commits <n>`                 | cap how many commits `split` proposes                      |
| `-y, --yes`                         | accept without the interactive review                      |
| `--no-cache`                        | ask the model again instead of reusing an answer           |
| `--verbose`                         | show what is being sent and received                       |

## Configuration

```bash
commilot init
```

This creates `.commilot.yml` and adds it to your `.gitignore`. Everything in it is optional —
Commilot works without the file.

```yaml
provider: ollama

ollama:
  model: llama3.1
  temperature: 0.3 # lower = more predictable

format:
  template: '{type}({scope}) - {description}'
  types: [dev, feat, bug]
  scopes: [auth, api, ui] # yours; empty means the model invents them
  descriptionMaxLength: 72
  language: en # ISO 639-1; see below

behaviour:
  autoStage: false
  maxDiffLines: 5000 # refuse anything larger
  excludePatterns:
    - 'package-lock.json'
    - '*.min.js'
  splitMaxCommits: 10
  confirmBeforeCommit: true
  cacheMinutes: 60 # reuse the answer for an identical diff; 0 disables
```

**Filling in `scopes` is the single change that improves messages the most.** Without that list,
every commit invents its own vocabulary.

`language` is an [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes) code —
`en`, `fr`, `es`, `de`… It is passed to the model as an instruction, so it applies to the
description and to any free-text field you define:

```yaml
language: fr # feat(auth) - ajouter le rafraîchissement du jeton
```

It deliberately does **not** touch `type`, `scope`, or a field restricted with `values`: those are
identifiers you chose, and translating them would break the constraint they express. It is also a
request to the model, not a guarantee — a small local model will occasionally answer in English
anyway.

### The message template

`format.template` accepts **any placeholder you like**. Three are filled by Commilot:

| Placeholder     | Filled with                                     |
| --------------- | ----------------------------------------------- |
| `{type}`        | one of `format.types`                           |
| `{scope}`       | one of `format.scopes`, or one the model infers |
| `{description}` | the summary, capped at `descriptionMaxLength`   |

Arrange them freely, repeat them, put any text around them:

```yaml
template: '{type}({scope}) - {description}' # feat(auth) - add login
template: '[{type}/{scope}] {description}' # [feat/auth] add login
template: '{description} ({scope}) :: {type}' # add login (auth) :: feat
```

### Your own fields

Any other placeholder becomes a field the model has to produce. Tell it what the
field means under `format.fields`:

```yaml
format:
  template: '{summary} ({title}) : {type} {reason} | {area}'
  fields:
    title:
      description: 'a short Title Case name for the change'
    summary:
      description: 'a one-line summary'
      maxLength: 40
    reason:
      description: 'why the change was needed'
    area:
      description: 'the part of the system touched'
      values: [frontend, backend, infra] # restrict the answer to this list
```

produces, for a real diff:

```
add login call (Login Endpoint) : feat to authenticate users | backend
```

| Key           | Effect                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `description` | what the model is asked to write. **The setting that matters** — without it, only the field name is a hint |
| `values`      | restrict the answer to a list; a near miss is corrected, anything else is kept with a warning              |
| `maxLength`   | truncate at a word boundary                                                                                |

Fields are editable in the review, one prompt each, with your allowed values
offered as a list.

If the model leaves a field blank, the message is still produced: the empty value
is dropped along with any brackets that surrounded it, so `{type}({scope}) [{ticket}]`
gives `feat(auth)` rather than `feat(auth) []`.

Every field costs the model a little attention. A template with eight fields will
be answered less precisely than one with three — especially by a small local model.

## Choosing a model

Any model you have pulled works. List yours with `ollama list`.

```bash
commilot generate --model qwen2.5-coder:7b        # this run only
commilot config set ollama.model qwen2.5-coder:7b # from now on
```

| Model              | Size  | Notes                           |
| ------------------ | ----- | ------------------------------- |
| `llama3.1`         | ~5 GB | the default; a good balance     |
| `qwen2.5-coder:7b` | ~5 GB | better at code and at splitting |
| `llama3.2:3b`      | ~2 GB | faster, less accurate           |

A local model is less precise than a hosted one. You will sometimes see a `misc` commit holding
whatever it could not classify. **No file is ever lost** — that part is guaranteed; the quality of
the grouping is not.

## Troubleshooting

| Message                                  | What to do                                                   |
| ---------------------------------------- | ------------------------------------------------------------ |
| `No staged changes detected`             | run `git add` first, or use `--all`                          |
| `Cannot reach Ollama…`                   | start it: `ollama serve`                                     |
| `Ollama does not have the model 'x'`     | `ollama pull x`                                              |
| `Interactive review requires a terminal` | add `--yes`, or `--dry-run` to preview                       |
| `Diff exceeds maximum size`              | commit part of it by hand, or raise `behaviour.maxDiffLines` |
| `Not a git repository`                   | run it from inside a repository                              |

Add `--verbose` to any command to see the exchange with the model.

## How it works

```
config → git diff → validation → prompt → model → parsing → your review → commit
```

Four things worth knowing:

- **Nothing is lost.** If the model forgets files, they go into a fallback commit rather than being
  dropped. If it lists a file twice, only the first group keeps it.
- **The model is constrained by a JSON schema.** Without it, a local model answers a single object
  where a list of commits is needed, and the split collapses into one group.
- **Large diffs are summarised, not truncated at random**: the full diff up to 500 changed lines,
  shortened hunks up to 2000, file statistics beyond that, refused past 5000.
- **Answers are cached for an hour** against the exact diff, so previewing then committing costs one
  model call rather than two.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the layout, the
branch model and the testing rules. Security reports go through
[SECURITY.md](SECURITY.md), not public issues.

```bash
npm test           # unit and end-to-end
npm run coverage   # thresholds at 80%
npm run lint && npm run typecheck
```

Tests never call a real model: a fake server replays recorded responses, so the suite runs offline
in a few seconds.

## Licence

MIT © Elsy Charles — see [LICENSE](LICENSE).
