import { useState } from "react";
import type {
  Project,
  Segment,
} from "../../../packages/contracts/src/index.ts";
import {
  cleanSegmentName,
  segmentNameKey,
} from "../../../packages/contracts/src/segment-names.ts";
import { command } from "./store.ts";
import { Button, Modal } from "./ui.tsx";
export function SegmentRename({
  project,
  segment,
  close,
}: {
  project: Project;
  segment: Segment;
  close: () => void;
}) {
  const [value, setValue] = useState(segment.name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const name = cleanSegmentName(value);
  const validation = !name
    ? "请输入段落名称。"
    : project.segments.some(
          (s) =>
            s.id !== segment.id &&
            segmentNameKey(s.name) === segmentNameKey(name),
        )
      ? "该作品中已有同名段落，请换一个名称。"
      : "";
  return (
    <Modal
      title="重命名段落"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (validation || busy) return;
          setBusy(true);
          void command({
            type: "segment.update",
            projectId: project.id,
            segmentId: segment.id,
            patch: { name },
          })
            .then(close)
            .catch((e) => {
              setError(String(e).replace(/^Error: /, ""));
              setBusy(false);
            });
        }}
      >
        <label>
          段落名称
          <input
            autoFocus
            maxLength={80}
            value={value}
            aria-invalid={!!validation}
            aria-describedby="segment-name-error"
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
          />
        </label>
        {validation || error ? (
          <p id="segment-name-error" className="inline-error" role="alert">
            {validation || error}
          </p>
        ) : null}
        <div className="actions end">
          <Button type="button" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button tone="primary" disabled={!!validation || busy}>
            {busy ? "正在保存…" : "保存名称"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
