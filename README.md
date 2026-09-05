# opencode-plugins

Custom [OpenCode](https://opencode.ai) plugins shared across my machines.
Each plugin lives in its own directory under `plugins/`.

| Plugin | Tools | What it does |
|---|---|---|
| [`sessions`](plugins/sessions/) | `sessions_list`, `sessions_get` | Read-only access to past OpenCode sessions |

## Install

Not published to npm (deliberately). Install by cloning and linking or
copying the plugin files:

```console
git clone https://github.com/flapperdeflipper/opencode-plugins.git
cd opencode-plugins
npm install        # provides @opencode-ai/plugin to the plugins
```

Then for each plugin you want, **symlink** it into OpenCode's global plugin
directory (`~/.config/opencode/plugin/` — `plugins/` on some versions):

```console
ln -s "$PWD/plugins/sessions/sessions.js" ~/.config/opencode/plugin/sessions.js
```

or **copy** it there instead if you prefer a snapshot over tracking the repo:

```console
cp plugins/sessions/sessions.js ~/.config/opencode/plugin/
```

Plugins load at OpenCode startup: new sessions pick them up immediately; a
long-running `opencode serve` process adopts them on its next restart.

### Requirements

The plugins import `@opencode-ai/plugin`. That package must be resolvable
from wherever the plugin file ends up — `npm install` in this clone covers
symlinked installs; for copied installs add the dependency to the
`package.json` in your OpenCode config directory instead:

```console
cd ~/.config/opencode && npm install @opencode-ai/plugin
```

## Plugins

### sessions

Gives every OpenCode agent read-only access to previous sessions, via the
SDK client OpenCode hands to plugins (`session.list` / `session.messages`) —
no MCP, no direct database access.

- `sessions_list(query?, limit?)` — list sessions (id, title, model, last
  update, directory), optionally filtered by a case-insensitive substring
  against title and directory. The current session is marked.
- `sessions_get(session_id, limit?)` — transcript of one session: role,
  timestamp and text per message, `[tool: name]` markers for tool calls.
  Reasoning parts and diffs are skipped. When truncated, the most recent
  messages are kept and the omission is noted.

Developed against `@opencode-ai/plugin` 1.17–1.18.
