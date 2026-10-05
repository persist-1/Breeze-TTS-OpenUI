import { useState, useEffect, type ReactNode } from "react";
import type { Snapshot } from "../../../packages/contracts/src/index.ts";
import { act } from "./store.ts";
import { Button, Icon, Empty, Modal } from "./ui.tsx";
import { Select } from "./Select.tsx";
import { TaskRecord } from "./TaskRecord.tsx";
import { useCollection } from "./useCollection.ts";
import { CollectionControls, Pagination } from "./Collection.tsx";
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
    [search, setSearch] = useState(""),
    [inspectedId, setInspectedId] = useState("");
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
  const ordered = projects.flatMap((p) =>
    tasks.filter((t) => t.projectId === p.id),
  );
  const collection = useCollection(
    ordered,
    "tasks",
    JSON.stringify([scope, filter, search]),
  );
  const inspected = w.tasks.find((t) => t.id === inspectedId);
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
        <div className="page-head inline-page-head">
          <h1>生成记录</h1>
          <p className="page-description">
            按作品管理任务；已完成音频保留，继续只补未完成部分。
          </p>
        </div>
        <div className="surface record-toolbar management-toolbar">
          <label>
            <span className="filter-label">
              <Icon name="projects" />
              作品集
            </span>
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
            <span className="filter-label">
              <Icon name="tasks" />
              任务状态
            </span>
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
            <span className="filter-label">
              <Icon name="search" />
              搜索
            </span>
            <input
              aria-label="搜索生成记录"
              placeholder="搜索文稿或作品名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <CollectionControls
            filtered={!!search || filter !== "all"}
            collection={collection}
            noun="个任务"
            total={inScope.length}
          />
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
          <div
            ref={collection.region}
            tabIndex={-1}
            className={
              collection.view === "grid"
                ? "collection-grid task-tiles"
                : "collection-list task-list"
            }
            aria-label="生成记录列表"
          >
            {collection.view === "grid"
              ? collection.items.map((t) => (
                  <TaskRecord
                    key={t.id}
                    task={t}
                    snapshot={snapshot}
                    show={show}
                    compact
                    onInspect={() => setInspectedId(t.id)}
                  />
                ))
              : projects.map((p) => {
                  const group = collection.items.filter(
                    (t) => t.projectId === p.id,
                  );
                  return group.length ? (
                    <section key={p.id} className="task-group">
                      {scope === "all" ? (
                        <div className="section-head">
                          <h2 title={p.title}>{p.title}</h2>
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
                      {group.map((t) => (
                        <TaskRecord
                          key={t.id}
                          task={t}
                          snapshot={snapshot}
                          show={show}
                        />
                      ))}
                    </section>
                  ) : null;
                })}
          </div>
        )}
        <Pagination collection={collection} footer />
        {inspected ? (
          <Modal title="生成记录" onClose={() => setInspectedId("")}>
            <div className="inspector-context">
              <Icon name="projects" />
              <span>
                {w.projects.find((p) => p.id === inspected.projectId)?.title ||
                  inspected.projectTitle}
              </span>
            </div>
            <TaskRecord
              key={inspected.id}
              task={inspected}
              snapshot={snapshot}
              show={show}
              inspector
            />
          </Modal>
        ) : null}
      </>
    </>
  );
}
