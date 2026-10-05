import { useState, useRef, useEffect, type ReactNode } from "react";
import type {
  Snapshot,
  Segment,
  Project,
  Output,
} from "../../../packages/contracts/src/index.ts";
import {
  act,
  command,
  flush,
  flushDrafts,
  registerDraftFlush,
} from "./store.ts";
import { matchesDraft } from "./compatibility.ts";
import { SelectedMaterial, VoicePicker } from "./MaterialPicker.tsx";
import { SegmentRail } from "./SegmentRail.tsx";
import { ProjectName, deleteProject } from "./ProjectActions.tsx";
import { Select } from "./Select.tsx";
import { WaveformPlayer } from "./WaveformPlayer.tsx";
import {
  Button,
  Help,
  Tabs,
  Toggle,
  Empty,
  Modal,
  DirectionSelect,
  confirmDelete,
  Icon,
} from "./ui.tsx";

export function Studio({
  snapshot,
  show,
}: {
  snapshot: Snapshot;
  show: (node: ReactNode) => void;
}) {
  const w = snapshot.workspace,
    p = w.projects.find((p) => p.id === w.currentProjectId)!;
  return (
    <>
      <div className="surface project-quickbar">
        <div className="project-heading">
          <label className="workspace-heading" htmlFor="project-picker">
            作品集
          </label>
          <Select
            id="project-picker"
            label="作品集"
            value={p.id}
            options={w.projects.map((p) => ({ value: p.id, label: p.title }))}
            onChange={(value) =>
              void flushDrafts()
                .then(() => command({ type: "project.open", projectId: value }))
                .catch(() => {})
            }
          />
        </div>
        <div className="actions">
          <Button
            icon="plus"
            onClick={() => show(<ProjectName close={() => show(null)} />)}
          >
            新建作品
          </Button>
          <Button
            onClick={() =>
              show(<ProjectName project={p} close={() => show(null)} />)
            }
          >
            重命名
          </Button>
          <Button
            icon="trash"
            aria-label="删除当前作品"
            disabled={w.tasks.some(
              (t) =>
                t.projectId === p.id &&
                ["queued", "preparing", "running"].includes(t.status),
            )}
            title={
              w.tasks.some(
                (t) =>
                  t.projectId === p.id &&
                  ["queued", "preparing", "running"].includes(t.status),
              )
                ? "请先在生成记录中取消关联任务"
                : "删除当前作品"
            }
            onClick={() => deleteProject(p, w, show)}
          />
        </div>
      </div>
      <div className="studio-layout">
        <SegmentRail key={p.id} project={p} show={show} />
        <Editor
          key={p.currentId}
          p={p}
          segment={p.segments.find((s) => s.id === p.currentId)!}
          snapshot={snapshot}
          show={show}
        />
      </div>
    </>
  );
}
function Editor({
  p,
  segment,
  snapshot,
  show,
}: {
  p: Project;
  segment: Segment;
  snapshot: Snapshot;
  show: (node: ReactNode) => void;
}) {
  const [s, setS] = useState(() => ({ ...segment })),
    [saving, setSaving] = useState(""),
    [event, setEvent] = useState(false),
    [eventText, setEventText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null),
    guidanceTextarea = useRef<HTMLTextAreaElement>(null),
    caret = useRef(0),
    guidanceCaret = useRef(0),
    pending = useRef<Record<string, unknown>>({}),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    local = useRef(s);
  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return flush();
    return command({
      type: "segment.update",
      projectId: p.id,
      segmentId: s.id,
      patch,
    })
      .then(() => setSaving(""))
      .catch((e) => {
        pending.current = { ...patch, ...pending.current };
        setSaving("保存失败");
        throw e;
      });
  };
  const patch = (value: Partial<Segment>) => {
    local.current = { ...local.current, ...value };
    setS(local.current);
    Object.assign(pending.current, value);
    setSaving("保存中");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit().catch(() => {}), 400);
  };
  useEffect(() => {
    if (
      !saving &&
      !Object.keys(pending.current).length &&
      JSON.stringify(segment) !== JSON.stringify(local.current)
    ) {
      local.current = { ...segment };
      setS(local.current);
    }
  }, [segment, saving]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const patch = pending.current;
      if (Object.keys(patch).length)
        act({
          type: "segment.update",
          projectId: p.id,
          segmentId: segment.id,
          patch,
        });
    },
    [p.id, segment.id],
  );
  useEffect(() => registerDraftFlush(commit), [p.id, segment.id]);
  const insert = (text: string) => {
    const t = textarea.current;
    const pos = t?.selectionStart ?? caret.current;
    const value = local.current.text;
    patch({ text: value.slice(0, pos) + text + value.slice(pos) });
    caret.current = pos + text.length;
    requestAnimationFrame(() => {
      t?.focus();
      t?.setSelectionRange(caret.current, caret.current);
    });
  };
  const w = snapshot.workspace,
    outputs = w.outputs.filter(
      (o) => o.projectId === p.id && o.segmentId === s.id,
    ),
    service = snapshot.runtime.service,
    unavailable = (["python", "dependencies", "model"] as const).some(
      (k) => snapshot.runtime[k].status !== "ready",
    ),
    ready =
      service.status === "running" && !unavailable && !snapshot.runtime.busy;
  const generate = async (all = false) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await commit();
      await command({ type: "task.create", projectId: p.id, all });
    } catch {
    } finally {
      setSubmitting(false);
    }
  };
  const saveText = (type: "voice" | "direction") => {
    const content = type === "voice" ? s.voiceDescription : s.directionDraft;
    show(
      <SaveText
        type={type}
        content={content}
        seed={s.seed}
        close={() => show(null)}
      />,
    );
  };
  const activeTasks = w.tasks.filter(
    (t) =>
      t.projectId === p.id &&
      ["queued", "preparing", "running"].includes(t.status),
  );
  const voice = w.voices.find((v) => v.id === s.voiceId);
  const direction = w.directions.find((d) => d.id === s.directionPresetId);
  const missingVoice =
    s.voiceSource === "library" &&
    !!s.voiceId &&
    (!voice ||
      (voice.kind === "reference" &&
        !(voice.assetId && voice.consent && voice.transcript?.trim())));
  const missingDirection =
    s.directionEnabled && s.directionSource === "preset" && !direction;
  return (
    <>
      <div className="studio-grid">
        <div className="manuscript-column">
          <section className="surface manuscript">
            <div className="section-head">
              <h2>待合成文稿</h2>
              <div className="actions">
                <Select
                  label="语言"
                  value={s.language}
                  options={[
                    { value: "zh", label: "中文" },
                    { value: "en", label: "English" },
                  ]}
                  onChange={(value) =>
                    patch({ language: value as Segment["language"] })
                  }
                />
                <Button
                  icon="brackets"
                  aria-label="插入发声标记"
                  onClick={() => {
                    caret.current = textarea.current?.selectionStart || 0;
                    setEvent(true);
                  }}
                >
                  发声标记
                </Button>
                <Help>
                  中文使用 [事件]，英文使用
                  (event)。在文稿光标处插入自定义发声描述，也可右键或按
                  Shift+F10。具体发声效果由模型决定。
                </Help>
              </div>
            </div>
            <textarea
              ref={textarea}
              className="manuscript-editor"
              aria-label="待合成文稿"
              placeholder="写下需要合成的内容…"
              value={s.text}
              maxLength={30000}
              onChange={(e) => patch({ text: e.target.value })}
              onSelect={() => {
                caret.current = textarea.current?.selectionStart || 0;
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                caret.current = textarea.current?.selectionStart || 0;
                setEvent(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "F10" && e.shiftKey) {
                  e.preventDefault();
                  setEvent(true);
                }
              }}
            />
            <div className="editor-footer">
              <span>
                {s.text.length} 字
                {saving === "保存失败" ? (
                  <span className="badge failure" role="alert">
                    {saving}
                  </span>
                ) : null}
              </span>
              <Button
                disabled={!s.text.includes("\n\n")}
                onClick={() =>
                  void commit().then(() =>
                    act({ type: "segment.split", projectId: p.id }),
                  )
                }
              >
                按空行分段
              </Button>
            </div>
          </section>
        </div>
        <aside className="controls-column">
          <section className="control-panel voice-panel">
            <div className="section-head">
              <h2>使用音色</h2>
              <Help>
                音色库使用保存的声音；音色描述仅对当前段落生效。不填写描述时使用模型默认声音。
              </Help>
            </div>
            <Tabs
              value={s.voiceSource}
              onChange={(v) =>
                patch({ voiceSource: v as Segment["voiceSource"] })
              }
              items={[
                ["library", "音色库"],
                ["description", "音色描述"],
              ]}
            />
            <div className="material-editor voice-content">
              {s.voiceSource === "description" ? (
                <>
                  <textarea
                    aria-label="音色描述"
                    rows={4}
                    value={s.voiceDescription}
                    onChange={(e) =>
                      patch({ voiceDescription: e.target.value })
                    }
                    placeholder="描述想要的声音特征…"
                  />
                  <Button
                    disabled={!s.voiceDescription.trim()}
                    onClick={() => saveText("voice")}
                  >
                    保存到音色库
                  </Button>
                </>
              ) : (
                <>
                  <SelectedMaterial
                    name={
                      voice?.name || (s.voiceId ? "重新选择音色" : "默认声音")
                    }
                    detail={
                      missingVoice
                        ? "原音色已删除或录音未核对，请重新选择"
                        : voice
                          ? voice.kind === "reference"
                            ? "参考录音 · 已核对"
                            : "描述音色"
                          : "由模型选择声音"
                    }
                    missing={missingVoice}
                    action={s.voiceId ? "更换" : "选择"}
                    onClick={() =>
                      show(
                        <Modal title="选择音色" onClose={() => show(null)}>
                          <VoicePicker
                            voices={w.voices}
                            selected={s.voiceId}
                            close={() => show(null)}
                            onSelect={(v) => {
                              patch({
                                voiceId: v?.id || "",
                                ...(v ? { seed: v.seed } : {}),
                              });
                              show(null);
                            }}
                          />
                        </Modal>,
                      )
                    }
                  />
                  {voice?.kind === "reference" && !missingVoice ? (
                    <details className="reference-context">
                      <summary>试听与录音原文</summary>
                      <WaveformPlayer
                        source="reference"
                        id={voice.assetId!}
                        label={voice.name}
                      />
                      <p>{voice.transcript}</p>
                      <a className="button" href="#voices">
                        到音色库编辑
                      </a>
                    </details>
                  ) : null}
                </>
              )}
            </div>
          </section>
          <section className="control-panel guidance-panel">
            <div className="section-head">
              <div className="heading-with-help">
                <h2>演绎指导</h2>
                <Help>
                  演绎描述可自由编辑并插入指导；预设演绎直接使用保存的内容。关闭后不参与生成。
                </Help>
              </div>
              <Toggle
                value={s.directionEnabled}
                onChange={(v) => patch({ directionEnabled: v })}
              />
            </div>
            {s.directionEnabled ? (
              <>
                <Tabs
                  value={s.directionSource}
                  onChange={(v) =>
                    patch({ directionSource: v as Segment["directionSource"] })
                  }
                  items={[
                    ["preset", "预设演绎"],
                    ["description", "演绎描述"],
                  ]}
                />
                <div className="material-editor guidance-content">
                  {s.directionSource === "description" ? (
                    <>
                      <textarea
                        ref={guidanceTextarea}
                        aria-label="演绎描述"
                        onSelect={(e) => {
                          guidanceCaret.current =
                            e.currentTarget.selectionStart;
                        }}
                        rows={4}
                        value={s.directionDraft}
                        onChange={(e) =>
                          patch({ directionDraft: e.target.value })
                        }
                        placeholder="描述语气、节奏与演绎方式…"
                      />
                      <div className="actions">
                        <Button
                          disabled={!s.directionDraft.trim()}
                          onClick={() => saveText("direction")}
                        >
                          保存指导
                        </Button>
                        <Button
                          onClick={() => {
                            guidanceCaret.current =
                              guidanceTextarea.current?.selectionStart ??
                              guidanceCaret.current;
                            show(
                              <Modal
                                title="插入演绎指导"
                                onClose={() => show(null)}
                              >
                                <DirectionSelect
                                  items={w.directions}
                                  selected=""
                                  onSelect={(d) => {
                                    const text = local.current.directionDraft,
                                      pos = guidanceCaret.current;
                                    patch({
                                      directionDraft:
                                        text.slice(0, pos) +
                                        d.instruction +
                                        text.slice(pos),
                                    });
                                    show(null);
                                  }}
                                />
                              </Modal>,
                            );
                          }}
                        >
                          插入指导
                        </Button>
                      </div>
                    </>
                  ) : (
                    <SelectedMaterial
                      name={direction?.name || "选择预设演绎"}
                      detail={
                        direction
                          ? direction.instruction
                          : s.directionPresetId
                            ? "原预设已删除，请重新选择"
                            : "从演绎指导库中选择"
                      }
                      icon="directions"
                      missing={!direction && !!s.directionPresetId}
                      action={direction ? "更换" : "选择"}
                      onClick={() =>
                        show(
                          <Modal
                            title="选择预设演绎"
                            onClose={() => show(null)}
                          >
                            <DirectionSelect
                              items={w.directions}
                              selected={s.directionPresetId}
                              onSelect={(d) => {
                                patch({ directionPresetId: d.id });
                                show(null);
                              }}
                            />
                            <a
                              className="button"
                              href="#directions"
                              onClick={() => show(null)}
                            >
                              管理演绎指导
                            </a>
                          </Modal>,
                        )
                      }
                    />
                  )}
                </div>
              </>
            ) : null}
          </section>
        </aside>
        <section className="surface control-panel generation-panel">
          <div className="section-head">
            <h2>生成</h2>
            <Help>
              每段可生成 1–3
              个候选音频。种子固定后便于比较不同指导；引导强度仅在存在音色描述或演绎指导时使用。长文建议分段。
            </Help>
          </div>
          <div className="generation-fields">
            <label>
              候选数量
              <Select
                label="候选数量"
                value={String(s.count)}
                options={[1, 2, 3].map((n) => ({
                  value: String(n),
                  label: String(n),
                }))}
                onChange={(value) => patch({ count: Number(value) })}
              />
            </label>
            <label>
              随机种子
              <input
                type="number"
                min="0"
                max="2147483644"
                value={s.seed}
                onChange={(e) => patch({ seed: Number(e.target.value) })}
              />
            </label>
            <label>
              指令引导强度
              <input
                type="number"
                min=".1"
                max="10"
                step=".1"
                value={s.cfg}
                onChange={(e) => patch({ cfg: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="actions generation-actions">
            <Button
              tone="primary"
              icon="play"
              disabled={
                submitting ||
                !ready ||
                missingVoice ||
                missingDirection ||
                !!snapshot.runtime.busy ||
                !s.text.trim()
              }
              onClick={() => void generate()}
            >
              {submitting ? "提交中…" : "生成本段"}
            </Button>
            {p.segments.length > 1 ? (
              <Button
                disabled={
                  submitting ||
                  !ready ||
                  missingVoice ||
                  missingDirection ||
                  !!snapshot.runtime.busy ||
                  !p.segments.some((seg) => seg.text.trim())
                }
                onClick={() => void generate(true)}
              >
                生成整个作品
              </Button>
            ) : null}
          </div>
          {!ready ? (
            <div className="service-notice">
              <Icon name={service.status === "error" ? "alert" : "info"} />
              <span>
                {service.status === "starting"
                  ? "正在加载模型…"
                  : snapshot.runtime.busy
                    ? "正在检查或配置资源，请稍后生成。"
                    : service.status === "running" && unavailable
                      ? "运行资源未通过校验，请到设置修复后生成。"
                      : service.status === "error"
                        ? "模型服务异常，请到设置查看原因。"
                        : "启动模型服务后即可生成。"}
              </span>
              <a href="#settings">设置</a>
            </div>
          ) : null}
        </section>
        <section className="surface result-section">
          <div className="section-head">
            <h2>
              本段音频 <span className="count">{outputs.length}</span>
            </h2>
            <a className="button" href="#tasks">
              查看生成记录
            </a>
          </div>
          {activeTasks.length ? (
            <div className="notice processing">
              <Icon name="clock" />
              <span>
                {activeTasks.some((t) =>
                  ["running", "preparing"].includes(t.status),
                )
                  ? "正在生成，完成音频会出现在这里"
                  : "任务已排队"}{" "}
                · {activeTasks.length} 个任务
              </span>
            </div>
          ) : null}
          {outputs.length ? (
            <div className="output-list">
              {outputs.map((o) => (
                <OutputCard
                  key={o.id}
                  output={o}
                  segment={s}
                  snapshot={snapshot}
                  show={show}
                />
              ))}
            </div>
          ) : (
            <Empty title="还没有音频">
              <p>
                填写文稿、选择声音，生成后试听，将喜欢的音频保存至所选位置。
              </p>
            </Empty>
          )}
        </section>
      </div>
      {event ? (
        <Modal title="插入发声标记" onClose={() => setEvent(false)}>
          <label>
            发声描述
            <input
              autoFocus
              value={eventText}
              onChange={(e) => setEventText(e.target.value)}
              placeholder={
                s.language === "zh"
                  ? "如：轻轻笑了一声"
                  : "For example: a quiet laugh"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && eventText.trim()) {
                  insert(
                    s.language === "zh"
                      ? `[${eventText.trim()}]`
                      : `(${eventText.trim()})`,
                  );
                  setEvent(false);
                  setEventText("");
                }
              }}
            />
          </label>
          <p>插入到文稿光标处，不替换原文。</p>
          <div className="actions end">
            <Button onClick={() => setEvent(false)}>取消</Button>
            <Button
              tone="primary"
              disabled={!eventText.trim()}
              onClick={() => {
                insert(
                  s.language === "zh"
                    ? `[${eventText.trim()}]`
                    : `(${eventText.trim()})`,
                );
                setEvent(false);
                setEventText("");
              }}
            >
              插入
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
export function OutputCard({
  output: o,
  segment: s,
  snapshot,
  show,
}: {
  output: Output;
  segment?: Segment;
  snapshot: Snapshot;
  show: (node: ReactNode) => void;
}) {
  const [feedback, setFeedback] = useState(o.feedback);
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState<{
      status: "success" | "neutral" | "failure";
      text: string;
    } | null>(null);
  const pendingSave = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const saveAudio = async () => {
    if (pendingSave.current) return;
    pendingSave.current = true;
    setSaving(true);
    setSaved(null);
    try {
      if (!window.breeze)
        throw Error("请在桌面客户端使用“保存至...”，以选择文件位置。");
      const result = await window.breeze.saveAudio(o.id);
      if (mounted.current)
        setSaved(
          result.status === "saved"
            ? { status: "success", text: "已保存：" + result.name }
            : { status: "neutral", text: "已取消保存" },
        );
    } catch (error) {
      if (mounted.current)
        setSaved({
          status: "failure",
          text: String(error)
            .replace(/^Error: /, "")
            .replace(
              /^Error invoking remote method 'audio.save': (?:Error: )?/,
              "",
            ),
        });
    } finally {
      pendingSave.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const stale = !!s && !matchesDraft(s, o, snapshot.workspace);
  return (
    <article className="output">
      <div className="section-head">
        <strong>{o.name}</strong>
        <span className={`badge ${stale ? "warning" : "neutral"}`}>
          {stale ? "旧输入" : o.duration.toFixed(1) + " 秒"}
        </span>
      </div>
      <WaveformPlayer
        source="audio"
        id={o.id}
        label={o.name}
        initialDuration={o.duration}
      />
      {o.truncated ? (
        <p className="inline-error">
          音频达到生成长度上限，请试听完整性；必要时拆分文稿重做。
        </p>
      ) : null}
      <div className="actions">
        <Button
          icon={saving ? "loader" : "folder"}
          disabled={saving}
          aria-busy={saving}
          onClick={() => void saveAudio()}
        >
          {saving ? "保存中…" : "保存至..."}
        </Button>
        <Button
          icon="trash"
          aria-label={"删除音频" + o.name}
          onClick={() =>
            confirmDelete(
              "output",
              o.name,
              "删除这份音频和对应文件。其他候选音频保留。",
              () => command({ type: "delete", value: "output", id: o.id }),
              show,
            )
          }
        />
      </div>
      {saved ? (
        <div
          className={"audio-save-feedback " + saved.status}
          role={saved.status === "failure" ? "alert" : "status"}
        >
          <Icon
            name={
              saved.status === "success"
                ? "check"
                : saved.status === "failure"
                  ? "alert"
                  : "info"
            }
          />
          <span>{saved.text}</span>
        </div>
      ) : null}
      <details className="output-details">
        <summary>输入与试听备注</summary>
        <p>{o.input.text}</p>
        <p>{o.input.instruction || "未指定音色或演绎描述"}</p>
        <small>
          随机种子 {o.candidateSeed ?? o.input.seed} · 引导强度 {o.input.cfg}
        </small>
        <label>
          试听备注
          <textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onBlur={() =>
              act({ type: "output.feedback", id: o.id, value: feedback })
            }
            placeholder="记下需要改进的地方…"
          />
        </label>
        <Button
          onClick={() =>
            show(
              <Modal title="恢复音频输入？" onClose={() => show(null)}>
                <p>用这份音频的固定输入替换原段落草稿。其他段落保留。</p>
                <div className="actions end">
                  <Button onClick={() => show(null)}>取消</Button>
                  <Button
                    tone="primary"
                    onClick={() =>
                      void command({
                        type: "output.restore",
                        projectId: o.projectId,
                        id: o.id,
                      })
                        .then(() => {
                          show(null);
                          location.hash = "studio";
                        })
                        .catch(() => {})
                    }
                  >
                    恢复输入
                  </Button>
                </div>
              </Modal>,
            )
          }
        >
          恢复输入到草稿
        </Button>
      </details>
    </article>
  );
}
function SaveText({
  type,
  content,
  seed,
  close,
}: {
  type: "voice" | "direction";
  content: string;
  seed: number;
  close: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal
      title={type === "voice" ? "保存音色" : "保存演绎指导"}
      onClose={close}
    >
      <label>
        名称
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <blockquote>{content}</blockquote>
      <div className="actions end">
        <Button onClick={close}>取消</Button>
        <Button
          tone="primary"
          disabled={!name.trim() || !content.trim()}
          onClick={() =>
            void command({
              type: type + ".save",
              item:
                type === "voice"
                  ? {
                      id: crypto.randomUUID(),
                      name,
                      kind: "design",
                      description: content,
                      seed,
                    }
                  : { id: crypto.randomUUID(), name, instruction: content },
            })
              .then(close)
              .catch(() => {})
          }
        >
          保存
        </Button>
      </div>
    </Modal>
  );
}
