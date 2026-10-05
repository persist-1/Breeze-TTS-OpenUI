import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { Repository } from "../apps/desktop/host/repository.ts";
import { fixedInput, uid, editWorkspace } from "../apps/desktop/host/domain.ts";
import { wavHeader } from "../apps/desktop/host/audio.ts";
import {
  createAudioSaver,
  audioFilename,
} from "../apps/desktop/host/save-audio.ts";
import { makeBackup, importBackup } from "../apps/desktop/host/backup.ts";
const base = path.resolve(".runtime/test-cases");
fs.mkdirSync(base, { recursive: true });
function fixture() {
  const repo = new Repository(
      new PortablePaths(fs.mkdtempSync(path.join(base, "save-"))),
    ),
    id = uid(),
    p = repo.workspace.projects[0],
    s = p.segments[0];
  s.text = "保留原文";
  const bytes = Buffer.concat([wavHeader(16000, 32000), Buffer.alloc(32000)]),
    file = repo.paths.inside(`data/audio/${id}.wav`);
  fs.writeFileSync(file, bytes);
  repo.transaction((w) =>
    w.outputs.push({
      id,
      taskId: "saved",
      projectId: p.id,
      segmentId: s.id,
      name: "测试音频",
      createdAt: 1,
      file: `data/audio/${id}.wav`,
      duration: 1,
      input: fixedInput(s, w, "fixture"),
      feedback: "备注",
      truncated: false,
    }),
  );
  const destination = path.join(
    fs.mkdtempSync(path.join(base, "user-chosen-")),
    "自选音频.wav",
  );
  return { repo, id, bytes, file, destination };
}
test("saving copies the selected WAV to an explicitly chosen location without changing the source or workspace", async () => {
  const f = fixture(),
    before = structuredClone(f.repo.workspace);
  const save = createAudioSaver(f.repo, async (suggested) => {
    assert.equal(suggested, f.repo.paths.inside("data/exports/测试音频.wav"));
    return f.destination;
  });
  assert.deepEqual(await save(f.id), { status: "saved", name: "自选音频.wav" });
  assert.deepEqual(fs.readFileSync(f.destination), f.bytes);
  assert.deepEqual(fs.readFileSync(f.file), f.bytes);
  assert.deepEqual(f.repo.workspace, before);
  // Overwriting the path confirmed by the native chooser retains the original audio.
  fs.writeFileSync(f.destination, "previous");
  await save(f.id);
  assert.deepEqual(fs.readFileSync(f.destination), f.bytes);
  assert.deepEqual(fs.readFileSync(f.file), f.bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(f.destination)), [
    "自选音频.wav",
  ]);
});
test("cancel and repeat submission do not copy files; a later save remains usable", async () => {
  const f = fixture();
  let release!: (value: string | null) => void;
  const save = createAudioSaver(
    f.repo,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = save(f.id);
  await assert.rejects(save(f.id), /完成或取消/);
  release(null);
  assert.deepEqual(await pending, { status: "cancelled" });
  assert(!fs.existsSync(f.destination));
  const again = save(f.id);
  release(f.destination);
  assert.equal((await again).status, "saved");
});
test("a missing or deleted source fails clearly; cancelling never touches existing destination", async () => {
  const f = fixture();
  fs.writeFileSync(f.destination, "keep");
  const cancelled = createAudioSaver(f.repo, async () => null);
  await cancelled(f.id);
  assert.equal(fs.readFileSync(f.destination, "utf8"), "keep");
  const deleted = createAudioSaver(f.repo, async () => {
    f.repo.delete("output", f.id);
    return f.destination;
  });
  await assert.rejects(deleted(f.id), /记录已删除/);
  assert.equal(fs.readFileSync(f.destination, "utf8"), "keep");
  const other = fixture();
  fs.unlinkSync(other.file);
  let opened = false;
  await assert.rejects(
    createAudioSaver(other.repo, async () => {
      opened = true;
      return other.destination;
    })(other.id),
    /文件已移除/,
  );
  assert(!opened);
});
test("save cannot overwrite managed application files or follow a directory junction into them", async () => {
  const f = fixture(),
    managed = f.repo.paths.inside("models/protected.wav");
  fs.writeFileSync(managed, "model-fixture");
  await assert.rejects(
    createAudioSaver(f.repo, async () => managed)(f.id),
    /避免覆盖/,
  );
  assert.equal(fs.readFileSync(managed, "utf8"), "model-fixture");
  const link = path.join(path.dirname(f.destination), "linked-models");
  fs.symlinkSync(path.dirname(managed), link, "junction");
  await assert.rejects(
    createAudioSaver(f.repo, async () => path.join(link, "protected.wav"))(
      f.id,
    ),
    /避免覆盖/,
  );
  assert.equal(fs.readFileSync(managed, "utf8"), "model-fixture");
  await assert.rejects(
    createAudioSaver(f.repo, async () => f.destination.replace(".wav", ".mp3"))(
      f.id,
    ),
    /wav/,
  );
  assert.equal(audioFilename("CON"), "_CON.wav");
  assert.equal(audioFilename("说明/音频?.wav"), "说明_音频_.wav");
});
test("write failure leaves the old destination and source intact and removes only its temporary copy", async (t) => {
  const f = fixture();
  fs.writeFileSync(f.destination, "existing");
  t.mock.method(fs.promises, "rename", async () => {
    throw Object.assign(Error("permission"), { code: "EACCES" });
  });
  await assert.rejects(
    createAudioSaver(f.repo, async () => f.destination)(f.id),
    /无法写入/,
  );
  assert.equal(fs.readFileSync(f.destination, "utf8"), "existing");
  assert.deepEqual(fs.readFileSync(f.file), f.bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(f.destination)), [
    "自选音频.wav",
  ]);
});
test("legacy selection and join-only pause metadata migrate away without losing audio; import strips them too", () => {
  const f = fixture(),
    p = f.repo.workspace.projects[0],
    s = p.segments[0];
  Object.assign(s, { adoptedId: f.id, pauseAfter: 0.5 });
  f.repo.save();
  const backup = makeBackup(f.repo),
    loaded = new Repository(f.repo.paths),
    migrated = loaded.workspace.projects[0].segments[0];
  assert(!("adoptedId" in migrated));
  assert(!("pauseAfter" in migrated));
  assert.equal(loaded.workspace.outputs[0].id, f.id);
  assert.deepEqual(fs.readFileSync(f.file), f.bytes);
  importBackup(loaded, backup);
  const imported = loaded.workspace.projects[1].segments[0];
  assert(!("adoptedId" in imported));
  assert(!("pauseAfter" in imported));
  assert.equal(loaded.workspace.outputs.length, 2);
  assert.throws(
    () => editWorkspace(loaded.workspace, { type: "output.adopt", id: f.id }),
    /不支持/,
  );
});
