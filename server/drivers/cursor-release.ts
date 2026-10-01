import type { ProviderSnapshot } from "../contracts.ts";
import { execCli } from "../procs.ts";
import { cliUpdateCommand } from "./cli-update-command.ts";

interface CursorRelease {
  version: string;
  updateAvailable: boolean;
}

function releaseDate(version: string): number | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})-[a-z0-9][a-z0-9.-]{0,63}$/i.exec(version);
  if (!match) return null;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return date.getTime();
}

function decodeRelease(stdout: string, installed: string): CursorRelease | null {
  try {
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    if (payload.cliVersion !== installed || !["up_to_date", "update_available"].includes(String(payload.latestStatus))) return null;
    if (typeof payload.latestVersion !== "string") return null;
    const currentDate = releaseDate(installed);
    const latestDate = releaseDate(payload.latestVersion);
    if (currentDate === null || latestDate === null) return null;
    return {
      version: payload.latestVersion,
      // The CLI resolves its configured release channel. Its explicit status
      // also distinguishes different builds on the same day; never downgrade.
      updateAvailable: payload.latestStatus === "update_available" && latestDate >= currentDate && payload.latestVersion !== installed,
    };
  } catch {
    return null;
  }
}

/** Same probe lifecycle as Codex: shared in-flight reads, one-hour freshness
 * and five-minute offline retry. Allow eight seconds like the other Cursor
 * CLI probes, including executable startup time. Each instance owns
 * its cache because Cursor's release channel lives in that instance's home. */
export function createCursorReleaseReader(run: typeof execCli = execCli, now = Date.now) {
  let cached: { key: string; expires: number; result: Promise<CursorRelease | null> } | undefined;
  return (cli: string, environment: NodeJS.ProcessEnv, installed: string): Promise<CursorRelease | null> => {
    if (releaseDate(installed) === null) return Promise.resolve(null);
    const key = JSON.stringify([cli, installed, environment.HOME, environment.USERPROFILE, environment.XDG_CONFIG_HOME, environment.APPDATA]);
    if (cached?.key === key && now() < cached.expires) return cached.result;
    const entry = { key, expires: now() + 60 * 60 * 1000, result: Promise.resolve<CursorRelease | null>(null) };
    cached = entry;
    entry.result = (async () => {
      try {
        const env = { ...environment };
        // Native test-endpoint overrides must not redirect a release probe.
        delete env.AGENT_CLI_UPDATE_CHECK_URL;
        const stdout = await new Promise<string | null>((resolve) => {
          // `about` only reads metadata; `update` is reserved for the existing
          // user-initiated, idle-engine update route.
          run(cli, ["about", "--format", "json"], { env, timeout: 8000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 }, (error, output) => {
            resolve(error ? null : String(output ?? ""));
          });
        });
        const release = stdout === null ? null : decodeRelease(stdout, installed);
        if (!release) entry.expires = now() + 5 * 60 * 1000;
        return release;
      } catch {
        // An unavailable release service must not disable a working engine.
        entry.expires = now() + 5 * 60 * 1000;
        return null;
      }
    })();
    return entry.result;
  };
}

export function cursorReleaseUpdate(installed: string, release: CursorRelease | null, cli: string): ProviderSnapshot["update"] | undefined {
  if (!release?.updateAvailable) return undefined;
  return {
    title: `Update Cursor to ${release.version}`,
    message: `A newer Cursor CLI is available (installed: ${installed}). Update it, then refresh models. Model availability also depends on your signed-in account.`,
    command: cliUpdateCommand(cli, "cursor-agent"),
  };
}
