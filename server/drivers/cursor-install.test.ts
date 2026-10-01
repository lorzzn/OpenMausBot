import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeTempDir } from "../testing/cleanup.ts";
import { ProviderRegistry } from "../harness/registry.ts";
import { createCursorAgentDriver } from "./acp/cursor.ts";
import { resolveCursorCli } from "./cursor-auth.ts";
import { cursorInstallAsset, cursorManagedInstallAvailable, installCursorRuntime } from "./cursor-install.ts";

const VERSION = "2026.09.28-offline";
const SCRIPT = `DOWNLOAD_URL="https://downloads.cursor.com/lab/${VERSION}/\${OS}/\${ARCH}/agent-cli-package.tar.gz"`;
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

async function fixture(unsafeLink = false) {
  const root = await mkdtemp(join(tmpdir(), "omb-cursor-install-")); dirs.push(root);
  const home = join(root, "home");
  const packageRoot = join(root, "dist-package");
  await mkdir(join(home, ".local", "bin"), { recursive: true });
  await mkdir(packageRoot);
  await writeFile(join(home, ".local", "bin", "agent"), "Another engine's command; preserve it.");
  const fake = await readFile(fileURLToPath(new URL("../testing/fake-cursor-login-cli.ts", import.meta.url)), "utf8");
  await writeFile(join(packageRoot, "cursor-agent"), fake.replace(/^#![^\n]+/, `#!${process.execPath} --experimental-strip-types`), { mode: 0o700 });
  if (unsafeLink) await symlink("../../outside", join(packageRoot, "escape"));
  const stream = tar.c({ gzip: true, cwd: root, portable: true }, ["dist-package"]);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const archive = Buffer.concat(chunks);
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url) === "https://cursor.com/install") return new Response(SCRIPT);
    if (String(url) === `https://downloads.cursor.com/lab/${VERSION}/linux/x64/agent-cli-package.tar.gz`) return new Response(archive);
    throw new Error("unexpected download target");
  });
  const environment = { ...process.env, HOME: home, OMB_CURSOR_AUTH_FIXTURE: "1" };
  return { home, environment, fetchImpl };
}

describe("Cursor installation from Settings", () => {
  it("resolves only the first-party package for supported server platforms", () => {
    expect(cursorInstallAsset(SCRIPT, "linux", "arm64")).toEqual({ version: VERSION,
      url: `https://downloads.cursor.com/lab/${VERSION}/linux/arm64/agent-cli-package.tar.gz` });
    expect(cursorInstallAsset(SCRIPT, "darwin", "x64").url).toContain("/darwin/x64/");
    expect(cursorManagedInstallAvailable("win32", "x64")).toBe(false);
    for (const script of ["nothing", SCRIPT.replace("downloads.cursor.com", "evil.test"), SCRIPT.replace(VERSION, "../../escape"), SCRIPT + SCRIPT.replace(VERSION, "2026.09.30-offline")]) {
      expect(() => cursorInstallAsset(script, "linux", "x64")).toThrow("metadata");
    }
  });

  it("installs and verifies the CLI in persistent HOME without replacing agent or credentials", async () => {
    const { home, environment, fetchImpl } = await fixture();
    await writeFile(join(home, "saved-credentials"), "Unrelated engine data");
    await installCursorRuntime(environment, { fetchImpl, platform: "linux", arch: "x64" });
    expect(resolveCursorCli("cursor-agent", environment)).toBe(join(home, ".local", "bin", "cursor-agent"));
    expect(await readFile(join(home, ".local", "bin", "agent"), "utf8")).toContain("Another engine");
    expect(await readFile(join(home, "saved-credentials"), "utf8")).toBe("Unrelated engine data");
    expect((await readdir(join(home, ".local", "share", "cursor-agent", "versions")))).toEqual([VERSION]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const registry = new ProviderRegistry([createCursorAgentDriver()]);
    await registry.load({ cursor: { driver: "cursorAgent", environment: { HOME: home, OMB_CURSOR_AUTH_FIXTURE: "1" } } });
    try {
      const [instance] = await registry.describe();
      expect(instance.snapshot).toMatchObject({ state: "available", version: VERSION, authenticated: false });
      expect(instance.install?.server).toEqual({ updateOnly: false });
    } finally { await registry.disposeAll(); }
  });

  it("does no installation during discovery and installs only after an explicit maintenance action", async () => {
    const { home, environment, fetchImpl } = await fixture();
    const installer = vi.fn<typeof installCursorRuntime>((env, options) => installCursorRuntime(env, { ...options, fetchImpl, platform: "linux", arch: "x64" }));
    const registry = new ProviderRegistry([createCursorAgentDriver(undefined, installer)]);
    await registry.load({ cursor: { driver: "cursorAgent", environment: { HOME: home, OMB_CURSOR_AUTH_FIXTURE: "1" } } });
    try {
      const [before] = await registry.describe();
      expect(before.snapshot.state).toBe("unavailable");
      expect(before.install?.server).toEqual({ updateOnly: false });
      expect(installer).not.toHaveBeenCalled();
      expect(await registry.installRuntime("cursor")).toBe(true);
      expect(installer).toHaveBeenCalledTimes(1);
      expect(resolveCursorCli("cursor-agent", environment)).not.toBe("cursor-agent");
      expect(await registry.installRuntime("cursor")).toBe(true);
      expect(installer).toHaveBeenCalledTimes(1); // The second click uses native update.
    } finally { await registry.disposeAll(); }
  });

  it("rejects escaping archive links without activating a shim", async () => {
    const { home, environment, fetchImpl } = await fixture(true);
    await expect(installCursorRuntime(environment, { fetchImpl, platform: "linux", arch: "x64" })).rejects.toThrow("unsupported files");
    expect(existsSync(join(home, ".local", "bin", "cursor-agent"))).toBe(false);
    expect(await readdir(join(home, ".local", "share", "cursor-agent", "versions"))).toEqual([]);
  });

  it("leaves the working installation untouched if verification fails", async () => {
    const { home, environment, fetchImpl } = await fixture();
    await writeFile(join(home, ".omb-fake-cursor-updated"), "Fixture reports a mismatched version");
    await expect(installCursorRuntime(environment, { fetchImpl, platform: "linux", arch: "x64" })).rejects.toThrow("could not be verified");
    expect(existsSync(join(home, ".local", "bin", "cursor-agent"))).toBe(false);
    expect(await readdir(join(home, ".local", "share", "cursor-agent", "versions"))).toEqual([]);
    expect(await readFile(join(home, ".local", "bin", "agent"), "utf8")).toContain("Another engine");
  });

  it("rejects oversized metadata and cancelled requests before downloading an archive", async () => {
    const { home, environment } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(128 * 1024 + 1)));
    await expect(installCursorRuntime(environment, { fetchImpl })).rejects.toThrow("size limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(join(home, ".local", "share", "cursor-agent"))).toBe(false);
    await expect(installCursorRuntime(environment, { signal: AbortSignal.abort() })).rejects.toThrow();
  });
});
