#!/usr/bin/env -S node --experimental-strip-types
// Offline account/update fixture. Never contact Cursor or write real credentials.
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.HOME;
if (process.env.OMB_CURSOR_AUTH_FIXTURE !== "1" || !home || !isAbsolute(home)) {
  console.error("This fake CLI requires OMB_CURSOR_AUTH_FIXTURE=1 and an isolated HOME.");
  process.exit(2);
}
const mode = process.env.FAKE_CURSOR_MODE ?? "waiting";
const authenticated = join(home, ".omb-fake-cursor-authenticated");
const approved = join(home, ".omb-fake-cursor-login-approved");
const updated = join(home, ".omb-fake-cursor-updated");
const args = process.argv.slice(2);
appendFileSync(join(home, "cursor-calls.jsonl"), JSON.stringify({ args, noOpenBrowser: process.env.NO_OPEN_BROWSER,
  foreignKey: !!process.env.OPENAI_API_KEY, workspaceKey: !!process.env.OMB_WEBHOOK_TOKEN,
  apiKey: !!process.env.CURSOR_API_KEY }) + "\n");
if (args[0] === "--version") {
  console.log(existsSync(updated) ? "2026.09.30-offline" : "2026.09.28-offline");
} else if (args[0] === "status") {
  console.log(JSON.stringify({ isAuthenticated: mode !== "unconfirmed" && existsSync(authenticated) }));
} else if (args[0] === "about") {
  const installed = existsSync(updated) ? "2026.09.30-offline" : "2026.09.28-offline";
  console.log(JSON.stringify({ cliVersion: installed, latestStatus: existsSync(updated) ? "up_to_date" : "update_available",
    latestVersion: "2026.09.30-offline", userEmail: "private-fixture@example.invalid" }));
} else if (args[0] === "models") {
  console.log("auto - Auto (default)\noffline-cursor - Offline Cursor");
} else if (args[0] === "login") {
  writeFileSync(join(home, "cursor-login.pid"), String(process.pid));
  if (mode === "overflow") console.error("private-token".repeat(2000));
  else if (mode !== "no-prompt") {
    console.error("Offline OMB fixture — do not open this link at Cursor.");
    console.error(mode === "evil" ? "https://evil.example/loginDeepControl?token=private-token" :
      "Open a browser: https://cursor.com/loginDeepControl?challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&uuid=00000000-0000-4000-8000-000000000001&mode=login&redirectTarget=cli&supportsSelectedTeamLogin=true");
  }
  if (mode === "ignore-term") process.on("SIGTERM", () => {});
  const timer = setInterval(() => {
    if (mode === "crash") { console.error("private-token"); process.exit(1); }
    if (!existsSync(approved)) return;
    clearInterval(timer);
    writeFileSync(authenticated, "Offline fixture; not a credential.");
    process.exit(0);
  }, 50);
} else if (args[0] === "update") {
  writeFileSync(join(home, "cursor-update.pid"), String(process.pid));
  if (mode === "update-fails") { console.error("private-token"); process.exit(1); }
  if (mode === "update-hangs") setInterval(() => {}, 1000);
  else {
    const directory = join(home, ".local", "share", "cursor-agent", "versions", "offline-update");
    const bin = join(home, ".local", "bin");
    mkdirSync(directory, { recursive: true }); mkdirSync(bin, { recursive: true });
    const executable = join(directory, "cursor-agent.mjs");
    writeFileSync(executable, readFileSync(fileURLToPath(import.meta.url)), { mode: 0o755 });
    if (!existsSync(join(bin, "cursor-agent"))) symlinkSync(executable, join(bin, "cursor-agent"));
    writeFileSync(updated, "Offline fixture only");
    console.log("Done");
  }
} else process.exitCode = 2;
