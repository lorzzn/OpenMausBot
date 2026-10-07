import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { antigravityProfileDirectory } from "./drivers/antigravity-acp.ts";
import {
  fetchPlanUsage, fileCredentialReader, parseAntigravityUsage, parseCursorUsage,
  type PlanAccount, type PlanFetch, type PlanResponse,
} from "./plan-usage.ts";

const NOW = Date.parse("2026-10-07T10:00:00Z");
const RESET = "2026-11-01T00:00:00.000Z";
const TOKEN = "fixture-access-secret";
const KEY = "fixture-api-secret";
const GOOGLE_AUTH = { client_id: "fixture-client", client_secret: "fixture-client-secret",
  refresh_token: "fixture-refresh-secret", project_id: "fixture-project" };
const CURSOR_USAGE = { enabled: true, billingCycleEnd: String(Date.parse(RESET)),
  planUsage: { totalSpend: 22244, limit: 2000, totalPercentUsed: 47, autoPercentUsed: 49, apiPercentUsed: 0 } };
const CURSOR_PLAN = { planInfo: { planName: "Pro", includedUsagePeriod: "INCLUDED_USAGE_PERIOD_MONTHLY" } };
const AGY_USAGE = { groups: [
  { displayName: "Gemini Models", buckets: [
    { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.8, resetTime: RESET },
    { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.6, resetTime: RESET },
  ] },
  { displayName: "Claude and GPT models", buckets: [
    { bucketId: "3p-weekly", window: "weekly", remainingFraction: 0.4, resetTime: RESET },
    { bucketId: "3p-5h", window: "5h", remainingFraction: 1, resetTime: RESET },
  ] },
] };
const AGY_PLAN = { currentTier: { name: "Antigravity" }, paidTier: { name: "Google AI Pro" } };

function account(driver: "cursor" | "antigravity", environment: PlanAccount["environment"] = {}): PlanAccount {
  return { id: driver, name: driver === "cursor" ? "Cursor" : "Antigravity", driver, environment };
}

function response(body: unknown, status = 200): PlanResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function jwt(exp: number): string {
  return `eyJ-fixture.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.fixture`;
}

