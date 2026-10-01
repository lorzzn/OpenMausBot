import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorAuthorizationUrl } from "../../shared/cursor-auth.ts";
import { ProviderRegistry } from "../harness/registry.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { CursorAuthController, cursorLoginPrompt, resolveCursorCli } from "./cursor-auth.ts";
import { CursorAgentDriver, probeCursorAuth } from "./acp/cursor.ts";

const FAKE = fileURLToPath(new URL("../testing/fake-cursor-login-cli.ts", import.meta.url));
chmodSync(FAKE, 0o755);
const LINK = "https://cursor.com/loginDeepControl?challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&uuid=00000000-0000-4000-8000-000000000001&mode=login&redirectTarget=cli&supportsSelectedTeamLogin=true";
const dirs: string[] = [];
const controllers: CursorAuthController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});
function fixture(mode = "waiting") {
  const home = mkdtempSync(join(tmpdir(), "omb-cursor-auth-")); dirs.push(home);
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, OMB_CURSOR_AUTH_FIXTURE: "1", FAKE_CURSOR_MODE: mode };
  delete environment.CURSOR_API_KEY; delete environment.CURSOR_AUTH_TOKEN;
  const controller = new CursorAuthController({ cli: FAKE, environment: () => environment, authenticated: probeCursorAuth,
    startupTimeoutMs: 1000, lifetimeMs: 3000, updateTimeoutMs: 1000 });
  controllers.push(controller);
  return { controller, home, environment };
}

