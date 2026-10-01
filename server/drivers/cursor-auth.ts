import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { cursorAuthorizationUrl } from "../../shared/cursor-auth.ts";
import type { ProviderAuthenticationStart, ProviderAuthenticationStatus } from "../contracts.ts";
import { userHome } from "../env-path.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { installCursorRuntime } from "./cursor-install.ts";

// The native updater writes ~/.local/bin and ~/.local/share, even when the
// original CLI came from a read-only Docker image. Prefer its persisted shim
// for probes, models, authentication and ACP alike. Explicit overrides stay pinned.
export function resolveCursorCli(cli: string, env: NodeJS.ProcessEnv): string {
  if (cli !== "cursor-agent") return cli;
  const names = process.platform === "win32" ? ["cursor-agent.exe", "cursor-agent.cmd", "cursor-agent"] : ["cursor-agent"];
  for (const name of names) {
    const updated = join(userHome(env), ".local", "bin", name);
    try { accessSync(updated, constants.X_OK); return updated; } catch { /* Try the next native shim. */ }
  }
  return cli;
}

export function cursorLoginPrompt(output: string): string | null {
  const lines = stripVTControlCharacters(output).split(/\r?\n/).slice(0, -1);
  for (const line of lines) {
    const candidate = line.match(/https:\/\/\S+/)?.[0];
    const link = cursorAuthorizationUrl(candidate ?? null);
    if (link) return link;
  }
  return null;
}

const accountCommands = new Set<string>();
const MAX_OUTPUT = 16_384;
interface Options {
  cli: string;
  environment: () => NodeJS.ProcessEnv;
  authenticated: (cli: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
  onAuthenticated?: () => Promise<void>;
  startupTimeoutMs?: number;
  lifetimeMs?: number;
  updateTimeoutMs?: number;
  installer?: typeof installCursorRuntime;
}
type Flow = {
  status: ProviderAuthenticationStatus;
  ready: boolean;
  child: ChildProcess | null;
  resolve: (value: ProviderAuthenticationStart) => void;
  reject: (cause: Error) => void;
  startupTimer: NodeJS.Timeout;
  expiryTimer: NodeJS.Timeout;
  release: () => void;
  stopping?: Promise<void>;
};

/** Only fixed first-party login/update commands; raw CLI output never leaves this controller. */
export class CursorAuthController {
  private flow: Flow | null = null;
  private updateChild: ChildProcess | null = null;
  private updateOperation: Promise<void> | null = null;
  private installOperation: Promise<void> | null = null;
  private installAbort: AbortController | null = null;
  private starting = false;
  private disposed = false;
  private readonly options: Options;
  constructor(options: Options) { this.options = options; }

  private context() {
    if (this.disposed) throw new Error("This Cursor provider was removed. Refresh Settings.");
    const env: NodeJS.ProcessEnv = { ...this.options.environment(), NO_OPEN_BROWSER: "1", NO_COLOR: "1" };
    // Do not let a CLI test/update override route account commands away from Cursor.
    delete env.AGENT_CLI_UPDATE_CHECK_URL;
    const home = userHome(env);
    if (!isAbsolute(home)) throw new Error("Cursor requires an absolute server HOME directory.");
    let key = home;
    try { key = realpathSync(home); } catch { /* Spawn reports a missing HOME safely. */ }
    if (accountCommands.has(key)) throw Object.assign(new Error("A Cursor install, login or update is already running for this server account. Finish or cancel it first."), { status: 409 });
    accountCommands.add(key);
    return { env, home, cli: resolveCursorCli(this.options.cli, env), release: () => accountCommands.delete(key) };
  }

  async start(): Promise<ProviderAuthenticationStart> {
    if (this.starting) throw Object.assign(new Error("Cursor sign-in is starting. Please wait."), { status: 409 });
    if (this.flow?.status.phase === "waiting" && this.flow.ready) return { ...this.flow.status, phase: "waiting" };
    await this.flow?.stopping;
    const context = this.context();
    this.starting = true;
    let ownsFlow = false;
    try {
      if (await this.options.authenticated(context.cli, context.env)) {
        context.release();
        return { phase: "succeeded", flowId: null, authorizationUrl: null, expiresAt: null };
      }
      if (this.disposed) throw new Error("Cursor sign-in cancelled because this provider was removed.");
      return await new Promise<ProviderAuthenticationStart>((resolve, reject) => {
        const flow: Flow = {
          status: { phase: "waiting", flowId: randomUUID(), authorizationUrl: null,
            expiresAt: new Date(Date.now() + (this.options.lifetimeMs ?? 5 * 60_000)).toISOString() },
          ready: false, child: null, resolve, reject, release: context.release,
          startupTimer: setTimeout(() => this.finish(flow, "failed", "Cursor did not provide a sign-in link. Check the server connection and update Cursor, then try again."), this.options.startupTimeoutMs ?? 30_000),
          expiryTimer: setTimeout(() => this.finish(flow, "expired", "Cursor sign-in expired. Start sign-in again."), this.options.lifetimeMs ?? 5 * 60_000),
        };
        this.flow = flow;
        ownsFlow = true;
        flow.startupTimer.unref(); flow.expiryTimer.unref();
        let output = "";
        try {
          const child = spawnCli(context.cli, ["login"], { env: context.env, cwd: context.home, stdio: ["pipe", "pipe", "pipe"] });
          flow.child = child;
          child.stdin.end();
          const receive = (chunk: Buffer) => {
            if (flow.status.phase !== "waiting") return;
            if (output.length + chunk.length > MAX_OUTPUT) {
              this.finish(flow, "failed", "Cursor returned an unexpected sign-in response. Update Cursor and try again.");
              return;
            }
            output += chunk.toString("utf8");
            const link = !flow.ready ? cursorLoginPrompt(output) : null;
            if (!link) return;
            flow.ready = true;
            clearTimeout(flow.startupTimer);
            flow.status.authorizationUrl = link;
            resolve({ ...flow.status, phase: "waiting" });
          };
          child.stdout.on("data", receive); child.stderr.on("data", receive);
          child.once("error", () => this.finish(flow, "failed", "Cursor could not start on this server. Check its CLI installation."));
          child.once("close", (code) => {
            flow.child = null;
            output = "";
            if (flow.status.phase !== "waiting") return;
            if (code !== 0 || !flow.ready) { this.finish(flow, "failed", "Cursor sign-in did not finish. Try again."); return; }
            flow.startupTimer = setTimeout(() => this.finish(flow, "failed", "Cursor could not confirm the account. Try again."), this.options.startupTimeoutMs ?? 30_000);
            flow.startupTimer.unref();
            void this.options.authenticated(context.cli, context.env).then((confirmed) => {
              this.finish(flow, confirmed ? "succeeded" : "failed", "Cursor did not confirm the signed-in account. Try again.");
            }).catch(() => this.finish(flow, "failed", "Cursor could not confirm the account. Try again."));
          });
        } catch { this.finish(flow, "failed", "Cursor could not start on this server. Check its CLI installation."); }
      });
    } catch (cause) { if (!ownsFlow) context.release(); throw cause; }
    finally { this.starting = false; }
  }

