import type { InstanceConfigMap } from "./contracts.ts";
import { isCodexAccountAuthMode } from "../shared/codex-account.ts";
import { codexAccountDirectories } from "./drivers/codex-account.ts";
import type { PlanAccount, PlanDriver } from "./plan-usage.ts";

const DRIVER_OF: Record<string, PlanDriver> = {
  claudeAgent: "claude",
  codex: "codex",
  grokAgent: "grok",
  cursorAgent: "cursor",
  antigravityAgent: "antigravity",
};

export const PRODUCT_NAME: Record<PlanDriver, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  cursor: "Cursor",
  antigravity: "Antigravity",
};

export function planAccountsFromInstances(instances: InstanceConfigMap): PlanAccount[] {
  const accounts: PlanAccount[] = [];
  for (const [id, entry] of Object.entries(instances)) {
    const driver = DRIVER_OF[entry.driver];
    if (!driver) continue;
    const config = entry.config && typeof entry.config === "object" && !Array.isArray(entry.config) ? entry.config as Record<string, unknown> : undefined;
    const configDir = typeof config?.configDir === "string" ? config.configDir : undefined;
    const environment = { ...entry.environment };
    if (driver === "codex" && isCodexAccountAuthMode(config?.authMode)) environment.CODEX_HOME = codexAccountDirectories(id, config.authMode).home;
    accounts.push({
      id,
      name: entry.displayName?.trim() || PRODUCT_NAME[driver],
      driver,
      environment,
      ...(configDir ? { configDir } : {}),
    });
  }
  return accounts;
}
