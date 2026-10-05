// Real development launch/close/relaunch against a separate internal workspace.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
const base = path.resolve(".runtime/dev-lifecycle");
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, "session-"));
const paths = new PortablePaths(root);
const portServer = createServer();
portServer.listen(0, "127.0.0.1");
await once(portServer, "listening");
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const url = `http://127.0.0.1:${port}`;
const results = [];
for (let cycle = 1; cycle <= 4; cycle++) {
  const signalShutdown = cycle === 4;
  let log = "",
    successful = 0,
    badResponses = 0,
    polling = true;
  // Mimic the already open browser: it polls before the development start.
  const poll = (async () => {
    while (polling) {
      try {
        const r = await fetch(url + "/api/snapshot");
        if (r.ok) {
          const s = await r.json();
          assert.equal(s.runtime.root, root);
          successful++;
        } else badResponses++;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  })();
  const args = signalShutdown
    ? [
        "--input-type=module",
        "-e",
        "process.argv=[process.execPath,'dev-signal-smoke','--smoke-session']; await import('./scripts/dev.mjs'); setTimeout(()=>process.emit('SIGINT'),1500)",
      ]
    : ["scripts/dev.mjs", "--smoke-close"];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...paths.env(),
      ELECTRON_RUN_AS_NODE: undefined,
      BREEZE_DEV_PORT: String(port),
      BREEZE_DEV_TEST_ROOT: root,
    },
  });
  child.stdout.on("data", (b) => {
    log += b;
  });
  child.stderr.on("data", (b) => {
    log += b;
  });
  const timeout = setTimeout(() => child.kill(), 45000);
  const [code] = await once(child, "close");
  clearTimeout(timeout);
  polling = false;
  await poll;
  assert.equal(code, 0, log);
  assert(successful > 0, log);
  assert.equal(badResponses, 0, log);
  assert(!/proxy error|ECONNREFUSED|EADDRINUSE|启动失败/.test(log), log);
  await assert.rejects(fetch(url + "/api/snapshot"));
  const close = JSON.parse(
    fs.readFileSync(
      paths.inside("data/logs/electron-close-smoke.json"),
      "utf8",
    ),
  );
  assert(close.flushed);
  results.push({
    cycle,
    signalShutdown,
    successful,
    badResponses,
    closed: true,
    log,
  });
  console.log(
    signalShutdown
      ? "中断退出：保存确认成功，预览及工作区服务关闭，无代理错误。"
      : `第 ${cycle} 次：工作区就绪后开放预览，关闭后端口释放，无代理错误。`,
  );
}
// A failed frontend bind must also release its newly started owned host;
// the unrelated listener occupying the requested port must remain untouched.
const occupied = createServer();
occupied.listen(port, "127.0.0.1");
await once(occupied, "listening");
try {
  let log = "";
  const child = spawn(process.execPath, ["scripts/dev.mjs", "--smoke-close"], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...paths.env(),
      ELECTRON_RUN_AS_NODE: undefined,
      BREEZE_DEV_PORT: String(port),
      BREEZE_DEV_TEST_ROOT: root,
    },
  });
  child.stdout.on("data", (b) => {
    log += b;
  });
  child.stderr.on("data", (b) => {
    log += b;
  });
  const timeout = setTimeout(() => child.kill(), 45000);
  const [code] = await once(child, "close");
  clearTimeout(timeout);
  assert.equal(code, 1, log);
  assert.match(log, /already in use|EADDRINUSE/);
  assert(!/proxy error|ECONNREFUSED/.test(log), log);
  assert(occupied.listening);
  results.push({ cycle: 5, expectedStartupFailure: true, exitCode: code, log });
  console.log(
    "启动失败：占用提示正确，本次客户端已退出，原端口监听者未被终止。",
  );
} finally {
  await new Promise((resolve) => occupied.close(resolve));
}
fs.writeFileSync(
  paths.inside("data/logs/dev-lifecycle.json"),
  JSON.stringify({ root, url, results }, null, 2),
);
console.log("连续启动与中断退出验收通过：" + root);
