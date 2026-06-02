import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

async function fetchSource(): Promise<{ source: string; scenario: string | null }> {
  const res = await fetch("/api/source", { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch /api/source -> ${res.status}`);
  const { source, scenario } = (await res.json()) as { source: string; scenario?: string | null };
  return { source, scenario: scenario ?? null };
}

function Boot({ initialSource, initialScenario }: { initialSource: string; initialScenario: string | null }) {
  const [externalSource, setExternalSource] = useState(initialSource);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const hot = (import.meta as ImportMeta & { hot?: { on(e: string, cb: () => void): void } }).hot;
    if (!hot) return;
    hot.on("cogster:source-changed", () => {
      fetchSource().then(({ source }) => {
        setExternalSource(source);
        setReloadKey((k) => k + 1);
      }).catch((e) => console.error("[cogster] reload failed", e));
    });
  }, []);
  return <App key={reloadKey} initialSource={externalSource} initialScenario={initialScenario} />;
}

async function boot() {
  const root = document.getElementById("root");
  if (!root) return;
  try {
    const { source, scenario } = await fetchSource();
    createRoot(root).render(<Boot initialSource={source} initialScenario={scenario} />);
  } catch (err) {
    root.textContent = `Failed to load source: ${err instanceof Error ? err.message : String(err)}`;
  }
}

boot();
