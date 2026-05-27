import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import css from "./styles.css?inline";

let styleInjected = false;

function injectStyles(): void {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.cogster = "true";
  style.textContent = css;
  document.head.appendChild(style);
  styleInjected = true;
}

export function cogsterMount(target: string | HTMLElement, source: string): void {
  injectStyles();
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) throw new Error(`cogsterMount: target '${String(target)}' not found`);
  createRoot(el as HTMLElement).render(React.createElement(App, { initialSource: source }));
}

declare global {
  interface Window {
    cogsterMount: typeof cogsterMount;
  }
}

if (typeof window !== "undefined") {
  window.cogsterMount = cogsterMount;
}
