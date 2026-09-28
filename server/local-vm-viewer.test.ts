import { describe, expect, it } from "vitest";

import { localVmViewerTarget, proxiedLocalVmViewerUrl } from "./local-vm-viewer.ts";

describe("Local VM same-origin viewer", () => {
  it("uses each request's origin for the page and target-specific WebSocket", () => {
    const raw = "http://127.0.0.1:6080/vnc.html#autoconnect=true&resize=scale&password=secret";
    for (const origin of ["http://198.51.100.20:8080", "http://192.0.2.10:8080", "http://localhost:8080"]) {
      const shared = new URL(proxiedLocalVmViewerUrl(raw, origin)!);
      expect(shared.origin).toBe(origin);
      expect(shared.pathname).toBe("/local-vm/shared/vnc.html");
      expect(new URLSearchParams(shared.hash.slice(1)).get("path")).toBe("local-vm/shared/websockify");
      expect(new URLSearchParams(shared.hash.slice(1)).get("password")).toBe("secret");

      const bot = new URL(proxiedLocalVmViewerUrl(raw, origin, "bot-123")!);
      expect(bot.pathname).toBe("/local-vm/bots/bot-123/vnc.html");
      expect(new URLSearchParams(bot.hash.slice(1)).get("path")).toBe("local-vm/bots/bot-123/websockify");
    }
  });

  it("only maps loopback noVNC pages and valid bot ids", () => {
    expect(proxiedLocalVmViewerUrl("http://example.com:6080/vnc.html", "http://localhost:8080")).toBeNull();
    expect(proxiedLocalVmViewerUrl("http://127.0.0.1:6080/other", "http://localhost:8080")).toBeNull();
    expect(proxiedLocalVmViewerUrl("http://127.0.0.1:6080/vnc.html", "http://localhost:8080", "../bad")).toBeNull();
  });

  it("recognizes only target-specific asset and WebSocket paths", () => {
    expect(localVmViewerTarget("/local-vm/shared/vnc.html")).toEqual({});
    expect(localVmViewerTarget("/local-vm/bots/bot-123/app/ui.js?x=1")).toEqual({ botId: "bot-123" });
    expect(localVmViewerTarget("/local-vm/bots/bot-123/websockify")).toEqual({ botId: "bot-123" });
    expect(localVmViewerTarget("/local-vm/shared/../secret")).toBeNull();
    expect(localVmViewerTarget("/local-vm/bots/../app/ui.js")).toBeNull();
    expect(localVmViewerTarget("/api/health")).toBeNull();
  });
});
