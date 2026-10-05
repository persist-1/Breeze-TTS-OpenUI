import { useState, type ReactNode } from "react";
import type { Snapshot } from "../../../packages/contracts/src/index.ts";
import { command, flushDrafts } from "./store.ts";
import { Button, Empty, Icon, Help } from "./ui.tsx";
import { Select } from "./Select.tsx";
import { ProjectName, deleteProject } from "./ProjectActions.tsx";
import { ItemList } from "./ItemList.tsx";

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
      <div className="page-head">
        <div>
          <h1>作品集</h1>
          <p>管理文稿、段落和生成成果。</p>
        </div>
        <Button
          icon="plus"
          tone="primary"
          onClick={() => show(<ProjectName close={() => show(null)} />)}
        >
          新建作品
        </Button>
      </div>
      <div className="surface projects-toolbar">
        <label className="search-field">
          搜索作品
          <input
            aria-label="搜索作品"
            value={query}
            placeholder="输入作品名称…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          排序
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
        <span className="count">
          {query.trim()
            ? `${projects.length} / ${w.projects.length}`
            : w.projects.length}{" "}
          个作品
        </span>
        <Help>
          删除作品会同时清理其中的段落、生成记录和音频。存在正在生成或排队的任务时，请先在生成记录中取消任务。
        </Help>
      </div>
      {projects.length ? (
        <ItemList className="surface projects-list" aria-label="作品列表">
          {projects.map((p) => {
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
              <article className="project-row" key={p.id}>
                <div className="project-row-main">
                  <div className="project-row-title">
                    <h2>{p.title}</h2>
                    {p.id === w.currentProjectId ? (
                      <span className="badge success">
                        <Icon name="check" />
                        当前作品
                      </span>
                    ) : null}
                  </div>
                  <div className="project-row-meta">
                    <span>{p.segments.length} 段文稿</span>
                    <span>{audios} 份音频</span>
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
                          {active} 条任务进行中
                        </span>
                      ) : null}
                      {needsAttention ? (
                        <span className="badge warning">
                          <Icon name="alert" />
                          {needsAttention} 条任务待继续
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="project-row-actions">
                  <Button
                    disabled={!!opening}
                    tone="primary"
                    icon={opening === p.id ? "loader" : "studio"}
                    onClick={() => void open(p.id, "studio")}
                  >
                    打开作品
                  </Button>
                  <Button
                    disabled={!!opening}
                    icon="tasks"
                    onClick={() => void open(p.id, "tasks")}
                  >
                    生成记录{tasks.length ? ` · ${tasks.length}` : ""}
                  </Button>
                  <Button
                    icon="edit"
                    aria-label={`重命名作品${p.title}`}
                    title="重命名"
                    onClick={() =>
                      show(<ProjectName project={p} close={() => show(null)} />)
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
        </ItemList>
      ) : (
        <Empty title="没有找到作品">
          <Button onClick={() => setQuery("")}>清除搜索</Button>
        </Empty>
      )}
    </>
  );
}
