// Real HTTP server, disposable home, fake CLI; OAuth stops before its callback.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verificationServerEnvironment } from "../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { excludedWorkspaceAuthPath } from "./workspace-backup-policy.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_CODEX = join(ROOT, "server/testing/fake-codex-accounts.ts");
let child: ChildProcess | undefined;
let home: string;
let base: string;
let logPath: string;
const evidence: Array<{ method: string; path: string; status: number }> = [];

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  evidence.push({ method, path: path.split("?")[0], status: response.status });
  return { status: response.status, body: await response.json() as Record<string, any>, headers: response.headers };
}

async function admin(label: string) {
  const pairing = await api("POST", "/api/auth/pairing", { scopes: ["admin", "client"] });
  expect(pairing.status).toBe(200);
  const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code, label });
  expect(paired.status).toBe(200);
  return { authorization: `Bearer ${paired.body.token}` };
}

function expectSignedOut(instance: Record<string, any>) {
  expect(instance).toMatchObject({
    driverKind: "codex", cli: FAKE_CODEX,
    snapshot: { state: "available", authenticated: false, chatgptPlan: true, billing: "subscription" },
    models: { default: "", options: [] }, authentication: { method: "browser-pkce" },
  });
  expect(instance).not.toHaveProperty("shadow");
  expect(JSON.stringify(instance)).not.toMatch(/access_token|refresh_token|id_token|code_verifier|credentials\.json/);
}

async function launch(port: number) {
  const log = openSync(logPath, "a", 0o600);
  try {
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
      cwd: ROOT, env: verificationServerEnvironment({}, home, port), stdio: ["ignore", log, log],
    });
  } finally { closeSync(log); }
  await vi.waitFor(async () => {
    if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`Fixture exited: ${logPath}`);
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) });
    expect(health.status).toBe(200);
    expect((await health.json() as { pid: number }).pid).toBe(child!.pid);
  }, { timeout: 20_000, interval: 100 });
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-chatgpt-api-"));
  mkdirSync(join(home, "tmp"));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  logPath = join(tmpdir(), `omb-chatgpt-api-${port}-${process.pid}.log`);
  writeFileSync(join(home, "config.json"), JSON.stringify({ instances: {
    fixture: { driver: "claudeAgent", config: { cli: join(ROOT, "server/testing/fake-claude-cli.ts") } },
    chatgpt: { driver: "codex", displayName: "ChatGPT plan", config: { authMode: "chatgpt-plan", cli: FAKE_CODEX } },
  } }));
  await launch(port);
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  if (logPath) {
    writeFileSync(`${logPath}.requests.json`, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ url: base, logPath, evidencePath: `${logPath}.requests.json` }));
  }
  if (home) await removeTempDir(home);
});

