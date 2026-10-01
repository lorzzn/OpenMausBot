/** Cursor CLI's browser authorization challenge; never accept arbitrary CLI links. */
export function cursorAuthorizationUrl(value: string | null): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://cursor.com" || url.pathname !== "/loginDeepControl" ||
      url.username || url.password || url.hash) return null;
    const allowed = new Set(["challenge", "uuid", "mode", "redirectTarget", "supportsSelectedTeamLogin"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return null;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("challenge") ?? "") ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(url.searchParams.get("uuid") ?? "") ||
      url.searchParams.get("mode") !== "login" || url.searchParams.get("redirectTarget") !== "cli" ||
      (url.searchParams.has("supportsSelectedTeamLogin") && url.searchParams.get("supportsSelectedTeamLogin") !== "true")) return null;
    return url.href;
  } catch { return null; }
}