describe("Cursor browser authorization", () => {
  it("extracts only a complete official challenge and rejects injected redirects", () => {
    expect(cursorLoginPrompt(`Open a browser: ${LINK}\n`)).toBe(LINK);
    expect(cursorLoginPrompt(LINK)).toBeNull();
    for (const link of [LINK.replace("https:", "http:"), LINK.replace("cursor.com", "cursor.com.evil.test"),
      LINK + "&redirect=https://evil.test", LINK + "&uuid=duplicate", LINK + "#token", LINK.replace("cli&", "web&"), "javascript:alert(1)"]) {
      expect(cursorAuthorizationUrl(link)).toBeNull();
      expect(cursorLoginPrompt(link + "\n")).toBeNull();
    }
  });
  it("resumes one login, confirms saved credentials and drops the challenge on completion", async () => {
    const { controller, home } = fixture();
    const start = await controller.start();
    expect(start).toMatchObject({ phase: "waiting", authorizationUrl: LINK });
    expect(await controller.start()).toEqual(start);
    const other = new CursorAuthController({ cli: FAKE, environment: () => ({ HOME: home }), authenticated: probeCursorAuth });
    controllers.push(other);
    await expect(other.start()).rejects.toMatchObject({ status: 409 });
    writeFileSync(join(home, ".omb-fake-cursor-login-approved"), "");
    await expect.poll(async () => (await controller.get(start.flowId!)).phase).toBe("succeeded");
    expect(await controller.get(start.flowId!)).toMatchObject({ authorizationUrl: null, expiresAt: null });
    const calls = readFileSync(join(home, "cursor-calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.filter((call) => call.args[0] === "login")).toHaveLength(1);
    expect(calls.find((call) => call.args[0] === "login").noOpenBrowser).toBe("1");
  });
  it("cancels a stubborn login process before releasing the account for another login", async () => {
    const { controller, home, environment } = fixture("ignore-term");
    const start = await controller.start();
    const pid = Number(readFileSync(join(home, "cursor-login.pid"), "utf8"));
    await controller.cancel();
    expect(() => process.kill(pid, 0)).toThrow();
    expect((await controller.get(start.flowId!)).phase).toBe("cancelled");
    environment.FAKE_CURSOR_MODE = "waiting";
    expect((await controller.start()).flowId).not.toBe(start.flowId);
  }, 8000);
  it.each(["evil", "no-prompt", "overflow"])("fails safely for %s without exposing CLI output", async (mode) => {
    const { controller } = fixture(mode);
    await expect(controller.start()).rejects.not.toThrow(/private-token|evil\.example/);
  });
  it("reports a crash after the link was issued without retaining private output", async () => {
    const { controller } = fixture("crash");
    const start = await controller.start();
    await expect.poll(async () => (await controller.get(start.flowId!)).phase).toBe("failed");
    expect(JSON.stringify(await controller.get(start.flowId!))).not.toMatch(/private-token|challenge=/);
  });
  it("does not treat exit zero as an authenticated account", async () => {
    const { controller, home } = fixture("unconfirmed");
    const start = await controller.start();
    writeFileSync(join(home, ".omb-fake-cursor-login-approved"), "");
    await expect.poll(async () => (await controller.get(start.flowId!)).phase).toBe("failed");
  });
  it("expires a login and kills its process", async () => {
    const { home, environment } = fixture();
    const controller = new CursorAuthController({ cli: FAKE, environment: () => environment,
      authenticated: probeCursorAuth, lifetimeMs: 250 }); controllers.push(controller);
    const start = await controller.start();
    await expect.poll(async () => (await controller.get(start.flowId!)).phase).toBe("expired");
    await controller.cancel();
    expect(() => process.kill(Number(readFileSync(join(home, "cursor-login.pid"), "utf8")), 0)).toThrow();
  });
  it("releases the account if the configured executable is missing", async () => {
    const { home, environment, controller } = fixture();
    const missing = new CursorAuthController({ cli: join(home, "missing-cursor"), environment: () => environment,
      authenticated: async () => false }); controllers.push(missing);
    await expect(missing.start()).rejects.toThrow("Check its CLI installation");
    await missing.dispose();
    expect((await controller.start()).phase).toBe("waiting");
  });
});

describe("Cursor native updates and persistence", () => {
  it("prefers the persisted native update on restart, with pinned overrides preserved", async () => {
    const { controller, home, environment } = fixture();
    await controller.update();
    const updated = join(home, ".local", "bin", "cursor-agent");
    expect(resolveCursorCli("cursor-agent", environment)).toBe(updated);
    expect(resolveCursorCli(FAKE, environment)).toBe(FAKE);
    const registry = new ProviderRegistry([CursorAgentDriver]);
    await registry.load({ cursor: { driver: "cursorAgent", environment: { HOME: home, OMB_CURSOR_AUTH_FIXTURE: "1" } } });
    const [instance] = await registry.describe();
    expect(instance.authentication?.method).toBe("browser-poll");
    expect(instance.install?.server).toEqual({ updateOnly: false });
    expect("version" in instance.snapshot && instance.snapshot.version).toBe("2026.09.30-offline");
    expect(instance.models.options).toContainEqual({ id: "offline-cursor", label: "Offline Cursor" });
    await registry.disposeAll();
  });
  it("rejects failed updates without exposing CLI output or a new executable", async () => {
    const { controller, environment } = fixture("update-fails");
    await expect(controller.update()).rejects.toThrow("Cursor update did not finish");
    expect(resolveCursorCli("cursor-agent", environment)).toBe("cursor-agent");
  });
  it("stops timed-out updates and allows retry", async () => {
    const { controller, home, environment } = fixture("update-hangs");
    await expect(controller.update()).rejects.toThrow("timed out");
    expect(() => process.kill(Number(readFileSync(join(home, "cursor-update.pid"), "utf8")), 0)).toThrow();
    environment.FAKE_CURSOR_MODE = "waiting";
    await controller.update();
    expect(existsSync(join(home, ".local", "bin", "cursor-agent"))).toBe(true);
  });
  it("does not update a manually selected executable", async () => {
    const { home } = fixture();
    const instance = await CursorAgentDriver.create({ instanceId: "cursor", displayName: "Cursor", enabled: true,
      environment: { HOME: home, OMB_CURSOR_AUTH_FIXTURE: "1" }, config: CursorAgentDriver.decodeConfig({ cli: FAKE }) });
    expect(instance.updateRuntime).toBeUndefined();
    await instance.dispose();
  });
  it("blocks updates during browser login", async () => {
    const { controller } = fixture();
    await controller.start();
    await expect(controller.update()).rejects.toMatchObject({ status: 409 });
  });
  it("locks the account during installation and cancels the installer on provider removal", async () => {
    const { environment, controller: other } = fixture();
    let signal: AbortSignal | undefined;
    const installing = new CursorAuthController({ cli: FAKE, environment: () => environment, authenticated: probeCursorAuth,
      installer: async (_environment, options) => new Promise<void>((_resolve, reject) => {
        signal = options?.signal;
        signal!.addEventListener("abort", () => reject(new Error("Fixture install cancelled")), { once: true });
      }) });
    controllers.push(installing);
    const result = installing.install().catch(cause => cause);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(other.update()).rejects.toMatchObject({ status: 409 });
    await installing.dispose();
    expect(signal?.aborted).toBe(true);
    expect(await result).toBeInstanceOf(Error);
    await expect(other.update()).resolves.toBeUndefined();
  });
});
