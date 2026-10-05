import { spawn } from "node:child_process";
import path from "node:path";
import { createServer } from "vite";
import {
  superviseDevelopment,
  waitForDevelopmentHost,
} from "./dev-session.mjs";

const webOnly = process.argv.includes("--web");
const session = superviseDevelopment();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void session.stop(0));
try {
  if (!webOnly) await import("./build-host.mjs");
  if (session.isStopping()) throw Error("启动已取消");
  const devPort = Number(process.env.BREEZE_DEV_PORT || 4320);
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535)
    throw Error("开发预览端口无效");
  const env = {
    ...process.env,
    BREEZE_DEV_IPC: "1",
    BREEZE_DEV_URL: `http://127.0.0.1:${devPort}`,
  };
  let vite;
  const client = webOnly
    ? spawn(process.execPath, ["--import", "tsx", "apps/desktop/host/dev.ts"], {
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        env,
        windowsHide: true,
      })
    : spawn(
        path.resolve("node_modules/electron/dist/electron.exe"),
        ["build/desktop/main.cjs", ...process.argv.slice(2)],
        {
          stdio: ["inherit", "inherit", "inherit", "ipc"],
          windowsHide: true,
          env: {
            ...env,
            ELECTRON_RUN_AS_NODE: undefined,
          },
        },
      );
  session.watch(client);
  client.on("message", (value) => {
    if (value?.type === "breeze:host-stopping") {
      void (async () => {
        await vite?.close();
        if (client.connected)
          client.send({ type: "breeze:frontend-stopped" }, () => {});
      })().catch((error) => {
        console.error("开发预览关闭失败：", error);
        void session.stop(1);
      });
    }
  });
  const address = await waitForDevelopmentHost(client);
  if (session.isStopping()) throw Error("启动已取消");
  vite = await createServer({
    server: {
      port: devPort,
      proxy: { "/api": { target: address, changeOrigin: true } },
    },
  });
  session.addCleanup(() => vite.close());
  if (session.isStopping()) throw Error("启动已取消");
  await vite.listen();
  if (session.isStopping()) throw Error("启动已取消");
  vite.printUrls();
  client.send({ type: "breeze:renderer-ready" }, (error) => {
    if (error) void session.stop(1);
  });
} catch (error) {
  if (!session.isStopping()) console.error("开发环境启动失败：", error);
  await session.stop(1);
}
