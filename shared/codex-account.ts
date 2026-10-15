export const CODEX_ACCOUNT_AUTH_MODES = ["device-code", "chatgpt-plan"] as const;

export type CodexAccountAuthMode = typeof CODEX_ACCOUNT_AUTH_MODES[number];

export function isCodexAccountAuthMode(value: unknown): value is CodexAccountAuthMode {
  return CODEX_ACCOUNT_AUTH_MODES.some((mode) => mode === value);
}
