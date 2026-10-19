import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureDirs } from "../../config.ts";
import { recordEvents } from "../../testing/events.ts";
import { CURSOR_MODEL_FIXTURE } from "../../testing/cursor-model-fixture.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import {
  classifyCursorError,
  createCursorAgentDriver,
  CursorAgentDriver,
  decodeCursorAuthStatus,
  decodeCursorAuthText,
  decodeCursorModelCatalog,
  decodeCursorModelText,
  STATIC_CURSOR_MODELS,
} from "./cursor.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "testing", "fake-acp-cli.ts");

beforeEach(() => vi.stubEnv("FAKE_ACP_CURSOR_MODELS", JSON.stringify(CURSOR_MODEL_FIXTURE)));
afterEach(() => vi.unstubAllEnvs());

describe("decodeCursorAuthStatus", () => {
  it("reads isAuthenticated from live CLI JSON", () => {
    expect(decodeCursorAuthStatus({ isAuthenticated: true })).toBe(true);
    expect(decodeCursorAuthStatus({ isAuthenticated: false })).toBe(false);
  });

  it("accepts sibling field names without inventing a yes from a missing flag", () => {
    expect(decodeCursorAuthStatus({ authenticated: true })).toBe(true);
    expect(decodeCursorAuthStatus({ loggedIn: false })).toBe(false);
    expect(decodeCursorAuthStatus({ auth: { isAuthenticated: true } })).toBe(true);
    expect(decodeCursorAuthStatus({ email: "user@example.com" })).toBeNull();
    expect(decodeCursorAuthStatus("logged in")).toBeNull();
  });
});

