// Real Settings usage component, real plan fetch/cache, synthetic native APIs.
// The app child has a disposable home/data directory. This process never reads
// login files or contacts a provider; every provider request is intercepted.
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { launchVerificationServer } from "./control-omb.ts";
import { clearPlanUsageCache, fileCredentialReader, loadPlanUsage, type PlanFetch } from "../server/plan-usage.ts";

type Scenario = "normal" | "expired" | "unknown" | "legacy";
let scenario: Scenario = "normal";
let providerRequests = 0;
const reset = () => new Date(Date.now() + 3 * 86400_000).toISOString();
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(body) });
const syntheticFetch: PlanFetch = async (url) => {
  providerRequests++;
  if (url === "https://oauth2.googleapis.com/token") {
    return scenario === "expired" ? response({ error: "invalid_grant" }, 400) : response({ access_token: "fixture-google-token" });
  }
  if (url.endsWith("/GetPlanInfo")) return response({ planInfo: { planName: "Pro" } });
  if (url.endsWith("/GetCurrentPeriodUsage")) {
    if (scenario === "expired") return response({}, 401);
    if (scenario === "unknown") return response({});
    return response({ enabled: true, billingCycleEnd: reset(),
      planUsage: { totalSpend: 22244, limit: 2000, totalPercentUsed: 47, autoPercentUsed: 49, apiPercentUsed: 0 } });
  }
  if (url.endsWith(":loadCodeAssist")) return response({ paidTier: { name: "Google AI Pro" } });
  if (url.endsWith(":retrieveUserQuotaSummary")) {
    if (scenario === "legacy") return response({}, 404);
    return response({ groups: scenario === "unknown" ? [] : [
      { displayName: "Gemini Models", buckets: [
        { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.6, resetTime: reset() },
        { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.8, resetTime: reset() },
      ] },
      { displayName: "Claude and GPT models", buckets: [
        { bucketId: "3p-5h", window: "5h", remainingFraction: 1, resetTime: reset() },
        { bucketId: "3p-weekly", window: "weekly", remainingFraction: 0.4, resetTime: reset() },
      ] },
    ] });
  }
  if (url.endsWith(":fetchAvailableModels")) return response({
    models: { gemini: { displayName: "Gemini", quotaInfo: { remainingFraction: 0.25, resetTime: reset() } } },
  });
  throw new Error("Unexpected native request in isolated usage fixture.");
};
const credentials = fileCredentialReader({ env: { HOME: "/isolated-plan-usage" }, dataDir: "/isolated-plan-usage-data",
  readText: (path) => path.endsWith("acp_token.json") ? JSON.stringify({ client_id: "fixture-client",
    client_secret: "fixture-secret", refresh_token: "fixture-refresh", project_id: "fixture-project" }) : null });
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
let ui: Awaited<ReturnType<typeof createServer>> | undefined;
const httpServer = createHttpServer();
try {
  fixture = await launchVerificationServer(process.env, controller.signal);
  controller.signal.throwIfAborted();
  ui = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../.omb-scratch/plan-usage-vite", import.meta.url)),
    server: { middlewareMode: { server: httpServer }, hmr: { server: httpServer }, proxy: { "/api": { target: fixture.info.url } } },
    plugins: [{ name: "isolated-plan-usage", configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
        if (url.pathname === "/api/plan-usage" && req.method === "GET") {
          void loadPlanUsage({ accounts: [
            { id: "cursor", name: "Cursor", driver: "cursor", environment: { CURSOR_AUTH_TOKEN: "fixture-cursor-token" } },
            { id: "antigravity", name: "Antigravity", driver: "antigravity", environment: {} },
          ], refresh: url.searchParams.get("refresh") === "1", fetch: syntheticFetch, credentials })
            .then((report) => json(report)).catch(() => json({ error: "Isolated quota query failed." }, 500));
          return;
        }
        if (url.pathname === "/__fixture/scenario" && req.method === "POST") {
          const selected = url.searchParams.get("name");
          if (!["normal", "expired", "unknown", "legacy"].includes(selected ?? "")) return json({ error: "Unknown fixture scenario." }, 400);
          scenario = selected as Scenario;
          clearPlanUsageCache();
          return json({ scenario });
        }
        if (url.pathname === "/__fixture/stats") return json({ scenario, providerRequests });
        if (url.pathname === "/favicon.ico") { res.statusCode = 204; res.end(); return; }
        if (url.pathname !== "/__plan-usage.html") return next();
        void server.transformIndexHtml(req.url!, '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenMaus · Plan usage fixture</title></head><body><div id="root"></div><script type="module" src="/scripts/testing/plan-usage-preview.tsx"></script></body></html>')
          .then((html) => { res.setHeader("Content-Type", "text/html"); res.end(html); });
      });
    } }],
  });
  httpServer.on("request", ui.middlewares);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => { httpServer.removeListener("error", reject); resolve(); });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Fixture UI has no TCP address.");
  console.log(JSON.stringify({ ...fixture.info, previewUrl: `http://127.0.0.1:${address.port}/__plan-usage.html` }));
  await new Promise<void>((resolve) => {
    if (controller.signal.aborted) return resolve();
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
} finally {
  const closed = new Promise<void>((resolve) => { httpServer.close(() => resolve()); httpServer.closeAllConnections(); });
  try { await fixture?.close(); }
  finally {
    try { await ui?.close(); }
    finally { await closed; process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
  }
}
