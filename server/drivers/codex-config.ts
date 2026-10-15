import { isCodexAccountAuthMode, type CodexAccountAuthMode } from "../../shared/codex-account.ts";

export interface CodexConfig {
  cli: string;
  fullAuto: boolean;
  authMode?: CodexAccountAuthMode;
  managed?: { url: string; models: string[] };
}

export function decodeConfig(raw: unknown): CodexConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.authMode !== undefined && !isCodexAccountAuthMode(o.authMode)) throw new Error("Unknown Codex sign-in mode.");
  if (o.authMode && o.managed) throw new Error("Codex account sign-in and Company billing cannot be combined.");
  return {
    cli: typeof o.cli === "string" ? o.cli : "codex",
    fullAuto: o.fullAuto === true,
    ...(isCodexAccountAuthMode(o.authMode) ? { authMode: o.authMode } : {}),
    ...(o.managed && typeof o.managed === "object" ? { managed: decodeManagedCodex(o.managed) } : {}),
  };
}

function decodeManagedCodex(raw: object): NonNullable<CodexConfig["managed"]> {
  const value = raw as { url?: unknown; models?: unknown };
  if (typeof value.url !== "string" || !Array.isArray(value.models) || !value.models.length || value.models.some(model => typeof model !== "string" || !/^[\w][\w./+-]*$/.test(model))) {
    throw new Error("Invalid Company Codex configuration.");
  }
  const url = new URL(value.url);
  // Plain HTTP leaks the Company API key; allow it only on loopback.
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("Invalid Company Codex endpoint.");
  return { url: url.href.replace(/\/$/, ""), models: value.models as string[] };
}
