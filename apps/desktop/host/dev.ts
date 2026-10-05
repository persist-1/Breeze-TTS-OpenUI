import { createHost } from "./server.ts";
const host = await createHost(
  process.cwd(),
  process.env.BREEZE_DEV_IPC ? 0 : 14321,
  undefined,
  process.env.BREEZE_DEV_URL,
);
console.log("Breeze local host: " + host.address);
process.send?.({ type: "breeze:host-ready", address: host.address });
let closing: Promise<void> | undefined;
const close = () =>
  (closing ||= (async () => {
    if (process.connected)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          process.off("message", message);
          process.off("disconnect", done);
          resolve();
        };
        const message = (value: any) => {
          if (value?.type === "breeze:frontend-stopped") done();
        };
        const timer = setTimeout(done, 5000);
        process.on("message", message);
        process.once("disconnect", done);
        process.send?.({ type: "breeze:host-stopping" });
      });
    await host.close();
    process.disconnect?.();
    process.exitCode = 0;
  })());
const requestClose = () => {
  void close().catch((error) => {
    console.error("本地工作区服务关闭失败：", error);
    if (process.connected) process.disconnect();
    process.exitCode = 1;
  });
};
process.on("message", (value: any) => {
  if (value?.type === "breeze:shutdown") requestClose();
});
process.on("disconnect", requestClose);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    requestClose();
  });
