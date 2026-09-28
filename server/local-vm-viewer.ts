/** Same-origin noVNC links for a Local VM behind the authenticated Caddy edge. */
export function proxiedLocalVmViewerUrl(
  raw: string,
  origin: string,
  botId?: string,
): string | null {
  try {
    const viewer = new URL(raw);
    const publicOrigin = new URL(origin);
    if (
      viewer.protocol !== "http:" || viewer.hostname !== "127.0.0.1" ||
      !/^\d+$/.test(viewer.port) || viewer.pathname !== "/vnc.html" ||
      (publicOrigin.protocol !== "http:" && publicOrigin.protocol !== "https:") ||
      (botId !== undefined && !/^[\w-]+$/.test(botId))
    ) return null;

    const prefix = botId === undefined ? "/local-vm/shared" : `/local-vm/bots/${botId}`;
    // noVNC otherwise connects to /websockify at the origin root. Its path
    // setting must follow the same authenticated, target-specific proxy route.
    const fragment = new URLSearchParams(viewer.hash.slice(1));
    fragment.set("path", `${prefix.slice(1)}/websockify`);
    return `${publicOrigin.origin}${prefix}/vnc.html#${fragment.toString()}`;
  } catch {
    return null;
  }
}

/** Caddy supplies its original URI in X-Forwarded-Uri before auth rewriting. */
export function localVmViewerTarget(uri: string | string[] | undefined): { botId?: string } | null {
  if (typeof uri !== "string") return null;
  const match = /^\/local-vm\/(shared|bots\/([\w-]+))\/(?:[\w./-]+)(?:\?[^#]*)?$/.exec(uri);
  if (!match || uri.includes("..")) return null;
  return match[2] ? { botId: match[2] } : {};
}
