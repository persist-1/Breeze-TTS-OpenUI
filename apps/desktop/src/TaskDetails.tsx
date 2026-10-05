import { useId, useState } from "react";
import type { Task } from "../../../packages/contracts/src/index.ts";
import { Button, Icon, Help } from "./ui.tsx";
import { Select } from "./Select.tsx";

export function TaskDetails({ task: t }: { task: Task }) {
  const [view, setView] = useState<"input" | "events" | null>(null),
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
            <>
              <div className="snapshot-fields">
                <div className="snapshot-field">
                  <h5>待合成文稿</h5>
                  <p className="snapshot-copy">
                    {unit.input.text || "文稿为空"}
                  </p>
                </div>
                <div className="snapshot-field">
                  <h5>声音与演绎指导</h5>
                  <p className="snapshot-copy">
                    {unit.input.instruction ||
                      (unit.input.reference
                        ? "使用参考录音的声音，未指定额外演绎指导。"
                        : "未指定描述，由模型使用默认声音。")}
                  </p>
                  {unit.input.reference ? (
                    <details className="reference-snapshot">
                      <summary>
                        <Icon name="voices" />
                        参考录音：{unit.input.reference.name}
                      </summary>
                      <p>{unit.input.reference.transcript}</p>
                    </details>
                  ) : null}
                </div>
              </div>
              <dl className="snapshot-params">
                <div>
                  <dt>语言</dt>
                  <dd>{unit.input.language === "zh" ? "中文" : "English"}</dd>
                </div>
                <div>
                  <dt>随机种子</dt>
                  <dd>{unit.input.seed + unit.index}</dd>
                </div>
                <div>
                  <dt>引导强度</dt>
                  <dd>{unit.input.cfg}</dd>
                </div>
              </dl>
            </>
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
