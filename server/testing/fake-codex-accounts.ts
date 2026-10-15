#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

if (process.argv[2] === "--version") await import("./fake-codex-app-server.ts");
const root = process.env.OMB_DATA_DIR;
const home = process.env.CODEX_HOME;
if (!root || !home || !isAbsolute(home) || relative(join(root, "providers"), home).startsWith("..")) throw new Error("An isolated provider home is required.");
if (!existsSync(home)) throw new Error("CODEX_HOME must exist before launching the CLI.");
appendFileSync(join(root, "codex-account-calls.jsonl"), JSON.stringify({ args: process.argv.slice(2), home }) + "\n");
const authPath = join(home, "auth.json");
const approvalPath = join(home, "approve-login.json");
if (process.argv[2] === "login" && process.argv[3] === "status") {
  process.stderr.write(existsSync(authPath) ? "Logged in using ChatGPT\n" : "Not logged in\n");
  process.exit(existsSync(authPath) ? 0 : 1);
}
if (process.argv[2] === "login" && process.argv[3] === "--device-auth") {
  process.stderr.write("https://auth.openai.com/codex/device\n0CSG-0IXIM\n");
  const timer = setInterval(() => {
    if (!existsSync(approvalPath)) return;
    clearInterval(timer);
    const account = JSON.parse(readFileSync(approvalPath, "utf8"));
    writeFileSync(authPath, JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: account.token, account_id: account.email } }));
    rmSync(approvalPath);
    process.exit(0);
  }, 10);
} else if (process.argv[2] === "logout") {
  rmSync(authPath, { force: true });
  process.stderr.write("Successfully logged out\n");
} else {
  process.env.FAKE_CODEX_ACCOUNT_MODE = existsSync(authPath) ? "chatgpt" : "none";
  if (existsSync(authPath)) process.env.FAKE_CODEX_ACCOUNT_EMAIL = JSON.parse(readFileSync(authPath, "utf8")).tokens.account_id;
  process.env.FAKE_CODEX_DUMP = join(home, `rpc-${process.pid}.json`);
  await import("./fake-codex-app-server.ts");
}