describe("Cursor and Antigravity plan parsing", () => {
  it("uses Cursor's reported pool percentages instead of its legacy dollar limit", () => {
    const result = parseCursorUsage(CURSOR_USAGE, CURSOR_PLAN);
    expect(result.plan).toBe("Pro");
    expect(result.fiveHour.available).toBe(false);
    expect(result.weekly.available).toBe(false);
    expect(result.extra).toEqual([{ label: "Monthly", usedPercent: 47, remainingPercent: 53, resetsAt: RESET }]);
    expect(result.models).toEqual([
      { name: "Cursor Models", windows: [{ label: "Monthly", usedPercent: 49, remainingPercent: 51, resetsAt: RESET }] },
      { name: "Other Models", windows: [{ label: "Monthly", usedPercent: 0, remainingPercent: 100, resetsAt: RESET }] },
    ]);
  });

  it("distinguishes an untouched legacy allowance from unknown or unlimited usage", () => {
    expect(parseCursorUsage({ planUsage: { limit: 2000 } }).extra[0]?.remainingPercent).toBe(100);
    expect(parseCursorUsage({ planUsage: { limit: 0 } }).extra).toEqual([]);
    expect(parseCursorUsage({ planUsage: { totalSpend: 200, limit: null } }).extra).toEqual([]);
    expect(parseCursorUsage({ planUsage: { totalSpend: "0", limit: 2000 } }).extra).toEqual([]);
    expect(parseCursorUsage({ enabled: false, planUsage: { totalPercentUsed: 0 } }).extra).toEqual([]);
    const poolsOnly = parseCursorUsage({ planUsage: { autoPercentUsed: 30, limit: 2000 } });
    expect(poolsOnly.extra).toEqual([]);
    expect(poolsOnly.models[0]?.windows[0]?.remainingPercent).toBe(70);
  });

  it("honors a weekly Cursor entitlement and its explicit allowance reset", () => {
    const result = parseCursorUsage(CURSOR_USAGE, { planInfo: { planName: "Weekly plan",
      includedUsagePeriod: "INCLUDED_USAGE_PERIOD_WEEKLY", includedUsageResetsAt: String(NOW + 3600_000) } });
    expect(result.weekly).toMatchObject({ available: true, remainingPercent: 53, resetsAt: new Date(NOW + 3600_000).toISOString() });
    expect(result.extra).toEqual([]);
  });

  it("keeps Google's 5-hour and weekly quotas in their own model pools", () => {
    const result = parseAntigravityUsage(AGY_USAGE, AGY_PLAN);
    expect(result.plan).toBe("Google AI Pro");
    expect(result.fiveHour.available).toBe(false);
    expect(result.weekly.available).toBe(false);
    expect(result.models.map((m) => [m.name, m.windows.map((w) => [w.label, Math.round(w.remainingPercent)])])).toEqual([
      ["Gemini Models", [["5-hour", 60], ["Weekly", 80]]],
      ["Claude and GPT models", [["5-hour", 100], ["Weekly", 40]]],
    ]);
  });

  it("handles exhausted proto buckets, skips disabled/malformed buckets, and invents no total", () => {
    const result = parseAntigravityUsage({ buckets: [
      { bucketId: "zero-weekly", displayName: "Exhausted", window: "weekly", resetTime: RESET },
      { displayName: "Empty" },
      { displayName: "Invalid", remainingFraction: "0.5", resetTime: RESET },
      { displayName: "Out of range", remainingFraction: 3 },
      { displayName: "Disabled", remainingFraction: 1, disabled: true },
    ] });
    expect(result.models).toEqual([{ name: "Exhausted", windows: [{ label: "Weekly", usedPercent: 100, remainingPercent: 0, resetsAt: RESET }] }]);
    expect(result.extra).toEqual([]);
    expect(parseAntigravityUsage({ groups: [] }).models).toEqual([]);
  });

  it("supports older model quotas without hidden models or duplicate aliases", () => {
    const result = parseAntigravityUsage({
      models: {
        gemini: { displayName: "Gemini", quotaInfo: { remainingFraction: 0.6, resetTime: RESET } },
        alias: { displayName: "Gemini", quotaInfo: { remainingFraction: 0.6, resetTime: RESET } },
        hidden: { displayName: "Hidden tab model", quotaInfo: { remainingFraction: 1 } },
      },
      agentModelSorts: [{ groups: [{ modelIds: ["gemini", "alias", "gemini"] }] }],
    });
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({ name: "Gemini", windows: [{ label: "Quota", remainingPercent: 60 }] });
  });
});

