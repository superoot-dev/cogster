import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IncomingMessage } from "node:http";
import { defineConfig } from "vite";

const ROOT = process.cwd();
const SOURCE_FILE = resolve(ROOT, process.env.COGSTER_FILE ?? "examples/sample.cogs");

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export default defineConfig({
  server: { host: "127.0.0.1", port: 5173 },
  plugins: [
    react(),
    {
      name: "cogster-source",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/source")) {
            next();
            return;
          }
          res.setHeader("content-type", "application/json");
          try {
            if (req.method === "GET") {
              const text = await readFile(SOURCE_FILE, "utf8");
              res.end(JSON.stringify({ source: text, path: SOURCE_FILE }));
              return;
            }
            if (req.method === "POST") {
              const body = await readBody(req);
              const { source } = JSON.parse(body) as { source: string };
              await writeFile(SOURCE_FILE, source, "utf8");
              res.end(JSON.stringify({ ok: true }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ error: "method not allowed" }));
          } catch (err) {
            console.error("[cogster-source]", err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          }
        });
        server.watcher.add(SOURCE_FILE);
        server.watcher.on("change", (file) => {
          if (file === SOURCE_FILE) server.ws.send({ type: "custom", event: "cogster:source-changed" });
        });
      },
    },
  ],
});
