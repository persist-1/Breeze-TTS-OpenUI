import { useState, useEffect, type ReactNode } from "react";
import type {
  Snapshot,
  TaskStatus,
} from "../../../packages/contracts/src/index.ts";
import { act, command } from "./store.ts";
import { Button, Icon, Empty, confirmDelete } from "./ui.tsx";
import { OutputCard } from "./Studio.tsx";
import { LiveAudio } from "./LiveAudio.tsx";
import { Select } from "./Select.tsx";
import { TaskDetails } from "./TaskDetails.tsx";
const labels: Record<TaskStatus, string> = {
  queued: "等待生成",
  preparing: "准备中",
  running: "生成中",
  completed: "已完成",
  failed: "生成失败",
  interrupted: "已中断",
  cancelled: "已取消",
};
export default function Tasks({
  snapshot,
  show,
}: {
  snapshot: Snapshot;
  show: (node: ReactNode) => void;
}) {
  const w = snapshot.workspace;
  const unavailable =
    snapshot.runtime.service.status === "running" &&
    (!!snapshot.runtime.busy ||
      (["python", "dependencies", "model"] as const).some(
        (k) => snapshot.runtime[k].status !== "ready",
      ));
  const [scope, setScope] = useState(w.currentProjectId),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  useEffect(() => {
    setScope(w.currentProjectId);
    setFilter("all");
    setSearch("");
  }, [w.currentProjectId]);
  const inScope = w.tasks.filter(
    (t) => scope === "all" || t.projectId === scope,
  );
  const tasks = inScope.filter(
    (t) =>
      (filter === "all" ||
        (filter === "unfinished" &&
          ["failed", "interrupted", "cancelled"].includes(t.status)) ||
        (filter === "active" &&
          ["queued", "preparing", "running"].includes(t.status)) ||
        (filter === "completed" && t.status === "completed")) &&
      (t.projectTitle + " " + t.units.map((u) => u.input.text).join(" "))
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const projects =
    scope === "all" ? w.projects : w.projects.filter((p) => p.id === scope);
  return (
    <>
      {unavailable ? (
        <div className="notice warning">
          <Icon name="alert" />
          <span>
            运行资源正在检查或未就绪，暂不能新建或继续生成。已完成音频可正常使用。
          </span>
          <a href="#settings">前往设置</a>
        </div>
      ) : null}
      <>
        <div className="page-head">
          <div>
            <h1>生成记录</h1>
            <p>按作品管理任务；已完成音频保留，继续只补未完成部分。</p>
          </div>
        </div>
        <div className="record-toolbar">
          <label>
            作品集
            <Select
              label="作品集范围"
              value={scope}
              options={[
                { value: "all", label: "全部作品" },
                ...w.projects.map((p) => ({ value: p.id, label: p.title })),
              ]}
              onChange={setScope}
            />
          </label>
          <label>
            任务状态
            <Select
              label="任务状态"
              value={filter}
              options={[
                { value: "all", label: "全部状态" },
                { value: "active", label: "排队与生成中" },
                { value: "unfinished", label: "需要继续" },
                { value: "completed", label: "已完成" },
              ]}
              onChange={setFilter}
            />
          </label>
          <label className="search-field">
            搜索
            <input
              placeholder="搜索文稿或作品名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span>
            {tasks.length} / {inScope.length} 个任务
          </span>
        </div>

        {!tasks.length ? (
          <Empty
            title={
              inScope.length ? "没有符合筛选的任务" : "当前作品还没有生成记录"
            }
          >
            {inScope.length ? (
              <Button
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                清除筛选
              </Button>
            ) : (
              <a className="button" href="#studio">
                去创作台
              </a>
            )}
          </Empty>
        ) : (
          projects.map((p) => {
            const group = tasks.filter((t) => t.projectId === p.id);
            return group.length ? (
              <section key={p.id} className="task-group">
                {scope === "all" ? (
                  <div className="section-head">
                    <h2>{p.title}</h2>
                    <Button
                      onClick={() => {
                        act({ type: "project.open", projectId: p.id });
                        location.hash = "studio";
                      }}
                    >
                      打开作品
                    </Button>
                  </div>
                ) : null}
                {group.map((t) => {
                  const outputs = w.outputs.filter((o) => o.taskId === t.id),
                    done = t.units.filter((u) => u.outputId !== null).length,
                    busy = ["queued", "preparing", "running"].includes(
                      t.status,
                    );
                  return (
                    <article className="surface task" key={t.id}>
                      <div className="section-head">
                        <div>
                          <h3>
                            {t.units.length === 1
                              ? t.units[0].segmentName
                              : `${t.units.length} 份音频`}
                          </h3>
                          <small>
                            {new Date(t.createdAt).toLocaleString("zh-CN")} · 第{" "}
                            {Math.max(1, t.attempts)} 次运行
                          </small>
                        </div>
                        <span
                          className={`badge ${["failed", "interrupted"].includes(t.status) ? "failure" : busy ? "processing" : t.status === "completed" ? "success" : "neutral"}`}
                        >
                          <Icon
                            name={
                              busy
                                ? "clock"
                                : t.status === "completed"
                                  ? "check"
                                  : "alert"
                            }
                          />
                          {t.cancelRequested ? "取消中…" : labels[t.status]}
                        </span>
                      </div>
                      <div className="task-progress">
                        <span>
                          {done} / {t.units.length} 份已处理 · {outputs.length}{" "}
                          份可试听
                        </span>
                        <progress value={done} max={t.units.length} />
                      </div>
                      {t.error ? (
                        <p className="inline-error">{t.error}</p>
                      ) : null}
                      <div className="actions">
                        {t.stream ? (
                          <LiveAudio
                            key={t.stream.file}
                            taskId={t.id}
                            file={t.stream.file}
                          />
                        ) : null}
                        {busy ? (
                          <Button
                            disabled={!!t.cancelRequested}
                            onClick={() =>
                              act({ type: "task.cancel", id: t.id })
                            }
                          >
                            {t.status === "queued" ? "取消排队" : "取消生成"}
                          </Button>
                        ) : ["failed", "interrupted", "cancelled"].includes(
                            t.status,
                          ) && done < t.units.length ? (
                          <Button
                            tone="primary"
                            icon="refresh"
                            disabled={
                              snapshot.runtime.service.status !== "running" ||
                              !!snapshot.runtime.busy ||
                              ["python", "dependencies", "model"].some(
                                (k) =>
                                  snapshot.runtime[k as "python"].status !==
                                  "ready",
                              )
                            }
                            onClick={() =>
                              act({ type: "task.retry", id: t.id })
                            }
                          >
                            继续未完成部分
                          </Button>
                        ) : null}
                        <Button
                          disabled={busy}
                          icon="trash"
                          onClick={() =>
                            confirmDelete(
                              "task",
                              "这条生成记录",
                              "删除这条记录及其所有音频。草稿与其他生成记录保留。",
                              () =>
                                command({
                                  type: "delete",
                                  value: "task",
                                  id: t.id,
                                }),
                              show,
                            )
                          }
                        >
                          删除记录
                        </Button>
                      </div>
                      <TaskDetails task={t} />
                      {outputs.length ? (
                        <details
                          className="task-audio"
                          open={t.status === "completed"}
                        >
                          <summary>试听音频（{outputs.length}）</summary>
                          <div className="output-list">
                            {outputs.map((o) => (
                              <OutputCard
                                key={o.id}
                                output={o}
                                segment={p.segments.find(
                                  (s) => s.id === o.segmentId,
                                )}
                                snapshot={snapshot}
                                show={show}
                              />
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </article>
                  );
                })}
              </section>
            ) : null;
          })
        )}
      </>
    </>
  );
}
