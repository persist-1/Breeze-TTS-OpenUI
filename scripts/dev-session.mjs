import { spawn } from "node:child_process";

// Only children launched by this session are touched; never kill by port/name.
export function superviseDevelopment() {
  const children = new Set(),
    cleanups = [];
  let stopping,
    finalCode = 0;
  const stop = (code = 0) => {
    if (code) process.exitCode = finalCode = code;
    return (stopping ||= (async () => {
      // Let the renderer flush edits first. Its host-stopping handshake closes
      // Vite before the API target; closing Vite here would break that flush.
      for (const child of children) {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null)
          continue;
        if (child.connected) {
          let onExit;
          const exited = new Promise((resolve) => {
            onExit = resolve;
            child.once("exit", onExit);
          });
          child.send({ type: "breeze:shutdown" }, () => {});
          let timer;
          await Promise.race([
            exited,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 25000);
            }),
          ]);
          clearTimeout(timer);
          child.off("exit", onExit);
        }
      }
      const cleanupResults = await Promise.allSettled(
        cleanups.map(async (cleanup) => cleanup()),
      );
      for (const result of cleanupResults)
        if (result.status === "rejected") {
          console.error("开发服务关闭失败：", result.reason);
          finalCode = 1;
        }
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
      process.exitCode = finalCode;
    })());
  };
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

export function waitForDevelopmentHost(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const finish = (error, address) => {
      clearTimeout(timer);
      child.off("message", message);
      child.off("exit", exit);
      child.off("error", failed);
      error ? reject(error) : resolve(address);
    };
    const message = (value) => {
      if (value?.type !== "breeze:host-ready") return;
      try {
        const url = new URL(value.address);
        if (
          url.protocol !== "http:" ||
          url.hostname !== "127.0.0.1" ||
          !url.port ||
          url.username ||
          url.password
        )
          throw Error("本地服务返回了无效地址");
        finish(null, url.origin);
      } catch (error) {
        finish(error);
      }
    };
    const exit = (code, signal) =>
      finish(Error(`本地工作区服务在就绪前退出（${signal || code}）。`));
    const failed = (error) => finish(error);
    const timer = setTimeout(
      () => finish(Error("等待本地工作区服务启动超时。")),
      timeoutMs,
    );
    child.on("message", message);
    child.once("exit", exit);
    child.once("error", failed);
  });
}
