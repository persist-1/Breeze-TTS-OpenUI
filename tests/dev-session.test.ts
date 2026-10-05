import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
// @ts-expect-error Development orchestration is a native Node module.
import { superviseDevelopment } from "../scripts/dev-session.mjs";

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
