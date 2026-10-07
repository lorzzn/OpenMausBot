import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, type InstanceInfo } from "@/state/store";
import { CursorSignInProgress } from "./CursorSignIn";
import type { DeviceSignInStatus } from "./DeviceSignIn";
import { EngineSetup, ServerEngineInstall } from "./EngineSetup";

afterEach(() => vi.unstubAllGlobals());
const link = "https://cursor.com/loginDeepControl?challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&uuid=00000000-0000-4000-8000-000000000001&mode=login&redirectTarget=cli";
const waiting: DeviceSignInStatus = { phase: "waiting", flowId: "fixture", authorizationUrl: link, expiresAt: "2030-01-01T00:00:00.000Z" };
const engine: InstanceInfo = { instanceId: "cursor", driverKind: "cursorAgent", displayName: "Cursor",
  snapshot: { state: "available", authenticated: false }, models: { default: "auto", options: [] },
  authentication: { method: "browser-poll" }, install: { server: { updateOnly: false }, signInCommand: "cursor-agent login",
    command: { linux: "curl https://cursor.com/install -fsS | bash" } } };
describe("Cursor page sign-in and updates", () => {
  it("shows a browser authorization link without local callback or device-code inputs", () => {
    const html = renderToStaticMarkup(createElement(CursorSignInProgress, { auth: waiting }));
    expect(html).toContain("https://cursor.com/loginDeepControl");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("ChatGPT");
  });
  it.each(["javascript:alert(1)", link.replace("cursor.com", "evil.test"), link + "&redirect=https://evil.test"])("does not render an untrusted link: %s", (authorizationUrl) => {
    const html = renderToStaticMarkup(createElement(CursorSignInProgress, { auth: { ...waiting, authorizationUrl } }));
    expect(html).toContain('role="alert"'); expect(html).not.toContain("href=");
  });
  it.each(["succeeded", "cancelled", "expired", "failed"] as const)("drops the authorization link after %s", (phase) => {
    const html = renderToStaticMarkup(createElement(CursorSignInProgress, { auth: { ...waiting, phase } }));
    expect(html).not.toContain("challenge="); expect(html).toContain('role="status"');
  });
  it("routes Cursor setup to browser login and offers updates independently of sign-in", () => {
    vi.stubGlobal("window", { ogb: { platform: "linux" } });
    const render = (child: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(StoreProvider, null, child));
    const setup = render(createElement(EngineSetup, { instance: engine }));
    expect(setup).toContain("data-cursor-sign-in"); expect(setup).not.toContain("cursor-agent login");
    const update = render(createElement(ServerEngineInstall, { instance: engine, mode: "update" }));
    expect(update).toContain("Update Cursor on this server");
    const missing = render(createElement(EngineSetup, { instance: { ...engine, snapshot: { state: "unavailable" } } }));
    expect(missing).toContain("Install Cursor on this server");
    expect(missing).not.toContain("data-cursor-sign-in");
  });
});
