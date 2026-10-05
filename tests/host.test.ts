import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHost } from "../apps/desktop/host/server.ts";
test("host starts without Python; mutations check origin; task submission requires a running service", async () => {
  const base = path.resolve(".runtime/test-cases");
  fs.mkdirSync(base, { recursive: true });
  const host = await createHost(fs.mkdtempSync(path.join(base, "host-")));
  try {
    const snapshot = await (await fetch(host.address + "/api/snapshot")).json();
    assert.equal(snapshot.workspace.projects.length, 1);
    assert.equal(snapshot.runtime.service.status, "stopped");
    const external = await fetch(host.address + "/api/command", {
      method: "POST",
      headers: { Origin: "https://external.example" },
      body: JSON.stringify({ type: "project.create" }),
    });
    assert.equal(external.status, 403);
    const submit = await fetch(host.address + "/api/command", {
      method: "POST",
      headers: { Origin: host.address },
      body: JSON.stringify({ type: "task.create" }),
    });
    assert.equal(submit.status, 400);
    assert.match((await submit.json()).error, /启动/);
    const create = await fetch(host.address + "/api/command", {
      method: "POST",
      headers: { Origin: host.address },
      body: JSON.stringify({ type: "project.create" }),
    });
    assert.equal((await create.json()).workspace.projects.length, 2);
  } finally {
    host.close();
  }
});
