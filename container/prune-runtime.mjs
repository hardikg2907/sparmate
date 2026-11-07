// Lists every runtime dependency the server does not import, for `npm uninstall` in the image build.
// The page is already bundled into dist/, so React, Monaco, Excalidraw and the rest only cost image size.
import { readFileSync } from "node:fs";

const SERVER_PACKAGES = new Set([
  "@anthropic-ai/claude-agent-sdk",
  "@anthropic-ai/sdk",
  "@modelcontextprotocol/sdk",
  "@fastify/static",
  "@fastify/websocket",
  "diff",
  "fastify",
  "tsx",
  "yaml",
  "zod",
]);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const missing = [...SERVER_PACKAGES].filter((name) => !(name in (pkg.dependencies ?? {})));
if (missing.length > 0) {
  console.error(`Server packages missing from dependencies: ${missing.join(", ")}`);
  process.exit(1);
}
process.stdout.write(
  Object.keys(pkg.dependencies ?? {})
    .filter((name) => !SERVER_PACKAGES.has(name))
    .join(" "),
);
