# Cursor Agent CLI

Cursor is an optional OpenMausBot engine. OpenMausBot runs the official
[`cursor-agent` CLI](https://cursor.com/docs/cli) in ACP stdio mode (`cursor-agent acp`), so
sessions, streaming, coding tools, permission requests, MCP integrations,
resume, and cancellation use the same runtime as the other ACP engines.

Bots on this engine consume the user's Cursor subscription (or a
`CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN`), not a separate Anthropic/OpenAI/xAI
key.

## Setup

Docker images built from this repository install Cursor on demand. Open
**Settings → Engines → Cursor → Install Cursor on this server**, then
**Connect Cursor** for browser authorization. The panel resolves the current
package from Cursor's official installer and activates it only after extraction
and a version check. Installations, updates and credentials use the persistent
`/data` home. Neither image builds nor container startup download Cursor.
See [local Docker deployment](../deploy/local/README.md) for the optional
terminal command. Existing installations and explicit CLI overrides are kept.

Cursor also uses the normal engine status checks on page load, window focus,
and **Check again** to detect updates. Like Codex, successful release checks
are cached for one hour; failed checks retry after five minutes without
disabling the engine. The native read-only `cursor-agent about --format json`
query follows that Cursor home's configured release channel. When a new
version is found, the existing engine update notice offers the server update
button. A changed installed version or CLI path invalidates the cached result.

For an installation outside those Docker images:

1. Install Cursor CLI:

   ```sh
   curl https://cursor.com/install -fsS | bash   # macOS / Linux
   ```

   Windows (native): `irm 'https://cursor.com/install?win32=true' | iex`

2. Open **Settings → Engines → Cursor → Connect Cursor**, follow the official
   browser authorization link, and return to the page. The server polls for
   completion; no localhost callback or pasted code is needed. Alternatively,
   run `cursor-agent login`, or set `CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` in the
   environment of the Cursor instance.

3. Confirm `cursor-agent --version` works. Cursor's docs call the command `agent`;
   the installer adds `cursor-agent` beside it, and OpenMausBot runs that name,
   because other tools also install an `agent`. The binary installs to
   `~/.local/bin` by default (`%LOCALAPPDATA%\cursor-agent` on Windows);
   OpenMausBot already looks in both, so a CLI installed while the app is open
   is found without restarting.

The engine stays unavailable until the `cursor-agent` executable is found. A
missing login shows as unauthenticated rather than crashing the fleet.

## Updates from Settings

Expand **CLI path and updates** and choose **Update Cursor on this server**.
OpenMausBot runs only the fixed native `cursor-agent update` command, with a
deadline, and refreshes the version and model catalog after success. Active
Cursor tasks must finish before updating; other engines continue running.
The native updater uses its configured release channel and writes into the
server user's `~/.local` directory. All Cursor probes and ACP sessions prefer
that updated shim over a system installation. Docker maps HOME to `/data`, so
updates and credentials survive container recreation. Explicit CLI overrides
remain pinned and do not offer this update button.

## Models

The picker starts from a small static catalog and refreshes from plain
`cursor-agent models` output (`slug - Label`, with `(default)` / `(current)` markers).
Live ids are merged into the main cloud rail (not the local-models pane). A
failed listing keeps the last usable catalog (then the static fallback) rather
than emptying the rail.

`--model <id>` is passed as a global CLI flag before `acp`. When the running
CLI also implements ACP `session/set_model`, OpenMausBot pins the same id over
the wire. If that method is missing (`-32601`), the argv pin is left to stand
and the turn continues.

## Autonomy

For compatibility with direct driver embedders, an instance `fullAuto: true`
adds `--force` (the CLI's documented auto-approve switch) only when a turn
does not provide a bot approval level. OpenMausBot app turns always provide
one: both **Ask for approval** and **Approve for me** launch Cursor without
`--force`, then OpenMausBot handles its permission requests according to the
bot's current level.

## What this driver does not do yet

- Cursor ACP extension methods (`cursor/ask_question`, `cursor/create_plan`,
  todos/tasks/images) are not given a dedicated UI. Unknown JSON-RPC requests
  are rejected with method-not-found so the CLI is not left blocked.
- MCP servers passed in `session/new` follow Cursor's ACP limitations; prefer
  project or user `.cursor/mcp.json` where needed.
- Live smoke (`cursor-agent login`, `cursor-agent models`, one real turn) should be run on
  a machine with the CLI installed and signed in before relying on this in
  production.

## Testing

Normal unit and ACP protocol tests use the scripted fake CLI and do not
require a Cursor subscription. Do not print credentials or upload native
protocol logs from a credentialed live run.
