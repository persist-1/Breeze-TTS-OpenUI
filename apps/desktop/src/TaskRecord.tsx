import type { ReactNode } from "react";
import type {
  Snapshot,
  Task,
  TaskStatus,
} from "../../../packages/contracts/src/index.ts";
import { act, command } from "./store.ts";
import { Button, Icon, confirmDelete } from "./ui.tsx";
import { OutputCard } from "./Studio.tsx";
import { LiveAudio } from "./LiveAudio.tsx";
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

export function TaskRecord({
  task: t,
  snapshot,
  show,
  compact = false,
  onInspect,
  inspector = false,
}: {
  task: Task;
  snapshot: Snapshot;
  show: (node: ReactNode) => void;
  compact?: boolean;
  onInspect?: () => void;
  inspector?: boolean;
}) {
  const w = snapshot.workspace;
  const project = w.projects.find((p) => p.id === t.projectId);
  const outputs = w.outputs.filter((o) => o.taskId === t.id);
  const done = t.units.filter((u) => u.outputId !== null).length;
  const busy = ["queued", "preparing", "running"].includes(t.status);
  const title =
    t.units.length === 1 ? t.units[0].segmentName : `${t.units.length} 份音频`;
  const retry =
    ["failed", "interrupted", "cancelled"].includes(t.status) &&
    done < t.units.length;
  const canRetry =
    snapshot.runtime.service.status === "running" &&
    !snapshot.runtime.busy &&
    (["python", "dependencies", "model"] as const).every(
      (k) => snapshot.runtime[k].status === "ready",
    );
  const remove = () =>
    confirmDelete(
      "task",
      "这条生成记录",
      "删除这条记录及其所有音频。草稿与其他生成记录保留。",
      () => command({ type: "delete", value: "task", id: t.id }),
      show,
    );
  return (
    <article
      className={
        compact
          ? "surface collection-tile task-tile"
          : `${inspector ? "record-inspector" : "surface"} task`
      }
      data-task-id={t.id}
    >
      <div className="section-head">
        {!compact ? (
          <div>
            <h3>{title}</h3>
            <small>
              {new Date(t.createdAt).toLocaleString("zh-CN")} · 第{" "}
              {Math.max(1, t.attempts)} 次运行
            </small>
          </div>
        ) : (
          <Icon name="tasks" />
        )}
        <span
          className={`badge ${["failed", "interrupted"].includes(t.status) ? "failure" : busy ? "processing" : t.status === "completed" ? "success" : "neutral"}`}
        >
          <Icon
            name={
              busy
                ? "clock"
                : t.status === "completed"
                  ? "check"
                  : t.status === "cancelled"
                    ? "stop"
                    : "alert"
            }
          />
          {t.cancelRequested ? "取消中…" : labels[t.status]}
        </span>
      </div>
      {compact ? (
        <>
          <h3 title={title}>{title}</h3>
          <div className="tile-meta">
            <span title={project?.title || t.projectTitle}>
              <Icon name="projects" />
              <span>{project?.title || t.projectTitle}</span>
            </span>
            <time dateTime={new Date(t.createdAt).toISOString()}>
              {new Date(t.createdAt).toLocaleString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
          <p
            className={`tile-excerpt ${t.error ? "tile-error" : ""}`}
            title={t.error || undefined}
          >
            {t.error || t.units[0]?.input.text || "没有文稿"}
          </p>
        </>
      ) : null}
      <div className="task-progress">
        <span>
          {done} / {t.units.length} 份已处理 · {outputs.length} 份可试听
        </span>
        <progress
          aria-label="音频生成完成数量"
          value={done}
          max={Math.max(1, t.units.length)}
        />
      </div>
      {!compact && t.error ? <p className="inline-error">{t.error}</p> : null}
      <div className="actions task-record-actions">
        {!compact && t.stream ? (
          <LiveAudio key={t.stream.file} taskId={t.id} file={t.stream.file} />
        ) : null}
        {busy ? (
          <Button
            disabled={!!t.cancelRequested}
            onClick={() => act({ type: "task.cancel", id: t.id })}
          >
            {t.status === "queued" ? "取消排队" : "取消生成"}
          </Button>
        ) : retry ? (
          <Button
            tone="primary"
            icon="refresh"
            disabled={!canRetry}
            title={!canRetry ? "请先启动模型服务并完成运行环境校验" : undefined}
            onClick={() => act({ type: "task.retry", id: t.id })}
          >
            继续未完成部分
          </Button>
        ) : null}
        {compact ? (
          <Button
            icon="brackets"
            onClick={onInspect}
            aria-label={`查看生成记录：${title}，${project?.title || t.projectTitle}`}
          >
            查看记录
          </Button>
        ) : null}
        <Button
          disabled={busy}
          icon="trash"
          aria-label={`删除生成记录：${title}`}
          title={busy ? "请先取消任务再删除" : "删除记录"}
          onClick={remove}
        >
          {compact ? null : "删除记录"}
        </Button>
      </div>
      {!compact ? (
        <>
          <TaskDetails task={t} />
          {outputs.length ? (
            <details className="task-audio" open={t.status === "completed"}>
              <summary>试听音频（{outputs.length}）</summary>
              <div className="output-list">
                {outputs.map((o) => (
                  <OutputCard
                    key={o.id}
                    output={o}
                    segment={project?.segments.find(
                      (s) => s.id === o.segmentId,
                    )}
                    snapshot={snapshot}
                    show={show}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
