import type { AppConfig } from "../config.ts";
import * as composio from "../composio.ts";
import type { HighLevelHost } from "../highlevel/host.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createConnectorReadRoutes(deps: { config: AppConfig; highlevel: Pick<HighLevelHost, "toolListing"> }): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (method !== "GET") return PASS;
    const cfg = deps.config;
    const highlevelHost = deps.highlevel;
    if (method === "GET" && path === "/api/connectors/catalog") {
      const { cards, source, pagination } = await composio.listToolkits(cfg);
      return json(res, 200, {
        configured: composio.configured(cfg),
        mode: composio.connectionMode(cfg),
        setup: composio.connectorSetup(cfg),
        source,
        cards,
        ...(pagination ? { pagination } : {}),
      });
    }
    if (method === "GET" && path === "/api/connectors/connected") {
      const availability = composio.connectorAvailability(cfg);
      if (availability !== "configured") {
        return json(res, 200, {
          configured: false,
          credentialStore: availability === "unreadable" ? "unavailable" : "ok",
          services: {},
        });
      }
      return json(res, 200, { configured: true, credentialStore: "ok", services: await composio.connectedServices(cfg) });
    }
    if (method === "GET" && path === "/api/connectors/tools") {
      const availability = composio.connectorAvailability(cfg);
      const highlevelTools = highlevelHost.toolListing();
      if (availability !== "configured") {
        return json(res, 200, { configured: Boolean(highlevelTools), services: { ...highlevelTools } });
      }
      try {
        return json(res, 200, { configured: true, services: { ...await composio.listConnectorTools(cfg), ...highlevelTools } });
      } catch (e) {
        return json(res, 502, { configured: true, services: {}, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (method === "GET" && path === "/api/connectors") {
      const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
      const availability = composio.connectorAvailability(cfg);
      if (availability !== "configured") {
        return json(res, 200, {
          configured: false,
          credentialStore: availability === "unreadable" ? "unavailable" : "ok",
          services: {},
        });
      }
      const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
      return json(res, 200, { configured: true, services: status });
    }
    return PASS;
  };
}
