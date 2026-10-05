import fs from "node:fs";
import { repairSegmentNames } from "../../../packages/contracts/src/segment-names.ts";
import AdmZip from "adm-zip";
import type { Workspace } from "../../../packages/contracts/src/index.ts";
import { Repository } from "./repository.ts";
import { uid, active, signatureFor, editWorkspace } from "./domain.ts";

export function makeBackup(repo: Repository): Buffer {
  const w = structuredClone(repo.workspace),
    zip = new AdmZip();
  for (const t of w.tasks) {
    delete t.stream;
    delete t.cancelRequested;
    if (active(t.status)) {
      t.status = "interrupted";
      t.error = "备份时任务尚未完成，启动模型后可手动继续。";
    }
  }
  zip.addFile("workspace.json", Buffer.from(JSON.stringify(w)));
  for (const o of w.outputs) {
    if (o.file !== `data/audio/${o.id}.wav`)
      throw Error("音频路径不符合工作区格式。");
    const file = repo.paths.inside(o.file);
    if (fs.existsSync(file))
      zip.addFile(`audio/${o.id}.wav`, fs.readFileSync(file));
  }
  const refs = new Set(
    [
      ...w.voices.map((v) => v.assetId),
      ...w.tasks.flatMap((t) => t.units.map((u) => u.input.reference?.assetId)),
    ].filter(Boolean),
  );
  for (const id of refs) {
    if (!/^[a-f\d-]{36}$/.test(id!)) throw Error("录音标识无效。");
    const file = repo.paths.inside(`data/references/${id}.wav`);
    if (fs.existsSync(file))
      zip.addFile(`references/${id}.wav`, fs.readFileSync(file));
  }
  return zip.toBuffer();
}
export function importBackup(repo: Repository, buffer: Buffer) {
  const zip = new AdmZip(buffer),
    entries = zip.getEntries();
  let total = 0;
  if (entries.length > 10000) throw Error("备份文件过多。");
  for (const e of entries) {
    if (
      !/^(workspace\.json|(?:audio|references)\/[a-f\d-]{36}\.wav)$/.test(
        e.entryName,
      )
    )
      throw Error("备份包含不支持的文件。");
    total += e.header.size;
    if (total > 500_000_000) throw Error("备份解压后超过 500 MB。");
  }
  const metadata = zip.getEntry("workspace.json");
  if (!metadata || metadata.header.size > 20_000_000)
    throw Error("缺少有效的工作区文件。");
  const w = JSON.parse(metadata.getData().toString("utf8")) as Workspace;
  if (
    w.schemaVersion !== 1 ||
    !["projects", "voices", "directions", "tasks", "outputs"].every((k) =>
      Array.isArray((w as any)[k]),
    ) ||
    !w.projects.length
  )
    throw Error("不支持的备份格式。");
  const ids = new Map<string, string>();
  const remap = (id: string) => {
    if (typeof id !== "string" || !id) throw Error("备份对象标识无效。");
    if (!ids.has(id)) ids.set(id, uid());
    return ids.get(id)!;
  };
  const files: string[] = [];
  const audio = (oldId: string, kind: "audio" | "references") => {
    const id = remap(oldId),
      entry = zip.getEntry(`${kind}/${oldId}.wav`);
    if (entry) {
      const relative = `data/${kind}/${id}.wav`;
      fs.writeFileSync(repo.paths.inside(relative), entry.getData());
      files.push(relative);
    }
    return id;
  };
  try {
    for (const p of w.projects) {
      p.id = remap(p.id);
      p.title = String(p.title).slice(0, 100) + "（导入）";
      if (!Array.isArray(p.segments) || !p.segments.length)
        throw Error("备份段落无效");
      p.currentId = remap(p.currentId);
      for (const s of p.segments) {
        s.id = remap(s.id);
        s.voiceId = s.voiceId ? remap(s.voiceId) : "";
        s.directionPresetId = s.directionPresetId
          ? remap(s.directionPresetId)
          : "";
        delete (s as typeof s & { adoptedId?: unknown }).adoptedId;
        delete (s as typeof s & { pauseAfter?: unknown }).pauseAfter;
        if (
          typeof s.text !== "string" ||
          s.text.length > 30000 ||
          !["zh", "en"].includes(s.language)
        )
          throw Error("备份文稿无效。");
      }
    }
    const refIDs = new Set<string>();
    for (const v of w.voices) {
      v.id = remap(v.id);
      if (v.assetId) {
        refIDs.add(v.assetId);
        v.assetId = audio(v.assetId, "references");
      }
    }
    for (const d of w.directions) d.id = remap(d.id);
    for (const t of w.tasks) {
      t.id = remap(t.id);
      t.projectId = remap(t.projectId);
      delete t.stream;
      delete t.cancelRequested;
      if (active(t.status)) {
        t.status = "interrupted";
        t.error = "导入的任务尚未完成。";
      }
      if (!Array.isArray(t.units)) throw Error("备份任务无效。");
      for (const u of t.units) {
        u.id = remap(u.id);
        u.segmentId = remap(u.segmentId);
        u.outputId =
          u.outputId && u.outputId !== "deleted"
            ? remap(u.outputId)
            : u.outputId;
        if (u.input.reference) {
          const id = u.input.reference.assetId;
          u.input.reference.assetId = refIDs.has(id)
            ? remap(id)
            : audio(id, "references");
          refIDs.add(id);
        }
        u.input.signature = signatureFor(u.input);
      }
    }
    for (const o of w.outputs) {
      const old = o.id;
      o.id = audio(old, "audio");
      o.file = `data/audio/${o.id}.wav`;
      if (!fs.existsSync(repo.paths.inside(o.file)))
        throw Error("备份缺少生成音频。");
      o.taskId = remap(o.taskId);
      o.projectId = remap(o.projectId);
      o.segmentId = remap(o.segmentId);
      if (o.input.reference)
        o.input.reference.assetId = remap(o.input.reference.assetId);
      o.input.signature = signatureFor(o.input);
    }
    for (const p of w.projects) repairSegmentNames(p);
    for (const p of w.projects)
      for (const s of p.segments)
        editWorkspace(w, {
          type: "segment.update",
          projectId: p.id,
          segmentId: s.id,
          patch: {},
        });
    repo.transaction((current) => {
      current.projects.push(...w.projects);
      current.voices.push(...w.voices);
      current.directions.push(...w.directions);
      current.tasks.unshift(...w.tasks);
      current.outputs.unshift(...w.outputs);
      current.currentProjectId = w.projects[0].id;
    });
    return { projects: w.projects.length, outputs: w.outputs.length };
  } catch (e) {
    for (const file of files)
      fs.rmSync(repo.paths.inside(file), { force: true });
    throw e;
  }
}