  async get(flowId: string): Promise<ProviderAuthenticationStatus> {
    if (!flowId || this.flow?.status.flowId !== flowId) throw new Error("This Cursor sign-in ended. Start sign-in again.");
    return { ...this.flow.status };
  }

  private finish(flow: Flow, phase: Exclude<ProviderAuthenticationStatus["phase"], "waiting">, message?: string) {
    if (flow.status.phase !== "waiting") return;
    clearTimeout(flow.startupTimer); clearTimeout(flow.expiryTimer);
    flow.status = { phase, flowId: flow.status.flowId, authorizationUrl: null, expiresAt: null,
      ...(phase !== "succeeded" && message ? { message } : {}) };
    const child = flow.child;
    flow.stopping = this.stop(child).then(() => flow.release());
    // Keep the account lock until a stubborn child actually exits.
    void flow.stopping.catch(() => { child?.once("close", flow.release); });
    if (!flow.ready) {
      if (phase === "succeeded") flow.resolve({ ...flow.status, phase });
      else flow.reject(new Error(message ?? "Cursor sign-in ended."));
    }
    if (phase === "succeeded") void this.options.onAuthenticated?.().catch(() => {});
  }

  async cancel(): Promise<void> {
    if (this.flow?.status.phase === "waiting") this.finish(this.flow, "cancelled", "Cursor sign-in cancelled.");
    await this.flow?.stopping;
  }

  async update(): Promise<void> {
    const context = this.context();
    const operation = new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof spawnCli>;
      try { child = spawnCli(context.cli, ["update"], { env: context.env, cwd: context.home, stdio: ["pipe", "pipe", "pipe"] }); }
      catch { reject(new Error("Cursor could not start. Check its CLI installation.")); return; }
      this.updateChild = child;
      child.stdin.end();
      // Drain output without exposing account details or download URLs.
      child.stdout.resume(); child.stderr.resume();
      let ended = false;
      const timer = setTimeout(() => {
        ended = true;
        void this.stop(child).then(() => reject(new Error("Cursor update timed out. Check the server connection and try again.")), reject);
      }, this.options.updateTimeoutMs ?? 10 * 60_000);
      timer.unref();
      child.once("error", () => { clearTimeout(timer); reject(new Error("Cursor could not start. Check its CLI installation.")); });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (this.updateChild === child) this.updateChild = null;
        if (ended) return;
        if (code === 0 && !this.disposed) resolve();
        else reject(new Error("Cursor update did not finish. Check the server network and writable HOME directory, then try again."));
      });
    });
    this.updateOperation = operation;
    try { await operation; }
    finally {
      if (!this.updateChild || this.updateChild.exitCode !== null || this.updateChild.signalCode !== null) context.release();
      else this.updateChild.once("close", context.release);
      if (this.updateOperation === operation) this.updateOperation = null;
    }
  }

  async install(): Promise<void> {
    const context = this.context();
    const abort = new AbortController();
    this.installAbort = abort;
    const operation = Promise.resolve().then(() => (this.options.installer ?? installCursorRuntime)(context.env, { signal: abort.signal }));
    this.installOperation = operation;
    try { await operation; }
    finally {
      context.release();
      if (this.installOperation === operation) this.installOperation = null;
      if (this.installAbort === abort) this.installAbort = null;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.installAbort?.abort();
    await this.cancel();
    await this.stop(this.updateChild);
    await this.updateOperation?.catch(() => {});
    await this.installOperation?.catch(() => {});
  }

  private async stop(child: ChildProcess | null): Promise<void> {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null || await killCliTree(child, 1500)) return;
    if (process.platform !== "win32" && child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    } else child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      child.once("close", () => { clearTimeout(timer); resolve(); });
    });
    if (child.exitCode === null && child.signalCode === null) throw new Error("Cursor could not be stopped. Ask the server administrator to stop its account command.");
  }
}
