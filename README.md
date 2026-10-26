# opencode-plugins

Custom [OpenCode](https://opencode.ai) plugins shared across my machines.
Each plugin lives in its own directory under `plugins/`.

| Plugin | Tools | What it does |
|---|---|---|
| [`sessions`](plugins/sessions/) | `sessions_list`, `sessions_get` | Read-only access to past OpenCode sessions |

## Install

Not published to npm (deliberately). Install by cloning and linking the
variant that matches your OpenCode version.

### OpenCode 2

The V2 plugin implements the V2 plugin API and has no npm dependencies.

```console
git clone https://github.com/flapperdeflipper/opencode-plugins.git
cd opencode-plugins
ln -s "$PWD/plugins/sessions/v2/sessions.js" ~/.config/opencode/plugins/sessions.js
```

`~/.config/opencode/plugins/` (plural) is V2's global auto-discovery directory;
a direct `.js` file there loads without a config entry.

### OpenCode 1

The V1 plugin imports `@opencode-ai/plugin`, so install the dependency first.

```console
git clone https://github.com/flapperdeflipper/opencode-plugins.git
cd opencode-plugins && npm install
ln -s "$PWD/plugins/sessions/sessions.js" ~/.config/opencode/plugin/sessions.js
```

Use `~/.config/opencode/plugin/` (singular) for V1. A V1 plugin does not run in
OpenCode 2, and a V2 plugin does not run in OpenCode 1.

Plugins load at OpenCode startup. V2 watches its config directories and reloads
changes automatically; restart `opencode serve` if a change does not appear.

## Plugins

### sessions

Two implementations:

- [V1](plugins/sessions/sessions.js) — uses the SDK client OpenCode 1 hands to
  plugins (`session.list` / `session.messages`).
- [V2](plugins/sessions/v2/sessions.js) — implements the OpenCode 2 plugin API.
  It prefers `ctx.session.list` when the runtime exposes it (2.1+) and otherwise
  reads the local OpenCode SQLite database read-only for the list; transcripts
  always use the public `ctx.session` API.

Both expose the same tools:

- `sessions_list(query?, limit?)` — list sessions (id, title, model, last
  update, directory), optionally filtered by a case-insensitive substring
  against title and directory. The current session is marked.
- `sessions_get(session_id, limit?)` — transcript of one session: role,
  timestamp and text per message, `[tool: name]` markers for tool calls.
  Reasoning parts and diffs are skipped. When truncated, the most recent
  messages are kept and the omission is noted.

The V1 implementation targets `@opencode-ai/plugin` 1.17–1.18. The V2
implementation targets the OpenCode 2 plugin API (verified against 2.0.29).
