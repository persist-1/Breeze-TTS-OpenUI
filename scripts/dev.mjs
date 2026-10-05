import { spawn } from "node:child_process";
import path from "node:path";
import { createServer } from "vite";
import { superviseDevelopment } from "./dev-session.mjs";

const webOnly = process.argv.includes("--web");
const session = superviseDevelopment();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void session.stop(0));
try {
  if (!webOnly) await import("./build-host.mjs");
  if (session.isStopping()) throw Error("启动已取消");
  const vite = await createServer();
  session.addCleanup(() => vite.close());
  if (session.isStopping()) throw Error("启动已取消");
  await vite.listen();
  if (session.isStopping()) throw Error("启动已取消");
  vite.printUrls();
  const client = webOnly
    ? spawn(process.execPath, ["--import", "tsx", "apps/desktop/host/dev.ts"], {
        stdio: "inherit",
        windowsHide: true,
      })
    : spawn(
        path.resolve("node_modules/electron/dist/electron.exe"),
        ["build/desktop/main.cjs", ...process.argv.slice(2)],
        {
          stdio: "inherit",
          windowsHide: true,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: undefined,
            BREEZE_DEV_URL: "http://127.0.0.1:4320",
          },
        },
      );
  session.watch(client);
} catch (error) {
  if (!session.isStopping()) console.error("开发环境启动失败：", error);
  await session.stop(1);
}
