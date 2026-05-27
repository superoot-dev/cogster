import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

async function fetchSource(): Promise<string> {
  const res = await fetch("/api/source", { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch /api/source -> ${res.status}`);
  const { source } = (await res.json()) as { source: string };
  return source;
}

function Boot({ initialSource }: { initialSource: string }) {
  const [externalSource, setExternalSource] = useState(initialSource);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const hot = (import.meta as ImportMeta & { hot?: { on(e: string, cb: () => void): void } }).hot;
    if (!hot) return;
    hot.on("cogster:source-changed", () => {
      fetchSource().then((s) => {
        setExternalSource(s);
        setReloadKey((k) => k + 1);
      }).catch((e) => console.error("[cogster] reload failed", e));
    });
  }, []);
  return <App key={reloadKey} initialSource={externalSource} />;
}

async function boot() {
  const root = document.getElementById("root");
  if (!root) return;
  try {
    const source = await fetchSource();
    createRoot(root).render(<Boot initialSource={source} />);
  } catch (err) {
    root.textContent = `Failed to load source: ${err instanceof Error ? err.message : String(err)}`;
  }
}

boot();
