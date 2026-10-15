# Engines and Doctor

## Sub-features

- Confirm the endpoint identifies itself as OpenMausBot.
- List configured provider instances without exposing executable paths.
- Distinguish available and unavailable engines.
- Add named Claude accounts and select them independently for bots.

## User path

Open a bot's model picker or Settings → Engines.

## Driving it

```sh
pnpm control:omb doctor --url http://127.0.0.1:PORT
pnpm control:omb models --url http://127.0.0.1:PORT
```

`doctor.ok` is true only when the endpoint is OpenMausBot and at least one
engine is available. The isolated fixture should expose `claude`.

## Named Claude accounts

Run the offline API fixture and driver regressions:

```sh
pnpm exec vitest run server/claude-account-api.test.ts server/claude-accounts.test.ts server/drivers/claude-accounts.test.ts
```

The API fixture launches its own disposable server and synthetic CLI. It checks
account creation, isolated directories, safe auth-status metadata, persistence,
directory/history guards, removal, malformed-account repair, and admin-only
mutations. Updating an idle sibling must preserve the busy bot's process and
subsequent events. No real provider login is required.

For a renderer check, open the isolated launcher's app in a browser, dismiss
onboarding, and go to **Settings → Engines**. Add Work and Personal, inspect
their distinct sign-in commands, and select one account per bot from the model
picker's single Claude entry and nested Account dropdown. Choose a model to
save the selection. Reload and revisit both bots. Confirm the account labels persist,
including at narrow window widths. Use synthetic accounts only; this does not
prove real OAuth login or native Windows execution.

## Gotchas

- Doctor proves server/engine readiness, not authentication against a real
  provider.
- Model-picker rendering is Electron UI and remains outside this first map.

## ChatGPT account sign-in types

Settings → Model providers → Add another ChatGPT account offers **Codex 设备码登录**
and **ChatGPT plan**. The selected type is explicit in the creation request;
neither a failed creation nor a failed sign-in changes it.

```sh
pnpm exec vitest run server/chatgpt-plan-api.test.ts server/plan-usage.test.ts server/drivers/codex.test.ts server/drivers/codex-device-auth.test.ts src/components/ChatGptPlanSignIn.interaction.test.ts src/components/EnginesSettings.test.ts
```

The disposable HTTP fixture creates two device-code accounts through an
authenticated proxy request, holds their synthetic CLI logins independently,
discovers models, completes one turn per account, signs one out, and restarts
the server with the other still signed in. The original default Codex login
must stay untouched. Quota tests assert that each explicit account reads its
own credential path and does not substitute the default login when missing.
Existing browser PKCE flow ownership, cancellation, and proxy refusal are also
covered. Renderer interaction tests check the exact labels, explicit request
type, and preserving a selection after a failed request.

These checks use a fake CLI, synthetic credentials, and a temporary HOME/data
directory. They do not verify real OpenAI authorization or real account model
access. ChatGPT plan retains its browser authorization flow and hosted-app
approval requirement for remote sign-in; device-code accounts use native
Codex models and quota.

## Groq API setup

```sh
pnpm exec vitest run server/drivers/groq.test.ts server/provider-key-check.test.ts server/config.test.ts server/openai-tools.e2e.test.ts src/components/ApiKeys.test.ts src/state/store.test.ts
```

These fixtures use disposable data and local HTTP providers. They check the
preset endpoint, write-only key status, model discovery, selection, streaming
usage, tool approval/denial/cancellation, and clearing the key. They never call
Groq or verify a real account's quota, model access, or inference.

For a renderer check, use an isolated server with a synthetic Groq endpoint.
Open **Settings → API keys**, paste its fixture key, and check that **Test**
reports catalog reachability without claiming chat authentication. Select a
Groq model in the bot's picker, send a fixture turn, then clear the key and
confirm the engine is unavailable. Never use the live app or a real key for
this recipe.

## Meta Muse: Model API and Muse Code

```sh
pnpm exec vitest run server/drivers/meta.test.ts server/drivers/muse-code.test.ts server/provider-key-check.test.ts server/config.test.ts server/openai-tools.e2e.test.ts src/components/ApiKeys.test.ts src/state/store.test.ts
```

The Meta Model API fixtures use a local HTTP provider: preset endpoint,
write-only key, the account's own model list (Muse Wonder becomes the default
once listed), streaming usage and tool approval. They never call Meta.

Muse Code has a live check against the real CLI, signed in on this machine
with `muse login`. It spends that account's Muse usage, so it runs only when
asked:

```sh
OMB_LIVE_MUSE=1 pnpm exec vitest run server/drivers/muse-code.live.test.ts
```

It lists the account's models (Muse Wonder 1.0), answers on Muse Wonder, runs
a shell command as a tool step, and resumes the session on a fresh instance
after the first one is gone, the way an app restart does.
