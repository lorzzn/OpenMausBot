import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

const REMOTE = { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" };

describe("upstream web Full access on an isolated server", () => {
  let fixture: VerificationServer;
  let adminCookie: string;
  let adminToken: string;
  let clientCookie: string;
  let botId: string;
  let firstThread: string;
  let secondThread: string;
  const origin = () => fixture.info.url.replace("http:", "https:");
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const admin = (method: string, path: string, body?: unknown) =>
    call(method, path, body, { ...REMOTE, origin: origin(), cookie: adminCookie });
  const bot = async () => (await call("GET", "/api/bots?messages=0")).body.bots.find((candidate: any) => candidate.id === botId);

  beforeAll(async () => {
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, ["codex"]);
    const pair = async (scopes: string[], cookie = true) => {
      const invitation = await call("POST", "/api/auth/pairing", { scopes });
      expect(invitation.status).toBe(200);
      const accepted = await call("POST", "/api/auth/pair", { code: invitation.body.code, label: "Fixture browser", cookie },
        { ...REMOTE, origin: origin() });
      expect(accepted.status).toBe(200);
      return accepted;
    };
    adminCookie = (await pair(["admin", "client"])).cookie!;
    adminToken = (await pair(["admin", "client"], false)).body.token;
    clientCookie = (await pair(["client"])).cookie!;
    const created = await call("POST", "/api/bots", { name: "Approval fixture", approvalMode: "ask" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    botId = created.body.bot.id;
    firstThread = created.body.bot.threadId;
    const second = await call("POST", `/api/bots/${botId}/tasks`, { title: "Second thread" });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    secondThread = second.body.task.threadId;
  }, 30_000);
  afterAll(async () => { await fixture?.close(); });

  it("uses the ordinary API without an opt-in or confirmation", async () => {
    const config = await admin("GET", "/api/config");
    expect(config.status).toBe(200);
    expect(config.body.features).not.toHaveProperty("pairedWebFullAccess");
    expect((await admin("POST", `/api/bots/${botId}/paired-full-access`, { mode: "full", scope: "bot" })).status).toBe(404);
    expect((await call("PATCH", `/api/bots/${botId}`, { approvalMode: "full" })).status).toBe(200);
    expect((await bot()).approvalMode).toBe("full");
    expect((await admin("PATCH", `/api/bots/${botId}`, { approvalMode: "ask" })).status).toBe(200);
  });

  it("preserves session and origin checks, and accepts authorized API clients", async () => {
    const path = `/api/bots/${botId}`;
    const patch = { approvalMode: "full" };
    expect((await call("PATCH", path, patch, { ...REMOTE, origin: origin() })).status).toBe(403);
    expect((await call("PATCH", path, patch, { ...REMOTE, origin: origin(), cookie: clientCookie })).status).toBe(403);
    expect((await call("PATCH", path, patch, { ...REMOTE, origin: "https://other.example.test", cookie: adminCookie })).status).toBe(403);
    expect((await bot()).approvalMode).toBe("ask");
    expect((await call("PATCH", path, patch, { ...REMOTE, origin: origin(), authorization: `Bearer ${adminToken}` })).status).toBe(200);
    expect((await bot()).approvalMode).toBe("full");
    expect((await admin("PATCH", path, { approvalMode: "ask" })).status).toBe(200);
  });

  it("grants one thread or all threads and can return them to Ask", async () => {
    const path = `/api/bots/${botId}`;
    expect((await admin("PATCH", path, { approvalMode: "ask", applyToAllThreads: true })).status).toBe(200);
    expect((await admin("PATCH", `${path}/tasks/${firstThread}`, { approvalMode: "full" })).status).toBe(200);
    let current = await bot();
    expect(current.approvalMode).toBe("ask");
    expect(current.tasks.find((task: any) => task.threadId === firstThread).approvalMode).toBe("full");
    expect(current.tasks.find((task: any) => task.threadId === secondThread).approvalMode).toBe("ask");
    expect((await admin("PATCH", path, { approvalMode: "full", applyToAllThreads: true })).status).toBe(200);
    current = await bot();
    expect(current.approvalMode).toBe("full");
    expect(current.tasks.every((task: any) => task.approvalMode === "full")).toBe(true);
    expect((await admin("PATCH", `${path}/tasks/${secondThread}`, { approvalMode: "ask" })).status).toBe(200);
    current = await bot();
    expect(current.approvalMode).toBe("full");
    expect(current.tasks.find((task: any) => task.threadId === firstThread).approvalMode).toBe("full");
    expect(current.tasks.find((task: any) => task.threadId === secondThread).approvalMode).toBe("ask");
    expect((await admin("PATCH", path, { approvalMode: "ask", applyToAllThreads: true })).status).toBe(200);
    expect((await bot()).tasks.every((task: any) => task.approvalMode === "ask")).toBe(true);
  });

  it("keeps Custom restricted to the private desktop flow", async () => {
    const instances = (await admin("GET", "/api/instances")).body.instances;
    const codex = instances.find((instance: any) => instance.instanceId === "codex");
    const model = codex.models.default ?? codex.models.options[0]?.id;
    expect(model).toBeTypeOf("string");
    const created = await admin("POST", "/api/bots", {
      name: "Custom boundary", modelSelection: { instanceId: "codex", model }, approvalMode: "ask",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const rejected = await admin("PATCH", `/api/bots/${created.body.bot.id}`, { approvalMode: "custom" });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(403);
    expect(rejected.body.error).toContain("packaged desktop app");
    expect((await bot()).approvalMode).toBe("ask");
  });
});
