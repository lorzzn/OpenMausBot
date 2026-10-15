// Cursor Agent (`cursor-agent acp`) on the Cursor subscription (`cursor-agent login`, CURSOR_API_KEY or
// CURSOR_AUTH_TOKEN). Per cursor.com/docs/cli/acp it advertises `cursor_login`; approval flags precede `acp`.
import type { ModelCatalog, ProviderErrorCode } from "../../contracts.ts";
import { titleCaseModelId } from "../../contracts.ts";
import { execCli } from "../../procs.ts";
import { augmentedPath, resetPathCache } from "../../env-path.ts";
import { PROVIDER_CREDENTIAL_ENV, WORKSPACE_CREDENTIAL_ENV, stripControlPlaneEnv } from "../../config.ts";
import { CursorAuthController, resolveCursorCli } from "../cursor-auth.ts";
import { createCursorReleaseReader, cursorReleaseUpdate } from "../cursor-release.ts";
import { cursorManagedInstallAvailable, installCursorRuntime } from "../cursor-install.ts";
import { createAcpDriver, type AcpSupport } from "./core.ts";
import { configureCursorModel } from "./cursor-model.ts";
import type { AcpQuestionRequest } from "./question-requests.ts";
import {
  capAnswerEcho, formatQuestionAnswers, MAX_QUESTIONS, parseChoices, parseProtocolAskQuestions, pickedOptionLabels, questionAnswersById,
  repeatsQuestionText,
} from "../../../shared/ask-question.ts";

export const STATIC_CURSOR_MODELS: ModelCatalog = {
  default: "auto",
  options: [
    { id: "auto", label: "Auto" },
    { id: "composer-2.5", label: "Composer 2.5" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
    { id: "gpt-5.3-codex", label: "Codex 5.3" },
    { id: "claude-sonnet-5-thinking-high", label: "Claude Sonnet 5 1M Thinking" },
  ],
};

const SLUG = /^[a-z0-9][a-z0-9._:+-]*$/i;
const EXEC_TIMEOUT_MS = 8_000;

const nonBlank = (value: string | undefined): boolean => Boolean(value?.trim());

function firstJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // CLIs sometimes print a banner before the payload.
  }
  const start = trimmed.search(/[{[]/);
  if (start < 0) return null;
  for (let end = trimmed.length; end > start + 1; end--) {
    const slice = trimmed.slice(start, end).trim();
    if (!slice.endsWith("}") && !slice.endsWith("]")) continue;
    try {
      return JSON.parse(slice);
    } catch {}
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function labelFor(id: string, explicit?: string): string {
  const trimmed = explicit?.trim();
  return trimmed || titleCaseModelId(id, /[-_./]+/);
}

function pushModel(
  options: ModelCatalog["options"],
  seen: Set<string>,
  id: string,
  label?: string,
  custom = false,
): void {
  if (!SLUG.test(id) || seen.has(id)) return;
  seen.add(id);
  options.push({ id, label: labelFor(id, label), ...(custom ? { custom: true as const } : {}) });
}

export function decodeCursorModelCatalog(payload: unknown): ModelCatalog | null {
  const records: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.models)
      ? (asRecord(payload)!.models as unknown[])
      : Array.isArray(asRecord(payload)?.data)
        ? (asRecord(payload)!.data as unknown[])
        : Array.isArray(asRecord(payload)?.modelIds)
          ? (asRecord(payload)!.modelIds as unknown[])
          : [];
  if (!records.length) return null;

  const options: ModelCatalog["options"] = [];
  const seen = new Set<string>();
  for (const row of records) {
    if (typeof row === "string") {
      pushModel(options, seen, row);
      continue;
    }
    const rec = asRecord(row);
    if (!rec) continue;
    const id = rec.id ?? rec.modelId ?? rec.slug ?? rec.name;
    if (typeof id !== "string") continue;
    const label =
      (typeof rec.label === "string" && rec.label) ||
      (typeof rec.displayName === "string" && rec.displayName) ||
      (typeof rec.name === "string" && rec.name !== id ? rec.name : undefined);
    pushModel(options, seen, id, label || undefined);
  }
  if (!options.length) return null;

  const defaultId =
    (typeof asRecord(payload)?.default === "string" && seen.has(asRecord(payload)!.default as string)
      ? (asRecord(payload)!.default as string)
      : undefined) ??
    (seen.has(STATIC_CURSOR_MODELS.default) ? STATIC_CURSOR_MODELS.default : options[0]!.id);

  const merged: ModelCatalog["options"] = STATIC_CURSOR_MODELS.options.map((option) => ({ ...option }));
  const mergedSeen = new Set(merged.map((option) => option.id));
  for (const option of options) {
    if (mergedSeen.has(option.id)) continue;
    mergedSeen.add(option.id);
    merged.push(option);
  }
  return { default: defaultId, options: merged };
}

function stripModelMarkers(label: string): { label: string; isDefault: boolean; isCurrent: boolean } {
  let cleaned = label.trim();
  let isDefault = false;
  let isCurrent = false;
  const defaultMatch = cleaned.match(/\s*\(default\)\s*$/i);
  if (defaultMatch) {
    isDefault = true;
    cleaned = cleaned.slice(0, defaultMatch.index).trim();
  }
  const currentMatch = cleaned.match(/\s*\(current\)\s*$/i);
  if (currentMatch) {
    isCurrent = true;
    cleaned = cleaned.slice(0, currentMatch.index).trim();
  }
  return { label: cleaned, isDefault, isCurrent };
}

/** Plain `cursor-agent models` text: one slug per line, optional `id - label`, `(default)` / `(current)` markers. */
export function decodeCursorModelText(text: string): ModelCatalog | null {
  const options: ModelCatalog["options"] = [];
  const seen = new Set<string>();
  let markedDefault: string | undefined;
  let markedCurrent: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^available\s+models?\b/i.test(line) || /^models?\b/i.test(line)) continue;
    const stripped = line.replace(/^[\s*•-]+\s*/, "");
    const parts = stripped.split(/\s+[—–|:]\s+|\s+-\s+|\s{2,}/);
    const id = (parts[0] ?? "").trim();
    const rawLabel = parts.slice(1).join(" ").trim();
    const { label, isDefault, isCurrent } = stripModelMarkers(rawLabel);
    pushModel(options, seen, id, label || undefined);
    if (isDefault) markedDefault = id;
    if (isCurrent) markedCurrent = id;
  }
  if (!options.length) return null;
  const merged: ModelCatalog["options"] = STATIC_CURSOR_MODELS.options.map((option) => ({ ...option }));
  const mergedSeen = new Set(merged.map((option) => option.id));
  for (const option of options) {
    if (mergedSeen.has(option.id)) continue;
    mergedSeen.add(option.id);
    merged.push(option);
  }
  const defaultId =
    (markedDefault && seen.has(markedDefault) ? markedDefault : undefined) ??
    (markedCurrent && seen.has(markedCurrent) ? markedCurrent : undefined) ??
    (seen.has(STATIC_CURSOR_MODELS.default) ? STATIC_CURSOR_MODELS.default : options[0]!.id);
  return { default: defaultId, options: merged };
}

