import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { createHost } from "../host/server.ts";
import { PortablePaths } from "../host/paths.ts";
import { registerAudioSave } from "./audio-save.ts";
import { workspaceWindowSize } from "./window-options.ts";

const development = !app.isPackaged;
const closeSmoke = process.argv.includes("--smoke-close");
const sessionSmoke = process.argv.includes("--smoke-session");
const applicationRoot = development
  ? path.resolve(__dirname, "../..")
  : path.dirname(process.execPath);
let root = applicationRoot;
// The isolated lifecycle smoke uses no user workspace or runtime resources.
if (
  development &&
  (closeSmoke || sessionSmoke || process.argv.includes("--smoke")) &&
  process.env.BREEZE_DEV_TEST_ROOT
) {
  const testRoot = fs.realpathSync(process.env.BREEZE_DEV_TEST_ROOT);
  const relative = path.relative(
    path.join(applicationRoot, ".runtime"),
    testRoot,
  );
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("验收目录必须位于项目 .runtime 内。");
  root = testRoot;
}
const paths = new PortablePaths(root);
const env = paths.env();
for (const [key, value] of Object.entries(env))
  if (value !== undefined) process.env[key] = value;
for (const [name, relative] of Object.entries({
  userData: "data/desktop",
  sessionData: "data/desktop/session",
  temp: ".runtime/tmp",
  appData: "data/appdata",
  crashDumps: "data/logs/crashes",
})) {
  const value = paths.inside(relative);
  fs.mkdirSync(value, { recursive: true });
  app.setPath(name as any, value);
}
app.setAppLogsPath(paths.inside("data/logs/desktop"));
app.setPath("downloads", paths.inside("data/exports"));
app.commandLine.appendSwitch(
  "disk-cache-dir",
  paths.inside("data/desktop/cache"),
);
app.commandLine.appendSwitch("disable-crash-reporter");
let host: Awaited<ReturnType<typeof createHost>> | undefined;
let windowRef: BrowserWindow | undefined,
  allowQuit = false;
let quitting = false,
  resourcesClosed = false,
  quitPending: Promise<void> | undefined;
const devIpc =
  development && process.env.BREEZE_DEV_IPC === "1" && !!process.send;
