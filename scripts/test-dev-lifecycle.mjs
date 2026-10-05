import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createServer } from "vite";
import { superviseDevelopment } from "./dev-session.mjs";

// A real Electron window/host and Vite server; no user workspace or model is opened.
const root = path.resolve(".runtime/dev-exit-review", String(Date.now()));
fs.mkdirSync(root, { recursive: true });
const reservation = httpServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const backendPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
fs.writeFileSync(
  path.join(root, "index.html"),
  '<html><body>开发退出验收<script>setInterval(()=>fetch("/api/snapshot").catch(()=>{}),80)</script></body></html>',
);
fs.writeFileSync(
  path.join(root, "client.cjs"),
  `
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
for(const [key,dir] of Object.entries({userData:"data/desktop",sessionData:"data/session",appData:"data/appdata",temp:"tmp",crashDumps:"data/crashes",downloads:"data/exports"})){const p=path.join(__dirname,dir);fs.mkdirSync(p,{recursive:true});app.setPath(key,p);}
app.setAppLogsPath(path.join(__dirname,"data/logs"));app.commandLine.appendSwitch("disk-cache-dir",path.join(__dirname,"cache"));app.commandLine.appendSwitch("disable-crash-reporter");
let server; app.whenReady().then(async()=>{server=http.createServer((q,r)=>{r.end("{}");});await new Promise(r=>server.listen(${backendPort},"127.0.0.1",r));const w=new BrowserWindow({show:false,webPreferences:{offscreen:true}});await w.loadURL(process.argv[2]);setTimeout(()=>w.close(),700);});
app.on("window-all-closed",()=>app.quit());app.on("before-quit",()=>server?.close());
`,
);
const session = superviseDevelopment(),
  errors = [];
const vite = await createServer({
  configFile: false,
  root,
  cacheDir: path.join(root, "cache/vite"),
  server: {
    host: "127.0.0.1",
    port: 0,
    proxy: { "/api": `http://127.0.0.1:${backendPort}` },
  },
  customLogger: {
    info() {},
    warn() {},
    warnOnce() {},
    error(message) {
      errors.push(message);
    },
    hasWarned: false,
    hasErrorLogged() {
      return false;
    },
    clearScreen() {},
  },
});
session.addCleanup(() => vite.close());
await vite.listen();
const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
const child = spawn(
  path.resolve("node_modules/electron/dist/electron.exe"),
  [path.join(root, "client.cjs"), url],
  {
    windowsHide: true,
    stdio: "pipe",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  },
);
session.watch(child);
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += chunk));
const timer = setTimeout(() => void session.stop(1), 10000);
try {
  const [code] = await once(child, "exit");
  await session.stop();
  assert.equal(code, 0, stderr);
  assert.equal(vite.httpServer.listening, false);
  await assert.rejects(fetch(url));
  assert.equal(
    errors.some((e) => e.includes("ECONNREFUSED")),
    false,
    errors.join("\n"),
  );
  const result = {
    electronExitCode: code,
    viteListenerClosed: true,
    proxyRefusedErrors: 0,
    isolatedRoot: root,
    boundary:
      "Real hidden Electron window and fixture HTTP host; production dev-session supervisor and real Vite. Does not open the user workspace, exercise model inference or certify the real editor close-flush dialog.",
  };
  fs.mkdirSync(".impeccable/review/layout", { recursive: true });
  fs.writeFileSync(
    ".impeccable/review/layout/dev-exit.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(timer);
  await session.stop();
}
