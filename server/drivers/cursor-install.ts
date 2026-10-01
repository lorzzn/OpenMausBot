import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import * as tar from "tar";
import { userHome } from "../env-path.ts";
import { execCli } from "../procs.ts";

const INSTALLER_URL = "https://cursor.com/install";
const MAX_SCRIPT_BYTES = 128 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;

export function cursorManagedInstallAvailable(platform: NodeJS.Platform = process.platform, arch: string = process.arch): boolean {
  return (platform === "linux" || platform === "darwin") && (arch === "x64" || arch === "arm64");
}

/** Resolve the version advertised by Cursor's official installer without
 * executing its shell script or replacing another engine's `agent` alias. */
export function cursorInstallAsset(script: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch) {
  if (!cursorManagedInstallAvailable(platform, arch)) throw new Error("Use Cursor's installation guide for this server platform.");
  const versions = [...script.matchAll(/https:\/\/downloads\.cursor\.com\/lab\/(\d{4}\.\d{2}\.\d{2}-[a-z0-9][a-z0-9.-]{0,63})\/\$\{OS\}\/\$\{ARCH\}\/agent-cli-package\.tar\.gz/g)].map(match => match[1]);
  if (new Set(versions).size !== 1) throw new Error("Cursor's installer metadata was not recognized. Try again or use the installation guide.");
  const version = versions[0]!;
  return { version, url: `https://downloads.cursor.com/lab/${version}/${platform}/${arch}/agent-cli-package.tar.gz` };
}

async function verifyCli(cli: string, version: string, env: NodeJS.ProcessEnv, signal: AbortSignal) {
  await new Promise<void>((done, reject) => {
    execCli(cli, ["--version"], { env, signal, timeout: 8000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 }, (error, stdout) => {
      if (error || stdout.trim() !== version) reject(new Error("The downloaded Cursor CLI could not be verified. Nothing was activated."));
      else done();
    });
  });
}

interface InstallOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
}

/** Install as the server user, under the same persistent home used by native
 * Cursor updates. Only activate the shim after extraction and version checks. */
export async function installCursorRuntime(environment: NodeJS.ProcessEnv, options: InstallOptions = {}): Promise<void> {
  const home = userHome(environment);
  if (!isAbsolute(home)) throw new Error("Cursor requires an absolute server HOME directory.");
  const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(options.signal ? [options.signal] : [])]);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(INSTALLER_URL, { signal, headers: { Accept: "text/plain" } });
  const origin = new URL(response.url || INSTALLER_URL);
  if (!response.ok || !response.body || origin.protocol !== "https:" || !["cursor.com", "www.cursor.com"].includes(origin.hostname)) {
    throw new Error("Cursor's installer could not be fetched. Check the server connection and try again.");
  }
  const chunks: Buffer[] = [];
  let scriptBytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    scriptBytes += chunk.length;
    if (scriptBytes > MAX_SCRIPT_BYTES) {
      throw new Error("Cursor's installer metadata exceeded its size limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  const asset = cursorInstallAsset(Buffer.concat(chunks).toString("utf8"), options.platform, options.arch);
  const versions = join(home, ".local", "share", "cursor-agent", "versions");
  await mkdir(versions, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(versions, ".omb-install-"));
  let temporaryShim: string | undefined;
  try {
    const download = await fetchImpl(asset.url, { signal });
    const url = new URL(download.url || asset.url);
    if (!download.ok || !download.body || url.protocol !== "https:" || url.hostname !== "downloads.cursor.com") {
      throw new Error("Cursor's package download failed. Check the server connection and try again.");
    }
    const length = Number(download.headers.get("content-length"));
    if (length > MAX_ARCHIVE_BYTES) throw new Error("Cursor's package exceeded its download size limit.");
    const archive = join(staging, "download.tar.gz");
    let archiveBytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
      archiveBytes += chunk.length;
      done(archiveBytes > MAX_ARCHIVE_BYTES ? new Error("Cursor's package exceeded its download size limit.") : null, chunk);
    } });
    await pipeline(Readable.fromWeb(download.body as import("node:stream/web").ReadableStream<Uint8Array>), limit,
      createWriteStream(archive, { flags: "wx", mode: 0o600 }), { signal });
    const packageDir = join(staging, "package");
    await mkdir(packageDir, { mode: 0o700 });
    let expandedBytes = 0;
    let invalid = false;
    let archiveRoot: string | undefined;
    const inside = (value: string) => value === packageDir || value.startsWith(packageDir + sep);
    const unpack = tar.x({ cwd: packageDir, strict: true, preservePaths: false, strip: 1, umask: 0o077,
      filter(path, entry) {
        if (signal.aborted) return false;
        if (!("type" in entry)) { invalid = true; return false; }
        const parts = path.split("/");
        const member = parts.slice(1).join("/");
        const link = entry.linkpath;
        // Cursor currently calls its outer archive folder `dist-package`.
        // Its name can change; all members must still share one safe root.
        archiveRoot ??= parts[0];
        expandedBytes += entry.size;
        if (!parts[0] || parts[0] === "." || parts[0] !== archiveRoot || parts.includes("..") || !inside(resolve(packageDir, member)) ||
          expandedBytes > MAX_EXPANDED_BYTES || !["Directory", "File", "SymbolicLink"].includes(entry.type) ||
          (entry.type === "SymbolicLink" && (!link || isAbsolute(link) || !inside(resolve(dirname(join(packageDir, member)), link))))) {
          invalid = true;
          return false;
        }
        return true;
      },
    });
    await pipeline(createReadStream(archive), unpack, { signal });
    if (invalid) throw new Error("Cursor's package contained unsupported files. Nothing was activated.");
    const executable = join(packageDir, "cursor-agent");
    await chmod(executable, 0o700);
    await verifyCli(executable, asset.version, environment, signal);
    signal.throwIfAborted();
    const destination = join(versions, asset.version);
    try { await rename(packageDir, destination); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      // Do not delete a completed release from an earlier native install.
      await verifyCli(join(destination, "cursor-agent"), asset.version, environment, signal);
    }
    const bin = join(home, ".local", "bin");
    await mkdir(bin, { recursive: true, mode: 0o700 });
    temporaryShim = join(bin, `.omb-cursor-${staging.split(sep).at(-1)}`);
    await symlink(join(destination, "cursor-agent"), temporaryShim);
    signal.throwIfAborted();
    await rename(temporaryShim, join(bin, "cursor-agent"));
  } finally {
    if (temporaryShim) await rm(temporaryShim, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}