if (devIpc) {
  process.on("message", (value: any) => {
    if (value?.type === "breeze:shutdown") app.quit();
  });
  process.on("disconnect", () => app.quit());
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  void app
    .whenReady()
    .then(async () => {
      host = await createHost(
        root,
        development && process.env.BREEZE_DEV_URL && !devIpc ? 14321 : 0,
        path.join(__dirname, "../renderer"),
        development ? process.env.BREEZE_DEV_URL : undefined,
      );
      if (quitting) {
        await host.close();
        return;
      }
      if (devIpc) {
        await new Promise<void>((resolve, reject) => {
          const done = (error?: Error) => {
            clearTimeout(timer);
            process.off("message", message);
            process.off("disconnect", disconnected);
            error ? reject(error) : resolve();
          };
          const message = (value: any) => {
            if (value?.type === "breeze:renderer-ready") done();
            else if (value?.type === "breeze:shutdown")
              done(Error("启动已取消"));
          };
          const disconnected = () => done(Error("开发启动进程已退出"));
          const timer = setTimeout(
            () => done(Error("等待开发界面启动超时")),
            30000,
          );
          process.on("message", message);
          process.once("disconnect", disconnected);
          process.send!({ type: "breeze:host-ready", address: host!.address });
        });
      }
      if (quitting) return;
      const url = development
        ? process.env.BREEZE_DEV_URL || host.address
        : host.address;
      const allowed = (event: Electron.IpcMainInvokeEvent) => {
        if (
          !event.senderFrame ||
          new URL(event.senderFrame.url).origin !== new URL(url).origin
        )
          throw Error("不允许此来源操作本地文件。");
      };
      ipcMain.handle("reference.pick", async (event) => {
        allowed(event);
        const result = await dialog.showOpenDialog({
          title: "导入参考录音（复制到应用内）",
          properties: ["openFile"],
          filters: [{ name: "WAV 录音", extensions: ["wav"] }],
        });
        if (result.canceled) return null;
        const filename = result.filePaths[0];
        const bytes = fs.readFileSync(filename);
        if (bytes.length > 60_000_000) throw Error("参考录音超过 60 MB。");
        return { name: path.basename(filename), bytes: Uint8Array.from(bytes) };
      });
      ipcMain.handle("folder.open", async (event, kind: string) => {
        allowed(event);
        if (!["data", "models", "root"].includes(kind)) throw Error("目录无效");
        await shell.openPath(paths.inside(kind === "root" ? "." : kind));
      });
      const window = new BrowserWindow({
        ...workspaceWindowSize,
        title: "Breeze \n OpenUI",
        icon: paths.inside("assets/brand/app.ico"),
        backgroundColor: "#f5f7f6",
        autoHideMenuBar: true,
        show: !process.argv.includes("--smoke") && !closeSmoke && !sessionSmoke,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      windowRef = window;
      registerAudioSave(host.repo, () => window, allowed);
      let closePending = false,
        closeTimer: ReturnType<typeof setTimeout> | null = null;
      const finishClose = async (ok: boolean) => {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
        if (!closePending) return;
        if (closeSmoke || sessionSmoke) {
          fs.writeFileSync(
            paths.inside("data/logs/electron-close-smoke.json"),
            JSON.stringify({ flushed: ok, root }),
          );
          if (!ok) {
            allowQuit = true;
            app.exit(1);
            return;
          }
        }
        if (!ok) {
          const choice = await dialog.showMessageBox(window, {
            type: "warning",
            title: "内容尚未保存",
            message: "无法确认所有编辑已保存。",
            detail: "返回检查并保存编辑，或选择退出。未保存的内容可能丢失。",
            buttons: ["返回检查", "退出"],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice.response === 0) {
            closePending = false;
            return;
          }
        }
        allowQuit = true;
        window.close();
      };
      window.on("close", (event) => {
        if (allowQuit || process.argv.includes("--smoke")) return;
        event.preventDefault();
        if (closePending) return;
        closePending = true;
        window.webContents.send("app:before-close");
        closeTimer = setTimeout(() => void finishClose(false), 5000);
      });
      ipcMain.on("app:flushed", (event, ok) => {
        if (event.sender === window.webContents) {
          try {
            allowed(event as any);
            void finishClose(ok === true);
          } catch {}
        }
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, target) => {
        if (new URL(target).origin !== new URL(url).origin)
          event.preventDefault();
      });
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      window.webContents.session.on("will-download", (_event, item) => {
        const name = path
          .basename(item.getFilename())
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
        item.setSavePath(paths.inside(`data/exports/${Date.now()}-${name}`));
        if (closeSmoke)
          item.once("done", (_event, state) => {
            fs.writeFileSync(
              paths.inside("data/logs/electron-download-smoke.json"),
              JSON.stringify({ state, file: item.getSavePath(), root }),
            );
            if (state !== "completed") {
              allowQuit = true;
              app.exit(1);
              return;
            }
            window.close();
          });
      });
      await window.loadURL(url);
      if (closeSmoke)
        window.webContents.downloadURL(host.address + "/api/backup");
      if (process.argv.includes("--smoke")) {
        fs.writeFileSync(
          paths.inside("data/logs/electron-smoke.json"),
          JSON.stringify({
            loaded: true,
            root,
            userData: app.getPath("userData"),
            sessionData: app.getPath("sessionData"),
            temp: app.getPath("temp"),
            version: process.versions.electron,
          }),
        );
        app.quit();
      }
    })
    .catch((e) => {
      allowQuit = true;
      if (devIpc) console.error("OpenUI 无法启动：", String(e));
      else if (!quitting) dialog.showErrorBox("OpenUI 无法启动", String(e));
      app.quit();
    });
}
app.on("before-quit", (event) => {
  if (
    windowRef &&
    !windowRef.isDestroyed() &&
    !allowQuit &&
    !process.argv.includes("--smoke")
  ) {
    event.preventDefault();
    windowRef.close();
    return;
  }
  quitting = true;
  if (host && !resourcesClosed) {
    event.preventDefault();
    quitPending ||= (async () => {
      if (devIpc && process.connected) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            process.off("message", message);
            process.off("disconnect", done);
            resolve();
          };
          const message = (value: any) => {
            if (value?.type === "breeze:frontend-stopped") done();
          };
          const timer = setTimeout(done, 5000);
          process.on("message", message);
          process.once("disconnect", done);
          process.send!({ type: "breeze:host-stopping" });
        });
      }
      await host!.close();
    })()
      .catch((error) => {
        console.error("本地服务关闭失败：", error);
        process.exitCode = 1;
      })
      .then(() => {
        resourcesClosed = true;
        app.quit();
      });
  }
});
app.on("window-all-closed", () => app.quit());
