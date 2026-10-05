import { randomUUID, createHash } from "node:crypto";
import {
  availableSegmentName,
  cleanSegmentName,
  segmentNameKey,
} from "../../../packages/contracts/src/segment-names.ts";
import type {
  Segment,
  Project,
  Workspace,
  FixedInput,
  Unit,
  Command,
  Voice,
  Direction,
} from "../../../packages/contracts/src/index.ts";
export const uid = () => randomUUID();
export function segment(name = "第 1 段"): Segment {
  return {
    id: uid(),
    name,
    text: "",
    language: "zh",
    voiceSource: "library",
    voiceId: "",
    voiceDescription: "",
    directionEnabled: false,
    directionSource: "description",
    directionDraft: "",
    directionPresetId: "",
    seed: 42,
    cfg: 4,
    count: 1,
  };
}
export function project(): Project {
  const s = segment();
  return {
    id: uid(),
    title: "未命名作品",
    segments: [s],
    currentId: s.id,
    updatedAt: Date.now(),
  };
}
export function fresh(): Workspace {
  const p = project();
  return {
    schemaVersion: 1,
    revision: 0,
    currentProjectId: p.id,
    projects: [p],
    voices: [],
    directions: [],
    tasks: [],
    outputs: [],
  };
}
export function fixedInput(
  s: Segment,
  w: Workspace,
  model: string,
): FixedInput {
  const voice =
    s.voiceSource === "library"
      ? w.voices.find((v) => v.id === s.voiceId)
      : undefined;
  if (s.voiceSource === "library" && s.voiceId && !voice)
    throw Error("音色已删除，请重新选择。");
  const description =
    s.voiceSource === "description"
      ? s.voiceDescription
      : voice?.kind === "design"
        ? voice.description
        : "";
  const guidance = s.directionEnabled
    ? s.directionSource === "description"
      ? s.directionDraft
      : w.directions.find((d) => d.id === s.directionPresetId)?.instruction
    : "";
  if (s.directionEnabled && s.directionSource === "preset" && guidance == null)
    throw Error("请先选择预设演绎。");
  if (
    voice?.kind === "reference" &&
    (!voice.consent || !voice.transcript?.trim() || !voice.assetId)
  )
    throw Error("参考音色需要录音、准确逐字稿与试听核对。");
  const instruction = [description?.trim(), guidance?.trim()]
    .filter(Boolean)
    .join("\n");
  const cfg = instruction ? s.cfg : 1;
  if (!Number.isFinite(cfg) || cfg <= 0 || cfg > 10)
    throw Error("指令引导强度应大于 0 且不超过 10。");
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 2147483644)
    throw Error("随机种子超出允许范围。");
  const input = {
    text: s.text,
    language: s.language,
    instruction,
    voiceName: voice?.name || description || "默认声音",
    presentation: {
      voiceDescription: description?.trim() || "",
      voiceSource: s.voiceSource,
      direction: guidance?.trim() || "",
      directionEnabled: s.directionEnabled,
      directionSource: s.directionSource,
    },
    reference:
      voice?.kind === "reference"
        ? {
            assetId: voice.assetId!,
            transcript: voice.transcript!,
            name: voice.name,
          }
        : undefined,
    cfg,
    seed: s.seed,
    model,
  };
  const signature = signatureFor(input);
  return { ...input, signature };
}
export function signatureFor(input: Omit<FixedInput, "signature">) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        text: input.text,
        language: input.language,
        instruction: input.instruction,
        reference: input.reference
          ? {
              assetId: input.reference.assetId,
              transcript: input.reference.transcript,
            }
          : undefined,
        cfg: input.cfg,
        seed: input.seed,
        model: input.model,
      }),
    )
    .digest("hex");
}
export function unitsFor(
  p: Project,
  w: Workspace,
  all: boolean,
  model: string,
): Unit[] {
  const segments = all
    ? p.segments.filter((s) => s.text.trim())
    : p.segments.filter((s) => s.id === p.currentId);
  if (!segments.length) throw Error("请先填写待合成文稿。");
  return segments.flatMap((s) => {
    if (!s.text.trim()) throw Error("请先填写待合成文稿。");
    if (![1, 2, 3].includes(s.count)) throw Error("每段生成 1 至 3 个音频。");
    const input = fixedInput(s, w, model);
    return Array.from({ length: s.count }, (_, i) => ({
      id: uid(),
      segmentId: s.id,
      segmentName: s.name,
      index: i,
      input: { ...input },
      outputId: null,
    }));
  });
}
const fields = new Set([
  "name",
  "text",
  "language",
  "voiceSource",
  "voiceId",
  "voiceDescription",
  "directionEnabled",
  "directionSource",
  "directionDraft",
  "directionPresetId",
  "seed",
  "cfg",
  "count",
]);
export function editWorkspace(w: Workspace, c: Command): void {
  const p = w.projects.find(
    (p) => p.id === (c.projectId || w.currentProjectId),
  );
  if (c.type === "project.create") {
    const next = project();
    if (c.patch?.title !== undefined) next.title = projectTitle(c.patch.title);
    w.projects.push(next);
    w.currentProjectId = next.id;
    return;
  }
  if (!p) throw Error("作品不存在。");
  switch (c.type) {
    case "project.open":
      w.currentProjectId = p.id;
      break;
    case "project.update":
      p.title = projectTitle(c.patch?.title);
      break;
    case "segment.create": {
      const previous = p.segments.find((s) => s.id === p.currentId)!;
      const next = {
        ...structuredClone(previous),
        id: uid(),
        name: availableSegmentName(
          p.segments.map((s) => s.name),
          p.segments.length + 1,
        ),
        text: "",
      };
      p.segments.push(next);
      p.currentId = next.id;
      break;
    }
    case "segment.open":
      if (!p.segments.some((s) => s.id === c.segmentId))
        throw Error("段落不存在。");
      p.currentId = c.segmentId!;
      break;
    case "segment.update": {
      const s = p.segments.find((s) => s.id === c.segmentId);
      if (!s) throw Error("段落不存在。");
      if (c.patch?.name !== undefined) {
        if (typeof c.patch.name !== "string") throw Error("段落名称无效。");
        const name = cleanSegmentName(c.patch.name);
        if (!name || name.length > 80) throw Error("段落名称须为 1–80 字。");
        if (
          p.segments.some(
            (other) =>
              other.id !== s.id &&
              segmentNameKey(other.name) === segmentNameKey(name),
          )
        )
          throw Error("该作品中已有同名段落，请换一个名称。");
        c = { ...c, patch: { ...c.patch, name } };
      }
      for (const [k, v] of Object.entries(c.patch || {})) {
        if (!fields.has(k)) throw Error("不支持的段落字段。");
        (s as unknown as Record<string, unknown>)[k] = v;
      }
      if (
        typeof s.text !== "string" ||
        s.text.length > 30000 ||
        !["zh", "en"].includes(s.language) ||
        !["library", "description"].includes(s.voiceSource) ||
        !["description", "preset"].includes(s.directionSource) ||
        !Number.isInteger(s.seed) ||
        s.seed < 0 ||
        s.seed > 2147483644 ||
        !Number.isFinite(s.cfg) ||
        s.cfg <= 0 ||
        s.cfg > 10 ||
        ![1, 2, 3].includes(s.count) ||
        typeof s.directionEnabled !== "boolean" ||
        [
          "name",
          "voiceId",
          "voiceDescription",
          "directionDraft",
          "directionPresetId",
        ].some(
          (key) =>
            typeof (s as unknown as Record<string, unknown>)[key] !== "string",
        )
      )
        throw Error("段落输入无效。");
      break;
    }
    case "segment.split": {
      const s = p.segments.find((s) => s.id === p.currentId)!;
      const parts = s.text
        .split(/\n\s*\n/)
        .map((t) => t.trim())
        .filter(Boolean);
      if (parts.length < 2) throw Error("请用空行分隔需要拆分的段落。");
      if (parts.length > 100) throw Error("单次最多拆分 100 段。");
      const pos = p.segments.indexOf(s);
      const names = p.segments.map((seg) => seg.name);
      const next = parts.map((text, i) => {
        const name = i ? availableSegmentName(names, pos + i + 1) : s.name;
        names.push(name);
        return {
          ...structuredClone(s),
          id: i ? uid() : s.id,
          name,
          text,
        };
      });
      p.segments.splice(pos, 1, ...next);
      p.currentId = next[0].id;
      break;
    }
    case "segment.reorder": {
      const value = c.value as
        { targetId?: string; after?: boolean } | undefined;
      const from = p.segments.findIndex((s) => s.id === c.segmentId),
        to = p.segments.findIndex((s) => s.id === value?.targetId);
      if (from < 0 || to < 0 || typeof value?.after !== "boolean")
        throw Error("段落已变化，请重新拖动排序。");
      if (from === to) break;
      const [segment] = p.segments.splice(from, 1);
      const target = p.segments.findIndex((s) => s.id === value.targetId);
      p.segments.splice(target + (value.after ? 1 : 0), 0, segment);
      break;
    }
    case "voice.save": {
      const item = c.item as Voice;
      if (item?.assetId && !/^[a-f\d-]{36}$/.test(item.assetId))
        throw Error("无效参考录音标识。");
      if (
        !item?.id ||
        !item.name?.trim() ||
        item.name.length > 80 ||
        !["design", "reference"].includes(item.kind) ||
        typeof item.description !== "string" ||
        !Number.isInteger(item.seed)
      )
        throw Error("请填写有效的音色名称和内容。");
      const i = w.voices.findIndex((v) => v.id === item.id);
      if (i < 0) w.voices.push(item);
      else w.voices[i] = item;
      break;
    }
    case "direction.save": {
      const item = c.item as Direction;
      if (
        !item?.id ||
        !item.name?.trim() ||
        item.name.length > 80 ||
        !item.instruction?.trim()
      )
        throw Error("请填写指导名称和完整指令。");
      const i = w.directions.findIndex((v) => v.id === item.id);
      if (i < 0) w.directions.push(item);
      else w.directions[i] = item;
      break;
    }
    case "output.feedback": {
      const o = w.outputs.find((o) => o.id === c.id);
      if (!o) throw Error("音频不存在。");
      o.feedback = String(c.value).slice(0, 1000);
      break;
    }
    case "output.restore": {
      const o = w.outputs.find((o) => o.id === c.id),
        s = p.segments.find((s) => s.id === o?.segmentId);
      if (!o || !s) throw Error("原段落不存在。");
      const ref = o.input.reference,
        voice = ref
          ? w.voices.find((v) => v.assetId === ref.assetId)
          : undefined;
      if (ref && !voice) throw Error("原参考录音已删除，请重新选音色。");
      Object.assign(s, {
        text: o.input.text,
        language: o.input.language,
        voiceSource: ref ? "library" : "description",
        voiceId: voice?.id || "",
        voiceDescription: ref
          ? ""
          : (o.input.presentation?.voiceDescription ?? o.input.instruction),
        directionEnabled:
          o.input.presentation?.directionEnabled ??
          (!!ref && !!o.input.instruction),
        directionSource: "description",
        directionDraft:
          o.input.presentation?.direction ?? (ref ? o.input.instruction : ""),
        directionPresetId: "",
        cfg: o.input.cfg,
        seed: o.candidateSeed ?? o.input.seed,
        count: 1,
      });
      p.currentId = s.id;
      w.currentProjectId = p.id;
      break;
    }
    default:
      throw Error("不支持的操作。");
  }
  p.updatedAt = Date.now();
}
export const active = (status: string) =>
  ["queued", "preparing", "running"].includes(status);
function projectTitle(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw Error("作品名称须为 1–100 字。");
  return value.trim();
}
