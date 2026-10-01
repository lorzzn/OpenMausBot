import { describe, expect, it, vi } from "vitest";
import { execCli } from "../procs.ts";
import { cliUpdateCommand } from "./cli-update-command.ts";
import { createCursorReleaseReader, cursorReleaseUpdate } from "./cursor-release.ts";

const installed = "2026.09.28-64d2043";
const newer = "2026.09.30-abcd123";
const metadata = (latestVersion = newer, latestStatus = "update_available", cliVersion = installed) => ({
  cliVersion, latestStatus, latestVersion, userEmail: "private@example.invalid", subscriptionTier: "private-account-info",
});
const runner = (body: unknown) => vi.fn<typeof execCli>().mockImplementation((_cli, _args, _options, done) => done(null, JSON.stringify(body)));

describe("Cursor native release checks", () => {
  it("uses the configured CLI's read-only metadata and the shared engine update notice", async () => {
    const run = runner(metadata());
    const read = createCursorReleaseReader(run);
    const release = await read("cursor-agent", { HOME: "/isolated/cursor", AGENT_CLI_UPDATE_CHECK_URL: "https://untrusted.invalid" }, installed);
    const update = cursorReleaseUpdate(installed, release, "cursor-agent");
    expect(update).toMatchObject({ title: `Update Cursor to ${newer}`, command: "cursor-agent update" });
    expect(JSON.stringify(update)).not.toContain("private");
    expect(run).toHaveBeenCalledWith("cursor-agent", ["about", "--format", "json"], expect.objectContaining({
      timeout: 8000, killSignal: "SIGKILL", maxBuffer: 16 * 1024, env: { HOME: "/isolated/cursor" },
    }), expect.any(Function));
  });

  it("shares simultaneous checks and refreshes after an hour", async () => {
    let now = 0;
    let complete!: Parameters<typeof execCli>[3];
    const run = vi.fn<typeof execCli>().mockImplementation((_cli, _args, _options, done) => { complete = done; });
    const read = createCursorReleaseReader(run, () => now);
    const first = read("cursor-agent", {}, installed);
    const second = read("cursor-agent", {}, installed);
    expect(run).toHaveBeenCalledTimes(1);
    complete(null, JSON.stringify(metadata()));
    expect(await first).toEqual(await second);
    now = 3_599_999;
    expect(await read("cursor-agent", {}, installed)).toEqual(await first);
    expect(run).toHaveBeenCalledTimes(1);
    now = 3_600_001;
    const refresh = read("cursor-agent", {}, installed);
    complete(null, JSON.stringify(metadata("2026.10.01-abc123")));
    expect((await refresh)?.version).toBe("2026.10.01-abc123");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries offline checks after five minutes and never publishes native errors", async () => {
    let now = 0;
    const run = vi.fn<typeof execCli>().mockImplementation((_cli, _args, _options, done) => done(new Error("private access token"), ""));
    const read = createCursorReleaseReader(run, () => now);
    expect(await read("cursor-agent", {}, installed)).toBeNull();
    expect(await read("cursor-agent", {}, installed)).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    now = 300_001;
    run.mockImplementation((_cli, _args, _options, done) => done(null, JSON.stringify(metadata())));
    expect((await read("cursor-agent", {}, installed))?.updateAvailable).toBe(true);
  });

  it("drops cached notices when the installed binary, configured CLI or home changes", async () => {
    const run = runner(metadata());
    const read = createCursorReleaseReader(run);
    expect((await read("cursor-agent", { HOME: "/fixture/a" }, installed))?.updateAvailable).toBe(true);
    run.mockImplementation((_cli, _args, _options, done) => done(null, JSON.stringify(metadata(newer, "up_to_date", newer))));
    expect(cursorReleaseUpdate(newer, await read("cursor-agent", { HOME: "/fixture/a" }, newer), "cursor-agent")).toBeUndefined();
    await read("/custom/cursor-agent", { HOME: "/fixture/a" }, newer);
    await read("/custom/cursor-agent", { HOME: "/fixture/b" }, newer);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it.each([
    metadata(installed, "up_to_date"),
    metadata("2026.09.27-abc123"),
    metadata(installed),
    metadata(newer, "up_to_date"),
  ])("does not advise updates for current, newer or inconsistent installations: %j", async (body) => {
    const release = await createCursorReleaseReader(runner(body))("cursor-agent", {}, installed);
    expect(cursorReleaseUpdate(installed, release, "cursor-agent")).toBeUndefined();
  });

  it("honors the native channel's explicit same-day build update", async () => {
    const release = await createCursorReleaseReader(runner(metadata("2026.09.28-abcd123")))("cursor-agent", {}, installed);
    expect(release?.updateAvailable).toBe(true);
  });

  it.each([
    {}, null, metadata("malformed"), metadata("2026.02.31-abc123"),
    metadata("2026.09.30-private\ntoken"), metadata(newer, "unavailable"),
    metadata(newer, "disabled"), metadata(newer, "update_available", "2026.09.27-abc123"),
  ])("ignores unavailable, disabled or malformed native metadata: %j", async (body) => {
    expect(await createCursorReleaseReader(runner(body))("cursor-agent", {}, installed)).toBeNull();
  });

  it("leaves unrecognized wrappers alone and keeps commands pointed at custom paths", async () => {
    const run = runner(metadata());
    expect(await createCursorReleaseReader(run)("wrapper", {}, "custom nightly")).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(cliUpdateCommand("cursor-agent", "cursor-agent", "linux")).toBe("cursor-agent update");
    expect(cliUpdateCommand("'/Applications/My Cursor/agent' --endpoint https://api.cursor.test", "cursor-agent", "darwin"))
      .toBe("'/Applications/My Cursor/agent' '--endpoint' 'https://api.cursor.test' update");
    expect(cliUpdateCommand("'C:\\Program Files\\Cursor\\agent.exe'", "cursor-agent", "win32"))
      .toBe("& 'C:\\Program Files\\Cursor\\agent.exe' update");
  });
});
