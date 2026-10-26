import type { AppConfig } from "../config.ts";
import * as composio from "../composio.ts";
import type { HighLevelHost } from "../highlevel/host.ts";
import type { createPhones } from "../host/phones.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createConnectorReadRoutes(deps: { config: AppConfig; highlevel: Pick<HighLevelHost, "toolListing">; phones: Pick<ReturnType<typeof createPhones>, "toolListing">; managed: boolean }): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (method !== "GET") return PASS;
    const cfg = deps.config;
    const highlevelHost = deps.highlevel;
    if (method === "GET" && path === "/api/connectors/catalog") {
      const { cards, source, pagination } = await composio.listToolkits(cfg);
      return json(res, 200, {
        configured: composio.configured(cfg),
        mode: composio.connectionMode(cfg),
        setup: composio.connectorSetup(cfg, deps.managed),
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
      const inventory = await composio.connectedServicesInventory(cfg);
      return json(res, 200, {
        configured: true,
        credentialStore: "ok",
        inventoryComplete: inventory.complete,
        services: inventory.services,
      });
    }
    if (method === "GET" && path === "/api/connectors/tools") {
      const availability = composio.connectorAvailability(cfg);
      const highlevelTools = { ...highlevelHost.toolListing(), ...deps.phones.toolListing() };
      if (availability !== "configured") {
        return json(res, 200, { configured: Object.keys(highlevelTools).length > 0, services: highlevelTools });
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