function truthyAuthFlag(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "authenticated", "logged_in", "logged-in", "yes"].includes(normalized)) return true;
    if (["false", "unauthenticated", "logged_out", "logged-out", "no"].includes(normalized)) return false;
  }
  return null;
}

export function decodeCursorAuthStatus(payload: unknown): boolean | null {
  const rec = asRecord(payload);
  if (!rec) return null;
  const auth = asRecord(rec.auth);
  const candidates = [
    rec.isAuthenticated,
    rec.authenticated,
    rec.loggedIn,
    rec.logged_in,
    auth?.isAuthenticated,
    auth?.authenticated,
    rec.status,
    auth?.status,
  ];
  for (const candidate of candidates) {
    const flag = truthyAuthFlag(candidate);
    if (flag !== null) return flag;
  }
  return null;
}

export function decodeCursorAuthText(text: string): boolean | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  if (/not (?:logged|signed) in|not authenticated|unauthenticated|logged out/.test(normalized)) return false;
  if (/login successful|logged in|signed in|authenticated/.test(normalized)) return true;
  return null;
}

function execText(
  run: typeof execCli,
  cli: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<string | null> {
  return new Promise((resolve) => {
    run(cli, args, { timeout: EXEC_TIMEOUT_MS, env: env as NodeJS.ProcessEnv }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout ?? ""));
    });
  });
}

export async function probeCursorAuth(
  cli: string,
  env: Record<string, string | undefined>,
  run: typeof execCli = execCli,
): Promise<boolean> {
  if (nonBlank(env.CURSOR_API_KEY) || nonBlank(env.CURSOR_AUTH_TOKEN)) return true;
  for (const args of [["status", "--format", "json"], ["status"]] as const) {
    const stdout = await execText(run, cli, [...args], env);
    if (stdout == null) continue;
    const decoded = decodeCursorAuthStatus(firstJsonValue(stdout)) ?? decodeCursorAuthText(stdout);
    if (decoded !== null) return decoded;
  }
  return false;
}