describe("Cursor parameterized model sessions", () => {
  const scratchDirs: string[] = [];
  afterEach(async () => {
    delete process.env.FAKE_ACP_DUMP;
    delete process.env.FAKE_ACP_CURSOR_REJECT;
    delete process.env.FAKE_ACP_RPC_DUMP;
    for (const dir of scratchDirs.splice(0)) await removeTempDir(dir);
  });

  const fixture = async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    const scratch = mkdtempSync(join(tmpdir(), "omb-cursor-params-"));
    scratchDirs.push(scratch);
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_RPC_DUMP = join(scratch, "rpc.json");
    const instance = await CursorAgentDriver.create({
      instanceId: "cursor-params", displayName: "Cursor", enabled: true,
      environment: {}, config: { cli: FAKE_CLI, fullAuto: false },
    });
    return { instance, dump, recorder: recordEvents(instance.adapter) };
  };

  it("changes High Fast to High and Medium within one process, without model replacement or read-back calls", async () => {
    const { instance, dump, recorder } = await fixture();
    try {
      for (const model of ["grok-4.7-high-fast", "grok-4.7-high", "grok-4.7-medium"]) {
        const turn = await instance.adapter.sendTurn({ threadId: "params", model, text: model });
        expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === turn.turnId)).toMatchObject({ ok: true });
      }
      const prompts = readFileSync(`${dump}.prompts.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(new Set(prompts.map((prompt) => prompt.pid)).size).toBe(1);
      expect(prompts.map(({ model, parameters }) => ({ model, parameters }))).toEqual([
        { model: "grok-4.7", parameters: { context: "256k", reasoning_effort: "high", fast: "true" } },
        { model: "grok-4.7", parameters: { context: "256k", reasoning_effort: "high", fast: "false" } },
        { model: "grok-4.7", parameters: { context: "256k", reasoning_effort: "medium", fast: "false" } },
      ]);
      expect(recorder.events.filter((event) => event.type === "runtime.notice")).toEqual([]);
      const methods: string[] = JSON.parse(readFileSync(process.env.FAKE_ACP_RPC_DUMP!, "utf8"));
      expect(methods).not.toContain("session/set_model");
      expect(methods.slice(methods.indexOf("cursor/list_available_models"))).toEqual(Array(3).fill([
        "cursor/list_available_models", ...Array(4).fill("session/set_config_option"), "session/prompt", "session/prompt.result",
      ]).flat());
    } finally {
      recorder.stop();
      await instance.dispose();
    }
  });

  it("selects Auto by its native base id", async () => {
    const { instance, dump, recorder } = await fixture();
    try {
      await instance.adapter.sendTurn({ threadId: "params-auto", model: "auto", text: "hi" });
      expect(await recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
      expect(JSON.parse(readFileSync(`${dump}.config.json`, "utf8"))).toEqual([
        { method: "session/set_config_option", params: { sessionId: "fake-acp-session", configId: "model", value: "default" } },
      ]);
    } finally {
      recorder.stop();
      await instance.dispose();
    }
  });

  it("fails before prompting when Fast is rejected", async () => {
    process.env.FAKE_ACP_CURSOR_REJECT = "fast";
    const { instance, dump, recorder } = await fixture();
    try {
      await instance.adapter.sendTurn({ threadId: "params-rejected", model: "grok-4.7-high", text: "hi" });
      expect(await recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false });
      expect(recorder.events).toContainEqual(expect.objectContaining({ type: "runtime.error", message: expect.stringContaining("Invalid config option fast") }));
      expect(existsSync(`${dump}.prompts.jsonl`)).toBe(false);
      expect(recorder.events.filter((event) => event.type === "runtime.notice")).toEqual([]);
    } finally {
      recorder.stop();
      await instance.dispose();
    }
  });
});

describe("decodeCursorAuthText", () => {
  it("recognizes the documented status output without confusing logged-out text", () => {
    expect(decodeCursorAuthText("✓ Login successful! Logged in")).toBe(true);
    expect(decodeCursorAuthText("Not logged in")).toBe(false);
    expect(decodeCursorAuthText("Cursor Agent CLI")).toBeNull();
  });
});

describe("decodeCursorModelCatalog", () => {
  it("merges live ids onto the static cloud set", () => {
    const catalog = decodeCursorModelCatalog({
      default: "composer-2.5",
      models: [
        { id: "composer-2.5", name: "Composer 2.5" },
        { id: "cursor-live", displayName: "Cursor Live" },
        { id: "bad id" },
        "gpt-5.3-codex",
      ],
    });
    expect(catalog?.default).toBe("composer-2.5");
    expect(catalog?.options.slice(0, STATIC_CURSOR_MODELS.options.length)).toEqual(STATIC_CURSOR_MODELS.options);
    expect(catalog?.options).toContainEqual({ id: "cursor-live", label: "Cursor Live" });
    expect(catalog?.options.some((option) => option.id === "bad id")).toBe(false);
  });

  it("reads { data: [...] } and a bare array", () => {
    expect(decodeCursorModelCatalog({ data: [{ id: "extra-one", label: "Extra One" }] })?.options).toContainEqual({
      id: "extra-one",
      label: "Extra One",
    });
    expect(decodeCursorModelCatalog(["composer-2.5", "brand-new"])?.options).toContainEqual({
      id: "brand-new",
      label: "Brand New",
    });
  });

  it("returns null for an unusable payload so the static fallback can win", () => {
    expect(decodeCursorModelCatalog(null)).toBeNull();
    expect(decodeCursorModelCatalog({ models: [] })).toBeNull();
    expect(decodeCursorModelCatalog({ hello: "world" })).toBeNull();
  });
});

describe("decodeCursorModelText", () => {
  it("parses slug-label lines and (default)/(current) markers", () => {
    const catalog = decodeCursorModelText(`
Available models

auto - Auto (default)
composer-2.5 - Composer 2.5 (current)
cursor-text - Cursor Text
`);
    expect(catalog?.default).toBe("auto");
    expect(catalog?.options).toContainEqual({ id: "cursor-text", label: "Cursor Text" });
    expect(catalog?.options).toContainEqual({ id: "composer-2.5", label: "Composer 2.5" });
  });

  it("falls back to the first parsed id when static default is absent", () => {
    const catalog = decodeCursorModelText("cursor-only - Cursor Only");
    expect(catalog?.default).toBe("cursor-only");
  });
});

describe("classifyCursorError", () => {
  it("maps auth and subscription failures onto provider codes", () => {
    expect(classifyCursorError({ code: -32000, message: "Authentication required" })).toBe("invalid_credentials");
    expect(classifyCursorError(new Error("not logged in"))).toBe("invalid_credentials");
    expect(classifyCursorError(new Error("upgrade your subscription"))).toBe("inactive_subscription");
    expect(classifyCursorError(new Error("model not found"))).toBeUndefined();
  });
});

describe("CursorAgentDriver", () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    delete process.env.FAKE_ACP_DUMP;
    delete process.env.FAKE_ACP_AUTH;
    delete process.env.FAKE_ACP_AUTH_METHOD;
    delete process.env.FAKE_ACP_RPC_APPEND_FILE;
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_AUTH_TOKEN;
    delete process.env.XAI_API_KEY;
    for (const dir of scratchDirs.splice(0)) await removeTempDir(dir);
  });

  it("defaults to the unambiguous cursor-agent binary and declares cross-platform setup", () => {
    expect(CursorAgentDriver.decodeConfig(undefined)).toEqual({
      cli: "cursor-agent",
      fullAuto: false,
      workspace: undefined,
    });
    expect(CursorAgentDriver.driverKind).toBe("cursorAgent");
    expect(CursorAgentDriver.install?.command).toMatchObject({
      darwin: expect.stringContaining("cursor.com/install"),
      linux: expect.stringContaining("cursor.com/install"),
      win32: expect.stringContaining("cursor.com/install"),
    });
    expect(CursorAgentDriver.install?.signInCommand).toBe("cursor-agent login");
  });

  it.skipIf(process.platform === "win32")("detects a persisted native shim in the instance HOME without a PATH installation", async () => {
    const home = mkdtempSync(join(tmpdir(), "omb-cursor-shim-"));
    const fake = join(dirname(FAKE_CLI), "fake-cursor-login-cli.ts");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    symlinkSync(fake, join(home, ".local", "bin", "cursor-agent"));
    const instance = await CursorAgentDriver.create({
      instanceId: "cursor-native-shim", displayName: "Cursor", enabled: true,
      environment: { HOME: home, OMB_CURSOR_AUTH_FIXTURE: "1" },
      config: { cli: "cursor-agent", fullAuto: false },
    });
    try {
      expect(await instance.snapshot()).toMatchObject({ state: "available", version: "2026.09.28-offline", authenticated: false,
        update: { title: "Update Cursor to 2026.09.30-offline" } });
    } finally {
      await instance.dispose();
      await removeTempDir(home);
    }
  });

  it("refreshes the catalog from `cursor-agent models` on the instance CLI", async () => {
    chmodSync(FAKE_CLI, 0o755);
    const driver = createCursorAgentDriver();
    const instance = await driver.create({
      instanceId: "cursor-catalog",
      displayName: "Cursor",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      expect(instance.models.options.some((option) => option.id === "cursor-live")).toBe(true);
      expect(instance.models.default).toBe("auto");
    } finally {
      await instance.dispose();
    }
  });

  it("treats CURSOR_API_KEY as signed in without asking the CLI", async () => {
    chmodSync(FAKE_CLI, 0o755);
    const instance = await CursorAgentDriver.create({
      instanceId: "cursor-key",
      displayName: "Cursor",
      environment: { CURSOR_API_KEY: "key-from-env" },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      expect((await instance.snapshot()).authenticated).toBe(true);
    } finally {
      await instance.dispose();
    }
  });

  it("reads isAuthenticated from `cursor-agent status --format json`", async () => {
    chmodSync(FAKE_CLI, 0o755);
    process.env.FAKE_ACP_AUTH = "0";
    const loggedOut = await CursorAgentDriver.create({
      instanceId: "cursor-status-out",
      displayName: "Cursor",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      expect((await loggedOut.snapshot()).authenticated).toBe(false);
    } finally {
      await loggedOut.dispose();
    }

    delete process.env.FAKE_ACP_AUTH;
    const loggedIn = await CursorAgentDriver.create({
      instanceId: "cursor-status-in",
      displayName: "Cursor",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      expect((await loggedIn.snapshot()).authenticated).toBe(true);
    } finally {
      await loggedIn.dispose();
    }
  });

  it("spawns `agent [--force] acp` and keeps Cursor credentials", async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    const scratch = mkdtempSync(join(tmpdir(), "omb-cursor-"));
    scratchDirs.push(scratch);
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.CURSOR_API_KEY = "cursor-should-keep";
    process.env.XAI_API_KEY = "xai-should-not-leak";

    const instance = await CursorAgentDriver.create({
      instanceId: "cursor-argv",
      displayName: "Cursor",
      environment: { CURSOR_API_KEY: "cursor-should-keep" },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: true },
    });
    const recorder = recordEvents(instance.adapter);
    try {
      await instance.adapter.sendTurn({ threadId: "t-cursor", text: "hi", model: "gpt-5.3-codex", approvalMode: "full" });
      await recorder.until((e) => e.type === "turn.completed");

      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(seen.argv).toEqual(["--force", "acp"]);
      expect(seen.env.CURSOR_API_KEY).toBe("cursor-should-keep");
      expect(seen.env.XAI_API_KEY).toBeUndefined();

      const applied = JSON.parse(readFileSync(`${dump}.config.json`, "utf8"));
      expect(applied).toEqual([
        { method: "session/set_config_option", params: { sessionId: "fake-acp-session", configId: "model", value: "gpt-5.3-codex" } },
        { method: "session/set_config_option", params: { sessionId: "fake-acp-session", configId: "reasoning", value: "medium" } },
        { method: "session/set_config_option", params: { sessionId: "fake-acp-session", configId: "fast", value: "false" } },
      ]);
      expect(JSON.parse(readFileSync(`${dump}.initialize.json`, "utf8")).clientCapabilities._meta).toEqual({ parameterizedModelPicker: true });
      for (const approvalMode of ["auto", "ask"] as const) {
        const { turnId } = await instance.adapter.sendTurn({ threadId: "t-cursor", text: "continue", approvalMode, resumeCursor: "fake-acp-session" });
        await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
        expect(JSON.parse(readFileSync(dump, "utf8")).argv).toEqual(approvalMode === "auto" ? ["--auto-review", "acp"] : ["acp"]);
      }
    } finally {
      recorder.stop();
      await instance.dispose();
    }
  });

  it("sends cursor_login only when no Cursor key is in the agent's env", async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    const scratch = mkdtempSync(join(tmpdir(), "omb-cursor-auth-"));
    scratchDirs.push(scratch);
    process.env.FAKE_ACP_AUTH_METHOD = "cursor_login";
    const authenticateCalls = async (environment: Record<string, string>) => {
      const rpcFile = join(scratch, `rpc-${Object.keys(environment).join("-") || "none"}.jsonl`);
      process.env.FAKE_ACP_RPC_APPEND_FILE = rpcFile;
      const instance = await CursorAgentDriver.create({
        instanceId: "cursor-auth",
        displayName: "Cursor",
        environment,
        enabled: true,
        config: { cli: FAKE_CLI, fullAuto: false },
      });
      const recorder = recordEvents(instance.adapter);
      try {
        await instance.adapter.sendTurn({ threadId: "t-cursor-auth", text: "hi" });
        expect(await recorder.until((e) => e.type === "turn.completed")).toMatchObject({ ok: true });
      } finally {
        recorder.stop();
        await instance.dispose();
      }
      return readFileSync(rpcFile, "utf8").trim().split("\n")
        .map((line) => JSON.parse(line) as { method: string })
        .filter((entry) => entry.method === "authenticate").length;
    };

    expect(await authenticateCalls({})).toBe(1);
    expect(await authenticateCalls({ CURSOR_API_KEY: "key-from-env" })).toBe(0);
    expect(await authenticateCalls({ CURSOR_AUTH_TOKEN: "token-from-env" })).toBe(0);
  });

  it("omits --force when fullAuto is off and still completes a turn", async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    const scratch = mkdtempSync(join(tmpdir(), "omb-cursor-safe-"));
    scratchDirs.push(scratch);
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;

    const instance = await CursorAgentDriver.create({
      instanceId: "cursor-safe",
      displayName: "Cursor",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    const recorder = recordEvents(instance.adapter);
    try {
      const { turnId } = await instance.adapter.sendTurn({ threadId: "t-cursor-safe", text: "hi" });
      await recorder.until((e) => e.type === "turn.completed");
      expect(JSON.parse(readFileSync(dump, "utf8")).argv).toEqual(["acp"]);
      expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "cursorAgent")).toBe(true);
      expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    } finally {
      recorder.stop();
      await instance.dispose();
    }
  });

  describe("cursor/ask_question", () => {
    // cursor-agent 2026.10.01's wire shape: no sessionId, a prompt per question, option ids, allowMultiple.
    const TWO_QUESTIONS = {
      toolCallId: "ask-1",
      title: "Setup",
      questions: [
        { id: "color", prompt: "Which color?", options: [{ id: "blue-id", label: "Blue" }, { id: "green-id", label: "Green" }], allowMultiple: false },
        { id: "sizes", prompt: "Which sizes?", options: [{ id: "s-id", label: "Small" }, { id: "m-id", label: "Medium, roomy" }, { id: "l-id", label: "Large" }], allowMultiple: true },
      ],
    };
    let scratch: string;
    let instance: Awaited<ReturnType<typeof CursorAgentDriver.create>>;
    let recorder: ReturnType<typeof recordEvents>;

    const start = async (threadId: string, env: Record<string, string> = {}) => {
      ensureDirs();
      chmodSync(FAKE_CLI, 0o755);
      scratch = mkdtempSync(join(tmpdir(), "omb-cursor-ask-"));
      Object.assign(process.env, { FAKE_ACP_MODE: "ask-question", FAKE_ACP_ASK_ANSWER: join(scratch, "answer.json"), ...env });
      instance = await CursorAgentDriver.create({
        instanceId: "cursor-ask",
        displayName: "Cursor",
        environment: {},
        enabled: true,
        config: { cli: FAKE_CLI, fullAuto: false },
      });
      recorder = recordEvents(instance.adapter);
      const { turnId } = await instance.adapter.sendTurn({ threadId, text: "hi" });
      return turnId;
    };
    const reply = () => JSON.parse(readFileSync(join(scratch, "answer.json"), "utf8"));

    afterEach(async () => {
      recorder?.stop();
      await instance?.dispose();
      for (const key of ["FAKE_ACP_MODE", "FAKE_ACP_ASK_ANSWER", "FAKE_ACP_ASK_PARAMS", "FAKE_ACP_ASK_METHOD", "FAKE_ACP_ASK_TIMING"]) delete process.env[key];
      if (scratch) await removeTempDir(scratch);
    });

    it("opens one question card and answers single and multi-select picks by option id", async () => {
      const turnId = await start("t-cursor-ask", { FAKE_ACP_ASK_PARAMS: JSON.stringify(TWO_QUESTIONS) });
      const opened = await recorder.until((e) => e.type === "request.opened");
      expect(opened).toMatchObject({
        requestType: "question",
        tool: "ask_user",
        summary: "Which color? (+1 more question)",
        questions: [
          { question: "Which color?", options: [{ label: "Blue" }, { label: "Green" }] },
          { question: "Which sizes?", multiSelect: true, options: [{ label: "Small" }, { label: "Medium, roomy" }, { label: "Large" }] },
        ],
      });
      // two questions cannot be answered by one flat button
      expect(opened).not.toHaveProperty("choices");
      const outcome = await instance.adapter.respondToRequest("t-cursor-ask", (opened as { requestId: string }).requestId, {
        behavior: "answer",
        message: "The user answered your questions.\n\nQ: Which color?\nA: Green\n\nQ: Which sizes?\nA: Medium, roomy, Large",
      });
      expect(outcome).toBe("answered");
      expect(await recorder.until((e) => e.type === "request.resolved")).toMatchObject({ behavior: "answer", source: "user" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      expect(reply()).toEqual({ result: { outcome: { outcome: "answered", answers: [
        { questionId: "color", selectedOptionIds: ["green-id"] },
        { questionId: "sizes", selectedOptionIds: ["m-id", "l-id"] },
      ] } } });
    });

    it("offers flat choices for one question and maps a bare label", async () => {
      await start("t-cursor-ask-flat");
      const opened = await recorder.until((e) => e.type === "request.opened");
      expect(opened).toMatchObject({ summary: "Which color?", choices: ["Blue", "Green"] });
      await instance.adapter.respondToRequest("t-cursor-ask-flat", (opened as { requestId: string }).requestId, { behavior: "answer", message: "Blue" });
      await recorder.until((e) => e.type === "turn.completed");
      expect(reply()).toEqual({ result: { outcome: { outcome: "answered", answers: [{ questionId: "color", selectedOptionIds: ["blue-id"] }] } } });
    });

    it("skips with every answer as the reason when the person typed their own words", async () => {
      await start("t-cursor-ask-own", { FAKE_ACP_ASK_PARAMS: JSON.stringify(TWO_QUESTIONS) });
      const opened = await recorder.until((e) => e.type === "request.opened");
      const outcome = await instance.adapter.respondToRequest("t-cursor-ask-own", (opened as { requestId: string }).requestId, {
        behavior: "answer",
        message: "The user answered your questions.\n\nQ: Which color?\nA: Blue\n\nQ: Which sizes?\nA: Small, one in XXL too",
      });
      expect(outcome).toBe("answered");
      await recorder.until((e) => e.type === "turn.completed");
      expect(reply()).toEqual({ result: { outcome: { outcome: "skipped", reason:
        "The user answered your questions.\n\nQ: Which color?\nA: Blue\n\nQ: Which sizes?\nA: Small, one in XXL too" } } });
    });

    it("cancels the request when the turn settles with the card still open", async () => {
      await start("t-cursor-ask-settle", { FAKE_ACP_ASK_TIMING: "with-result" });
      const opened = await recorder.until((e) => e.type === "request.opened");
      await recorder.until((e) => e.type === "turn.completed");
      expect(await recorder.until((e) => e.type === "request.resolved")).toMatchObject({
        requestId: (opened as { requestId: string }).requestId, behavior: "deny", source: "system",
      });
      for (let i = 0; i < 80 && !existsSync(join(scratch, "answer.json")); i++) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(reply()).toEqual({ result: { outcome: { outcome: "cancelled" } } });
    });

    it("cancels a request that arrives between turns without opening a card", async () => {
      await start("t-cursor-ask-idle", { FAKE_ACP_ASK_TIMING: "after-result" });
      await recorder.until((e) => e.type === "turn.completed");
      for (let i = 0; i < 80 && !existsSync(join(scratch, "answer.json")); i++) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(reply()).toEqual({ result: { outcome: { outcome: "cancelled" } } });
      expect(recorder.events.some((e) => e.type === "request.opened")).toBe(false);
    });

    it("refuses malformed params with invalid params instead of leaving Cursor blocked", async () => {
      await start("t-cursor-ask-bad", { FAKE_ACP_ASK_PARAMS: JSON.stringify({ questions: [{ question: "Which color?", options: ["Blue"] }] }) });
      await recorder.until((e) => e.type === "turn.completed");
      expect(reply()).toMatchObject({ error: { code: -32602 } });
      expect(recorder.events.some((e) => e.type === "request.opened")).toBe(false);
    });

    it("refuses more questions than one card holds instead of answering only some", async () => {
      const seven = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, prompt: `Question ${i}?`, options: [{ id: `o${i}`, label: "Yes" }] }));
      await start("t-cursor-ask-many", { FAKE_ACP_ASK_PARAMS: JSON.stringify({ toolCallId: "ask-7", questions: seven }) });
      await recorder.until((e) => e.type === "turn.completed");
      expect(reply()).toMatchObject({ error: { code: -32602, message: "ask needs 1 to 6 distinct questions with question text" } });
      expect(recorder.events.some((e) => e.type === "request.opened")).toBe(false);
    });

    it("refuses two questions with the same text, whose answers a card could not tell apart", async () => {
      const twins = [0, 1].map((i) => ({ id: `q${i}`, prompt: "Which color?", options: [{ id: `o${i}`, label: "Blue" }] }));
      await start("t-cursor-ask-twins", { FAKE_ACP_ASK_PARAMS: JSON.stringify({ toolCallId: "ask-twins", questions: twins }) });
      await recorder.until((e) => e.type === "turn.completed");
      expect(reply()).toMatchObject({ error: { code: -32602 } });
      expect(recorder.events.some((e) => e.type === "request.opened")).toBe(false);
    });

    it("cancels an unanswered card after 15 minutes", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await start("t-cursor-ask-timeout");
        const opened = await recorder.until((e) => e.type === "request.opened");
        await vi.advanceTimersByTimeAsync(15 * 60_000);
        expect(await recorder.until((e) => e.type === "request.resolved" && e.requestId === opened.requestId)).toMatchObject({
          behavior: "deny", source: "timeout",
        });
      } finally {
        vi.useRealTimers();
      }
      await recorder.until((e) => e.type === "turn.completed");
      expect(reply()).toEqual({ result: { outcome: { outcome: "cancelled" } } });
    });
  });

  it("fails when the parameterized settings method is missing", async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    process.env.FAKE_ACP_MODE = "no-session-config";
    const instance = await CursorAgentDriver.create({
      instanceId: "cursor-old",
      displayName: "Cursor",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    const recorder = recordEvents(instance.adapter);
    try {
      await instance.adapter.sendTurn({ threadId: "t-cursor-old", text: "hi", model: "gpt-5.3-codex" });
      const done = await recorder.until((e) => e.type === "turn.completed");
      expect(done).toMatchObject({ type: "turn.completed", ok: false });
    } finally {
      recorder.stop();
      await instance.dispose();
      delete process.env.FAKE_ACP_MODE;
    }
  });
});
