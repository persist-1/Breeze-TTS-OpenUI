import { useId, useState } from "react";
import type { Task } from "../../../packages/contracts/src/index.ts";
import { Button, Icon, Help } from "./ui.tsx";
import { Select } from "./Select.tsx";
import { InputSnapshot } from "./InputSnapshot.tsx";

export function TaskDetails({ task: t }: { task: Task }) {
  const [view, setView] = useState<"input" | "events" | null>("input"),
    [unitId, setUnitId] = useState(t.units[0]?.id || "");
  const id = useId(),
    unit = t.units.find((u) => u.id === unitId) || t.units[0];
  return (
    <div className="task-detail">
      <div className="task-detail-actions">
        <Button
          icon="brackets"
          aria-expanded={view === "input"}
          aria-controls={id + "-input"}
          onClick={() => setView(view === "input" ? null : "input")}
        >
          合成输入
          <Icon name="chevron" />
        </Button>
        <Button
          icon="clock"
          aria-expanded={view === "events"}
          aria-controls={id + "-events"}
          onClick={() => setView(view === "events" ? null : "events")}
        >
          运行过程
          <Icon name="chevron" />
        </Button>
      </div>
      {view === "input" ? (
        <section
          id={id + "-input"}
          className="task-detail-body input-snapshot"
          aria-label="任务固定输入"
        >
          <div className="snapshot-head">
            {t.units.length > 1 ? (
              <Select
                label="查看候选输入"
                value={unit?.id || ""}
                options={t.units.map((u) => ({
                  value: u.id,
                  label: `${u.segmentName} · 候选 ${u.index + 1}`,
                }))}
                onChange={setUnitId}
              />
            ) : (
              <h4>
                {unit
                  ? `${unit.segmentName} · 候选 ${unit.index + 1}`
                  : "暂无输入"}
              </h4>
            )}
            <Help>
              这里保存的是提交生成时的输入，修改创作台草稿不会改变这份记录。各候选的实际随机种子为基础种子加候选序号减一。
            </Help>
          </div>
          {unit ? (
            <InputSnapshot
              key={unit.id}
              input={unit.input}
              seed={unit.input.seed + unit.index}
            />
          ) : null}
        </section>
      ) : null}
      {view === "events" ? (
        <section
          id={id + "-events"}
          className="task-detail-body"
          aria-label="任务运行过程"
        >
          <div className="snapshot-head">
            <h4>运行过程</h4>
            <span className="count">第 {Math.max(1, t.attempts)} 次运行</span>
          </div>
          {t.events.length ? (
            <ol className="run-events" tabIndex={0} aria-label="运行事件列表">
              {t.events.map((e, i) => {
                const last = i === t.events.length - 1,
                  busy = last && ["running", "preparing"].includes(t.status),
                  failed = last && t.status === "failed";
                return (
                  <li
                    key={i}
                    className={
                      failed
                        ? "event-failure"
                        : last && t.status === "completed"
                          ? "event-success"
                          : ""
                    }
                  >
                    <Icon
                      name={
                        failed
                          ? "alert"
                          : last && t.status === "completed"
                            ? "check"
                            : busy
                              ? "loader"
                              : "clock"
                      }
                    />
                    <time dateTime={new Date(e.at).toISOString()}>
                      {new Date(e.at).toDateString() ===
                      new Date(t.createdAt).toDateString()
                        ? new Date(e.at).toLocaleTimeString("zh-CN", {
                            hour12: false,
                          })
                        : new Date(e.at).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false,
                          })}
                    </time>
                    <span>{e.message}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="detail-empty">
              暂无运行事件，任务状态显示在记录顶部。
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
