import { build } from "esbuild";
import { spawn } from "node:child_process";
import path from "node:path";
await build({
  entryPoints: [
    process.argv.includes("--management")
      ? "scripts/management-ui.ts"
      : "scripts/studio-ui.ts",
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: process.argv.includes("--management")
    ? ".runtime/management-ui.cjs"
    : ".runtime/studio-ui.cjs",
  external: ["electron"],
});
const child = spawn(
  path.resolve("node_modules/electron/dist/electron.exe"),
  [
    path.resolve(
      process.argv.includes("--management")
        ? ".runtime/management-ui.cjs"
        : ".runtime/studio-ui.cjs",
    ),
    ...process.argv.slice(2),
  ],
  {
    windowsHide: true,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  },
);
const timeout = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
}, 180000);
child.once("error", (error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  clearTimeout(timeout);
  process.exitCode = code ?? 1;
});
