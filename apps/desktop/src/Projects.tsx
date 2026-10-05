import { useState, type ReactNode } from "react";
import type { Snapshot } from "../../../packages/contracts/src/index.ts";
import { command, flushDrafts, state } from "./store.ts";
import { Button, Empty, Icon, Help } from "./ui.tsx";
import { Select } from "./Select.tsx";
import { ProjectName, deleteProject } from "./ProjectActions.tsx";
import { useCollection } from "./useCollection.ts";
import { CollectionControls, Pagination } from "./Collection.tsx";

export default function Projects({
  snapshot,
  show,
}: {
  snapshot: Snapshot;
  show: (node: ReactNode) => void;
}) {
  const w = snapshot.workspace;
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("updated"),
    [opening, setOpening] = useState("");
  const projects = w.projects
    .filter((p) =>
      p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .slice()
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title, "zh-CN")
        : b.updatedAt - a.updatedAt,
    );
  const collection = useCollection(
    projects,
    "projects",
    JSON.stringify([query, sort]),
  );
  const reveal = (id: string) => {
    const all = state
      .get()!
      .workspace.projects.slice()
      .sort((a, b) =>
        sort === "name"
          ? a.title.localeCompare(b.title, "zh-CN")
          : b.updatedAt - a.updatedAt,
      );
    setQuery("");
    collection.reveal(
      id,
      all.findIndex((p) => p.id === id),
      JSON.stringify(["", sort]),
    );
  };
  const open = async (id: string, view: "studio" | "tasks") => {
    if (opening) return;
    setOpening(id);
    try {
      await flushDrafts();
      await command({ type: "project.open", projectId: id });
      location.hash = view;
    } catch {
    } finally {
      setOpening("");
    }
  };
  return (
    <>
      <div className="page-head inline-page-head">
        <h1>作品集</h1>
        <p className="page-description">管理文稿、段落和生成成果。</p>
        <Button
          icon="plus"
          tone="primary"
          onClick={() =>
            show(<ProjectName close={() => show(null)} onSaved={reveal} />)
          }
        >
          新建作品
        </Button>
      </div>
      <div className="surface projects-toolbar management-toolbar">
        <label className="search-field">
          <span className="filter-label">
            <Icon name="search" />
            搜索作品
          </span>
          <input
            aria-label="搜索作品"
            value={query}
            placeholder="输入作品名称…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="filter-label">
            <Icon name="list" />
            排序
          </span>
          <Select
            label="作品排序"
            value={sort}
            options={[
              { value: "updated", label: "最近编辑" },
              { value: "name", label: "名称顺序" },
            ]}
            onChange={setSort}
          />
        </label>
        <Help>
          删除作品会同时清理其中的段落、生成记录和音频。存在正在生成或排队的任务时，请先在生成记录中取消任务。
        </Help>
        <CollectionControls
          collection={collection}
          noun="个作品"
          total={w.projects.length}
          filtered={!!query.trim()}
        />
      </div>
      {projects.length ? (
        <div
          ref={collection.region}
          tabIndex={-1}
          className={
            collection.view === "grid"
              ? "collection-grid projects-grid"
              : "surface projects-list collection-list"
          }
          aria-label="作品列表"
        >
          {collection.items.map((p) => {
            const tasks = w.tasks.filter((t) => t.projectId === p.id),
              audios = w.outputs.filter((o) => o.projectId === p.id).length,
              active = tasks.filter((t) =>
                ["queued", "preparing", "running"].includes(t.status),
              ).length,
              needsAttention = tasks.filter(
                (t) =>
                  ["failed", "interrupted", "cancelled"].includes(t.status) &&
                  t.units.some((u) => u.outputId === null),
              ).length;
            return (
              <article
                className={
                  collection.view === "grid"
                    ? "surface collection-tile project-tile"
                    : "project-row"
                }
                key={p.id}
                data-collection-id={p.id}
                tabIndex={-1}
              >
                <div className="project-row-main">
                  <div className="project-row-title">
                    <h2 title={p.title}>{p.title}</h2>
                    {p.id === w.currentProjectId &&
                    collection.view === "list" ? (
                      <span className="badge success">
                        <Icon name="check" />
                        当前作品
                      </span>
                    ) : null}
                  </div>
                  <div className="project-row-meta">
                    <span>
                      {p.segments.length}{" "}
                      {collection.view === "grid" ? "段" : "段文稿"}
                    </span>
                    <span>
                      {audios} {collection.view === "grid" ? "音频" : "份音频"}
                    </span>
                    {collection.view === "grid" ? (
                      <span>{tasks.length} 记录</span>
                    ) : null}
                    <time dateTime={new Date(p.updatedAt).toISOString()}>
                      编辑于{" "}
                      {new Date(p.updatedAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  {active || needsAttention ? (
                    <div className="project-task-state">
                      {active ? (
                        <span className="badge processing">
                          <Icon name="clock" />
                          {active}{" "}
                          {collection.view === "grid"
                            ? "生成中"
                            : "条任务进行中"}
                        </span>
                      ) : null}
                      {needsAttention ? (
                        <span className="badge warning">
                          <Icon name="alert" />
                          {needsAttention}{" "}
                          {collection.view === "grid"
                            ? "待继续"
                            : "条任务待继续"}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="project-row-actions">
                  <Button
                    disabled={!!opening}
                    tone="primary"
                    icon={
                      opening === p.id
                        ? "loader"
                        : collection.view === "grid" &&
                            p.id === w.currentProjectId
                          ? "check"
                          : "studio"
                    }
                    onClick={() => void open(p.id, "studio")}
                  >
                    {collection.view === "grid" && p.id === w.currentProjectId
                      ? "打开当前作品"
                      : "打开作品"}
                  </Button>
                  <Button
                    disabled={!!opening}
                    icon="tasks"
                    aria-label={`查看作品${p.title}的生成记录`}
                    title={collection.view === "grid" ? "生成记录" : undefined}
                    onClick={() => void open(p.id, "tasks")}
                  >
                    {collection.view === "list" ? (
                      <>生成记录{tasks.length ? ` · ${tasks.length}` : ""}</>
                    ) : null}
                  </Button>
                  <Button
                    icon="edit"
                    aria-label={`重命名作品${p.title}`}
                    title="重命名"
                    onClick={() =>
                      show(
                        <ProjectName
                          project={p}
                          close={() => show(null)}
                          onSaved={reveal}
                        />,
                      )
                    }
                  />
                  <Button
                    icon="trash"
                    disabled={!!active}
                    aria-label={`删除作品${p.title}`}
                    title={active ? "请先在生成记录中取消关联任务" : "删除作品"}
                    onClick={() => deleteProject(p, w, show)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title="没有找到作品">
          <Button onClick={() => setQuery("")}>清除搜索</Button>
        </Empty>
      )}
      <Pagination collection={collection} footer />
    </>
  );
}
