# pr-agent-reviewer

Local PR review runner that can use subscription-backed coding agents through the same basic shape as Zed: spawn an agent process, talk ACP or CLI, normalize findings, then print or post GitHub review comments.

## Quick start

```sh
npm test
npm run desktop
```

The desktop app starts its own internal local server and opens a native Electron
window.

For browser-only development:

```sh
npm run app
```

Open the local app URL printed by the server, usually:

```text
http://127.0.0.1:5173/?token=...
```

The app can read the selected local git workspace, detect the current branch,
infer the GitHub remote, and prefill the PR field when it finds an open PR for
that branch.

The CLI still works:

```sh
node ./bin/pr-agent-review.ts review owner/repo#123 --provider codex
```

Use `--post` to create GitHub review comments. The CLI requires `GITHUB_TOKEN`
with access to the target repo. The desktop app can save a GitHub token from
Advanced settings and reuses it for browsing repos, running reviews, and posting
comments.

```sh
GITHUB_TOKEN=... node ./bin/pr-agent-review.ts review owner/repo#123 --provider codex --post
```

## Providers

Default providers are built in:

- `codex`: ACP through an installed `codex-acp` command
- `claude`: ACP through an installed `claude-agent-acp` command
- `gemini`: generic CLI through an installed `gemini` command, with the review prompt sent on stdin

Copy `pr-agent-reviewer.config.example.json` to `.pr-agent-reviewer.json` to override commands, args, env, auth method, or timeout.

## Shape

```text
GitHub PR diff
  -> review prompt
  -> provider runner (ACP or CLI)
  -> JSON findings
  -> changed-line filter
  -> dry-run markdown or GitHub inline comments
```

The first version is intentionally local-runner first. That keeps vendor auth inside each user's installed agent/CLI instead of trying to proxy subscriptions through a hosted service.
