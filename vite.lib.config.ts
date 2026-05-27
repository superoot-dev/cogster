import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/ui",
    lib: {
      entry: resolve(__dirname, "web/src/lib.ts"),
      name: "Cogster",
      fileName: () => "cogster-ui.js",
      formats: ["iife"],
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
