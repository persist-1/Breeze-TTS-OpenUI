import { useRef, useState, useEffect } from "react";
import type { ReactNode } from "react";
import type {
  Project,
  Segment,
} from "../../../packages/contracts/src/index.ts";
import { command, flushDrafts } from "./store.ts";
import { Button, Help, Icon, confirmDelete } from "./ui.tsx";
import { SegmentRename } from "./SegmentRename.tsx";
const shortName = (name: string) => {
  const text = name.replace(/^第\s*(\d+)\s*段$/, "第$1段");
  const letters = Array.from(
    new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );
  return letters.length > 3 ? letters.slice(0, 3).join("") + "..." : text;
};
export function SegmentRail({
  project: p,
  show,
}: {
  project: Project;
  show: (node: ReactNode) => void;
}) {
  const [dragged, setDragged] = useState(""),
    [target, setTarget] = useState<{ id: string; after: boolean } | null>(null),
    [busy, setBusy] = useState(false);
  const dragSource = useRef("");
  const list = useRef<HTMLDivElement>(null);
  const order = p.segments.map((s) => s.id).join("|");
  useEffect(() => {
    const container = list.current;
    if (!container) return;
    const reveal = () => {
      const selected = container.querySelector<HTMLButtonElement>(
        '[aria-pressed="true"]',
      );
      if (!selected) return;
      const a = container.getBoundingClientRect(),
        b = selected.getBoundingClientRect();
      if (b.top < a.top + 4) container.scrollTop -= a.top + 4 - b.top;
      else if (b.bottom > a.bottom - 4)
        container.scrollTop += b.bottom - a.bottom + 4;
    };
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(container);
    return () => resize.disconnect();
  }, [p.currentId, order]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await flushDrafts();
      await fn();
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const rename = (s: Segment) =>
    void flushDrafts()
      .then(() =>
        show(
          <SegmentRename project={p} segment={s} close={() => show(null)} />,
        ),
      )
      .catch(() => {});
  const reorder = (id: string, targetId: string, after: boolean) =>
    void run(() =>
      command({
        type: "segment.reorder",
        projectId: p.id,
        segmentId: id,
        value: { targetId, after },
      }),
    );
  return (
    <aside className="surface segment-rail" aria-label="段落管理">
      <div className="rail-heading">
        <h2>段落</h2>
        <Help>
          拖动段落调整顺序，双击名称重命名。键盘也可使用 F2 改名、Alt +
          上下方向键排序。悬停可查看完整名称。
        </Help>
      </div>
      <div
        ref={list}
        className="rail-list"
        aria-label="段落列表"
        onDragOver={(e) => {
          if (!dragSource.current || !list.current) return;
          const rect = list.current.getBoundingClientRect();
          if (e.clientY < rect.top + 28) list.current.scrollTop -= 14;
          else if (e.clientY > rect.bottom - 28) list.current.scrollTop += 14;
        }}
      >
        {p.segments.map((s, index) => (
          <button
            key={s.id}
            type="button"
            className={`rail-segment ${dragged === s.id ? "dragging" : ""} ${target?.id === s.id ? (target.after ? "drop-after" : "drop-before") : ""}`}
            aria-label={s.name}
            aria-pressed={s.id === p.currentId}
            title={s.name + " · 双击改名，拖动排序"}
            draggable={!busy}
            onClick={() =>
              void flushDrafts()
                .then(() =>
                  command({
                    type: "segment.open",
                    projectId: p.id,
                    segmentId: s.id,
                  }),
                )
                .catch(() => {})
            }
            onDoubleClick={() => rename(s)}
            onKeyDown={(e) => {
              if (e.key === "F2") {
                e.preventDefault();
                rename(s);
              } else if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                const to = index + (e.key === "ArrowUp" ? -1 : 1);
                if (p.segments[to])
                  reorder(s.id, p.segments[to].id, to > index);
              }
            }}
            onDragStart={(e) => {
              dragSource.current = s.id;
              setDragged(s.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-breeze-segment", s.id);
            }}
            onDragOver={(e) => {
              if (!dragSource.current || s.id === dragSource.current) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              setTarget({
                id: s.id,
                after: e.clientY > rect.top + rect.height / 2,
              });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragSource.current;
              const rect = e.currentTarget.getBoundingClientRect();
              if (id && id !== s.id)
                reorder(id, s.id, e.clientY > rect.top + rect.height / 2);
              dragSource.current = "";
              setDragged("");
              setTarget(null);
            }}
            onDragEnd={() => {
              dragSource.current = "";
              setDragged("");
              setTarget(null);
            }}
          >
            <Icon name="grip" />
            <span>{shortName(s.name)}</span>
            {s.id === p.currentId ? <Icon name="check" /> : null}
          </button>
        ))}
      </div>
      <div className="rail-actions">
        <Button
          icon="plus"
          aria-label="添加段落"
          title="添加段落"
          disabled={busy}
          onClick={() =>
            void run(() => command({ type: "segment.create", projectId: p.id }))
          }
        />
        <Button
          icon="trash"
          aria-label="删除当前段落"
          title={p.segments.length === 1 ? "至少保留一个段落" : "删除当前段落"}
          disabled={busy || p.segments.length === 1}
          onClick={() => {
            const s = p.segments.find((s) => s.id === p.currentId)!;
            confirmDelete(
              "segment",
              s.name,
              "删除该段落的生成记录与音频，其他段落保留。",
              async () => {
                await flushDrafts();
                await command({ type: "delete", value: "segment", id: s.id });
              },
              show,
            );
          }}
        />
      </div>
    </aside>
  );
}
