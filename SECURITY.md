# Security Policy

## Supported versions

The latest release on `main` is supported. Older versions receive no fixes.

## Reporting a vulnerability

Do **not** open a public issue for a security problem.

Use GitHub's private reporting: **Security → Report a vulnerability** on
<https://github.com/elsycharles/commilot/security/advisories/new>.

Please include what an attacker can do, the steps to reproduce, and the version and platform you
tested. You will get a first answer within 7 days.

## What Commilot does with your data

Worth knowing before you report, and before you use it on sensitive code:

- **The diff is sent to the configured AI provider.** With `gemini`, `openai` or `claude`, the
  content of your changed files leaves your machine. With `ollama`, nothing does.
- **Files matching `behaviour.excludePatterns` are stripped before the request.** Add `.env*` and
  anything else confidential to that list.
- **API keys** are read from `COMMILOT_<PROVIDER>_KEY` or from `.commitHelper.yml`. `commilot init`
  adds that file to `.gitignore`, and `commilot config get` masks the value. Keys are never logged,
  including with `--verbose`.
- **Commilot runs `git` commands** in the current repository: `add`, `commit`, `reset HEAD`. It
  never pushes, never rewrites history, and never touches a remote.
