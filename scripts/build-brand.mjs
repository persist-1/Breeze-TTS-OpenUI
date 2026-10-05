import { build } from "esbuild";
import { spawn } from "node:child_process";
import path from "node:path";
await build({
  entryPoints: ["scripts/render-brand.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: ".runtime/render-brand.cjs",
  external: ["electron"],
});
const child = spawn(
  path.resolve("node_modules/electron/dist/electron.exe"),
  [path.resolve(".runtime/render-brand.cjs")],
  {
    windowsHide: true,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  },
);
const timer = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
}, 30000);
child.once("error", (e) => {
  clearTimeout(timer);
  console.error(e);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
