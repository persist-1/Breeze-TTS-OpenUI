import type {
  Snapshot,
  InstallKind,
  InstallPlan,
} from "../../../packages/contracts/src/index.ts";
import { useState, useEffect, useRef } from "react";
import { act, command, download, request, state } from "./store.ts";
import { Button, Icon, Help, Modal } from "./ui.tsx";
import { installPrerequisites } from "../../../packages/contracts/src/install-order.ts";
const steps: [InstallKind, string, string][] = [
  ["uv", "uv CLI", "下载官方 uv，校验后用于管理本地 Python。"],
  ["python", "Python 环境", "由本项目 uv 下载 Python 3.11，并建立内部环境。"],
  ["dependencies", "推理依赖", "安装 CUDA 版 PyTorch 与 Breeze 所需组件。"],
  ["model", "Breeze-TTS-2 模型", "从 ModelScope 下载模型及音频编解码器。"],
];
const size = (value = 0) =>
  value > 1e9
    ? (value / 1e9).toFixed(2) + " GB"
    : (value / 1e6).toFixed(1) + " MB";
export default function Settings({ snapshot }: { snapshot: Snapshot }) {
  const r = snapshot.runtime;
  const [importing, setImporting] = useState(false),
    [importResult, setImportResult] = useState("");
  const [repair, setRepair] = useState<InstallKind | null>(null);
  const [checking, setChecking] = useState<InstallKind | null>(null),
    [checks, setChecks] = useState<
      Partial<Record<InstallKind, { ok: boolean; text: string }>>
    >({});
  const checkingRef = useRef<InstallKind | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const validate = async (kind: InstallKind) => {
    if (checkingRef.current) return;
    checkingRef.current = kind;
    setChecking(kind);
    setChecks((v) => ({ ...v, [kind]: undefined }));
    try {
      await request("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "install.validate", value: kind }),
      });
      if (mounted.current)
        setChecks((v) => ({
          ...v,
          [kind]: {
            ok: true,
            text:
              "校验通过 · " +
              new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          },
        }));
    } catch (e) {
      if (mounted.current)
        setChecks((v) => ({
          ...v,
          [kind]: {
            ok: false,
            text: String(e)
              .replace(/^Error: /, "")
              .split("\n")
              .slice(-2)
              .join(" ")
              .slice(0, 180),
          },
        }));
    } finally {
      checkingRef.current = null;
      if (mounted.current) setChecking(null);
    }
  };
  return (
    <div className="settings-page">
      <div className="page-head">
        <div>
          <h1>设置</h1>
        </div>
      </div>
      <section className="surface install-panel">
        <div className="section-head">
          <h2>模型运行环境</h2>
          <Help>
            依次完成
            uv、Python、推理依赖和模型，每一步校验通过后再继续。中途取消不会删除有效文件；再次安装会利用内部缓存。推理使用支持
            CUDA 的 NVIDIA 显卡。
          </Help>
        </div>
        <p className="install-guide">
          按顺序完成下方 4 步，校验通过后解锁下一步。
        </p>
        <div className="root-path">
          <span className="path-label">
            <Icon name="folder" />
            应用目录
          </span>
          <span>{r.root}</span>
          {window.breeze ? (
            <Button onClick={() => void window.breeze!.openFolder("root")}>
              打开目录
            </Button>
          ) : null}
        </div>
        {steps.map(([kind, title, description], index) => {
          const s = r[kind],
            busy = s.status === "busy" || checking === kind,
            validating =
              busy && (checking === kind || s.stage.includes("校验")),
            ready = s.status === "ready" && !busy,
            blocker = installPrerequisites(kind).find(
              (k) => r[k].status !== "ready",
            ),
            blockedStep = steps.findIndex((step) => step[0] === blocker),
            enabled = !r.busy && !checking && !blocker;
          return (
            <div className="install-row" key={kind} data-resource={kind}>
              <div
                className={`step-number ${ready ? "ready" : !blocker ? "current" : ""}`}
              >
                {ready ? <Icon name="check" /> : index + 1}
              </div>
              <div className="install-main">
                <div className="section-head">
                  <div className="resource-heading">
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <span
                    className={`badge ${ready ? "success" : busy ? "processing" : s.status === "error" ? "failure" : "neutral"}`}
                  >
                    <Icon
                      name={
                        ready
                          ? "check"
                          : busy
                            ? "loader"
                            : s.status === "error"
                              ? "alert"
                              : blocker
                                ? "clock"
                                : "download"
                      }
                    />
                    {ready
                      ? "已就绪"
                      : busy
                        ? validating
                          ? "校验中"
                          : "安装中"
                        : s.status === "cancelled"
                          ? "已取消"
                          : s.status === "error"
                            ? "安装异常"
                            : blocker
                              ? "等待前置步骤"
                              : "未安装"}
                  </span>
                </div>
                <div className="resource-path">
                  <span className="path-label">
                    <Icon name="folder" />
                    安装位置
                  </span>
                  <code title={s.path}>{s.path}</code>
                </div>
                {blocker && !busy ? (
                  <p className="step-blocker" id={`prerequisite-${kind}`}>
                    <Icon name="clock" />
                    先完成第 {blockedStep + 1} 步：{steps[blockedStep][1]}。
                  </p>
                ) : null}
                {busy ? (
                  <div className="download-state" role="status">
                    <span>
                      {checking === kind
                        ? "正在检查本地文件与可用性…"
                        : s.stage}
                    </span>
                    {checking !== kind && s.progress != null ? (
                      <>
                        <progress value={s.progress} max="100" />
                        <div className="progress-meta">
                          <span>
                            {size(s.downloaded)} / {size(s.total)}
                          </span>
                          <strong>{Math.floor(s.progress)}%</strong>
                        </div>
                      </>
                    ) : (
                      <progress
                        aria-label={
                          checking === kind ? "资源校验进度" : s.stage
                        }
                      />
                    )}
                  </div>
                ) : null}
                {s.error && !busy && checks[kind]?.ok !== false ? (
                  <div className="inline-error" role="alert">
                    {s.error.includes("ENOENT") && kind === "model"
                      ? "模型尚未下载完整，请继续下载。"
                      : s.error
                          .replace(/^Error: /, "")
                          .split("\n")
                          .slice(-3)
                          .join("\n")}
                  </div>
                ) : null}
                <div className="actions">
                  {busy ? (
                    <Button onClick={() => act({ type: "install.cancel" })}>
                      {validating ? "取消校验" : "取消安装"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        tone={ready ? "" : "primary"}
                        icon="download"
                        disabled={!enabled}
                        aria-describedby={
                          blocker ? `prerequisite-${kind}` : undefined
                        }
                        onClick={() => {
                          setChecks((v) => ({ ...v, [kind]: undefined }));
                          setRepair(kind);
                        }}
                      >
                        {ready
                          ? "重新安装"
                          : s.status === "cancelled"
                            ? "继续安装"
                            : s.status === "error"
                              ? "重试安装"
                              : "下载并安装"}
                      </Button>
                      <Button
                        icon="check"
                        disabled={!enabled}
                        aria-describedby={
                          blocker ? `prerequisite-${kind}` : undefined
                        }
                        onClick={() => void validate(kind)}
                      >
                        校验
                      </Button>
                    </>
                  )}
                </div>
                {!busy &&
                checks[kind] &&
                !(checks[kind]!.ok && s.status !== "ready") ? (
                  <div
                    className={`validation-feedback ${checks[kind]!.ok ? "success" : "failure"}`}
                    role={checks[kind]!.ok ? "status" : "alert"}
                  >
                    <Icon name={checks[kind]!.ok ? "check" : "alert"} />
                    <span>{checks[kind]!.text}</span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>
      <section className="surface service-panel">
        <div className="section-head">
          <h2>模型服务</h2>
          <span
            className={`badge ${r.service.status === "running" ? "success" : r.service.status === "error" ? "failure" : "neutral"}`}
          >
            {r.service.message}
          </span>
        </div>
        {r.service.error ? (
          <p className="inline-error">{r.service.error}</p>
        ) : null}
        <details className="log-details">
          <summary>查看安装与运行日志</summary>
          <pre>{r.logs.join("\n") || "暂无运行日志"}</pre>
        </details>
      </section>
      <section className="surface">
        <h2>工作区数据</h2>
        <p>
          草稿、音色、生成记录和音频保存在本目录的 data
          文件夹中。迁移时复制整个解压目录。
        </p>
        <div className="actions">
          <Button
            icon="download"
            onClick={() => void download("/api/backup", "Breeze-工作区.zip")}
          >
            导出工作区备份
          </Button>
          <Button
            disabled={snapshot.workspace.tasks.some((t) =>
              ["running", "preparing"].includes(t.status),
            )}
            onClick={() => setImporting(true)}
          >
            导入备份
          </Button>
          {window.breeze ? (
            <>
              <Button
                icon="folder"
                onClick={() => void window.breeze!.openFolder("data")}
              >
                打开数据目录
              </Button>
              <Button
                icon="folder"
                onClick={() => void window.breeze!.openFolder("models")}
              >
                打开模型目录
              </Button>
            </>
          ) : null}
        </div>
        {importResult ? (
          <p className="import-result" role="status">
            {importResult}
          </p>
        ) : null}
      </section>
      {importing ? (
        <ImportBackup
          close={() => setImporting(false)}
          onDone={(result) => {
            setImportResult(result);
            setImporting(false);
          }}
        />
      ) : null}
      {repair ? (
        <RepairInstall kind={repair} close={() => setRepair(null)} />
      ) : null}
    </div>
  );
}
function RepairInstall({
  kind,
  close,
}: {
  kind: InstallKind;
  close: () => void;
}) {
  const [plan, setPlan] = useState<InstallPlan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const title = steps.find((s) => s[0] === kind)![1];
  useEffect(() => {
    let alive = true;
    void request<InstallPlan>("/api/install-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    })
      .then((p) => {
        if (alive) setPlan(p);
      })
      .catch((e) => {
        if (alive) setError(String(e).replace(/^Error: /, ""));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [kind]);
  const active =
    state
      .get()
      ?.workspace.tasks.filter((t) =>
        ["preparing", "running"].includes(t.status),
      ).length || 0;
  return (
    <Modal
      title={
        busy && !plan
          ? `检查 ${title}`
          : plan?.valid
            ? `${title} 已完整`
            : `修复 ${title}？`
      }
      onClose={() => {
        if (!busy) close();
      }}
    >
      {busy && !plan ? (
        <div className="notice processing" role="status">
          <Icon name="clock" />
          正在检查本地文件与可用性…
        </div>
      ) : null}
      {plan?.valid ? (
        <div className="notice success" role="status">
          <Icon name="check" />
          <span>已有文件完整，已复用；无需重复下载。</span>
        </div>
      ) : null}
      {plan && !plan.valid ? (
        <>
          <p>
            本地资源未通过检查。确认后利用已有文件和缓存修复，缺失内容才下载。
          </p>
          <details className="log-details">
            <summary>查看检查结果</summary>
            <pre>{plan.reason}</pre>
          </details>
          {plan.blockers.length ? (
            <div className="notice warning">
              请先安装并校验：
              {plan.blockers
                .map((k) => steps.find((s) => s[0] === k)![1])
                .join("、")}
              。
            </div>
          ) : (
            <div className="notice warning">
              修复时如模型服务正在运行，将先关闭服务。
              {active ? `当前 ${active} 个生成任务将中断，可稍后重试。` : ""}
              排队任务等待下次启动。 已完成音频保留。
            </div>
          )}
        </>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions end">
        <Button disabled={busy} onClick={close}>
          {plan?.valid ? "完成" : "取消"}
        </Button>
        {plan && !plan.valid && !plan.blockers.length ? (
          <Button
            disabled={busy}
            tone="primary"
            onClick={() => {
              setBusy(true);
              void command({
                type: "install.start",
                value: kind,
                patch: { stopService: true },
              })
                .then(close)
                .catch((e) => {
                  setError(String(e));
                  setBusy(false);
                });
            }}
          >
            {busy ? "提交中…" : "确认修复"}
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
function ImportBackup({
  close,
  onDone,
}: {
  close: () => void;
  onDone: (result: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title="导入工作区备份"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <div className="form-stack">
        <p>
          将备份中的作品、音色、指导和音频作为独立内容导入，保留当前工作区。最大
          500 MB。
        </p>
        <input
          aria-label="选择工作区 ZIP 备份"
          type="file"
          accept=".zip"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="actions end">
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            tone="primary"
            disabled={!file || busy}
            onClick={() => {
              if (!file) return;
              if (file.size > 500_000_000) {
                setError("备份超过 500 MB。");
                return;
              }
              setBusy(true);
              void request<{ imported: { projects: number; outputs: number } }>(
                "/api/backup",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/zip" },
                  body: file,
                },
              )
                .then((r) =>
                  onDone(
                    `已导入 ${r.imported.projects} 个作品、${r.imported.outputs} 份音频。`,
                  ),
                )
                .catch((e) => {
                  setError(String(e));
                  setBusy(false);
                });
            }}
          >
            {busy ? "正在导入…" : "导入备份"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
