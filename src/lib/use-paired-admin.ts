import { useEffect, useState } from "react";

import { readSessionState } from "./session";

let pending: Promise<boolean> | null = null;

/** A paired browser administrator, excluding the bot-accessible loopback owner. */
export function usePairedAdmin(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    pending ??= readSessionState().then(
      (session) => session.kind === "session" && session.scopes.includes("admin"),
      () => false,
    );
    let alive = true;
    void pending.then((value) => { if (alive) setAllowed(value); });
    return () => { alive = false; };
  }, []);
  return allowed;
}
