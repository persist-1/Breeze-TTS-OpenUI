import fs from "node:fs";
import path from "node:path";
import { fresh, active } from "./domain.ts";
import { repairSegmentNames } from "../../../packages/contracts/src/segment-names.ts";
import type { Workspace } from "../../../packages/contracts/src/index.ts";
import { PortablePaths } from "./paths.ts";
export class Repository {
  workspace: Workspace;
  constructor(readonly paths: PortablePaths) {
    const file = paths.inside("data/workspace.json");
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (
          parsed.schemaVersion !== 1 ||
          !Array.isArray(parsed.projects) ||
          !parsed.projects.length
        )
          throw Error("不支持的工作区格式");
        this.workspace = parsed;
      } catch (e) {
        throw Error(
          "工作区文件无法读取。请保留 data 目录并从备份恢复：" + String(e),
        );
      }
    } else this.workspace = fresh();
    delete (this.workspace as typeof this.workspace & { queuePaused?: boolean })
      .queuePaused;
    for (const project of this.workspace.projects) {
      repairSegmentNames(project);
      for (const segment of project.segments) {
        delete (segment as typeof segment & { adoptedId?: unknown }).adoptedId;
        delete (segment as typeof segment & { pauseAfter?: unknown })
          .pauseAfter;
      }
    }
    for (const task of this.workspace.tasks)
      if (active(task.status)) {
        task.status = "interrupted";
        delete task.cancelRequested;
        delete task.stream;
        task.error =
          "应用上次关闭时任务未完成。已保存音频保留，可启动模型后手动继续。";
      }
    this.save();
  }
  save() {
    const w = this.workspace;
    w.revision++;
    const file = this.paths.inside("data/workspace.json"),
      tmp = file + ".pending";
    fs.writeFileSync(tmp, JSON.stringify(w, null, 2), "utf8");
    const fd = fs.openSync(tmp, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }
  transaction(fn: (w: Workspace) => void) {
    const before = structuredClone(this.workspace);
    try {
      fn(this.workspace);
      this.save();
    } catch (e) {
      this.workspace = before;
      throw e;
    }
  }
  removeFile(relative: string) {
    const file = this.paths.inside(relative);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  delete(kind: string, id: string) {
    const w = this.workspace;
    const project = w.projects.find((p) => p.id === id),
      voice = w.voices.find((v) => v.id === id);
    const tasks = w.tasks.filter((t) =>
      kind === "project"
        ? t.projectId === id
        : kind === "task"
          ? t.id === id
          : kind === "segment"
            ? t.units.some((u) => u.segmentId === id)
            : kind === "voice"
              ? t.units.some(
                  (u) =>
                    !!voice?.assetId &&
                    u.input.reference?.assetId === voice.assetId,
                )
              : false,
    );
    if (tasks.some((t) => active(t.status)))
      throw Error("请先取消关联的生成任务，再删除。");
    const files: string[] = [];
    this.transaction((w) => {
      const outputs = w.outputs.filter((o) =>
        kind === "output"
          ? o.id === id
          : kind === "project"
            ? o.projectId === id
            : kind === "task"
              ? o.taskId === id
              : kind === "segment"
                ? o.segmentId === id
                : false,
      );
      for (const o of outputs) {
        files.push(o.file);
        w.outputs = w.outputs.filter((x) => x.id !== o.id);
        for (const t of w.tasks)
          for (const u of t.units)
            if (u.outputId === o.id) u.outputId = "deleted";
      }
      if (kind === "project") {
        if (!project) throw Error("作品不存在。");
        w.projects = w.projects.filter((p) => p.id !== id);
        w.tasks = w.tasks.filter((t) => t.projectId !== id);
        if (!w.projects.length) {
          const f = fresh();
          w.projects = f.projects;
        }
        if (w.currentProjectId === id) w.currentProjectId = w.projects[0].id;
      } else if (kind === "segment") {
        for (const p of w.projects) {
          const i = p.segments.findIndex((s) => s.id === id);
          if (i < 0) continue;
          if (p.segments.length === 1) throw Error("作品至少保留一段。");
          p.segments.splice(i, 1);
          if (p.currentId === id) p.currentId = p.segments[0].id;
        }
        for (const t of w.tasks)
          t.units = t.units.filter((u) => u.segmentId !== id);
        w.tasks = w.tasks.filter((t) => t.units.length);
      } else if (kind === "task") w.tasks = w.tasks.filter((t) => t.id !== id);
      else if (kind === "voice") {
        if (!voice) throw Error("音色不存在。");
        w.voices = w.voices.filter((v) => v.id !== id);
        if (voice.assetId) {
          const asset = this.paths.inside(
            "data/references/" + voice.assetId + ".wav",
          );
          files.push(this.paths.relative(asset));
        }
        for (const p of w.projects)
          for (const s of p.segments)
            if (s.voiceId === id) {
              s.voiceId = "";
              s.voiceSource = "description";
              s.voiceDescription =
                voice.kind === "design" ? voice.description : "";
            }
      } else if (kind === "direction")
        w.directions = w.directions.filter((d) => d.id !== id);
      else if (kind !== "output") throw Error("不支持的删除对象。");
    });
    for (const file of files) {
      try {
        this.removeFile(file);
      } catch (e) {
        throw Error(
          "记录已删除，但文件清理失败，请检查目录权限：" + path.basename(file),
        );
      }
    }
  }
}
