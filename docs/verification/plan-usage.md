# Subscription plan usage

Settings → Usage queries subscription allowance separately from the token/cost
ledger. Cursor reports its monthly allowance and Cursor/other model pools.
Antigravity reports each model pool's five-hour and weekly windows. Values and
reset times come from the provider; missing data must not become 100% remaining.

## Isolated renderer fixture

```sh
node --experimental-strip-types scripts/verify-plan-usage.ts
```

Open the printed `previewUrl`. The foreground launcher owns a disposable app
child and a temporary home/data directory. The real `PlanUsage` component calls
the real plan fetch/cache with synthetic credentials and intercepted provider
responses. No provider request or credential-file read can reach a real account.

Check these controls, then stop the launcher with Ctrl-C:

- **Normal quotas:** Cursor Pro shows 53% monthly remaining, 51% for Cursor
  models and 100% for other models. Antigravity Google AI Pro shows Gemini
  60%/80% and Claude/GPT 100%/40% for five-hour/weekly allowance. There is no
  fabricated shared Antigravity total or empty Cursor five-hour/weekly row.
- **Refresh:** forces another provider query. A plain GET to `/api/plan-usage`
  reuses the 45-second cache; `/__fixture/stats` exposes synthetic request counts.
- **Expired logins:** each provider shows its sign-in error with no quota bars.
- **Unavailable quotas:** each provider reports missing data without a 100% bar.
- **Older Antigravity API:** an unavailable summary endpoint falls back to a
  model quota (Gemini 25% remaining).
- **中文 / English:** translated headings, quota windows, remainders and refresh
  controls stay aligned. Capture a screenshot and check there are no page errors.

The focused tests use injected readers/fetchers only:

```sh
pnpm exec vitest run server/plan-usage.test.ts \
  server/plan-usage-cursor-antigravity.test.ts src/components/PlanUsage.test.ts
pnpm typecheck
pnpm lint
pnpm i18n:check
```

They cover native Linux/macOS/Windows Cursor credential storage, explicit
API-key account isolation, token expiry, Google per-instance profile isolation,
temporary token exchanges, partial provider failures, old quota responses and
credential redaction. The fixture proves presentation and refresh behavior;
real provider availability requires a separate read-only account query.
