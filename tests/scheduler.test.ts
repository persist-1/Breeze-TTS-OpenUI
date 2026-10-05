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
test("shutdown waits for the model child and forbids any later service start", async () => {
  const f = fixture();
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    kill: () => true,
  });
  f.protocol.worker = child;
  let finished = false;
  const closing = f.scheduler.shutdown().then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  child.emit("close", 0);
  await closing;
  assert.equal(finished, true);
  await assert.rejects(f.scheduler.start(), /正在关闭/);
});

test("a model failure retains child ownership until shutdown can wait for its exit", async () => {
  const f = fixture();
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    kill: () => true,
  });
  f.protocol.worker = child;
  f.protocol.message({ type: "fatal", message: "模型加载失败" });
  assert.equal(f.protocol.worker, child);
  assert.equal(f.scheduler.installer.runtime.service.error, "模型加载失败");
  await assert.rejects(f.scheduler.start(), /当前正在运行/);
  let finished = false;
  const closing = f.scheduler.shutdown().then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  child.emit("close", 1);
  await closing;
  assert.equal(finished, true);
});
test("stop during resource validation cancels model startup before a child can spawn", async () => {
  const f = fixture();
  f.protocol.worker = null;
  f.scheduler.installer.runtime.busy = null;
  let release!: () => void;
  const check = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.scheduler.installer.validate = async () => {
    await check;
  };
  const starting = f.scheduler.start();
  await f.scheduler.stop();
  release();
  await starting;
  assert.equal(f.protocol.worker, null);
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
    assert(f.repo.workspace.outputs.some((o) => o.id === kept.id));
  } finally {
    f.scheduler.stop();
  }
});
