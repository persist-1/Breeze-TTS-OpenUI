// Targeted brand review, isolated from the user's data and existing releases.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHost } from "../apps/desktop/host/server.ts";
const project = process.cwd();
const root = path.join(project, ".runtime/brand-review", String(Date.now()));
const evidence = path.join(project, ".impeccable/review/brand");
fs.mkdirSync(evidence, { recursive: true });
for (const name of [
  "userData",
  "sessionData",
  "temp",
  "appData",
  "crashDumps",
] as const) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  app.setPath(name, dir);
}
app.setAppLogsPath(path.join(root, "logs"));
app.commandLine.appendSwitch("disk-cache-dir", path.join(root, "cache"));
app.commandLine.appendSwitch("disable-crash-reporter");
async function main() {
  await app.whenReady();
  fs.cpSync(
    path.join(project, "build/renderer"),
    path.join(root, "build/renderer"),
    { recursive: true },
  );
  const host = await createHost(root, 0, path.join(root, "build/renderer"));
  const window = new BrowserWindow({
    show: false,
    width: 1320,
    height: 920,
    icon: path.join(project, "assets/brand/app.ico"),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const errors: string[] = [];
  window.webContents.on("console-message", (event: any) => {
    if (event.level === "error") errors.push(event.message);
  });
  await window.loadURL(host.address);
  const js = (code: string) =>
    window.webContents.executeJavaScript(code).catch((error) => {
      throw Error(String(error) + " / " + errors.join(" / "));
    });
  for (let n = 0; n < 50; n++) {
    if (await js("!!document.querySelector('.brand img')")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!(await js("!!document.querySelector('.brand img')")))
    throw Error(
      "应用未加载：" +
        (await js("document.body.innerText")) +
        " / " +
        errors.join(" / "),
    );
  const results = [];
  for (const width of [1320, 1152]) {
    window.setSize(width, 920);
    await new Promise((r) => setTimeout(r, 400));
    const actual = await js(
      `(()=>{const i=document.querySelector('.brand img'),b=document.querySelector('.brand'),bar=document.querySelector('.topbar');return {text:b.textContent.trim(),image:i.complete&&i.naturalWidth>0,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height,title:document.title,favicon:document.querySelector('link[rel="icon"]').href,overflow:bar.scrollWidth>bar.clientWidth}})()`,
    );
    assert.equal(actual.text, "OpenUI");
    assert.equal(actual.image, true);
    assert.equal(actual.width, 32);
    assert.equal(actual.height, 32);
    assert.equal(actual.overflow, false);
    assert.equal(actual.title, "OpenUI · 语音创作台");
    assert.equal((await fetch(actual.favicon)).status, 200);
    fs.writeFileSync(
      path.join(evidence, `desktop-${width}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
    fs.writeFileSync(
      path.join(evidence, `header-${width}.png`),
      (
        await window.webContents.capturePage({
          x: 0,
          y: 0,
          width: window.getContentSize()[0],
          height: 82,
        })
      ).toPNG(),
    );
    results.push({ width, ...actual });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(evidence, "functional.json"),
    JSON.stringify({ results, errors, isolatedRoot: root }, null, 2),
  );
  window.destroy();
  await host.close();
  console.log(
    "图标、页面标题、favicon、顶部布局在 1320 / 1152 窗口通过，控制台无错误。",
  );
  app.quit();
}
main().catch((error) => {
  console.error(error);
  app.exit(1);
});
