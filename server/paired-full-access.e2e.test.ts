import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

const REMOTE = { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" };

describe("paired web Full access on an isolated server", () => {
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
  const admin = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    call(method, path, body, { ...REMOTE, origin: origin(), cookie: adminCookie, ...extra });
  const change = (mode: "full" | "ask", scope: "thread" | "bot" | "all", threadId?: string) => ({
    mode, scope, ...(threadId ? { threadId } : {}), ...(mode === "full" ? { confirmation: "approve-all-tools" } : {}),
  });
  const bot = async () => (await call("GET", "/api/bots?messages=0")).body.bots.find((candidate: any) => candidate.id === botId);

  beforeAll(async () => {
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], undefined, true);
    const pair = async (scopes: string[]) => {
      const invitation = await call("POST", "/api/auth/pairing", { scopes });
      expect(invitation.status).toBe(200);
      const accepted = await call("POST", "/api/auth/pair", { code: invitation.body.code, label: "Fixture browser", cookie: true },
        { ...REMOTE, origin: origin() });
      expect(accepted.status).toBe(200);
      return { cookie: accepted.cookie!, token: accepted.body.token as string | undefined };
    };
    const adminPair = await pair(["admin", "client"]);
    adminCookie = adminPair.cookie;
    const bearerInvitation = await call("POST", "/api/auth/pairing", { scopes: ["admin", "client"] });
    const bearer = await call("POST", "/api/auth/pair", { code: bearerInvitation.body.code, label: "Fixture API" }, { ...REMOTE, origin: origin() });
    adminToken = bearer.body.token;
    clientCookie = (await pair(["client"])).cookie;
    const created = await call("POST", "/api/bots", { name: "Approval fixture" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    botId = created.body.bot.id;
    firstThread = created.body.bot.threadId;
    const second = await call("POST", `/api/bots/${botId}/tasks`, { title: "Second thread" });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    secondThread = second.body.task.threadId;
  }, 30_000);

  afterAll(async () => { await fixture?.close(); });

  it("is off by default even for the loopback owner", async () => {
    const disabled = await launchVerificationServer();
    try {
      const response = await fetch(`${disabled.info.url}/api/bots/fixture/paired-full-access`, {
        method: "POST", headers: { origin: disabled.info.url, "content-type": "application/json" },
        body: JSON.stringify(change("full", "bot")),
      });
      expect(response.status).toBe(404);
    } finally { await disabled.close(); }
  }, 30_000);

  it("requires a same-origin admin cookie and explicit confirmation", async () => {
    const config = await admin("GET", "/api/config");
    expect(config.status, JSON.stringify(config.body)).toBe(200);
    expect(config.body.features.pairedWebFullAccess).toBe(true);
    const path = `/api/bots/${botId}/paired-full-access`;
    expect((await call("POST", path, change("full", "bot"), { origin: fixture.info.url })).status).toBe(403);
    expect((await call("POST", path, change("full", "bot"), { ...REMOTE, origin: origin(), authorization: `Bearer ${adminToken}` })).status).toBe(403);
    expect((await call("POST", path, change("full", "bot"), { ...REMOTE, origin: origin(), cookie: clientCookie })).status).toBe(403);
    expect((await admin("POST", path, change("full", "bot"), { origin: "https://other.example.test" })).status).toBe(403);
    expect((await call("POST", path, change("full", "bot"), { ...REMOTE, cookie: adminCookie })).status).toBe(403);
    expect((await admin("POST", path, { mode: "full", scope: "bot" })).status).toBe(400);
    expect((await admin("POST", path, { ...change("full", "bot"), extra: true })).status).toBe(400);
    expect((await bot()).approvalMode ?? "ask").toBe("ask");
  });

  it("grants only the chosen thread, then all threads, and can revoke the grant", async () => {
    const path = `/api/bots/${botId}/paired-full-access`;
    const granted = await admin("POST", path, change("full", "thread", firstThread));
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    let current = await bot();
    expect(current.approvalMode ?? "ask").toBe("ask");
    expect(current.tasks.find((task: any) => task.threadId === firstThread).approvalMode).toBe("full");
    expect(current.tasks.find((task: any) => task.threadId === secondThread).approvalMode ?? "ask").toBe("ask");
    expect((await admin("POST", path, change("full", "all"))).status).toBe(200);
    current = await bot();
    expect(current.approvalMode).toBe("full");
    expect(current.tasks.every((task: any) => task.approvalMode === "full")).toBe(true);
    expect((await admin("POST", path, change("ask", "all"))).status).toBe(200);
    current = await bot();
    expect(current.approvalMode).toBe("ask");
    expect(current.tasks.every((task: any) => task.approvalMode === "ask")).toBe(true);
  });
});
