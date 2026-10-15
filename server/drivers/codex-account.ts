import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CodexAccountAuthMode } from "../../shared/codex-account.ts";
import { DATA_DIR } from "../config.ts";

export function codexAccountDirectories(instanceId: string, mode: CodexAccountAuthMode): { directory: string; home: string } {
  const provider = mode === "chatgpt-plan" ? "chatgpt-plan" : "codex";
  const directory = join(DATA_DIR, "providers", provider, createHash("sha256").update(instanceId).digest("hex"));
  return { directory, home: join(directory, "codex") };
}
