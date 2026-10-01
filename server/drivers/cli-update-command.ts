import { existsSync } from "node:fs";
import { splitCliString } from "../env-path.ts";

/** Keep update instructions pointed at the configured executable, including
 * wrapper arguments and paths with spaces, just like resolveCliSpawn. */
export function cliUpdateCommand(cli: string, defaultCli: string, platform: NodeJS.Platform = process.platform): string {
  if (cli === defaultCli) return `${defaultCli} update`;
  const trimmed = cli.trim();
  const tokens = trimmed.includes(" ") && existsSync(trimmed) ? [trimmed] : splitCliString(trimmed);
  const quote = platform === "win32"
    ? (token: string) => `'${token.replaceAll("'", "''")}'`
    : (token: string) => `'${token.replaceAll("'", `'\\''`)}'`;
  const command = (tokens.length > 0 ? tokens : [trimmed]).map(quote).join(" ");
  return platform === "win32" ? `& ${command} update` : `${command} update`;
}
