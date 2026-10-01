import { useEffect, useState } from "react";
import { ExternalLink, Loader2, LogIn } from "lucide-react";
import { cursorAuthorizationUrl } from "../../shared/cursor-auth";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { deviceFlowUnavailable, type DeviceSignInStatus } from "./CodexDeviceSignIn";

function endedFlow(phase: "expired" | "failed"): DeviceSignInStatus {
  return { phase, flowId: null, authorizationUrl: null, expiresAt: null };
}

export function CursorSignInProgress({ auth }: { auth: DeviceSignInStatus }) {
  if (auth.phase !== "waiting") {
    const label = auth.phase === "succeeded" ? t("engineSetup.cursor.connected")
      : auth.phase === "cancelled" ? t("engineSetup.cursor.cancelled")
      : auth.phase === "expired" ? t("engineSetup.cursor.expired")
      : auth.message || t("engineSetup.cursor.failed");
    return <p role="status" className={auth.phase === "succeeded" ? "text-[12px] text-success" : "text-[12px] text-ink-secondary"}>{label}</p>;
  }
  const link = cursorAuthorizationUrl(auth.authorizationUrl);
  if (!link) return <p role="alert" className="text-[12px] text-danger">{t("engineSetup.cursor.invalidLink")}</p>;
  return (
    <div className="space-y-2 rounded-lg border border-hairline/50 bg-app p-3">
      <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white hover:brightness-110">
        {t("engineSetup.cursor.open")} <ExternalLink size={13} />
      </a>
      <p role="status" className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
        <Loader2 size={12} className="animate-spin" /> {t("engineSetup.cursor.waiting")}
      </p>
      <p className="text-[11px] leading-relaxed text-ink-secondary">{t("engineSetup.cursor.security")}</p>
    </div>
  );
}

export function CursorSignIn({ instanceId }: { instanceId: string }) {
  const { refreshInstances, refreshModels } = useStore();
  const [auth, setAuth] = useState<DeviceSignInStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/instances/${encodeURIComponent(instanceId)}/auth`;

  const refresh = async () => {
    await refreshInstances();
    await refreshModels(instanceId);
  };

  useEffect(() => {
    if (busy || auth?.phase !== "waiting" || !auth.flowId) return;
    const controller = new AbortController();
    const remaining = auth.expiresAt ? Date.parse(auth.expiresAt) - Date.now() : Number.NaN;
    // Also expire the UI if the connection hangs or the server was restarted.
    // No credentials are removed: this only discards an obsolete challenge.
    const expiryTimer = Number.isFinite(remaining)
      ? window.setTimeout(() => { controller.abort(); setAuth(endedFlow("expired")); setError(null); }, Math.max(0, remaining))
      : null;
    const timer = window.setTimeout(() => {
      void api(`${base}/status?flowId=${encodeURIComponent(auth.flowId!)}`, { signal: controller.signal })
        .then(async ({ auth: next }: { auth: DeviceSignInStatus }) => {
          if (controller.signal.aborted) return;
          setAuth(next);
          setError(null);
          if (next.phase === "succeeded") {
            await refreshInstances();
            await refreshModels(instanceId);
          }
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (deviceFlowUnavailable(cause)) {
            setAuth(endedFlow("failed"));
            setError(null);
            return;
          }
          setError(cause instanceof Error ? cause.message : t("engineSetup.cursor.failed"));
          // Retry transient connectivity failures without creating another login.
          setAuth({ ...auth });
        });
    }, 2000);
    return () => {
      window.clearTimeout(timer);
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      controller.abort();
    };
  }, [auth, base, busy, instanceId, refreshInstances, refreshModels]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { auth: next }: { auth: DeviceSignInStatus } = await api(`${base}/start`, { method: "POST" });
      setAuth(next);
      if (next.phase === "succeeded") await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("engineSetup.cursor.failed"));
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!auth?.flowId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/cancel`, { method: "POST", body: JSON.stringify({ flowId: auth.flowId }) });
      setAuth({ phase: "cancelled", flowId: null, authorizationUrl: null, expiresAt: null });
    } catch (cause) {
      if (deviceFlowUnavailable(cause)) setAuth(endedFlow("failed"));
      else setError(cause instanceof Error ? cause.message : t("engineSetup.cursor.failed"));
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-2" data-cursor-sign-in>
      {auth && <CursorSignInProgress auth={auth} />}
      {auth?.phase === "waiting" ? (
        <button type="button" disabled={busy} onClick={() => void cancel()} className="w-full rounded-lg bg-control px-3 py-2 text-[12px] font-medium text-ink disabled:opacity-50">
          {busy ? t("engineSetup.device.cancelling") : t("engineSetup.device.cancel")}
        </button>
      ) : auth?.phase !== "succeeded" && (
        <button type="button" disabled={busy} onClick={() => void start()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          {busy ? t("engineSetup.cursor.starting") : t("engineSetup.cursor.start")}
        </button>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