export async function fetchCursorModels(
  cli: string,
  env: Record<string, string | undefined>,
  run: typeof execCli = execCli,
): Promise<ModelCatalog> {
  // Live CLI prints plain text (`slug - Label`); `--format json` is not supported yet.
  for (const args of [["models"], ["--list-models"]] as const) {
    const stdout = await execText(run, cli, [...args], env);
    if (stdout == null) continue;
    const fromText = decodeCursorModelText(stdout);
    if (fromText) return fromText;
    const fromJson = decodeCursorModelCatalog(firstJsonValue(stdout));
    if (fromJson) return fromJson;
  }
  return STATIC_CURSOR_MODELS;
}

export function classifyCursorError(error: unknown): ProviderErrorCode | undefined {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  const blob = `${code ?? ""} ${message}`.toLowerCase();
  if (
    code === -32000 ||
    /unauthoriz|unauthenticated|not signed in|not logged in|invalid api key|invalid_credentials|authentication required/.test(
      blob,
    )
  ) {
    return "invalid_credentials";
  }
  if (/inactive subscription|subscription.*(expired|inactive)|upgrade your (plan|subscription)/.test(blob)) {
    return "inactive_subscription";
  }
  return undefined;
}

/** Cursor's AskQuestion blocks on `cursor/ask_question` (cursor.com/docs/cli/acp; cursor-agent 2026.10.01, no sessionId).
 * Cursor answers by option id only, so a reply with any own words goes back whole as `skipped` with the answers as the
 * reason, which Cursor hands the model verbatim: a typed answer is never forced onto an option. */
export const CURSOR_ASK_QUESTION: AcpQuestionRequest = {
  cancelled: { outcome: { outcome: "cancelled" } },
  parse(params) {
    const raw = (params as { questions?: unknown } | null)?.questions;
    if (!Array.isArray(raw) || raw.length > MAX_QUESTIONS) return null;
    const parsed = parseProtocolAskQuestions(raw.map((entry) =>
      entry && typeof entry === "object"
        ? { id: entry.id, question: entry.prompt, options: entry.options, multiSelect: entry.allowMultiple === true }
        : entry));
    if (!parsed || repeatsQuestionText(parsed)) return null;
    const rawOptions = new Map<string, unknown[]>(raw.flatMap((entry) =>
      entry && typeof entry.id === "string" && Array.isArray(entry.options) ? [[entry.id, entry.options]] : []));
    // Card labels are trimmed and capped: never guess when two options normalize alike.
    const optionId = (questionId: string, label: string): string | null => {
      const matches = (rawOptions.get(questionId) ?? []).filter((option) => parseChoices([option], 1)?.[0] === label);
      const id = matches.length === 1 ? (matches[0] as { id?: unknown }).id : null;
      return typeof id === "string" ? id : null;
    };
    const questions = parsed.map(({ question }) => question);
    return {
      questions,
      answered(message) {
        const byId = questionAnswersById(message, parsed);
        const answers: Array<{ questionId: string; selectedOptionIds: string[] }> = [];
        let ownWords = false;
        for (const { id, question } of parsed) {
          const reply = byId[id];
          if (reply === undefined) continue;
          const { labels, other } = pickedOptionLabels(reply, question);
          const selectedOptionIds = labels.map((label) => optionId(id, label));
          if (other !== undefined || selectedOptionIds.some((selected) => selected === null)) ownWords = true;
          else answers.push({ questionId: id, selectedOptionIds: selectedOptionIds as string[] });
        }
        if (ownWords) {
          const reason = formatQuestionAnswers(questions, parsed.map(({ id }) => byId[id] ? [byId[id]] : []));
          return { outcome: { outcome: "skipped", reason: capAnswerEcho(reason) } };
        }
        return answers.length ? { outcome: { outcome: "answered", answers } } : null;
      },
    };
  },
};

