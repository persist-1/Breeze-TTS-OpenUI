import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fresh,
  fixedInput,
  unitsFor,
  editWorkspace,
  uid,
} from "../apps/desktop/host/domain.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { Repository } from "../apps/desktop/host/repository.ts";
import { inspectWav, wavHeader } from "../apps/desktop/host/audio.ts";
const sandbox = path.resolve(".runtime/test-cases");
fs.mkdirSync(sandbox, { recursive: true });
function repository() {
  const root = fs.mkdtempSync(path.join(sandbox, "workspace-"));
  return new Repository(new PortablePaths(root));
}
test("paths reject traversal, external absolute paths and external junctions", () => {
  const repo = repository(),
    p = repo.paths;
  assert.throws(() => p.inside("../outside"));
  assert.throws(() => p.inside("C:\\Users\\outside"));
  const outside = fs.mkdtempSync(path.join(sandbox, "outside-"));
  fs.symlinkSync(outside, p.inside("data/link"), "junction");
  assert.throws(() => p.inside("data/link/test"));
});
test("all subprocess caches and interpreters stay within the portable root", () => {
  const p = repository().paths,
    env = p.env();
  for (const key of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "UV_CACHE_DIR",
    "UV_PYTHON_INSTALL_DIR",
    "TORCH_HOME",
    "HF_HOME",
    "MODELSCOPE_CACHE",
    "PIP_CACHE_DIR",
  ])
    assert.equal(p.inside(env[key]!), env[key]);
  assert.equal(env.UV_PYTHON_PREFERENCE, "only-managed");
  assert.equal(env.UV_PYTHON_INSTALL_REGISTRY, "0");
  assert.equal(env.PYTHONNOUSERSITE, "1");
});
test("guidance modes preserve personal description; disabled guidance does not reach inference", () => {
  const w = fresh(),
    p = w.projects[0],
    s = p.segments[0];
  w.directions.push({ id: "guide", name: "播报", instruction: "清晰播报" });
  Object.assign(s, {
    text: "你好",
    directionEnabled: true,
    directionDraft: "自己的指导",
  });
  const own = fixedInput(s, w, "model");
  assert.equal(own.instruction, "自己的指导");
  editWorkspace(w, {
    type: "segment.update",
    segmentId: s.id,
    patch: { directionSource: "preset", directionPresetId: "guide" },
  });
  assert.equal(fixedInput(s, w, "model").instruction, "清晰播报");
  assert.equal(s.directionDraft, "自己的指导");
  s.directionEnabled = false;
  assert.equal(fixedInput(s, w, "model").instruction, "");
  assert.equal(fixedInput(s, w, "model").cfg, 1);
});
test("candidate inputs are immutable snapshots with consistent base signatures", () => {
  const w = fresh(),
    p = w.projects[0],
    s = p.segments[0];
  Object.assign(s, { text: "原稿", count: 3 });
  const units = unitsFor(p, w, false, "model");
  assert.equal(units.length, 3);
  assert.equal(units[2].input.seed, s.seed);
  s.text = "新稿";
  assert.equal(units[0].input.text, "原稿");
  assert.notEqual(
    units[0].input.signature,
    fixedInput(s, w, "model").signature,
  );
});
test("saved input keeps voice and guidance distinct without changing inference signatures", () => {
  const w = fresh(),
    s = w.projects[0].segments[0];
  Object.assign(s, {
    text: "记录文稿",
    voiceSource: "description",
    voiceDescription: "清晰的声音\n低沉",
    directionEnabled: true,
    directionDraft: "缓慢讲述\n自然停顿",
  });
  const input = fixedInput(s, w, "model");
  assert.equal(input.instruction, "清晰的声音\n低沉\n缓慢讲述\n自然停顿");
  assert.equal(input.presentation?.voiceDescription, "清晰的声音\n低沉");
  assert.equal(input.presentation?.direction, "缓慢讲述\n自然停顿");
  w.outputs.push({
    id: "separate",
    taskId: "task",
    projectId: w.currentProjectId,
    segmentId: s.id,
    name: "音频",
    createdAt: 0,
    file: "data/audio/test.wav",
    duration: 1,
    input,
    feedback: "",
    truncated: false,
  });
  s.voiceDescription = "已修改";
  s.directionDraft = "已修改";
  editWorkspace(w, { type: "output.restore", id: "separate" });
  assert.equal(s.voiceDescription, "清晰的声音\n低沉");
  assert.equal(s.directionDraft, "缓慢讲述\n自然停顿");
  assert.equal(fixedInput(s, w, "model").signature, input.signature);
  s.directionEnabled = false;
  assert.equal(fixedInput(s, w, "model").presentation?.direction, "");
});
test("deleted preset/reference requires a new choice, rather than silently downgrading", () => {
  const w = fresh(),
    s = w.projects[0].segments[0];
  Object.assign(s, {
    directionEnabled: true,
    directionSource: "preset",
    directionPresetId: "gone",
  });
  assert.throws(() => fixedInput(s, w, "m"), /预设/);
  s.directionEnabled = false;
  s.voiceId = "gone";
  assert.throws(() => fixedInput(s, w, "m"), /删除/);
});
test("restoring reference guidance retains exact input and does not alter saved audio", () => {
  const w = fresh(),
    p = w.projects[0],
    s = p.segments[0];
  w.voices.push({
    id: "ref",
    name: "本人",
    kind: "reference",
    description: "",
    seed: 42,
    assetId: "asset",
    transcript: "参考",
    consent: true,
  });
  Object.assign(s, {
    text: "文稿",
    voiceId: "ref",
    directionEnabled: true,
    directionDraft: "轻声",
  });
  const input = fixedInput(s, w, "m");
  w.outputs.push({
    id: "out",
    taskId: "task",
    projectId: p.id,
    segmentId: s.id,
    name: "音频",
    createdAt: 0,
    file: "data/audio/a.wav",
    duration: 1,
    input,
    feedback: "",
    truncated: false,
  });
  s.text = "变化";
  const retained = structuredClone(w.outputs);
  editWorkspace(w, { type: "output.restore", id: "out" });
  assert.equal(fixedInput(s, w, "m").signature, input.signature);
  assert.deepEqual(w.outputs, retained);
});
test("failed mutation rolls back and persisted workspace survives restart", () => {
  const repo = repository(),
    id = repo.workspace.projects[0].segments[0].id;
  assert.throws(() =>
    repo.transaction((w) =>
      editWorkspace(w, {
        type: "segment.update",
        segmentId: id,
        patch: { text: "保留", language: "xx" },
      }),
    ),
  );
  assert.equal(repo.workspace.projects[0].segments[0].text, "");
  repo.transaction((w) =>
    editWorkspace(w, {
      type: "segment.update",
      segmentId: id,
      patch: { text: "真实保存" },
    }),
  );
  assert.equal(
    new Repository(repo.paths).workspace.projects[0].segments[0].text,
    "真实保存",
  );
});
test("restart interrupts pending work and retains completed outputs", () => {
  const repo = repository();
  repo.transaction((w) => {
    w.tasks.push({
      id: "task",
      projectId: w.currentProjectId,
      projectTitle: "作品",
      createdAt: 1,
      status: "running",
      attempts: 1,
      error: null,
      events: [],
      units: [
        {
          id: "unit",
          segmentId: w.projects[0].currentId,
          segmentName: "第1段",
          index: 0,
          input: fixedInput(w.projects[0].segments[0], w, "m"),
          outputId: "retained",
        },
      ],
    });
  });
  const next = new Repository(repo.paths);
  assert.equal(next.workspace.tasks[0].status, "interrupted");
  assert.equal(next.workspace.tasks[0].units[0].outputId, "retained");
});
test("WAV imports reject non-audio and invalid durations", () => {
  assert.throws(() => inspectWav(Buffer.from("not audio")));
  const pcm = Buffer.alloc(24000 * 2);
  assert.equal(
    inspectWav(Buffer.concat([wavHeader(24000, pcm.length), pcm])).duration,
    1,
  );
  assert.throws(() =>
    inspectWav(Buffer.concat([wavHeader(24000, 2), Buffer.alloc(2)])),
  );
});
test("permanent voice deletion removes internal reference asset and clears draft linkage", () => {
  const repo = repository(),
    asset = uid();
  fs.writeFileSync(repo.paths.inside(`data/references/${asset}.wav`), "wav");
  repo.transaction((w) => {
    w.voices.push({
      id: "voice",
      name: "声音",
      kind: "reference",
      description: "",
      seed: 42,
      assetId: asset,
    });
    w.projects[0].segments[0].voiceId = "voice";
  });
  repo.delete("voice", "voice");
  assert.equal(
    fs.existsSync(repo.paths.inside(`data/references/${asset}.wav`)),
    false,
  );
  assert.equal(repo.workspace.projects[0].segments[0].voiceId, "");
});

test("a queued task without a reference does not block deleting unrelated described voices", () => {
  const repo = repository();
  repo.transaction((w) => {
    const p = w.projects[0];
    w.voices.push({
      id: "unrelated",
      name: "不相关的描述音色",
      kind: "design",
      description: "清晰明亮",
      seed: 42,
    });
    w.tasks.push({
      id: "queued",
      projectId: p.id,
      projectTitle: p.title,
      createdAt: Date.now(),
      status: "queued",
      attempts: 0,
      error: null,
      events: [],
      units: [
        {
          id: "unit",
          segmentId: p.currentId,
          segmentName: p.segments[0].name,
          index: 0,
          input: fixedInput(p.segments[0], w, "fixture"),
          outputId: null,
        },
      ],
    });
  });
  repo.delete("voice", "unrelated");
  assert.equal(repo.workspace.voices.length, 0);
  assert.equal(repo.workspace.tasks[0].status, "queued");
});
