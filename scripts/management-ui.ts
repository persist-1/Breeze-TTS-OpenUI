// Real renderer, isolated internal workspace. Fixtures are never user data.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHost } from "../apps/desktop/host/server.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { fixedInput, uid } from "../apps/desktop/host/domain.ts";
import { wavHeader } from "../apps/desktop/host/audio.ts";
import type { TaskStatus } from "../packages/contracts/src/index.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CollectionControls } from "../apps/desktop/src/Collection.tsx";
import type { CollectionState } from "../apps/desktop/src/useCollection.ts";

const project = process.cwd();
const root = path.join(
  project,
  ".runtime/management-review",
  String(Date.now()),
);
const evidence = path.join(project, ".impeccable/review/pagination");
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
const paths = new PortablePaths(root);
fs.cpSync(
  path.join(project, "build/renderer"),
  paths.inside("build/renderer"),
  { recursive: true },
);
fs.mkdirSync(paths.inside("build/desktop"), { recursive: true });
fs.copyFileSync(
  path.join(project, "build/desktop/preload.cjs"),
  paths.inside("build/desktop/preload.cjs"),
);
for (const [key, value] of Object.entries(paths.env()))
  if (value !== undefined) process.env[key] = value;
for (const [name, dir] of Object.entries({
  userData: "data/desktop",
  sessionData: "data/desktop/session",
  appData: "data/appdata",
  temp: ".runtime/tmp",
  crashDumps: "data/logs/crashes",
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
const delay = (ms = 160) => new Promise((r) => setTimeout(r, ms));
const assertions: string[] = [];
const captures: string[] = [];
function ok(value: unknown, label: string) {
  assert(value, label);
  assertions.push(label);
}

async function main() {
  await app.whenReady();
  const host = await createHost(root, 0, paths.inside("build/renderer"));
  while (host.installer.runtime.busy) await delay(50);
  const p = structuredClone(host.repo.workspace.projects[0]);
  const s = p.segments[0];
  const assetId = uid();
  const wavFile = paths.inside(`data/references/${assetId}.wav`);
  const pcm = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i * 0.08) * 9000), i * 2);
  fs.writeFileSync(wavFile, Buffer.concat([wavHeader(24000, pcm.length), pcm]));
  host.repo.transaction((w) => {
    w.projects = Array.from({ length: 80 }, (_, i) => ({
      ...structuredClone(p),
      id: i === 0 ? p.id : `project-${i}`,
      title:
        i % 9 === 0
          ? `长名称作品：雨后森林与山谷中的旅行故事 · ${i + 1}`
          : `作品 ${String(i + 1).padStart(2, "0")}`,
      updatedAt: Date.now() - i * 1000,
    }));
    w.voices = Array.from({ length: 80 }, (_, i) => ({
      id: `voice-${i}`,
      name:
        i % 7 === 0
          ? `温柔清晰的成年女性旁白音色 ${i + 1}`
          : `音色 ${String(i + 1).padStart(2, "0")}`,
      kind: i === 0 ? "reference" : "design",
      description: "温暖清晰，低声线，适合缓缓讲述。".repeat(
        i % 7 === 0 ? 40 : 1,
      ),
      seed: 42,
      ...(i === 0
        ? {
            assetId,
            transcript: "欢迎来到雨后的森林。",
            consent: true,
          }
        : {}),
    }));
    w.directions = Array.from({ length: 80 }, (_, i) => ({
      id: `direction-${i}`,
      name:
        i % 7 === 0
          ? `舒缓而有层次的长篇故事演绎指导 ${i + 1}`
          : `指导 ${String(i + 1).padStart(2, "0")}`,
      instruction: "轻声讲述，节奏舒缓，在转折处自然停顿。".repeat(
        i % 7 === 0 ? 40 : 1,
      ),
    }));
    s.text = "窗外的雨滴，一滴滴累积。愿每一段文字都有自己的声音。";
    s.voiceId = w.voices[1].id;
    s.voiceSource = "library";
    s.directionSource = "preset";
    s.directionEnabled = true;
    s.directionPresetId = w.directions[1].id;
    w.projects[0].segments[0] = s;
    w.tasks = Array.from({ length: 80 }, (_, i) => {
      const status: TaskStatus = [
        "completed",
        "queued",
        "interrupted",
        "failed",
        "cancelled",
      ][i % 5] as TaskStatus;
      return {
        id: `task-${i}`,
        projectId: p.id,
        projectTitle: w.projects[0].title,
        createdAt: Date.now() - i * 60000,
        status,
        attempts: 1,
        error:
          status === "failed"
            ? "模型服务异常中断，已完成音频保留。请检查设置后继续。"
            : null,
        events: [{ at: Date.now(), message: "生成记录验收事件" }],
        units: [
          {
            id: `unit-${i}`,
            segmentId: s.id,
            segmentName:
              i % 7 === 0
                ? `开场旁白：在雨后的森林中缓缓讲述 ${i + 1}`
                : `第 ${i + 1} 段`,
            index: 0,
            input: fixedInput(s, w, "fixture"),
            outputId: status === "completed" ? `audio-${i}` : null,
          },
        ],
      };
    });
    w.outputs = w.tasks
      .filter((t) => t.status === "completed")
      .map((t) => ({
        id: t.units[0].outputId!,
        taskId: t.id,
        projectId: p.id,
        segmentId: s.id,
        name: t.units[0].segmentName,
        createdAt: t.createdAt,
        file: `data/references/${assetId}.wav`,
        duration: 1,
        input: t.units[0].input,
        feedback: "",
        truncated: false,
      }));
  });
  const win = new BrowserWindow({
    show: false,
    width: 1320,
    height: 920,
    webPreferences: {
      preload: paths.inside("build/desktop/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const errors: string[] = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = async (source: string) => {
    try {
      return await win.webContents.executeJavaScript(source);
    } catch (error) {
      throw Error(`Renderer action failed: ${source}\n${String(error)}`);
    }
  };
  const wait = async (test: string) => {
    for (let i = 0; i < 60; i++) {
      if (await js(test)) return;
      await delay(100);
    }
    throw Error("UI timeout: " + test);
  };
  const click = async (selector: string) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay();
  };
  const input = async (selector: string, value: string) => {
    await js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await delay();
  };
  const route = async (name: string) => {
    await js(`location.hash=${JSON.stringify(name)}`);
    const title = {
      projects: "作品集",
      voices: "音色库",
      directions: "演绎指导",
      tasks: "生成记录",
    }[name];
    await wait(
      `document.querySelector('.page-head h1')?.textContent===${JSON.stringify(title)}&&!!document.querySelector('.collection-controls')`,
    );
    await delay();
  };
  const searchSelector = (name: string) =>
    name === "projects"
      ? 'input[aria-label="搜索作品"]'
      : name === "tasks"
        ? 'input[aria-label="搜索生成记录"]'
        : 'input[aria-label="搜索名称与内容"]';
  const chooseSize = async (size: number) => {
    await click('[aria-label="每页显示数量"]');
    await click(`[role="option"][aria-label="${size} 项"]`);
  };
  const capture = async (name: string, full = false) => {
    await js("scrollTo(0,0)");
    await delay();
    const [width, height] = win.getContentSize();
    if (full) {
      const total = await js("document.documentElement.scrollHeight");
      win.setContentSize(width, total);
      await delay();
    }
    ok(
      await js("document.documentElement.scrollWidth<=innerWidth"),
      `${name}: no horizontal overflow`,
    );
    const file = path.join(evidence, name + ".png");
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    captures.push(file);
    if (full) {
      win.setContentSize(width, height);
      await delay();
    }
  };
  try {
    await win.loadURL(host.address + "/#projects");
    await wait('!!document.querySelector(".collection-controls")');
    for (const name of ["projects", "voices", "directions", "tasks"]) {
      await route(name);
      await click(".collection-view button:first-child");
      ok(
        await js(
          name === "tasks"
            ? 'document.querySelectorAll(".task-list .task").length===15'
            : 'document.querySelectorAll(".collection-list article").length===15',
        ),
        `${name}: expanded list defaults to 15 records`,
      );
      await capture(`${name}-list-1320`, true);
      await click(".collection-view button:nth-child(2)");
      ok(
        await js(
          'document.querySelectorAll(".collection-grid > article").length===15',
        ),
        `${name}: grid keeps the chosen 15 records`,
      );
      await capture(`${name}-grid-1320`);
      await capture(`${name}-grid-full-1320`, true);
      await chooseSize(30);
      const first = await js(
        '[...document.querySelectorAll(".collection-grid > article h2,.collection-grid > article h3")].map(e=>e.textContent)',
      );
      await click('.collection-controls [aria-label="下一页"]');
      ok(
        await js(
          'document.querySelectorAll(".collection-grid > article").length===30',
        ),
        `${name}: next grid page contains 30 records`,
      );
      const second = await js(
        '[...document.querySelectorAll(".collection-grid > article h2,.collection-grid > article h3")].map(e=>e.textContent)',
      );
      ok(
        new Set([...first, ...second]).size === 60,
        `${name}: pages contain unique records`,
      );
      await click(".collection-view button:first-child");
      ok(
        await js(
          'document.querySelector(".collection-controls [aria-current=page]").textContent==="2"&&document.querySelector("[aria-label=每页显示数量]").title==="30 项"',
        ),
        `${name}: switching views keeps the viewed item range`,
      );
      await input(searchSelector(name), "无法匹配的内容");
      ok(
        await js(
          '!!document.querySelector(".empty")&&!document.querySelector(".collection-grid")&&!document.querySelector(".collection-list")',
        ),
        `${name}: search can produce a clear empty result`,
      );
      ok(
        await js(
          '!document.querySelector(".collection-pagination")&&document.querySelector(".collection-controls .sr-only").textContent.includes("没有")',
        ),
        `${name}: search resets pagination`,
      );
      await input(searchSelector(name), "");
      await click(".collection-view button:nth-child(2)");
      await click('.collection-controls [aria-label="下一页"]');
      await click('.collection-controls [aria-label="下一页"]');
      ok(
        await js(
          'document.querySelectorAll(".collection-grid > article").length===20&&document.querySelector(".collection-controls [aria-label=下一页]").disabled',
        ),
        `${name}: last page has 20 records and prevents overflow`,
      );
      await click('.collection-controls [aria-label="上一页"]');
      await click('.collection-controls [aria-label="上一页"]');
      for (const size of [8, 15, 30]) {
        await chooseSize(size);
        ok(
          await js(
            `document.querySelectorAll('.collection-grid > article').length===${size}`,
          ),
          `${name}: user-selected size ${size} changes actual visible items`,
        );
      }
      await chooseSize(15);
      const allQuery =
        name === "projects"
          ? "作品"
          : name === "voices"
            ? "音色"
            : name === "directions"
              ? "指导"
              : "窗外";
      await input(searchSelector(name), allQuery);
      ok(
        await js(
          "document.querySelector('.collection-count').textContent.includes('匹配')&&document.querySelector('.collection-count').textContent.includes('80')",
        ),
        `${name}: active filter is shown even when all records match`,
      );
      await input(searchSelector(name), "");
      win.setContentSize(1152, 648);
      await delay();
      console.log(
        name,
        "Browse geometry",
        await js(
          "({width:document.querySelector('.collection-size .select-control').getBoundingClientRect().width,heights:[...document.querySelectorAll('.collection-count,.collection-view,.collection-size .select-trigger,.collection-controls .page-buttons')].map(e=>[e.className,e.getBoundingClientRect().height])})",
        ),
      );
      ok(
        await js(
          "Math.abs(document.querySelector('.collection-size .select-control').getBoundingClientRect().width-88)<0.5&&[...document.querySelectorAll('.collection-count,.collection-view,.collection-size .select-trigger,.collection-controls .page-buttons')].every(e=>Math.abs(e.getBoundingClientRect().height-42)<0.5)",
        ),
        `${name}: shared browsing controls keep 88px size select and 42px aligned heights at minimum desktop width`,
      );
      await capture(`${name}-grid-1152`);
      win.setContentSize(1320, 920);
    }
    await route("projects");
    await click('[aria-label="每页显示数量"]');
    await capture("projects-size-menu-1320");
    await click('[role="option"][aria-label="8 项"]');
    for (let i = 0; i < 4; i++)
      await click('.collection-controls [aria-label="下一页"]');
    ok(
      await js(
        "document.querySelector('.collection-controls [aria-current=page]').textContent==='5'&&document.querySelectorAll('.collection-controls button[aria-label^=第]').length<=5&&document.querySelector('.page-gap')!==null",
      ),
      "Middle pages remain bounded, show current page and noninteractive gaps",
    );
    await capture("projects-middle-1320");
    await chooseSize(15);
    ok(
      await js(
        "document.querySelector('.collection-controls [aria-current=page]').textContent==='3'&&document.querySelector('.collection-grid h2').textContent==='作品 31'",
      ),
      "Changing page size anchors the first previously visible item",
    );
    await chooseSize(8);
    win.webContents.focus();
    await js(
      'document.querySelector(".collection-controls [aria-label=第5页]").focus()',
    );
    await delay();
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand(
      "Emulation.setFocusEmulationEnabled",
      { enabled: true },
    );
    await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: "\r",
      unmodifiedText: "\r",
    });
    await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    win.webContents.debugger.detach();
    await delay();
    console.log(
      "Keyboard pagination evidence",
      await js(
        "({focused:document.activeElement?.getAttribute('aria-label'),page:document.querySelector('.collection-controls [aria-current=page]')?.textContent,status:document.querySelector('.collection-controls .sr-only')?.textContent})",
      ),
    );
    ok(
      await js(
        "document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2",
      ),
      "Keyboard page button has a visible focus outline",
    );
    await capture("projects-keyboard-focus-1320");
    win.webContents.debugger.attach("1.3");
    const hover = await js(
      "(()=>{const e=document.querySelector('.collection-controls [aria-current=page]'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x+r.width/2,y:r.y+r.height/2,background:s.backgroundColor,border:s.borderTopColor}})()",
    );
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: hover.x,
      y: hover.y,
    });
    await delay();
    ok(
      await js(
        `(()=>{const e=document.querySelector('.collection-controls [aria-current=page]'),s=getComputedStyle(e);return e.matches(':hover')&&s.backgroundColor===${JSON.stringify(hover.background)}&&s.borderTopColor===${JSON.stringify(hover.border)}})()`,
      ),
      "Real hover preserves the selected page background and border",
    );
    await capture("projects-current-hover-1320");
    win.webContents.debugger.detach();
    ok(
      await js(
        "document.querySelector('.collection-controls [aria-current=page]').textContent==='5'&&document.querySelector('.collection-controls .sr-only').textContent.includes('第5页')",
      ),
      "Real keyboard activation changes page and provides a screen-reader status",
    );
    await click('.collection-controls [aria-label="第10页"]');
    await capture("projects-last-1320");
    await js("scrollTo(0,document.documentElement.scrollHeight)");
    await click('.collection-footer [aria-label="第1页"]');
    ok(
      await js(
        "document.querySelector('.collection-controls [aria-current=page]').textContent==='1'&&document.querySelector('.collection-grid').getBoundingClientRect().top>=0",
      ),
      "Bottom pagination navigates and brings the new content into view",
    );
    await click('.collection-controls [aria-label="下一页"]');
    await click('[aria-label="作品排序"]');
    await click('[role="option"][aria-label="名称顺序"]');
    ok(
      await js(
        "document.querySelector('.collection-controls [aria-current=page]').textContent==='1'",
      ),
      "Changing sort order resets pagination to the first page",
    );
    await click('[aria-label="作品排序"]');
    await click('[role="option"][aria-label="最近编辑"]');
    await route("directions");
    ok(
      await js(
        'document.querySelector("[aria-label=每页显示数量]").title==="15 项"',
      ),
      "Direction page size stays independent from project preference",
    );
    await route("projects");
    ok(
      await js(
        'document.querySelector("[aria-label=每页显示数量]").title==="8 项"',
      ),
      "Page size preference survives route navigation independently",
    );
    await chooseSize(15);
    const allProjects = structuredClone(host.repo.workspace.projects);
    host.repo.transaction((w) => {
      w.projects = w.projects.slice(0, 3);
    });
    await wait(
      "document.querySelector('.collection-count').textContent.includes('3')&&!document.querySelector('.collection-pagination')",
    );
    ok(
      await js(
        "document.querySelector('.collection-count').textContent.replace(/\\s/g,'')==='共3个作品'&&document.querySelector('[aria-label=每页显示数量]')!==null",
      ),
      "Three projects show a styled total and size control without redundant pagination",
    );
    await capture("projects-single-page-1320");
    win.setContentSize(1152, 648);
    await delay();
    await capture("projects-single-page-1152");
    win.setContentSize(1320, 920);
    await input(searchSelector("projects"), "无法匹配");
    await capture("projects-filter-empty-1320");
    host.repo.transaction((w) => {
      w.projects = allProjects;
    });
    await input(searchSelector("projects"), "");
    for (const name of ["voices", "directions", "projects"]) {
      await route(name);
      await click(".collection-view button:nth-child(2)");
      await input(searchSelector(name), "不会匹配新名称的搜索");
      await click(".page-head .button");
      const created = `验收新增${name}`;
      await input("dialog input", created);
      if (name !== "projects")
        await input("dialog textarea", "用于保存后定位的完整内容");
      await click("dialog .actions .primary");
      await wait(
        `!document.querySelector('dialog[open]')&&[...document.querySelectorAll('[data-collection-id] h2')].some(e=>e.textContent===${JSON.stringify(created)})`,
      );
      ok(
        await js(
          `document.querySelector(${JSON.stringify(searchSelector(name))}).value===''&&document.activeElement.dataset.collectionId!==undefined`,
        ),
        `${name}: new item clears obstructing search, reveals its page and receives focus`,
      );
      await input(searchSelector(name), created);
      if (name === "projects")
        await click('[data-collection-id] [aria-label^="重命名"]');
      else await click("[data-collection-id] .actions .button:nth-child(2)");
      const renamed = `已改名${name}`;
      await input("dialog input", renamed);
      await click("dialog .actions .primary");
      await wait(
        `!document.querySelector('dialog[open]')&&[...document.querySelectorAll('[data-collection-id] h2')].some(e=>e.textContent===${JSON.stringify(renamed)})`,
      );
      ok(
        await js(
          `document.querySelector(${JSON.stringify(searchSelector(name))}).value===''&&document.activeElement.dataset.collectionId!==undefined`,
        ),
        `${name}: renaming out of current search preserves discoverability and focus`,
      );
    }
    // Read-only detail access remains useful from the dense browsing view.
    await route("voices");
    await click(".collection-view button:first-child");
    await click(".collection-view button:nth-child(2)");
    while (
      await js(
        'document.querySelector(".collection-controls [aria-current=page]")?.textContent!=="1"',
      )
    )
      await click('.collection-controls [aria-label="上一页"]');
    await click(".library-tile .actions .button:nth-child(2)");
    await wait('!!document.querySelector("dialog[open] .wave-player")');
    ok(
      await js(
        'document.querySelector("dialog textarea").value==="欢迎来到雨后的森林。"',
      ),
      "Reference voice opens complete transcript and real audio audition",
    );
    await capture("reference-inspector");
    await click("dialog .modal-head button");
    host.repo.transaction((w) => {
      w.currentProjectId = p.id;
    });
    await route("tasks");
    await click('[aria-label="作品集范围"]');
    await click('[role="option"][aria-label="全部作品"]');
    await wait('!!document.querySelector(".task-tile")');
    await click('.task-tile [aria-label^="查看"]');
    await wait('!!document.querySelector("dialog .input-snapshot")');
    ok(
      await js(
        '!document.querySelector("dialog .instruction-snapshot").open&&!!document.querySelector("dialog .wave-player")',
      ),
      "Record inspector exposes distinct inputs and audio; full instruction remains collapsed",
    );
    await capture("record-inspector");
    await click("dialog .modal-head button");
    await click('.task-tile:nth-child(2) [aria-label^="查看"]');
    host.repo.transaction((w) => {
      w.tasks[1].status = "interrupted";
      w.tasks[1].error = "验收：模型连接中断";
    });
    await wait(
      'document.querySelector("dialog .badge").textContent.includes("已中断")',
    );
    ok(
      await js(
        'document.querySelector("dialog .inline-error").textContent.includes("模型连接中断")',
      ),
      "An open record inspector follows live task changes",
    );
    await click("dialog .modal-head button");
    await route("voices");
    await chooseSize(30);
    host.repo.transaction((w) => {
      w.voices = w.voices.slice(0, 31);
    });
    await wait(
      'document.querySelector(".collection-count").textContent.includes("31")',
    );
    await click('.collection-controls [aria-label="下一页"]');
    ok(
      await js('document.querySelectorAll(".library-tile").length===1'),
      "Final single-item page is available",
    );
    await click('.library-tile [aria-label^="删除"]');
    await click("dialog .actions .danger");
    await wait(
      '!document.querySelector("dialog[open]")&&document.querySelectorAll(".library-tile").length===30',
    );
    ok(
      await js('!document.querySelector(".collection-pagination")'),
      "Deleting the last item clamps to the last valid page",
    );
    host.repo.transaction((w) => {
      w.voices.push({ ...structuredClone(w.voices[1]), id: uid() });
    });
    await wait(
      "document.querySelector('.collection-count').textContent.includes('31')",
    );
    ok(
      await js(
        "document.querySelector('.collection-controls [aria-current=page]').textContent==='1'",
      ),
      "Adding later data cannot resurrect the previously invalid page",
    );
    host.repo.transaction((w) => {
      w.voices.pop();
    });
    await wait("!document.querySelector('.collection-pagination')");
    await route("directions");
    ok(
      await js(
        'document.querySelector("[aria-label=每页显示数量]").title==="15 项"',
      ),
      "Voice and direction sizes stay independent in the shared library component",
    );
    await route("voices");
    ok(
      await js(
        'document.querySelector(".collection-view button:nth-child(2)").getAttribute("aria-pressed")==="true"',
      ),
      "Per-page view preference survives navigation",
    );
    await win.webContents.reload();
    await wait('!!document.querySelector(".library-tiles")');
    ok(
      await js(
        'document.querySelector(".collection-view button:nth-child(2)").getAttribute("aria-pressed")==="true"',
      ),
      "View preference survives a renderer reload",
    );
    ok(
      await js(
        'document.querySelector("[aria-label=每页显示数量]").title==="30 项"',
      ),
      "Page size preference survives reload",
    );
    const allVoices = structuredClone(host.repo.workspace.voices);
    host.repo.transaction((w) => {
      w.voices = [];
    });
    await wait(
      "document.querySelector('.collection-count').textContent.includes('0')&&!!document.querySelector('.empty')",
    );
    ok(
      await js(
        "!document.querySelector('.collection-pagination')&&!!document.querySelector('[aria-label=每页显示数量]')",
      ),
      "An empty library retains useful controls without fake page navigation",
    );
    await capture("voices-empty-1320");
    host.repo.transaction((w) => {
      w.voices = allVoices;
    });
    await wait('!!document.querySelector(".library-tiles")');
    for (const name of ["voices", "tasks"]) {
      await route(name);
      win.setContentSize(390, 844);
      await delay();
      await capture(`${name}-grid-narrow`);
      win.setContentSize(1320, 920);
    }
    ok(errors.length === 0, "No renderer console errors in tested flows");
    // Render the production component with synthetic page totals; no giant database or user data.
    await route("projects");
    for (const current of [1, 500000, 1000000]) {
      const markup = renderToStaticMarkup(
        createElement(CollectionControls, {
          collection: {
            view: "grid",
            page: current,
            pages: 1000000,
            size: 8,
            start: (current - 1) * 8,
            end: current * 8,
            total: 8000000,
            items: [],
            region: { current: null },
            setView() {},
            setPage() {},
            setSize() {},
            reveal() {},
          } as CollectionState,
          noun: "个作品",
          total: 8000000,
        }),
      );
      await js(
        `document.querySelector('.collection-controls').outerHTML=${JSON.stringify(markup)}`,
      );
      win.setContentSize(1152, 648);
      await delay();
      ok(
        await js(
          "document.querySelectorAll('.collection-controls button[aria-label^=第]').length<=5&&[...document.querySelectorAll('.collection-controls button')].every(e=>e.scrollWidth<=e.clientWidth)&&document.documentElement.scrollWidth<=innerWidth",
        ),
        `One million pages at ${current}: bounded production markup fits minimum desktop width without clipping digits`,
      );
      await capture(`projects-million-page-${current}-1152`);
    }
    fs.rmSync(path.join(evidence, "failure.txt"), { force: true });
    fs.writeFileSync(
      path.join(evidence, "functional.json"),
      JSON.stringify(
        {
          root,
          assertions,
          captures,
          errors,
          note: "80 isolated fixture objects per management route; real PCM file for audio inspection, no model inference. Narrow web stress capture is not a supported desktop window size.",
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ assertions: assertions.length, evidence, errors }),
    );
  } finally {
    await host.close();
    win.destroy();
    app.quit();
  }
}
void main().catch((error) => {
  fs.writeFileSync(
    path.join(evidence, "failure.txt"),
    String(error.stack || error),
  );
  console.error(error);
  app.exit(1);
});
