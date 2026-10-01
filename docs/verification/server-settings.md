# Server provider sign-in and custom domain

Use an isolated fixture only. Never change the running user's provider account,
domain, or configuration to verify these controls.

## Automated checks

```sh
pnpm exec vitest run server/custom-domain.test.ts server/provider-auth-sessions.test.ts server/drivers/codex-device-auth.test.ts server/request-auth.test.ts server/config.test.ts src/components/CodexDeviceSignIn.test.ts src/components/CustomDomainSettings.test.ts src/components/EngineSetup.test.ts src/components/EnginesSettings.test.ts
pnpm exec vitest run server/drivers/cursor-install.test.ts server/drivers/cursor-auth.test.ts server/drivers/cursor-release.test.ts server/drivers/acp/cursor.test.ts src/components/CursorSignIn.test.ts
pnpm typecheck
pnpm build
pnpm build:server
node scripts/smoke-packaged-server.mjs
```

The domain helper tests substitute DNS and HTTPS responses. They check public
address restrictions, pinned DNS, TLS options, redirects, deadlines, bounded
responses, the workspace identity, and the independent one-time proof. They do
not prove a customer's real DNS, certificate, or reverse proxy is configured.

## Real Settings UI with an offline provider

1. Follow the [fixture launcher](README.md#launch), retaining its printed URL,
   temporary data directory and persistent log path. Run Doctor against that
   explicit URL.
2. Start Vite on a separate free port with `OMB_PORT` set to the printed harness
   port. Do not let it proxy to the default port or the user's live app.
3. For domain UI, open Settings → Remote access → Connect your domain. Enter
   `bots.example.com`: confirm the Type/Name/Value rows and that copy buttons do
   not submit the form. Technical guidance must remain collapsed under
   **Advanced server setup**. The launcher deliberately strips operator
   environment variables. To test the copyable IP in browser automation,
   intercept only the fixture's GET `/api/settings/custom-domain` response and
   supply `serverIpv4: "8.8.8.8"`, preserving its other fields. Never point DNS
   at this synthetic address or intercept verification POSTs. Public-interface
   detection and the `OMB_PUBLIC_IPV4` override are covered by the helper tests.
   Without a public interface or override, confirm the UI asks the administrator
   for the IP and does not offer a fake value to copy. Expand the advanced guide
   and confirm its app and webhook ports match the fixture. Submit
   `http://bots.example.com` and confirm HTTPS validation appears without
   changing the current address. The real API must likewise reject localhost,
   IP addresses, and URLs containing pairing codes.
   At a 390px viewport, Settings uses a section dropdown instead of the sidebar.
   Switch sections, copy a DNS value, and confirm the form remains readable.
   Tab and Shift-Tab must stay inside the dialog, skipping the hidden sidebar
   and links inside the collapsed advanced guide.
4. To exercise Codex, add an instance to **only the fixture's config.json**:
   driver `codex`, CLI set to the absolute path of
   `server/testing/fake-codex-login-cli.ts`, environment
   `OMB_DEVICE_AUTH_FIXTURE=1`, `HOME` set to the fixture's temporary directory,
   and `CODEX_HOME` set to its `.codex` subdirectory. Reload that isolated
   provider registry and refresh the preview. Never substitute the real Codex
   executable. The fixture requires an explicit opt-in and makes no network
   requests.
5. Settings → Engines → Connect ChatGPT should display `TEST-12345`, the
   official link, expiry, and Cancel. **Do not enter the fake code at OpenAI.**
   Cancel and restart, then switch Settings sections and return; Connect should
   recover the same active flow without spawning a second login.
6. Create the empty `.omb-fake-codex-login-approved` marker in the fixture's
   temporary HOME. The offline process records a fake signed-in state. Confirm
   the real Settings UI changes to “ChatGPT connected on this server.”
7. Stop the Vite process and interrupt the foreground fixture launcher. Only
   its owned child and disposable data are removed; retain the printed log.

For deployment acceptance, separately test an actual public domain and an
owner-initiated real provider sign-in. A green offline run must not be reported
as a real OpenAI account login or proof of public DNS/TLS reachability.

## Cursor browser sign-in and native updates

Use the same isolated launcher. In its temporary data directory create a
`cursor-home/.local/bin/cursor-agent` symlink to the absolute path of
`server/testing/fake-cursor-login-cli.ts`. Add a `cursorAgent` instance to only
that fixture's `config.json`, with `HOME` set to `cursor-home` and
`OMB_CURSOR_AUTH_FIXTURE=1`. Keep the default CLI so the persisted native shim
is selected. Refresh the fixture's in-memory config with a PATCH to
`/api/config` containing its existing `defaultModelSelection`, then PATCH
`/api/instances/cursor` with `{ "cli": "" }` to reload that instance. Refresh
the engine statuses before opening the card.

Open the actual Settings → Engines → Cursor card. Connect shows an official
Cursor challenge link and Cancel, with no callback input or device-code field.
The same card must show **Update Cursor to 2026.09.30-offline** automatically,
without clicking Check again. The notice uses the existing server update
button and must not display the private email from the native `about` payload.
**Do not open the fake link at Cursor.** Cancel, start again, and create the
empty `.omb-fake-cursor-login-approved` marker in `cursor-home`. The card must
move to Ready after polling. Update from the notice; the fake
version must change from `2026.09.28-offline` to `2026.09.30-offline` and remain
selected after reloading the fixture providers. The update notice must disappear
immediately after the version changes, and CLI path and updates must retain
the manual update button. None of this proves a real
Cursor account login or downloads a real update.

The persisted-shim regression in `server/drivers/acp/cursor.test.ts` uses a
separate temporary HOME with the default CLI name. It checks that availability,
authentication and update probes resolve the same native shim as turns do.

## Cursor first installation from the panel

Keep the fixture's isolated home empty, and run the fixture in an image with no
Cursor CLI on PATH (the `before-cursor` local verification image is suitable).
Add a default `cursorAgent` instance only to this disposable config. The real
Settings card must offer **Install Cursor on this server**. Before clicking,
refresh the page and verify that no Cursor download or installation occurs.
Click Install: verify that the version is available and **Connect Cursor**
replaces the install control without restarting the fixture. This acceptance
step intentionally downloads the public official package, never signs into a
real account, and must use an isolated home or disposable Docker volume.
Recreate that fixture container with the same disposable home and verify the
installation persists. Remove only that fixture container and its own volume.
