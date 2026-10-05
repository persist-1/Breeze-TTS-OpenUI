import { WaveformPlayer } from "./WaveformPlayer.tsx";
import { ItemList } from "./ItemList.tsx";
import { useState, useRef, useEffect, type ReactNode } from "react";
import type {
  Snapshot,
  Voice,
  Direction,
} from "../../../packages/contracts/src/index.ts";
import { act, command, request, report, registerDraftFlush } from "./store.ts";
import { Button, Modal, Empty, Tabs, confirmDelete, Help } from "./ui.tsx";
type Props = {
  snapshot: Snapshot;
  kind: "voices" | "directions";
  show: (node: ReactNode) => void;
};
export default function Library({ snapshot, kind, show }: Props) {
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(""), [kind]);
  const voices = kind === "voices";
  const items = (
    voices ? snapshot.workspace.voices : snapshot.workspace.directions
  ).filter((x) =>
    (x.name + " " + ("description" in x ? x.description : x.instruction))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const open = (item?: Voice | Direction) =>
    show(<Editor voices={voices} item={item} close={() => show(null)} />);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{voices ? "音色库" : "演绎指导"}</h1>
          <p>
            {voices
              ? "保存声音描述或参考录音，创作时直接选择。"
              : "保存完整指导，按原文使用或插入个人描述。"}
          </p>
        </div>
        <Button tone="primary" icon="plus" onClick={() => open()}>
          {voices ? "新建音色" : "新建演绎指导"}
        </Button>
      </div>
      <div className="library-toolbar">
        <input
          aria-label="搜索名称与内容"
          placeholder="搜索名称与内容"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{items.length} 项</span>
      </div>
      {!items.length ? (
        <Empty
          title={
            search
              ? "没有匹配内容"
              : voices
                ? "建立你的第一种声音"
                : "保存一份演绎指导"
          }
        >
          {search ? (
            <Button onClick={() => setSearch("")}>清除搜索</Button>
          ) : (
            <Button onClick={() => open()}>
              {voices ? "新建音色" : "新建演绎指导"}
            </Button>
          )}
        </Empty>
      ) : (
        <ItemList
          key={kind}
          className={voices ? "library-grid" : "direction-list"}
          aria-label={voices ? "音色列表" : "演绎指导列表"}
        >
          {items.map((item) => (
            <article className="surface library-item" key={item.id}>
              <div className="section-head">
                <h2>{item.name}</h2>
                <span className="badge neutral">
                  {"kind" in item
                    ? item.kind === "design"
                      ? "描述音色"
                      : "参考录音"
                    : "演绎指导"}
                </span>
              </div>
              <p className="library-description">
                {"description" in item
                  ? item.description || item.transcript
                  : item.instruction}
              </p>
              {"assetId" in item && item.assetId ? (
                <WaveformPlayer
                  source="reference"
                  id={item.assetId}
                  label={item.name}
                />
              ) : null}
              <div className="actions">
                <Button
                  onClick={() => {
                    const p = snapshot.workspace.projects.find(
                      (p) => p.id === snapshot.workspace.currentProjectId,
                    )!;
                    act({
                      type: "segment.update",
                      projectId: p.id,
                      segmentId: p.currentId,
                      patch: voices
                        ? {
                            voiceSource: "library",
                            voiceId: item.id,
                            ...("seed" in item ? { seed: item.seed } : {}),
                          }
                        : {
                            directionEnabled: true,
                            directionSource: "preset",
                            directionPresetId: item.id,
                          },
                    });
                    location.hash = "studio";
                  }}
                >
                  用于创作
                </Button>
                <Button onClick={() => open(item)}>编辑</Button>
                <Button
                  icon="trash"
                  aria-label={"删除" + item.name}
                  onClick={() =>
                    confirmDelete(
                      voices ? "voice" : "direction",
                      item.name,
                      voices
                        ? "删除音色与其参考录音。已生成音频保留；使用此录音的历史任务将无法重做。"
                        : "删除预设后，原文使用此预设的草稿需要重新选择。已生成音频保留。",
                      () =>
                        command({
                          type: "delete",
                          value: voices ? "voice" : "direction",
                          id: item.id,
                        }),
                      show,
                    )
                  }
                />
              </div>
            </article>
          ))}
        </ItemList>
      )}
    </>
  );
}
function Editor({
  voices,
  item,
  close,
}: {
  voices: boolean;
  item?: Voice | Direction;
  close: () => void;
}) {
  const [name, setName] = useState(item?.name || ""),
    [kind, setKind] = useState<Voice["kind"]>(
      "kind" in (item || {}) ? (item as Voice).kind : "design",
    ),
    [content, setContent] = useState(
      item ? ("description" in item ? item.description : item.instruction) : "",
    ),
    [transcript, setTranscript] = useState((item as Voice)?.transcript || ""),
    [asset, setAsset] = useState((item as Voice)?.assetId || ""),
    [consent, setConsent] = useState((item as Voice)?.consent || false),
    [seed, setSeed] = useState((item as Voice)?.seed || 42),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const upload = async (bytes: Uint8Array) => {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>("/api/reference", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: bytes as unknown as BodyInit,
      });
      setAsset(result.id);
      uploaded.current.push(result.id);
      setConsent(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const uploaded = useRef<string[]>([]);
  useEffect(() => {
    const clear = async () => {
      for (const id of uploaded.current)
        await command({ type: "reference.discard", id });
    };
    const unregister = registerDraftFlush(clear);
    return () => {
      unregister();
      void clear().catch(() => {});
    };
  }, []);
  const save = async () => {
    if (!name.trim() || (!content.trim() && (!voices || kind === "design"))) {
      setError("请填写名称和完整内容。");
      return;
    }
    if (
      voices &&
      kind === "reference" &&
      (!asset || !transcript.trim() || !consent)
    ) {
      setError("请导入参考录音，填写逐字稿并试听核对。");
      return;
    }
    setBusy(true);
    try {
      await command({
        type: voices ? "voice.save" : "direction.save",
        item: voices
          ? {
              id: item?.id || crypto.randomUUID(),
              name,
              kind,
              description: content,
              seed,
              assetId: kind === "reference" ? asset : undefined,
              transcript: kind === "reference" ? transcript : undefined,
              consent: kind === "reference" ? consent : undefined,
            }
          : { id: item?.id || crypto.randomUUID(), name, instruction: content },
      });
      close();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={(item ? "编辑" : "新建") + (voices ? "音色" : "演绎指导")}
      onClose={close}
    >
      <div className="form-stack">
        <label>
          名称
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        {voices ? (
          <Tabs
            value={kind}
            onChange={(v) => setKind(v as Voice["kind"])}
            items={[
              ["design", "声音描述"],
              ["reference", "参考录音"],
            ]}
          />
        ) : null}
        {!voices || kind === "design" ? (
          <label>
            {voices ? "音色描述" : "演绎指导"}
            <textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                voices
                  ? "描述年龄、音域、音质、口音等声音特征"
                  : "描述语气、节奏和演绎方式，不必选择固定标签"
              }
            />
          </label>
        ) : (
          <>
            <div className="section-head">
              <h3>参考录音</h3>
              <Help>
                导入 1–120 秒
                WAV，录音会复制到应用内部。请使用单人、清晰录音，并按录音填写准确逐字稿。
              </Help>
            </div>
            {window.breeze ? (
              <Button
                disabled={busy}
                icon="plus"
                onClick={() =>
                  void window
                    .breeze!.pickReference()
                    .then((r) =>
                      r ? upload(Uint8Array.from(r.bytes)) : undefined,
                    )
                    .catch((e) => setError(String(e)))
                }
              >
                导入 WAV 录音
              </Button>
            ) : (
              <input
                aria-label="导入 WAV 录音"
                type="file"
                accept=".wav"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void f.arrayBuffer().then((b) => upload(new Uint8Array(b)));
                }}
              />
            )}
            {asset ? (
              <WaveformPlayer
                source="reference"
                id={asset}
                label={name || "参考录音"}
              />
            ) : null}
            <label>
              录音逐字稿
              <textarea
                rows={4}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              已试听，并确认逐字稿与录音一致
            </label>
          </>
        )}
        {voices ? (
          <label>
            固定随机种子
            <input
              type="number"
              min="0"
              max="2147483644"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
        ) : null}
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions end">
          <Button onClick={close}>取消</Button>
          <Button tone="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
