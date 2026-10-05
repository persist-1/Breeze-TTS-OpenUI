import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createHost } from "../apps/desktop/host/server.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
const evidence = path.resolve(".impeccable/review/refinement"),
  root = JSON.parse(
    fs.readFileSync(path.join(evidence, "functional.json"), "utf8"),
  ).root,
  p = new PortablePaths(root);
for (const [k, v] of Object.entries(p.env()))
  if (v !== undefined) process.env[k] = v;
for (const [key, value] of Object.entries({
  userData: "data/capture",
  sessionData: "data/capture/session",
  temp: ".runtime/tmp",
  appData: "data/appdata",
  crashDumps: "data/logs/crashes",
})) {
  fs.mkdirSync(p.inside(value), { recursive: true });
  app.setPath(key as any, p.inside(value));
}
app.setAppLogsPath(p.inside("data/logs/capture"));
app.commandLine.appendSwitch("disk-cache-dir", p.inside("data/capture/cache"));
async function main() {
  await app.whenReady();
  const host = await createHost(root, 0, p.inside("build/renderer"));
  const win = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        sandbox: true,
      },
    }),
    js = (s: string) => win.webContents.executeJavaScript(s, true),
    delay = (n: number) => new Promise((r) => setTimeout(r, n));
  try {
    await win.loadURL(host.address + "/#studio");
    for (let n = 0; n < 60; n++) {
      if (await js(`!!document.querySelector('.selected-material')`)) break;
      await delay(100);
    }
    await delay(300);
    const before = await js(
      `JSON.stringify({y:scrollY,height:document.documentElement.scrollHeight,rect:document.querySelector('.controls-column .control-panel').getBoundingClientRect().toJSON(),overflow:getComputedStyle(document.documentElement).overflow})`,
    );
    await js(
      `document.activeElement.blur();document.querySelector('.controls-column .control-panel').scrollIntoView({block:'start',behavior:'instant'});`,
    );
    await delay(400);
    const after = await js(
      'JSON.stringify({y:scrollY,rect:document.querySelector(".controls-column .control-panel").getBoundingClientRect().toJSON()})',
    );
    fs.writeFileSync(
      path.join(evidence, "mobile-controls-content.png"),
      (
        await win.webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
      ).toPNG(),
    );
    fs.writeFileSync(
      path.join(evidence, "capture-state.json"),
      JSON.stringify({ before, after, final: await js("scrollY") }, null, 2),
    );
    win.setContentSize(1320, 920);
    await win.loadURL(host.address + "/#settings");
    for (let n = 0; n < 60; n++) {
      if (await js(`!!document.querySelector('.resource-heading')`)) break;
      await delay(100);
    }
    await delay(400);
    fs.writeFileSync(
      path.join(evidence, "settings-final.png"),
      (
        await win.webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
      ).toPNG(),
    );
    console.log("Captured loaded settings and mobile controls.");
  } finally {
    host.close();
    win.destroy();
    app.quit();
  }
}
void main().catch((e) => {
  console.error(e);
  app.exit(1);
});
