import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import type { Snapshot, Command } from "../packages/contracts/src/index.ts";
const address = "http://127.0.0.1:14321";
const snapshot = async (): Promise<Snapshot> =>
  fetch(address + "/api/snapshot").then((r) => r.json());
const initial = await snapshot();
assert.equal(initial.runtime.root, path.resolve(process.cwd()));
assert.equal(
  initial.runtime.service.status,
  "running",
  "请先在项目设置安装资源并启动模型服务",
);
const command = async (c: Command): Promise<Snapshot> => {
  const response = await fetch(address + "/api/command", {
    method: "POST",
    headers: { Origin: address, "Content-Type": "application/json" },
    body: JSON.stringify(c),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
};
let state = await command({ type: "project.create" });
const projectId = state.workspace.currentProjectId,
  segmentId = state.workspace.projects.find(
    (p) => p.id === projectId,
  )!.currentId;
await command({
  type: "project.update",
  projectId,
  patch: { title: "真实推理验收（测试）" },
});
const results: {
  mode: string;
  taskId: string;
  duration: number;
  file: string;
}[] = [];
const run = async (mode: string, patch: Record<string, unknown>) => {
  await command({
    type: "segment.update",
    projectId,
    segmentId,
    patch: {
      text: "你好，这是本地语音生成测试。",
      voiceSource: "description",
      voiceDescription: "",
      voiceId: "",
      directionEnabled: false,
      directionDraft: "",
      directionSource: "description",
      seed: 42,
      cfg: 4,
      count: 1,
      ...patch,
    },
  });
  const submitted = await command({ type: "task.create", projectId }),
    taskId = submitted.workspace.tasks[0].id;
  const limit = Date.now() + 300_000;
  while (Date.now() < limit) {
    state = await snapshot();
    const task = state.workspace.tasks.find((t) => t.id === taskId)!;
    if (["failed", "interrupted", "cancelled"].includes(task.status))
      throw Error(`${mode}: ${task.error || task.status}`);
    if (task.status === "completed") {
      const output = state.workspace.outputs.find((o) => o.taskId === taskId)!;
      assert(output.duration > 0.1);
      assert(fs.statSync(path.resolve(output.file)).size > 44);
      results.push({
        mode,
        taskId,
        duration: output.duration,
        file: output.file,
      });
      console.log(`${mode}: ${output.duration.toFixed(2)}s WAV generated`);
      return output;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(mode + " 生成超时");
};
try {
  const plain = await run("普通合成", {});
  await run("声音描述与演绎指导", {
    voiceDescription: "年轻女性，清晰自然的中音。",
    directionEnabled: true,
    directionDraft: "轻声、平静地讲述。",
  });
  const response = await fetch(address + "/api/reference", {
    method: "POST",
    headers: { Origin: address, "Content-Type": "audio/wav" },
    body: fs.readFileSync(path.resolve(plain.file)),
  });
  const reference = await response.json();
  if (!response.ok) throw Error(reference.error);
  const voiceId = crypto.randomUUID();
  await command({
    type: "voice.save",
    item: {
      id: voiceId,
      name: "参考管线验收（测试录音）",
      kind: "reference",
      description: "",
      seed: 42,
      assetId: reference.id,
      transcript: plain.input.text,
      consent: true,
    },
  });
  await run("参考音色克隆", { voiceSource: "library", voiceId });
  await run("参考音色与演绎修改", {
    voiceSource: "library",
    voiceId,
    directionEnabled: true,
    directionDraft: "放慢语速，温和讲述。",
  });
} finally {
  fs.mkdirSync("data/logs", { recursive: true });
  fs.writeFileSync(
    "data/logs/inference-smoke.json",
    JSON.stringify(
      {
        projectId,
        results,
        scope: "真实本地模型管线；不代表人工听感或转写质量评估",
      },
      null,
      2,
    ),
  );
}
