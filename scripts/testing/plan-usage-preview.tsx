import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PlanUsage } from "../../src/components/PlanUsage";
import { setLocale } from "../../src/lib/i18n";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

function Preview() {
  const [revision, setRevision] = useState(0);
  const select = async (name: string) => {
    await fetch(`/__fixture/scenario?name=${encodeURIComponent(name)}`, { method: "POST" });
    setRevision((value) => value + 1);
  };
  return <main className="mx-auto max-w-3xl p-6">
    <p className="mb-4 text-[13px] text-ink-secondary">Isolated plan usage fixture · synthetic accounts and quotas</p>
    <nav aria-label="Fixture controls" className="mb-4 flex flex-wrap gap-2 text-[13px] text-ink [&_button]:rounded [&_button]:bg-control [&_button]:px-3 [&_button]:py-2">
      <button onClick={() => void select("normal")}>Normal quotas</button>
      <button onClick={() => void select("expired")}>Expired logins</button>
      <button onClick={() => void select("unknown")}>Unavailable quotas</button>
      <button onClick={() => void select("legacy")}>Older Antigravity API</button>
      <button onClick={() => { setLocale("zh"); setRevision((value) => value + 1); }}>中文</button>
      <button onClick={() => { setLocale("en"); setRevision((value) => value + 1); }}>English</button>
    </nav>
    <PlanUsage key={revision} />
  </main>;
}
setLocale("en");
applySkin("midnight");
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
