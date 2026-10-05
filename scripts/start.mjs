import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["node_modules/electron/cli.js", "build/desktop/main.cjs"],
  { stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => process.exit(code || 0));
