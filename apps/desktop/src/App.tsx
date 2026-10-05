import { lazy, Suspense, useState, useEffect, type ReactNode } from "react";
import { useSnapshot, useError, act, command, report } from "./store.ts";
import { Button, Icon, Modal } from "./ui.tsx";
import type { View } from "../../../packages/contracts/src/index.ts";
import { Studio } from "./Studio.tsx";
const Settings = lazy(() => import("./Settings.tsx"));
const Library = lazy(() => import("./Library.tsx"));
const Tasks = lazy(() => import("./Tasks.tsx"));
const Projects = lazy(() => import("./Projects.tsx"));
const routes: [View, string][] = [
  ["studio", "创作台"],
  ["projects", "作品集"],
  ["voices", "音色库"],
  ["directions", "演绎指导"],
  ["tasks", "生成记录"],
];
const readView = (): View =>
  ["studio", "projects", "voices", "directions", "tasks", "settings"].includes(
    location.hash.slice(1),
  )
    ? (location.hash.slice(1) as View)
    : "studio";
export function App() {
  const snapshot = useSnapshot(),
    error = useError();
  const [view, setView] = useState(readView),
    [modal, show] = useState<ReactNode>(null),
    [servicePending, setServicePending] = useState(false);
  useEffect(() => {
    const change = () => {
      setView(readView());
      show(null);
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  if (!snapshot)
    return (
      <main className="startup">
        <h1>OpenUI</h1>
        <p>{error || "正在打开本地工作区…"}</p>
      </main>
    );
  const service = snapshot.runtime.service;
  const ready = ["uv", "python", "dependencies", "model"].every(
    (k) => snapshot.runtime[k as "uv"].status === "ready",
  );
  const serviceClick = () => {
    const changeService = (type: string) => {
      setServicePending(true);
      void command({ type })
        .catch(() => {})
        .finally(() => setServicePending(false));
    };
    if (service.status === "running") {
      const busy = snapshot.workspace.tasks.some((t) =>
        ["running", "preparing"].includes(t.status),
      );
      if (busy) {
        show(
          <Modal title="关闭模型服务？" onClose={() => show(null)}>
            <p>当前生成将中断。已完成音频保留，排队任务等待下次启动。</p>
            <div className="actions end">
              <Button onClick={() => show(null)}>继续生成</Button>
              <Button
                tone="danger"
                onClick={() => {
                  changeService("service.stop");
                  show(null);
                }}
              >
                关闭服务
              </Button>
            </div>
          </Modal>,
        );
      } else changeService("service.stop");
    } else if (ready) changeService("service.start");
    else location.hash = "settings";
  };
  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href="#studio"
          title="独立社区客户端 · 使用 Breeze-TTS-2 模型"
        >
          <img src="/brand/logo.svg" width="32" height="32" alt="" />
          Breeze TTS OpenUI
        </a>
        <nav aria-label="主导航">
          {routes.map(([id, label]) => (
            <a
              key={id}
              href={"#" + id}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon name={id} />
              {label}
            </a>
          ))}
        </nav>
        <div className="top-actions">
          <Button
            tone={`service ${service.status}`}
            icon={
              ["starting", "stopping"].includes(service.status)
                ? "loader"
                : service.status === "error"
                  ? "alert"
                  : "power"
            }
            disabled={
              servicePending ||
              ["starting", "stopping"].includes(service.status) ||
              !!snapshot.runtime.busy
            }
            onClick={serviceClick}
          >
            {service.status === "running"
              ? "关闭模型服务"
              : service.status === "starting"
                ? "启动中…"
                : service.status === "stopping"
                  ? "关闭中…"
                  : service.status === "error"
                    ? "服务异常 · 重启"
                    : !ready
                      ? "配置模型服务"
                      : "启动模型服务"}
          </Button>
          <a
            className={`button icon-button ${view === "settings" ? "selected" : ""}`}
            href="#settings"
            aria-label="设置"
          >
            <Icon name="settings" />
          </a>
        </div>
      </header>
      {error ? (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
          <Button
            icon="close"
            aria-label="关闭错误提示"
            onClick={() => report("")}
          />
        </div>
      ) : null}
      <main className="workspace">
        <Suspense fallback={<p className="loading">正在打开…</p>}>
          {view === "studio" ? (
            <Studio snapshot={snapshot} show={show} />
          ) : view === "settings" ? (
            <Settings snapshot={snapshot} />
          ) : view === "tasks" ? (
            <Tasks snapshot={snapshot} show={show} />
          ) : view === "projects" ? (
            <Projects snapshot={snapshot} show={show} />
          ) : (
            <Library snapshot={snapshot} kind={view} show={show} />
          )}
        </Suspense>
      </main>
      {modal}
    </>
  );
}
