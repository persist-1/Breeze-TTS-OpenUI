import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  superviseDevelopment,
  waitForDevelopmentHost,
  // @ts-expect-error Development orchestration is a native Node module.
} from "../scripts/dev-session.mjs";

test("client exit closes its development listener once", async () => {
  const server = createServer((_req, res) => res.end("ready"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const session = superviseDevelopment();
  let cleanups = 0;
  session.addCleanup(
    () =>
      new Promise<void>((resolve) => {
        cleanups++;
        server.close(() => resolve());
      }),
  );
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    windowsHide: true,
  });
  session.watch(child);
  await once(child, "exit");
  await session.stop();
  assert.equal(server.listening, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
  await session.stop();
  assert.equal(cleanups, 1);
});
test("development readiness waits for the owned host and rejects exit before ready", async () => {
  const ready = spawn(
    process.execPath,
    [
      "-e",
      "setTimeout(()=>process.send({type:'breeze:host-ready',address:'http://127.0.0.1:23456'}),80)",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  const exited = once(ready, "exit");
  const result = waitForDevelopmentHost(ready, 2000);
  assert.equal(await result, "http://127.0.0.1:23456");
  await exited;
  const failed = spawn(process.execPath, ["-e", "process.exit(3)"], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await assert.rejects(waitForDevelopmentHost(failed, 2000), /就绪前退出/);
});
test("supervisor allows final edits to flush before closing frontend and waits for child exit", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('message', m=>{if(m.type==='breeze:shutdown')setTimeout(()=>process.exit(0),100)});process.send({type:'breeze:host-ready',address:'http://127.0.0.1:23456'})",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  await waitForDevelopmentHost(child);
  const session = superviseDevelopment();
  let cleaned = false,
    shutdownBeforeCleanup = false;
  session.addCleanup(() => {
    cleaned = true;
  });
  const send = child.send.bind(child);
  child.send = ((...args: any[]) => {
    shutdownBeforeCleanup = !cleaned;
    return send(...(args as [any]));
  }) as typeof child.send;
  session.watch(child);
  await session.stop();
  assert(shutdownBeforeCleanup);
  assert(cleaned);
  assert.equal(child.exitCode, 0);
});

test("a failed child shutdown preserves a failure exit code even when normal exit was requested", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('message',m=>{if(m.type==='breeze:shutdown')process.exit(7)});process.send({type:'breeze:host-ready',address:'http://127.0.0.1:23456'})",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  await waitForDevelopmentHost(child);
  const session = superviseDevelopment();
  session.watch(child);
  const previous = process.exitCode;
  try {
    await session.stop(0);
    assert.equal(child.exitCode, 7);
    assert.equal(process.exitCode, 7);
  } finally {
    process.exitCode = previous;
  }
});
