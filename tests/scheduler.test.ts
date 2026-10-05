import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { Repository } from "../apps/desktop/host/repository.ts";
import { Installer } from "../apps/desktop/host/installer.ts";
import { Scheduler } from "../apps/desktop/host/scheduler.ts";
import { editWorkspace } from "../apps/desktop/host/domain.ts";
import { matchesDraft } from "../apps/desktop/src/compatibility.ts";
function fixture() {
  const base = path.resolve(".runtime/test-cases");
  fs.mkdirSync(base, { recursive: true });
  const paths = new PortablePaths(
      fs.mkdtempSync(path.join(base, "scheduler-")),
    ),
    repo = new Repository(paths),
    installer = new Installer(paths, () => {}),
    scheduler = new Scheduler(repo, installer, () => {});
  installer.runtime.service = { status: "running", message: "test" };
  installer.runtime.model.version = "fixture";
  for (const k of ["python", "dependencies", "model"] as const)
    installer.runtime[k].status = "ready";
  const protocol = scheduler as unknown as {
    worker: unknown;
    message: (m: unknown) => void;
  };
  const sent: { type: string; id: string }[] = [];
  protocol.worker = {
    stdin: { write: (line: string) => sent.push(JSON.parse(line)) },
    kill: () => {},
  };
  const p = repo.workspace.projects[0];
  repo.transaction((w) =>
    editWorkspace(w, {
      type: "segment.update",
      projectId: p.id,
      segmentId: p.currentId,
      patch: { text: "管线测试", count: 3 },
    }),
  );
  const finish = () => {
    const id = sent.at(-1)!.id;
    protocol.message({
      type: "pcm",
      id,
      data: Buffer.alloc(4800).toString("base64"),
      sampleRate: 24000,
    });
    protocol.message({ type: "done", id });
  };
  return { repo, scheduler, protocol, sent, p, finish };
}
test("service stays stopping until process close; repeated stop shares the pending shutdown", async () => {
  const f = fixture(),
    child = Object.assign(new EventEmitter(), {
      exitCode: null,
      kill: () => true,
    });
  f.protocol.worker = child;
  const stopping = f.scheduler.stop();
  assert.equal(f.scheduler.installer.runtime.service.status, "stopping");
  assert.equal(f.scheduler.stop(), stopping);
  child.emit("close", 1);
  await stopping;
  assert.equal(f.scheduler.installer.runtime.service.status, "stopped");
});
test("validation failure blocks new generation, retry and next candidate without deleting finished audio", () => {
  const f = fixture();
  try {
    f.scheduler.enqueue(f.p.id, false);
    const t = f.repo.workspace.tasks[0];
    f.scheduler.installer.runtime.model.status = "error";
    assert.throws(() => f.scheduler.enqueue(f.p.id, false), /未就绪/);
    f.finish();
    assert.equal(f.repo.workspace.outputs.length, 1);
    assert.equal(f.sent.length, 1);
    f.repo.transaction((w) => {
      w.tasks[0].status = "interrupted";
    });
    assert.throws(() => f.scheduler.retry(t.id), /未就绪/);
    f.scheduler.installer.runtime.model.status = "ready";
    f.scheduler.retry(t.id);
    assert.equal(f.sent.length, 2);
    assert.equal(f.repo.workspace.outputs.length, 1);
  } finally {
    void f.scheduler.stop();
  }
});
test("queue automatically prepares next task after current candidates finish", () => {
  const f = fixture();
  try {
    f.scheduler.enqueue(f.p.id, false);
    const first = f.repo.workspace.tasks[0].id;
    f.scheduler.enqueue(f.p.id, false);
    const second = f.repo.workspace.tasks[0].id;
    f.finish();
    f.finish();
    f.finish();
    assert.equal(
      f.repo.workspace.tasks.find((t) => t.id === first)!.status,
      "completed",
    );
    assert.equal(
      f.repo.workspace.tasks.find((t) => t.id === second)!.status,
      "preparing",
    );
    assert.equal(f.sent.length, 4);
  } finally {
    f.scheduler.stop();
  }
});
test("cancel retry preserves completed candidate, avoids duplicates, and marks changed drafts as stale", () => {
  const f = fixture();
  try {
    f.scheduler.enqueue(f.p.id, false);
    const taskId = f.repo.workspace.tasks[0].id;
    f.finish();
    const kept = f.repo.workspace.outputs[0];
    f.scheduler.cancel(taskId);
    f.protocol.message({
      type: "cancelled",
      id: f.repo.workspace.tasks[0].units[1].id,
    });
    f.scheduler.retry(taskId);
    f.finish();
    f.finish();
    assert.equal(f.repo.workspace.outputs.length, 3);
    assert.equal(f.repo.workspace.tasks[0].attempts, 2);
    assert(f.repo.workspace.outputs.some((o) => o.id === kept.id));
    const s = f.repo.workspace.projects[0].segments[0];
    assert(matchesDraft(s, kept, f.repo.workspace));
    f.repo.transaction((w) =>
      editWorkspace(w, {
        type: "segment.update",
        segmentId: s.id,
        patch: { text: "新文稿" },
      }),
    );
    assert(
      !matchesDraft(
        f.repo.workspace.projects[0].segments[0],
        kept,
        f.repo.workspace,
      ),
    );
    assert(f.repo.workspace.outputs.some(o => o.id === kept.id));
  } finally {
    f.scheduler.stop();
  }
});
