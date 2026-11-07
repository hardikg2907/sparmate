import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ASSET_PREFIX = "/excalidraw-assets/";
const ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "node_modules", "@excalidraw", "excalidraw", "dist", "prod");
const ASSET_TYPES: Record<string, string> = { ".woff2": "font/woff2", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

// The real server serves these files at the same address in production. Serving them from the dev server too means
// the board's fonts load without the API server running (fixture pages), and never reach for a CDN.
function excalidrawAssets(): Plugin {
  return {
    name: "excalidraw-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        if (!path.startsWith(ASSET_PREFIX) || (req.method !== "GET" && req.method !== "HEAD")) return next();
        let file: string;
        try {
          file = resolve(ASSET_ROOT, decodeURIComponent(path.slice(ASSET_PREFIX.length)));
        } catch {
          res.statusCode = 400;
          return res.end();
        }
        if (!file.startsWith(ASSET_ROOT + sep) || file.split(sep).some((part) => part.startsWith(".")) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader("Content-Type", ASSET_TYPES[extname(file)] ?? "application/octet-stream");
        if (req.method === "HEAD") return res.end();
        createReadStream(file).pipe(res);
      });
    },
  };
}

const SERVER = `http://127.0.0.1:${process.env.PORT ?? 4747}`;

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss(), excalidrawAssets()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": SERVER,
      "/ws": { target: SERVER.replace("http", "ws"), ws: true },
    },
  },
});
