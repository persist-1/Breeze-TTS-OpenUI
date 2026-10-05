import { build } from "esbuild";
import fs from "node:fs";
fs.mkdirSync("build/desktop", { recursive: true });
await build({
  entryPoints: ["apps/desktop/electron/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "build/desktop/main.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["apps/desktop/electron/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "build/desktop/preload.cjs",
  external: ["electron"],
});
