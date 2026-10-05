import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  editWorkspace,
  fresh,
  fixedInput,
  uid,
} from "../apps/desktop/host/domain.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { Repository } from "../apps/desktop/host/repository.ts";
import { wavHeader } from "../apps/desktop/host/audio.ts";
import { readWaveform } from "../apps/desktop/host/waveform.ts";
import { createHost } from "../apps/desktop/host/server.ts";
const base = path.resolve(".runtime/test-cases");
fs.mkdirSync(base, { recursive: true });
const root = () => fs.mkdtempSync(path.join(base, "studio-"));
function audio() {
  const pcm = Buffer.alloc(16000 * 2);
  for (let i = 4000; i < 8000; i++)
    pcm.writeInt16LE(i % 2 ? -16384 : 16384, i * 2);
  for (let i = 12000; i < 16000; i++) pcm.writeInt16LE(1, i * 2);
  return Buffer.concat([wavHeader(16000, pcm.length), pcm]);
}
test("reorder uses stable IDs, preserves current selection and all segment data, rejects foreign targets", () => {
  const repo = new Repository(new PortablePaths(root())),
    w = repo.workspace,
    p = w.projects[0],
    a = p.segments[0];
  editWorkspace(w, { type: "segment.create" });
  editWorkspace(w, { type: "segment.create" });
  const [_, b, c] = p.segments;
  Object.assign(a, {
    text: "保留内容",
    directionDraft: "轻声",
  });
  const before = structuredClone(a),
    current = p.currentId;
  repo.transaction((w) =>
    editWorkspace(w, {
      type: "segment.reorder",
      segmentId: a.id,
      value: { targetId: c.id, after: true },
    }),
  );
  assert.deepEqual(
    repo.workspace.projects[0].segments.map((s) => s.id),
    [b.id, c.id, a.id],
  );
  assert.deepEqual(repo.workspace.projects[0].segments[2], before);
  assert.equal(repo.workspace.projects[0].currentId, current);
  repo.transaction((w) =>
    editWorkspace(w, {
      type: "segment.reorder",
      segmentId: a.id,
      value: { targetId: b.id, after: false },
    }),
  );
  assert.deepEqual(
    repo.workspace.projects[0].segments.map((s) => s.id),
    [a.id, b.id, c.id],
  );
  const stable = structuredClone(repo.workspace.projects[0]);
  assert.throws(
    () =>
      repo.transaction((w) =>
        editWorkspace(w, {
          type: "segment.reorder",
          segmentId: a.id,
          value: { targetId: "foreign", after: true },
        }),
      ),
    /重新拖动/,
  );
  assert.deepEqual(repo.workspace.projects[0], stable);
  assert.deepEqual(new Repository(repo.paths).workspace.projects[0], stable);
});
test("loading a legacy paused workspace removes the obsolete queue flag", () => {
  const paths = new PortablePaths(root()),
    w = Object.assign(fresh(), { queuePaused: true });
  fs.writeFileSync(paths.inside("data/workspace.json"), JSON.stringify(w));
  const repo = new Repository(paths);
  assert(!("queuePaused" in repo.workspace));
  assert(
    !(
      "queuePaused" in
      JSON.parse(fs.readFileSync(paths.inside("data/workspace.json"), "utf8"))
    ),
  );
});
test("waveform measures loudness, silence and quiet samples instead of synthesizing decorative bars", () => {
  const dir = root(),
    file = path.join(dir, "real.wav");
  fs.writeFileSync(file, audio());
  const wave = readWaveform(file, 16);
  assert.equal(wave.duration, 1);
  assert.equal(wave.peak, 0.5);
  assert(wave.peaks.slice(0, 4).every((p) => p === 0));
  assert(wave.peaks.slice(4, 8).every((p) => p === 0.5));
  assert(wave.peaks.slice(8, 12).every((p) => p === 0));
  assert(wave.peaks.slice(12).every((p) => p > 0 && p < 0.001));
  fs.writeFileSync(file, audio().subarray(0, 60));
  assert.throws(() => readWaveform(file), /不完整/);
  fs.writeFileSync(file, "invalid");
  assert.throws(() => readWaveform(file));
});
test("waveform aggregates stereo float samples and skips padded ancillary chunks", () => {
  const pcm = Buffer.alloc(32 * 8),
    header = wavHeader(16, pcm.length);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(128, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  for (let i = 0; i < 32; i++) {
    pcm.writeFloatLE(0.25, i * 8);
    pcm.writeFloatLE(i < 16 ? -0.75 : 0, i * 8 + 4);
  }
  const junk = Buffer.alloc(10);
  junk.write("JUNK");
  junk.writeUInt32LE(1, 4);
  junk[8] = 7;
  const file = path.join(root(), "stereo.wav");
  fs.writeFileSync(
    file,
    Buffer.concat([header.subarray(0, 36), junk, header.subarray(36), pcm]),
  );
  const wave = readWaveform(file, 16);
  assert.equal(wave.duration, 2);
  assert.equal(wave.peak, 0.75);
  assert(wave.peaks.slice(0, 8).every((p) => p === 0.75));
  assert(wave.peaks.slice(8).every((p) => p === 0.25));
});
test("audio endpoint supports seek ranges, waveform refreshes changed files and rejects invalid IDs", async () => {
  const host = await createHost(root());
  try {
    const id = uid(),
      file = host.paths.inside(`data/references/${id}.wav`),
      bytes = audio();
    fs.writeFileSync(file, bytes);
    const p = host.repo.workspace.projects[0],
      s = p.segments[0];
    s.text = "测试";
    host.repo.transaction((w) =>
      w.outputs.push({
        id: "result",
        taskId: "task",
        projectId: p.id,
        segmentId: s.id,
        name: "测试",
        createdAt: 0,
        file: `data/references/${id}.wav`,
        duration: 1,
        input: fixedInput(s, w, "fixture"),
        feedback: "",
        truncated: false,
      }),
    );
    const range = await fetch(`${host.address}/api/audio/result`, {
      headers: { Range: "bytes=44-63" },
    });
    assert.equal(range.status, 206);
    assert.equal(
      range.headers.get("content-range"),
      `bytes 44-63/${bytes.length}`,
    );
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      bytes.subarray(44, 64),
    );
    const suffix = await fetch(`${host.address}/api/reference/${id}`, {
      headers: { Range: "bytes=-4" },
    });
    assert.equal(suffix.status, 206);
    assert.deepEqual(
      Buffer.from(await suffix.arrayBuffer()),
      bytes.subarray(-4),
    );
    assert.equal(
      (
        await fetch(`${host.address}/api/audio/result`, {
          headers: { Range: "bytes=999999-" },
        })
      ).status,
      416,
    );
    const wave = await (
      await fetch(`${host.address}/api/waveform/audio/result`)
    ).json();
    assert.equal(wave.peak, 0.5);
    const silent = Buffer.concat([
      wavHeader(16000, 32000),
      Buffer.alloc(32000),
    ]);
    fs.writeFileSync(file, silent);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
    assert.equal(
      (
        await (
          await fetch(`${host.address}/api/waveform/reference/${id}`)
        ).json()
      ).peak,
      0,
    );
    assert.equal(
      (await fetch(`${host.address}/api/waveform/audio/result`)).status,
      200,
    );
    assert.equal(
      (await fetch(`${host.address}/api/waveform/reference/not-an-id`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${host.address}/api/waveform/audio/not-a-result`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${host.address}/api/export?project=${p.id}`)).status,
      404,
    );
  } finally {
    host.close();
  }
});
