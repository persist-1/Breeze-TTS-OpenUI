import { spawn } from "node:child_process";

// Only children launched by this session are touched; never kill by port/name.
export function superviseDevelopment() {
  const children = new Set(),
    cleanups = [];
  let stopping;
  const stop = (code = 0) =>
    (stopping ||= (async () => {
      for (const child of children) {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null)
          continue;
        if (process.platform === "win32") {
          await new Promise((resolve) => {
            const killer = spawn(
              "taskkill",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true, stdio: "ignore" },
            );
            killer.once("error", () => {
              child.kill();
              resolve();
            });
            killer.once("exit", resolve);
          });
        } else child.kill("SIGTERM");
      }
      await Promise.allSettled(cleanups.map((cleanup) => cleanup()));
      process.exitCode = code;
    })());
  return {
    stop,
    isStopping: () => !!stopping,
    addCleanup: (cleanup) =>
      stopping ? void cleanup() : cleanups.push(cleanup),
    watch: (child) => {
      children.add(child);
      child.once("error", (error) => {
        console.error("开发客户端启动失败：", error);
        void stop(1);
      });
      child.once("exit", (code, signal) => {
        children.delete(child);
        console.log("开发客户端已退出，正在关闭开发服务…");
        void stop(code ?? (signal ? 1 : 0));
      });
    },
  };
}