describe("native account credential isolation", () => {
  it("reads Cursor's Linux credential path and its selected team", async () => {
    const readText = vi.fn((path: string) => path.endsWith("auth.json")
      ? JSON.stringify({ accessToken: TOKEN }) : JSON.stringify({ authInfo: { activeTeamId: 42 } }));
    const reader = fileCredentialReader({ readText, platform: "linux", env: { HOME: "/fixture", XDG_CONFIG_HOME: "/xdg" } });
    expect(await reader.read(account("cursor"))).toMatchObject({ token: TOKEN, teamId: 42, expired: false });
    expect(readText.mock.calls.map(([p]) => p)).toEqual([join("/xdg/cursor", "cli-config.json"), join("/xdg/cursor", "auth.json")]);
  });

  it("reads the native macOS keychain and respects forced file/memory storage", async () => {
    const readCursorKeychain = vi.fn(async (service: string) => service === "cursor-access-token" ? TOKEN : null);
    const readText = vi.fn((path: string) => path.endsWith("auth.json") ? JSON.stringify({ accessToken: "file-token" }) : null);
    const source = { readText, readCursorKeychain, platform: "darwin" as const, env: { HOME: "/fixture" } };
    expect(await fileCredentialReader(source).read(account("cursor"))).toMatchObject({ token: TOKEN });
    expect(readCursorKeychain.mock.calls.map(([s]) => s)).toEqual(["cursor-access-token", "cursor-api-key"]);
    readCursorKeychain.mockClear();
    expect(await fileCredentialReader(source).read(account("cursor", { AGENT_CLI_CREDENTIAL_STORE: "file" }))).toMatchObject({ token: "file-token" });
    expect(await fileCredentialReader(source).read(account("cursor", { AGENT_CLI_CREDENTIAL_STORE: "memory" }))).toMatchObject({ token: null });
    expect(readCursorKeychain).not.toHaveBeenCalled();
  });

  it("uses Cursor's Windows roaming credentials and USERPROFILE config path", async () => {
    const readText = vi.fn((path: string) => path.endsWith("auth.json") ? JSON.stringify({ accessToken: TOKEN }) : null);
    const reader = fileCredentialReader({ readText, platform: "win32", env: { USERPROFILE: "/windows-user", HOME: "/wrong", APPDATA: "/roaming" } });
    expect(await reader.read(account("cursor"))).toMatchObject({ token: TOKEN });
    expect(readText.mock.calls.map(([p]) => p)).toEqual([join("/windows-user/.cursor", "cli-config.json"), join("/roaming/Cursor", "auth.json")]);
  });

  it("prefers an explicit Cursor token, rejects expiry, and does not reuse a different API-key account", async () => {
    const readText = () => JSON.stringify({ accessToken: TOKEN, apiKey: "other-key" });
    const reader = fileCredentialReader({ readText, platform: "linux", env: { HOME: "/fixture" }, now: () => NOW });
    expect(await reader.read(account("cursor", { CURSOR_AUTH_TOKEN: jwt(NOW / 1000 - 1) }))).toMatchObject({ expired: true });
    expect(await reader.read(account("cursor", { CURSOR_API_KEY: KEY }))).toMatchObject({ token: null, apiKey: KEY });
    expect(await reader.read(account("cursor", { CURSOR_AUTH_TOKEN: "explicit-token" }))).toMatchObject({ token: "explicit-token" });
  });

  it("reads only the selected Antigravity instance profile, regardless of global Google credentials", async () => {
    const expected = join(antigravityProfileDirectory("antigravity", "/fixture-data"), "antigravity-acp/acp_token.json");
    const readText = vi.fn((path: string) => path === expected ? JSON.stringify(GOOGLE_AUTH) : null);
    const reader = fileCredentialReader({ readText, dataDir: "/fixture-data", env: { GEMINI_HOME: "/wrong-account", GOOGLE_API_KEY: KEY } });
    expect(await reader.read(account("antigravity"))).toMatchObject({ googleOAuth: { refreshToken: GOOGLE_AUTH.refresh_token, projectId: GOOGLE_AUTH.project_id } });
    const other = await reader.read({ ...account("antigravity"), id: "other-google-account" });
    expect(other.token).toBeNull();
    expect(other.googleOAuth).toBeUndefined();
    expect(readText.mock.calls.map(([p]) => p)).not.toContain(join("/wrong-account", "antigravity-acp/acp_token.json"));
  });
});

