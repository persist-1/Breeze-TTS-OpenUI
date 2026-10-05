import { useState, type ReactNode } from "react";
import type {
  Project,
  Workspace,
} from "../../../packages/contracts/src/index.ts";
import { command, flushDrafts, state } from "./store.ts";
import { Button, Modal, confirmDelete } from "./ui.tsx";

export function ProjectName({
  project,
  close,
  onSaved,
}: {
  project?: Project;
  close: () => void;
  onSaved?: (id: string) => void;
}) {
  const [name, setName] = useState(project?.title || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await flushDrafts();
      await command(
        project
          ? {
              type: "project.update",
              projectId: project.id,
              patch: { title: name.trim() },
            }
          : { type: "project.create", patch: { title: name.trim() } },
      );
      onSaved?.(project?.id || state.get()!.workspace.currentProjectId);
      close();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={project ? "重命名作品" : "新建作品"}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          作品名称
          <input
            autoFocus
            value={name}
            maxLength={100}
            placeholder="给这份作品起个名字…"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions end">
          <Button type="button" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            tone="primary"
            disabled={busy || !name.trim()}
            icon={busy ? "loader" : undefined}
            aria-busy={busy}
          >
            {busy ? "保存中…" : project ? "保存名称" : "创建作品"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function deleteProject(
  p: Project,
  w: Workspace,
  show: (node: ReactNode) => void,
) {
  const audio = w.outputs.filter((o) => o.projectId === p.id).length,
    tasks = w.tasks.filter((t) => t.projectId === p.id).length;
  confirmDelete(
    "project",
    p.title,
    `永久删除 ${p.segments.length} 个段落、${tasks} 条生成记录与 ${audio} 份音频。其他作品保留。`,
    async () => {
      await flushDrafts();
      await command({ type: "delete", value: "project", id: p.id });
    },
    show,
  );
}