describe("ChatGPT plan accounts over isolated HTTP", () => {
  it("starts signed out with an empty live catalog and rejects invalid account names without saving", async () => {
    const list = await api("GET", "/api/instances");
    expect(list.status).toBe(200);
    expectSignedOut(list.body.instances.find((instance: { instanceId: string }) => instance.instanceId === "chatgpt"));
    const saved = readFileSync(join(home, "config.json"), "utf8");
    for (const body of [{}, { displayName: "Missing mode" }, { displayName: "Wrong mode", authMode: "browser" },
      ...[" ", "x".repeat(81), "Bad\nName", 42].map(displayName => ({ displayName, authMode: "device-code" })),
      { displayName: "Injected", authMode: "device-code", environment: { OPENAI_API_KEY: "synthetic-injection" } }]) {
      expect((await api("POST", "/api/instances/chatgpt-accounts", body)).status).toBe(400);
    }
    expect((await api("POST", "/api/instances/chatgpt-accounts", { displayName: "Wrong type" }, { "content-type": "text/plain" })).status).toBe(415);
    expect(readFileSync(join(home, "config.json"), "utf8")).toBe(saved);
  });

  it("keeps account entries and locally generated sign-in flows separate and owned by their admin sessions", async () => {
    const ids: string[] = [];
    for (const displayName of ["  Personal plan  ", "Work plan"]) {
      const created = await api("POST", "/api/instances/chatgpt-accounts", { displayName, authMode: "chatgpt-plan" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      ids.push(created.body.instanceId);
      const instance = created.body.instances.find((row: { instanceId: string }) => row.instanceId === created.body.instanceId);
      expectSignedOut(instance);
      expect(instance.displayName).toBe(displayName.trim());
    }
    expect(new Set(ids).size).toBe(2);
    const saved = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    for (const id of ids) {
      expect(saved.instances[id].config).toEqual({ authMode: "chatgpt-plan", cli: FAKE_CODEX });
      expect(saved.instances[id]).not.toHaveProperty("environment");
    }
    const owners = [await admin("Personal browser"), await admin("Work browser")];
    const starts = [];
    for (const [index, id] of ids.entries()) {
      const started = await api("POST", `/api/instances/${id}/auth/start`, {}, owners[index]);
      expect(started.status).toBe(200);
      expect(started.headers.get("cache-control")).toBe("no-store");
      expect(started.body.auth).toMatchObject({ phase: "waiting", flowId: expect.any(String) });
      const authorization = new URL(started.body.auth.authorizationUrl);
      expect(authorization.origin + authorization.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorization.searchParams.get("scope")?.split(" ")).toContain("chatgpt.tokens.use.direct");
      expect(new URL(authorization.searchParams.get("redirect_uri")!).hostname).toBe("127.0.0.1");
      expect(JSON.stringify(started.body)).not.toMatch(/access_token|refresh_token|id_token|code_verifier/);
      starts.push({ id, auth: started.body.auth, authorization });
      const relativeCredentials = `providers/chatgpt-plan/${createHash("sha256").update(id).digest("hex")}/credentials.json`;
      expect(excludedWorkspaceAuthPath(relativeCredentials)).toBe(true);
      expect(existsSync(join(home, relativeCredentials))).toBe(false);
    }
    expect(starts[0].authorization.searchParams.get("state")).not.toBe(starts[1].authorization.searchParams.get("state"));
    const first = starts[0];
    const statusPath = `/api/instances/${first.id}/auth/status?flowId=${first.auth.flowId}`;
    expect((await api("POST", `/api/instances/${first.id}/auth/start`, {}, owners[1])).status).toBe(409);
    expect((await api("GET", statusPath, undefined, owners[1])).status).toBe(404);
    expect((await api("POST", `/api/instances/${first.id}/auth/cancel`, { flowId: first.auth.flowId }, owners[1])).status).toBe(404);
    const status = await api("GET", statusPath, undefined, owners[0]);
    expect(status.status).toBe(200);
    expect(status.body.auth).toEqual(first.auth);
    const global = await api("GET", "/api/instances");
    expect(JSON.stringify(global.body)).not.toContain(first.auth.flowId);
    expect(JSON.stringify(global.body)).not.toContain(first.auth.authorizationUrl);
    for (const [index, flow] of starts.entries()) {
      expect((await api("POST", `/api/instances/${flow.id}/auth/cancel`, { flowId: flow.auth.flowId }, owners[index])).status).toBe(200);
      const cancelled = await api("GET", `/api/instances/${flow.id}/auth/status?flowId=${flow.auth.flowId}`, undefined, owners[index]);
      expect(cancelled.body.auth).toMatchObject({ phase: "cancelled", authorizationUrl: null });
    }
  });

  it("refuses proxied OAuth starts even for an authenticated admin", async () => {
    const owner = await admin("Proxy browser");
    for (const [header, value] of [
      ["x-forwarded-for", "198.51.100.21"], ["x-forwarded-proto", "https"],
      ["x-forwarded-host", "workspace.example.test"], ["forwarded", "for=198.51.100.21;proto=https"],
    ] as const) {
      const refused = await api("POST", "/api/instances/chatgpt/auth/start", {}, { ...owner, [header]: value });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toContain("computer running OpenMausBot");
      expect(refused.body).not.toHaveProperty("auth");
    }
  });

  it("renames and removes an added account, but never the built-in one", async () => {
    const created = await api("POST", "/api/instances/chatgpt-accounts", { displayName: "Side plan", authMode: "chatgpt-plan" });
    expect(created.status).toBe(201);
    const id = created.body.instanceId as string;
    const renamed = await api("PATCH", `/api/instances/${id}`, { displayName: "Client plan" });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.instances.find((row: { instanceId: string }) => row.instanceId === id).displayName).toBe("Client plan");
    expect((await api("PATCH", `/api/instances/${id}`, { configDir: "/elsewhere" })).status).toBe(400);
    expect((await api("DELETE", "/api/instances/chatgpt")).status).toBe(400);
    const removed = await api("DELETE", `/api/instances/${id}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.instances.some((row: { instanceId: string }) => row.instanceId === id)).toBe(false);
    expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).instances).not.toHaveProperty(id);
    expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).instances).toHaveProperty("chatgpt");
  });

  it("signs in two native Codex accounts remotely, runs with their own homes, and keeps the other login after sign-out and restart", async () => {
    mkdirSync(join(home, ".codex"));
    const original = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "synthetic-default" } });
    writeFileSync(join(home, ".codex/auth.json"), original);
    const owner = { ...await admin("Remote device browser"), "x-forwarded-proto": "https", "x-forwarded-host": "fixture.example.test" };
    const accounts: Array<{ id: string; home: string; flowId: string; email: string }> = [];
    for (const [index, displayName] of ["Personal Codex", "Work Codex"].entries()) {
      const created = await api("POST", "/api/instances/chatgpt-accounts", { displayName, authMode: "device-code" }, owner);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.instanceId as string;
      const row = created.body.instances.find((instance: any) => instance.instanceId === id);
      expect(row).toMatchObject({ authentication: { method: "device-code" }, snapshot: { authenticated: false } });
      expect(row.snapshot.chatgptPlan).not.toBe(true);
      const started = await api("POST", `/api/instances/${id}/auth/start`, {}, owner);
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      expect(started.body.auth).toMatchObject({ phase: "waiting", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "0CSG-0IXIM" });
      accounts.push({ id, home: join(home, "providers/codex", createHash("sha256").update(id).digest("hex"), "codex"), flowId: started.body.auth.flowId, email: `account-${index}@example.test` });
    }
    expect(accounts[0].home).not.toBe(accounts[1].home);
    const status = async (index: number) => (await api("GET", `/api/instances/${accounts[index].id}/auth/status?flowId=${accounts[index].flowId}`, undefined, owner)).body.auth;
    for (const [index, account] of accounts.entries()) {
      writeFileSync(join(account.home, "approve-login.json"), JSON.stringify({ token: `synthetic-account-${index}`, email: account.email }));
      await expect.poll(async () => (await status(index)).phase, { timeout: 15_000 }).toBe("succeeded");
      if (index === 0) expect((await status(1)).phase).toBe("waiting");
      const refreshed = await api("POST", `/api/instances/${account.id}/refresh-models`, {}, owner);
      expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
      const instance = refreshed.body.instances.find((row: any) => row.instanceId === account.id);
      expect(instance.snapshot).toMatchObject({ authenticated: true, account: { email: account.email } });
      const created = await api("POST", "/api/bots", { name: account.email, modelSelection: { instanceId: account.id, model: instance.models.default }, requireAvailableModel: true });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const bot = created.body.bot;
      const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "Reply from this fixture account.", threadId: bot.activeTaskId });
      expect(sent.status, JSON.stringify(sent.body)).toBe(202);
      await expect.poll(async () => readdirSync(account.home).filter(name => /^rpc-.*\.json$/.test(name)).map(name => JSON.parse(readFileSync(join(account.home, name), "utf8")))
        .some(rpc => rpc.env.CODEX_HOME === account.home && rpc.calls.some((call: any) => call.method === "turn/start")), { timeout: 20_000 }).toBe(true);
      await expect.poll(async () => (await api("GET", `/api/threads/${sent.body.threadId}/messages`)).body.messages
        .some((message: any) => message.role === "bot" && message.kind === "text" && message.text === "done from fake codex"), { timeout: 20_000 }).toBe(true);
    }
    const signedOut = await api("POST", `/api/instances/${accounts[0].id}/auth/sign-out`, {}, owner);
    expect(signedOut.status, JSON.stringify(signedOut.body)).toBe(200);
    expect(existsSync(join(accounts[0].home, "auth.json"))).toBe(false);
    expect(existsSync(join(accounts[1].home, "auth.json"))).toBe(true);
    await waitForExit(child, { signal: "SIGTERM" });
    await launch(Number(new URL(base).port));
    const list = await api("GET", "/api/instances");
    expect(list.body.instances.find((row: any) => row.instanceId === accounts[0].id).snapshot.authenticated).toBe(false);
    expect(list.body.instances.find((row: any) => row.instanceId === accounts[1].id).snapshot).toMatchObject({ authenticated: true, account: { email: accounts[1].email } });
    expect(readFileSync(join(home, ".codex/auth.json"), "utf8")).toBe(original);
    const saved = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    for (const account of accounts) {
      expect(saved.instances[account.id].config).toEqual({ authMode: "device-code", cli: FAKE_CODEX });
      expect(saved.instances[account.id]).not.toHaveProperty("environment");
    }
  }, 60_000);
});
