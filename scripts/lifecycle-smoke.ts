import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import type { Snapshot, Command } from "../packages/contracts/src/index.ts";
const address = "http://127.0.0.1:14321";
const snapshot = async (): Promise<Snapshot> =>
  fetch(address + "/api/snapshot").then((r) => r.json());
const command = async (c: Command): Promise<Snapshot> => {
  const response = await fetch(address + "/api/command", {
    method: "POST",
    headers: { Origin: address, "Content-Type": "application/json" },
    body: JSON.stringify(c),
  });
  const state = await response.json();
  if (!response.ok) throw Error(state.error);
  return state;
};
assert.equal((await snapshot()).runtime.root, path.resolve(process.cwd()));
let state = await command({ type: "project.create" });
const projectId = state.workspace.currentProjectId,
  segmentId = state.workspace.projects.find(
    (p) => p.id === projectId,
  )!.currentId;
await command({
  type: "project.update",
  projectId,
  patch: { title: "取消与恢复验收（测试）" },
});
await command({
  type: "segment.update",
  projectId,
  segmentId,
  patch: {
    text: "窗外的雨渐渐停了。我们打开窗户，让清新的空气和清晨的阳光一起进来。今天，还有许多值得期待的事情。",
    voiceSource: "description",
    voiceDescription: "",
    directionEnabled: false,
    count: 3,
  },
});
state = await command({ type: "task.create", projectId });
const taskId = state.workspace.tasks[0].id;
async function until(check: (s: Snapshot) => boolean) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    state = await snapshot();
    const task = state.workspace.tasks.find((t) => t.id === taskId)!;
    if (["failed", "interrupted"].includes(task.status))
      throw Error(task.error || task.status);
    if (check(state)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("验收等待超时");
}
await until((s) => s.workspace.outputs.some((o) => o.taskId === taskId));
const retained = state.workspace.outputs
  .filter((o) => o.taskId === taskId)
  .map((o) => ({ id: o.id, file: o.file, bytes: fs.readFileSync(o.file) }));
await command({ type: "task.cancel", id: taskId });
await until(
  (s) => s.workspace.tasks.find((t) => t.id === taskId)!.status === "cancelled",
);
assert(
  state.workspace.outputs.filter((o) => o.taskId === taskId).length < 3,
  "必须在全部完成前取消",
);
await command({ type: "task.retry", id: taskId });
await until(
  (s) => s.workspace.tasks.find((t) => t.id === taskId)!.status === "completed",
);
const outputs = state.workspace.outputs.filter((o) => o.taskId === taskId);
assert.equal(outputs.length, 3);
assert.equal(state.workspace.tasks.find((t) => t.id === taskId)!.attempts, 2);
for (const o of retained) {
  assert(outputs.some((x) => x.id === o.id));
  assert.deepEqual(fs.readFileSync(o.file), o.bytes);
}
const response = await fetch(address + "/api/audio/" + outputs[0].id);
assert.equal(response.status, 200);
const exported = Buffer.from(await response.arrayBuffer());
assert.equal(exported.toString("ascii", 0, 4), "RIFF");
fs.writeFileSync(
  "data/logs/lifecycle-smoke.json",
  JSON.stringify(
    {
      projectId,
      taskId,
      retainedIds: retained.map((o) => o.id),
      outputs: outputs.map((o) => o.id),
      attempts: 2,
      audioBytes: exported.length,
      scope:
        "真实生成、部分取消、同一记录恢复、已完成音频字节不变、单份音频读取",
    },
    null,
    2,
  ),
);
console.log(
  "Real cancellation/resume/audio access passed; completed audio preserved.",
);
