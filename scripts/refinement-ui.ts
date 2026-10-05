// Isolated Electron integration test. Never opens or edits the user's workspace.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHost } from "../apps/desktop/host/server.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { editWorkspace } from "../apps/desktop/host/domain.ts";
const project = process.cwd(),
  root = path.join(project, ".runtime/ui-review/" + Date.now()),
  evidence = path.join(project, ".impeccable/review/refinement");
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
const screenshots = path.join(evidence, "current");
fs.mkdirSync(screenshots, { recursive: true });
const paths = new PortablePaths(root);
for (const [k, v] of Object.entries(paths.env()))
  if (v !== undefined) process.env[k] = v;
for (const [name, dir] of Object.entries({
  userData: "data/desktop",
  sessionData: "data/desktop/session",
  temp: ".runtime/tmp",
  appData: "data/appdata",
  crashDumps: "data/logs/crashes",
  downloads: "data/exports",
})) {
  fs.mkdirSync(paths.inside(dir), { recursive: true });
  app.setPath(name as any, paths.inside(dir));
}
app.setAppLogsPath(paths.inside("data/logs/desktop"));
app.commandLine.appendSwitch(
  "disk-cache-dir",
  paths.inside("data/desktop/cache"),
);
app.commandLine.appendSwitch("disable-crash-reporter");
fs.copyFileSync(path.join(project, ".runtime/uv/uv.exe"), paths.uv);
fs.cpSync(
  path.join(project, "build/renderer"),
  paths.inside("build/renderer"),
  { recursive: true },
);
const delay = (n = 350) => new Promise((r) => setTimeout(r, n));
async function main() {
  await app.whenReady();
  const host = await createHost(root, 0, paths.inside("build/renderer"));
  while (host.installer.runtime.busy) await delay(80);
  const p = host.repo.workspace.projects[0],
    s = p.segments[0];
  host.repo.transaction((w) => {
    editWorkspace(w, {
      type: "voice.save",
      item: {
        id: "warm",
        kind: "design",
        name: "温暖旁白",
        description: "温暖、清晰的成年男性声音。",
        seed: 42,
      },
    });
    editWorkspace(w, {
      type: "voice.save",
      item: {
        id: "clear",
        kind: "design",
        name: "清澈女声",
        description: "清晰、明亮的成年女性声音。",
        seed: 42,
      },
    });
    editWorkspace(w, {
      type: "direction.save",
      item: {
        id: "story",
        name: "故事讲述",
        instruction: "轻声讲述，节奏舒缓，在转折处自然停顿。",
      },
    });
    editWorkspace(w, {
      type: "segment.update",
      segmentId: s.id,
      patch: {
        name: "开场",
        text: "欢迎来到 Breeze。\n在这里，让文字拥有声音。",
        voiceId: "warm",
        directionEnabled: true,
        directionSource: "preset",
        directionPresetId: "story",
      },
    });
    editWorkspace(w, { type: "segment.create" });
    editWorkspace(w, { type: "segment.open", segmentId: s.id });
  });
  const win = new BrowserWindow({
    show: false,
    width: 1320,
    height: 920,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const errors: string[] = [];
  win.webContents.on("console-message", (event: any) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code: string) => win.webContents.executeJavaScript(code, true);
  const waitFor = async (selector: string) => {
    for (let n = 0; n < 40; n++) {
      if (await js(`!!document.querySelector(${JSON.stringify(selector)})`))
        return;
      await delay(100);
    }
    throw Error("UI did not load: " + selector);
  };
  const click = async (selector: string, text?: string) => {
    await js(
      `(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text ? `e.textContent.trim()===${JSON.stringify(text)}` : "true"});if(!el)throw Error('missing '+${JSON.stringify(selector + " " + (text || ""))});el.click();})()`,
    );
    await delay();
  };
  const input = async (selector: string, value: string) => {
    await js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await delay();
  };
  const capture = async (name: string) => {
    await delay();
    fs.writeFileSync(
      path.join(screenshots, name + ".png"),
      (await win.webContents.capturePage()).toPNG(),
    );
  };
  const assertions: string[] = [];
  function ok(value: unknown, label: string) {
    assert(value, label);
    assertions.push(label);
  }
  try {
    await win.loadURL(host.address + "/#studio");
    await delay(600);
    await js(`console.error('__breeze_console_test_probe__')`);
    await delay(80);
    ok(
      errors.includes("__breeze_console_test_probe__"),
      "Console error capture is active",
    );
    errors.splice(errors.indexOf("__breeze_console_test_probe__"), 1);
    await capture("initial");
    fs.writeFileSync(
      path.join(evidence, "initial-dom.txt"),
      await js("document.body.innerText"),
    );
    ok(
      await js(
        `document.querySelectorAll('.controls-column .selected-material').length===2 && document.querySelectorAll('.controls-column .choice').length===0`,
      ),
      "Studio shows only two selected cards, no expanded choices",
    );
    ok(
      await js(
        `!!document.querySelector('.manuscript .paragraph-tools') && !document.querySelector('.advanced [aria-label="段落上移"]')`,
      ),
      "Paragraph tools belong to manuscript",
    );
    await capture("desktop");
    win.setContentSize(1271, 720);
    await capture("user-1271");
    await click(".selected-material");
    await capture("voice-picker");
    await click("dialog .choice strong", "清澈女声");
    ok(
      await js(
        `document.querySelector('.selected-material').textContent.includes('清澈女声') && !document.querySelector('dialog')`,
      ),
      "Voice selection replaces card and closes picker",
    );
    await click(".selected-material");
    await click("dialog .modal-head button");
    ok(
      host.repo.workspace.projects[0].segments[0].voiceId === "clear",
      "Closing picker preserves selection",
    );
    await click(".paragraph-tools button", "重命名");
    await input("dialog input", p.segments[1].name);
    await capture("duplicate-name");
    ok(
      await js(
        `document.querySelector('dialog .inline-error').textContent.includes('同名') && document.querySelector('dialog button.primary').disabled`,
      ),
      "Duplicate name has local error and blocked save",
    );
    await input("dialog input", "序章");
    await click("dialog button", "保存名称");
    ok(
      host.repo.workspace.projects[0].segments[0].name === "序章",
      "Rename persists",
    );
    await click('button[aria-label="段落下移"]');
    ok(
      host.repo.workspace.projects[0].segments[1].id === s.id,
      "Reorder keeps identity",
    );
    await click('button[aria-label="段落上移"]');
    await click('button[aria-label="删除段落"]');
    await click("dialog button", "取消");
    ok(
      host.repo.workspace.projects[0].segments.length === 2,
      "Delete cancellation preserves paragraph",
    );
    await click('[role="switch"]');
    ok(
      await js(
        `!document.querySelector('textarea[aria-label="演绎描述"]') && document.querySelectorAll('.selected-material').length===1`,
      ),
      "Guidance off hides all guidance inputs",
    );
    await click('[role="switch"]');
    await click(".controls-column section:nth-child(2) .selected-material");
    await capture("direction-picker");
    await click("dialog .choice strong", "故事讲述");
    ok(
      await js(
        `!document.querySelector('dialog') && document.querySelectorAll('.selected-material').length===2`,
      ),
      "Preset selection returns to one immutable selected card",
    );
    await click(
      ".controls-column section:nth-child(2) .segmented button",
      "演绎描述",
    );
    await input('textarea[aria-label="演绎描述"]', "自己的描述");
    await js(
      `(()=>{const e=document.querySelector('textarea[aria-label="演绎描述"]');e.focus();e.setSelectionRange(2,2);e.dispatchEvent(new Event('select',{bubbles:true}));})()`,
    );
    await click(".controls-column button", "插入指导");
    await click("dialog .choice strong", "故事讲述");
    ok(
      await js(
        `document.querySelector('textarea[aria-label="演绎描述"]').value==='自己轻声讲述，节奏舒缓，在转折处自然停顿。的描述'`,
      ),
      "Inserting guidance preserves both sides of original description at caret",
    );
    await click(
      ".controls-column section:nth-child(2) .segmented button",
      "预设演绎",
    );
    await click(".selected-material:nth-of-type(1)");
    await click("dialog .modal-head button");
    win.setContentSize(390, 844);
    await capture("mobile");
    ok(
      await js(`document.documentElement.scrollWidth<=innerWidth`),
      "Mobile has no horizontal overflow",
    );
    await js(
      `document.querySelector('.controls-column .control-panel').scrollIntoView()`,
    );
    await capture("mobile-controls");
    win.setContentSize(1320, 920);
    await win.loadURL(host.address + "/#settings");
    await waitFor(".settings-page");
    await delay(300);
    await capture("settings");
    ok(
      await js(
        `(()=>{const h=document.querySelector('.resource-heading');const a=h.querySelector('h3').getBoundingClientRect(),b=h.querySelector('p').getBoundingClientRect();return Math.abs(a.top-b.top)<8&&getComputedStyle(h.querySelector('h3')).fontSize==='17px'&&getComputedStyle(h.querySelector('p')).fontSize==='14px';})()`,
      ),
      "Settings title and description share a row and original type sizes",
    );
    const uvStamp = fs.statSync(paths.uv).mtimeMs;
    host.installer.runtime.service.status = "running";
    await delay(700);
    ok(
      await js(
        `!document.querySelector('.install-row button').disabled && [...document.querySelectorAll('.install-row button')].find(e=>e.textContent.trim()==='校验').disabled===false`,
      ),
      "Ready repair and validation stay enabled while service runs",
    );
    await click(".install-row button", "重新安装");
    await delay(900);
    await capture("reuse-complete");
    ok(
      await js(
        `document.querySelector('dialog').textContent.includes('无需重复下载')`,
      ),
      "Existing uv passes inspection and shows reuse result",
    );
    await click("dialog button", "完成");
    ok(
      fs.statSync(paths.uv).mtimeMs === uvStamp,
      "Reuse does not rewrite or download uv",
    );
    await click(".install-row button", "下载并安装");
    await delay(800);
    await capture("repair-confirmation");
    await click("dialog button", "取消");
    ok(
      host.installer.runtime.service.status === "running",
      "Cancelling repair never stops service",
    );
    ok(!fs.existsSync(paths.python), "Cancelling repair never installs Python");
    await win.loadURL(host.address + "/#studio");
    await waitFor(".service-notice");
    await delay(300);
    ok(
      await js(
        `document.querySelector('.service-notice').textContent.includes('未通过校验') && [...document.querySelectorAll('.controls-column button')].find(e=>e.textContent.trim()==='生成本段').disabled`,
      ),
      "Running service with invalid resources blocks generation and shows local recovery",
    );
    await js(`document.querySelector('.controls-column section:nth-child(3)').scrollIntoView({block:'end',behavior:'instant'})`);
    await capture("resource-recovery");
    await win.loadURL(host.address + "/#settings");
    await waitFor(".settings-page");
    host.installer.runtime.service.status = "stopped";
    win.setContentSize(390, 844);
    await capture("settings-mobile");
    ok(
      await js(`document.documentElement.scrollWidth<=innerWidth`),
      "Mobile settings has no horizontal overflow",
    );
    ok(errors.length===0,'No application console errors during tested interactions');
    fs.writeFileSync(
      path.join(evidence, "functional.json"),
      JSON.stringify({ root, assertions, errors }, null, 2),
    );
    if (fs.existsSync(path.join(evidence, "failure.txt")))
      fs.unlinkSync(path.join(evidence, "failure.txt"));
    console.log(
      JSON.stringify({ assertions: assertions.length, evidence, errors }),
    );
  } finally {
    host.installer.runtime.service.status = "stopped";
    host.close();
    win.destroy();
    app.quit();
  }
}
void main().catch((e) => {
  fs.writeFileSync(path.join(evidence, "failure.txt"), String(e.stack || e));
  console.error(e);
  app.exit(1);
});