const support = (run: typeof execCli): AcpSupport => ({
  driverKind: "cursorAgent",
  questionRequests: { "cursor/ask_question": CURSOR_ASK_QUESTION },
  displayName: "Cursor",
  models: STATIC_CURSOR_MODELS,
  // Other coding agents can install a generic `agent` shim; `cursor-agent` is unambiguous.
  defaultCli: "cursor-agent",
  nativeSource: "cursor.acp",
  loginNote: "Cursor CLI is not signed in — connect Cursor in Settings → Engines, or set CURSOR_API_KEY",

  install: {
    command: {
      darwin: "curl https://cursor.com/install -fsS | bash",
      linux: "curl https://cursor.com/install -fsS | bash",
      win32: "irm 'https://cursor.com/install?win32=true' | iex",
    },
    docsUrl: "https://cursor.com/docs/cli/installation",
    signInCommand: "cursor-agent login",
  },

  // Global flags precede `acp`; `--force` is the documented auto-approve switch.
  spawnArgs: (config, turn) => [
    ...(config.fullAuto ? ["--force"] : turn.approvalMode === "auto" ? ["--auto-review"] : []),
    "acp",
  ],
  credentialEnv: ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"],

  resolveCommand: async (environment, config) => ({ command: resolveCursorCli(config.cli, environment) }),
  resolveModels: (environment, config) => fetchCursorModels(resolveCursorCli(config.cli, environment), environment, run),
  async snapshot(environment, config) {
    const cli = resolveCursorCli(config.cli, environment);
    const version = (await execText(run, cli, ["--version"], environment))?.trim();
    if (!version) return { state: "unavailable", reason: `\`${cli}\` CLI not found` };
    return { state: "available", version, authenticated: await probeCursorAuth(cli, environment, run) };
  },

  // A key in the env already authenticates the session, and Cursor's cursor_login handler would then
  // delete the saved login and open a browser once the token expired, so it is not sent.
  pickAuthMethod: (methods, env) =>
    nonBlank(env.CURSOR_API_KEY) || nonBlank(env.CURSOR_AUTH_TOKEN) ? null
      : methods.some((m) => m.id === "cursor_login") ? "cursor_login" : null,
  authFailure: "continue",
  isAuthenticated: (env, config) => probeCursorAuth(resolveCursorCli(config.cli, env), env, run),
  classifyError: classifyCursorError,

  clientCapabilities: { _meta: { parameterizedModelPicker: true } },
  async configureSession({ request, sessionId, turn, modelLabel }) {
    if (turn.model) await configureCursorModel(request, sessionId, turn.model, modelLabel);
  },

  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
});

export function createCursorAgentDriver(run: typeof execCli = execCli, installer = installCursorRuntime) {
  const driver = createAcpDriver(support(run));
  return {
    ...driver,
    async create(input: Parameters<typeof driver.create>[0]) {
      const base = await driver.create(input);
      const environment = () => {
        const env: NodeJS.ProcessEnv = { ...process.env, ...input.environment, PATH: augmentedPath() };
        for (const key of [...PROVIDER_CREDENTIAL_ENV, ...WORKSPACE_CREDENTIAL_ENV]) {
          if (key !== "CURSOR_API_KEY" && key !== "CURSOR_AUTH_TOKEN") delete env[key];
        }
        stripControlPlaneEnv(env);
        return env;
      };
      const auth = new CursorAuthController({ cli: input.config.cli, environment,
        authenticated: (cli, env) => probeCursorAuth(cli, env, run), onAuthenticated: base.refreshModels, installer });
      const readRelease = createCursorReleaseReader(run);
      let installFailure: string | undefined;
      const verifyAndRefresh = async () => {
        resetPathCache();
        const snapshot = await base.snapshot();
        if (snapshot.state !== "available") throw new Error("Cursor's CLI could not be verified. Check Settings → Engines.");
        installFailure = undefined;
        await base.adapter.stopAll();
        await base.refreshModels?.();
      };
      return {
        ...base,
        get models() { return base.models; },
        async snapshot() {
          const snapshot = await base.snapshot();
          if (snapshot.state !== "available" || !snapshot.version) return installFailure ? { ...snapshot, reason: installFailure } : snapshot;
          installFailure = undefined;
          const env = environment();
          const release = await readRelease(resolveCursorCli(input.config.cli, env), env, snapshot.version);
          const update = cursorReleaseUpdate(snapshot.version, release, input.config.cli);
          return { ...snapshot, ...(update ? { update } : {}) };
        },
        authenticationMethod: "browser-poll" as const,
        startAuthentication: () => auth.start(),
        getAuthentication: (flowId: string) => auth.get(flowId),
        cancelAuthentication: () => auth.cancel(),
        // A manually selected CLI remains pinned until its owner resets it.
        ...(input.config.cli === "cursor-agent" ? {
          updateRuntime: async () => { await auth.update(); await verifyAndRefresh(); },
          ...(cursorManagedInstallAvailable() ? { installRuntime: async () => {
            installFailure = undefined;
            try {
              const env = environment();
              const version = await execText(run, resolveCursorCli(input.config.cli, env), ["--version"], env);
              if (version?.trim()) await auth.update();
              else await auth.install();
              await verifyAndRefresh();
            } catch (cause) {
              if ((cause as { status?: number })?.status === 409) throw cause;
              installFailure = "Cursor installation or update did not finish. Check the server connection and writable HOME directory, then try again.";
              throw new Error(installFailure);
            }
          } } : {}),
        } : {}),
        async dispose() { try { await auth.dispose(); } finally { await base.dispose(); } },
      };
    },
  };
}

export const CursorAgentDriver = createCursorAgentDriver();