describe("provider usage requests", () => {
  it("queries Cursor with its team and keeps usage when the optional plan lookup fails", async () => {
    const fetchImpl = vi.fn<PlanFetch>(async (url) => url.endsWith("GetPlanInfo") ? response({}, 500) : response(CURSOR_USAGE));
    const result = await fetchPlanUsage([account("cursor")], { fetch: fetchImpl,
      credentials: { read: () => ({ token: TOKEN, accountId: null, expired: false, teamId: 42 }) } });
    expect(result.providers[0]).toMatchObject({ ok: true, plan: null, extra: [{ remainingPercent: 53 }] });
    const usage = fetchImpl.mock.calls.find(([url]) => url.endsWith("GetCurrentPeriodUsage"))!;
    expect(usage[1]).toMatchObject({ method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "x-cursor-team-id": "42", "Connect-Protocol-Version": "1" } });
    expect(JSON.parse(usage[1].body!)).toEqual({ teamId: 42, includePooledUsage: true });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("exchanges a Cursor API key without persisting it or returning the refresh token", async () => {
    const fetchImpl = vi.fn<PlanFetch>(async (url) => url.endsWith("exchange_user_api_key")
      ? response({ accessToken: TOKEN, refreshToken: "do-not-return-refresh-secret" })
      : response(url.endsWith("GetPlanInfo") ? CURSOR_PLAN : CURSOR_USAGE));
    const result = await fetchPlanUsage([account("cursor")], { fetch: fetchImpl,
      credentials: { read: () => ({ token: null, accountId: null, expired: false, apiKey: KEY }) } });
    expect(result.providers[0]).toMatchObject({ ok: true, plan: "Pro" });
    expect(fetchImpl.mock.calls[0]?.[1].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(fetchImpl.mock.calls.slice(1).every(([, init]) => init.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret|refreshToken/);
  });

  it("refreshes Google's ACP credential only in memory and reads quota summary plus paid tier", async () => {
    const fetchImpl = vi.fn<PlanFetch>(async (url) => response(url.endsWith("/token") ? { access_token: TOKEN }
      : url.endsWith(":loadCodeAssist") ? AGY_PLAN : AGY_USAGE));
    const reader = fileCredentialReader({ readText: () => JSON.stringify(GOOGLE_AUTH), dataDir: "/fixture-data", env: {} });
    const result = await fetchPlanUsage([account("antigravity")], { fetch: fetchImpl, credentials: reader });
    expect(result.providers[0]).toMatchObject({ ok: true, plan: "Google AI Pro", models: [{ name: "Gemini Models" }, { name: "Claude and GPT models" }] });
    const exchange = new URLSearchParams(fetchImpl.mock.calls[0]?.[1].body);
    expect(exchange.get("grant_type")).toBe("refresh_token");
    expect(exchange.get("refresh_token")).toBe(GOOGLE_AUTH.refresh_token);
    const usage = fetchImpl.mock.calls.find(([url]) => url.endsWith(":retrieveUserQuotaSummary"))!;
    expect(JSON.parse(usage[1].body!)).toEqual({ project: GOOGLE_AUTH.project_id });
    expect(usage[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(result)).not.toMatch(/secret|fixture-project|refresh_token|client_secret/);
    expect(fetchImpl.mock.calls.some(([url]) => url.includes("onboardUser"))).toBe(false);
  });

  it("falls back to model quotas on an older backend without treating its missing endpoint as a bad login", async () => {
    const fetchImpl = vi.fn<PlanFetch>(async (url) => url.endsWith(":retrieveUserQuotaSummary") ? response({}, 404)
      : response(url.endsWith("/token") ? { access_token: TOKEN } : url.endsWith(":loadCodeAssist") ? AGY_PLAN
        : { models: { gemini: { displayName: "Gemini", quotaInfo: { remainingFraction: 0.25 } } } }));
    const reader = fileCredentialReader({ readText: () => JSON.stringify(GOOGLE_AUTH), env: {} });
    const result = await fetchPlanUsage([account("antigravity")], { fetch: fetchImpl, credentials: reader });
    expect(result.providers[0]).toMatchObject({ ok: true, models: [{ name: "Gemini", windows: [{ remainingPercent: 25 }] }] });
  });

  it("isolates expired logins and network failures without leaking response bodies or breaking another provider", async () => {
    const fetchImpl = vi.fn<PlanFetch>(async (url) => url.endsWith("/token") ? response({ error: "invalid_grant", message: TOKEN }, 400)
      : response(url.endsWith("GetPlanInfo") ? CURSOR_PLAN : CURSOR_USAGE));
    const reader = fileCredentialReader({ readText: () => JSON.stringify(GOOGLE_AUTH), env: {} });
    const result = await fetchPlanUsage([account("antigravity"), account("cursor", { CURSOR_AUTH_TOKEN: TOKEN })], { fetch: fetchImpl, credentials: reader });
    expect(result.providers.map((p) => [p.driver, p.ok, p.error])).toEqual([
      ["antigravity", false, "Sign in again in Antigravity"], ["cursor", true, null],
    ]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    const failed = await fetchPlanUsage([account("cursor", { CURSOR_AUTH_TOKEN: TOKEN })], { credentials: reader,
      fetch: async () => { throw new Error(TOKEN); } });
    expect(failed.providers[0]).toMatchObject({ ok: false, error: "Could not reach Cursor" });
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
  });
});
