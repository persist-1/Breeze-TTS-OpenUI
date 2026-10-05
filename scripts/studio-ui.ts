// Isolated Electron integration test. Never opens or edits the user's workspace.
import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHost } from "../apps/desktop/host/server.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { editWorkspace, fixedInput, uid } from "../apps/desktop/host/domain.ts";
import { wavHeader } from "../apps/desktop/host/audio.ts";
import { registerAudioSave } from "../apps/desktop/electron/audio-save.ts";
import { workspaceWindowSize } from "../apps/desktop/electron/window-options.ts";
const project = process.cwd(),
  root = path.join(project, ".runtime/ui-review/" + Date.now()),
  evidence = path.join(project, process.argv.includes("--record-confirm") ? ".impeccable/review/record-input" : process.argv.includes("--setup-confirm") ? ".impeccable/review/settings-clarity" : ".impeccable/review/space-balance");
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
fs.mkdirSync(paths.inside("build/desktop"), { recursive: true });
fs.copyFileSync(
  path.join(project, "build/desktop/preload.cjs"),
  paths.inside("build/desktop/preload.cjs"),
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
  const asset = uid(),
    pcm = Buffer.alloc(16000 * 4 * 2);
  for (let i = 0; i < 16000 * 4; i++) {
    const amp = i < 16000 ? 0.2 : i < 24000 ? 0 : i < 48000 ? 0.65 : 0.08;
    pcm.writeInt16LE(Math.round(Math.sin(i * 0.2) * amp * 32767), i * 2);
  }
  const wav = Buffer.concat([wavHeader(16000, pcm.length), pcm]);
  fs.writeFileSync(paths.inside("data/references/" + asset + ".wav"), wav);
  host.repo.transaction((w) => {
    w.tasks.push({
      id: "fixture",
      projectId: p.id,
      projectTitle: p.title,
      createdAt: 0,
      status: "completed",
      attempts: 1,
      units: [
        {
          id: "unit-fixture",
          segmentId: s.id,
          segmentName: s.name,
          index: 0,
          input: fixedInput(s, w, "fixture"),
          outputId: "wave-fixture",
        },
      ],
      error: null,
      events: [],
    });
    w.outputs.push({
      id: "wave-fixture",
      taskId: "fixture",
      projectId: p.id,
      segmentId: s.id,
      name: "波形验收音频",
      createdAt: 0,
      file: "data/references/" + asset + ".wav",
      duration: 4,
      input: fixedInput(s, w, "fixture"),
      feedback: "",
      truncated: false,
    });
  });
  const win = new BrowserWindow({
    show: false,
    ...workspaceWindowSize,
    webPreferences: {
      preload: paths.inside("build/desktop/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  let chooserCalls = 0,
    chooserOptions: any,
    chooserParent: any;
  let chooser: () => Promise<{
    canceled: boolean;
    filePath?: string;
  }> = async () => ({ canceled: true });
  dialog.showSaveDialog = (async (parent: any, options: any) => {
    chooserCalls++;
    chooserParent = parent;
    chooserOptions = options;
    return chooser();
  }) as typeof dialog.showSaveDialog;
  registerAudioSave(
    host.repo,
    () => win,
    (event) => {
      assert.equal(new URL(event.senderFrame!.url).origin, host.address);
    },
  );
  const errors: string[] = [];
  win.webContents.on("console-message", (event: any) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code: string) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw Error(
        String(error) +
          "\nRenderer expression: " +
          code +
          "\nConsole: " +
          errors.join("\n"),
      );
    });
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

  const key = async (selector: string, key: string, alt = false) => {
    await js(
      "document.querySelector(" + JSON.stringify(selector) + ").focus()",
    );
    win.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: key,
      modifiers: alt ? ["alt"] : [],
    });
    win.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: key,
      modifiers: alt ? ["alt"] : [],
    });
    await delay();
  };
  const nativeDouble = async (selector: string) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center"})`);
    await delay(50);
    const rect = await js(
      "(()=>{const r=document.querySelector(" +
        JSON.stringify(selector) +
        ").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()",
    );
    for (const count of [1, 2]) {
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: count,
        ...rect,
      });
      win.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: count,
        ...rect,
      });
      await delay(65);
    }
    await delay();
  };
  const drag = async (from: string, to: string, after = true, drop = true) => {
    await js(
      "(()=>{const a=document.querySelector(" +
        JSON.stringify(from) +
        "),b=document.querySelector(" +
        JSON.stringify(to) +
        '),r=b.getBoundingClientRect(),dt=new DataTransfer();a.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.top+r.height*' +
        (after ? ".75" : ".25") +
        "}));" +
        (drop
          ? 'b.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.top+r.height*' +
            (after ? ".75" : ".25") +
            "}));"
          : "") +
        'a.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:dt}));})()',
    );
    await delay();
  };
  const listFlows = async () => {
    win.setContentSize(1320, 920);
    host.repo.transaction((w) => {
      for (let n = 1; n <= 8; n++) {
        editWorkspace(w, {
          type: "voice.save",
          item: {
            id: `many-voice-${n}`,
            name: `声音 ${n}`,
            kind: "design",
            description: `第 ${n} 种声音，清晰自然。`,
            seed: 42,
          },
        });
        editWorkspace(w, {
          type: "direction.save",
          item: {
            id: `many-direction-${n}`,
            name: `指导 ${n}`,
            instruction: `第 ${n} 份完整指导，语气平和，节奏舒缓。`,
          },
        });
        editWorkspace(w, {
          type: "project.create",
          patch: { title: `列表作品 ${n}` },
        });
      }
      editWorkspace(w, { type: "project.open", projectId: p.id });
      for (let n = 0; n < 20; n++)
        editWorkspace(w, { type: "segment.create", projectId: p.id });
    });
    const limited = async (selector: string) => {
      const result = await js(
        `(()=>{const a=document.querySelector(${JSON.stringify(selector)}),r=a.getBoundingClientRect(),visible=[...a.children].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>r.top+4&&b.top<r.bottom-4;});return {count:a.children.length,visible:visible.length,scroll:a.scrollHeight,client:a.clientHeight,cap:a.style.getPropertyValue("--item-limit-height"),height:getComputedStyle(a).maxHeight,scrollTop:a.scrollTop,rows:[...a.children].slice(0,7).map(e=>({top:e.getBoundingClientRect().top-r.top,bottom:e.getBoundingClientRect().bottom-r.top}))};})()`,
      );
      const pass =
        result.count > 5 &&
        result.visible <= 5 &&
        result.scroll > result.client;
      if (!pass) console.log(selector, result);
      return pass;
    };
    await win.loadURL(host.address + "/#studio");
    await waitFor(".segment-rail");
    await waitFor(".rail-segment:nth-child(6)");
    await delay(200);
    await js(
      'window.scrollTo(0,0);document.querySelector(".rail-list").scrollTop=0',
    );
    ok(
      await js('(()=>{const e=document.querySelector(".rail-list"),r=e.getBoundingClientRect(),a=document.querySelector(".rail-actions").getBoundingClientRect(),v=[...e.children].filter(c=>{const b=c.getBoundingClientRect();return b.bottom>r.top+4&&b.top<r.bottom-4});return v.length>5&&e.scrollHeight>e.clientHeight&&a.top-r.bottom<=26&&Math.abs(e.closest(".segment-rail").getBoundingClientRect().bottom-a.bottom)<18;})()'),
      "Segment list fills the available column, shows more than five rows and scrolls excess above anchored actions",
    );
    await capture("studio-space-segments");
    await click("#project-picker");
    await capture("projects-dropdown-five");
    ok(
      await limited(".select-menu"),
      "Project dropdown shows at most five choices",
    );
    await capture("projects-dropdown-five");
    await js(
      'document.querySelector("#project-picker").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))',
    );
    await delay(100);
    ok(
      await js(
        '(()=>{const a=document.querySelector(".select-menu"),b=a.querySelector(".active").getBoundingClientRect(),r=a.getBoundingClientRect();return a.scrollTop>0&&b.bottom<=r.bottom;})()',
      ),
      "Keyboard End reveals the last dropdown choice inside its list",
    );
    await js(
      'document.querySelector("#project-picker").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
    );
    await click(".selected-material");
    ok(
      await limited("dialog .choices"),
      "Voice picker caps five entries including its default choice",
    );
    await capture("voices-five");
    await click('dialog button[aria-label="关闭"]');
    await click(".controls-column section:nth-child(2) .selected-material");
    ok(
      await limited("dialog .choices"),
      "Preset guidance picker caps five entries",
    );
    await capture("directions-five");
    await click('dialog button[aria-label="关闭"]');
    for (const [route, selector] of [
      ["projects", ".projects-list"],
      ["voices", ".library-grid"],
      ["directions", ".direction-list"],
    ]) {
      await win.loadURL(host.address + "/#" + route);
      await waitFor(selector);
      await delay(180);
      ok(await js(`document.querySelector(${JSON.stringify(selector)}).scrollTop===0`), `${route} management opens at the top of its own list`);
      ok(
        await limited(selector),
        `${route} management keeps at most five entries in its scrolling list`,
      );
      await capture(route + "-many");
      await js(
        `document.querySelector(${JSON.stringify(selector)}).scrollTop=99999`,
      );
      ok(
        await js(
          `(()=>{const a=document.querySelector(${JSON.stringify(selector)}),b=a.lastElementChild.getBoundingClientRect(),r=a.getBoundingClientRect();return b.bottom<=r.bottom+1&&b.bottom>r.top;})()`,
        ),
        `${route} last item remains reachable by scrolling`,
      );
    }
    ok(
      errors.length === 0,
      "No application console errors after the five-item list flows",
    );
  };
  const frameFlows = async () => {
    const joined = () => js('(()=>{const a=[".segment-rail",".manuscript",".controls-column"].map(s=>document.querySelector(s).getBoundingClientRect());return a.every(r=>Math.abs(r.top-a[0].top)<1&&Math.abs(r.bottom-a[0].bottom)<1)&&Math.abs(a[0].right-a[1].left)<1&&Math.abs(a[1].right-a[2].left)<1;})()');
    for (const [width,height] of [[1320,920],[1152,648],[1271,720]]) {
      win.setContentSize(width,height);
      await delay();
      ok(await joined(), `Editing frame shares top/bottom and joins without gaps at ${width}x${height}`);
      await capture(`frame-${width}`);
    }
    const before = await js('document.querySelector(".manuscript").getBoundingClientRect().height');
    await input('textarea[aria-label="待合成文稿"]', '这是需要反复编辑的长文稿，每段都有完整内容。\n'.repeat(120));
    await click('.voice-panel .segmented button', '音色描述');
    await input('textarea[aria-label="音色描述"]', '清晰、自然的声音，保留细节。\n'.repeat(60));
    await click('.guidance-panel .segmented button', '演绎描述');
    await input('textarea[aria-label="演绎描述"]', '以舒缓节奏讲述，句间适度停顿。\n'.repeat(60));
    ok(await js('(()=>{const a=document.querySelector(".voice-content textarea").getBoundingClientRect(),b=document.querySelector(".guidance-content textarea").getBoundingClientRect();return Math.abs(a.height-b.height)<1&&Math.abs(a.width-b.width)<1;})()'), 'Voice and guidance description fields have equal height and width');
    ok(await js('!document.querySelector(".editor-footer .badge")&&!document.querySelector(".editor-footer").textContent.includes("保存中")'), 'Typing keeps the manuscript footer quiet');
    await delay(650);
    ok(host.repo.workspace.projects.find(x=>x.id===p.id)!.segments.find(x=>x.id===s.id)!.text.includes('这是需要反复编辑的长文稿'), 'Quiet autosave still persists the manuscript');
    ok(await joined() && await js('document.querySelector(".manuscript").getBoundingClientRect().height') === before, 'Long descriptions and manuscript preserve the shared editing frame height');
    ok(await js('[...document.querySelectorAll(".studio-layout textarea")].filter(e=>e.closest(".manuscript,.material-editor")).every(e=>e.scrollHeight>e.clientHeight&&getComputedStyle(e).resize==="none")'), 'Long content scrolls within all three editors; no free resize handle');
    ok(await js('(()=>{const p=document.querySelector(".guidance-panel").getBoundingClientRect(),a=document.querySelector(".guidance-content .actions").getBoundingClientRect();return a.bottom<=p.bottom&&a.top>=p.top&&document.querySelector(".guidance-content").scrollHeight<=document.querySelector(".guidance-content").clientHeight+1;})()'), 'Guidance save and insert remain visible without scrolling the form');
    ok(await js('(()=>{const p=document.querySelector(".voice-panel").getBoundingClientRect(),a=document.querySelector(".voice-content > .button").getBoundingClientRect();return a.bottom<=p.bottom&&a.top>=p.top&&document.querySelector(".voice-content").scrollHeight<=document.querySelector(".voice-content").clientHeight+1;})()'), 'Voice save stays visible with the long description');
    await js('window.scrollTo(0,document.querySelector(".segment-rail").offsetTop-24)');
    await capture('frame-long-descriptions');
    await js('for(const e of document.querySelectorAll(".manuscript-editor,.material-editor textarea"))e.scrollTop=e.scrollHeight');
    ok(await js('[...document.querySelectorAll(".manuscript-editor,.material-editor textarea")].every(e=>e.scrollTop>0)'), 'Each long editor can reach its own end');
    await capture('frame-long-scrolled');
    await click('.guidance-panel [role=switch]');
    ok(await joined() && await js('document.querySelector(".manuscript").getBoundingClientRect().height') === before && await js('!document.querySelector(".guidance-content,.guidance-panel .segmented")'), 'Guidance off removes inputs without moving the frame or generation');
    await capture('frame-guidance-off');
    await click('.guidance-panel [role=switch]');
    await input('textarea[aria-label="待合成文稿"]', '欢迎来到 Breeze。\n在这里，让文字拥有声音。');
    await input('textarea[aria-label="音色描述"]', '');
    await input('textarea[aria-label="演绎描述"]', '');
    await click('.voice-panel .segmented button', '音色库');
    await click('.guidance-panel .segmented button', '预设演绎');
    ok(await joined(), 'Returning to saved material cards keeps the shared frame');
    await js('window.scrollTo(0,0)');
  };
  try {
    if (process.argv.includes("--record-confirm")) {
      host.repo.transaction(w => { w.projects[0].title = "讲解员读稿与角色配音的长作品名称"; w.tasks[0].projectTitle = w.projects[0].title; });
      for (const [width,height] of [[1320,920],[1152,648]]) {
        win.setContentSize(width,height);
        await win.loadURL(host.address + "/?record-width=" + width + "#tasks");
        await waitFor(".task");
        await delay();
        ok(await js('!!document.querySelector(".input-snapshot")&&document.querySelector(".task-detail-actions .button").getAttribute("aria-expanded")==="true"'), `Record input is visible on arrival at ${width}`);
        await js('window.scrollTo(0,0)');
        await delay();
        ok(await js('getComputedStyle(document.querySelector(".record-toolbar")).backgroundColor==="rgb(255, 255, 255)"&&document.querySelectorAll(".record-toolbar .filter-label svg").length===3'), `Filters have a shared white surface and labeled icons at ${width}`);
        ok(await js('document.documentElement.scrollWidth<=innerWidth'), `Records fit ${width} without horizontal overflow`);
        await capture(`filters-${width}`);
        await js('(()=>{const b=document.querySelector(".task-detail-actions .button");if(b.getAttribute("aria-expanded")!=="true")b.click()})()');
        await waitFor('.input-snapshot');
        ok(await js('!document.querySelector(".input-snapshot .instruction-snapshot").open'), `Complete model instruction starts collapsed at ${width}`);
        ok(await js('(()=>{const e=document.querySelector(".input-snapshot"),v=e.querySelector("section[aria-label=使用音色]"),g=e.querySelector("section[aria-label=演绎指导]");return v.textContent.includes("温暖旁白")&&v.textContent.includes("温暖、清晰")&&!v.textContent.includes("节奏舒缓")&&g.textContent.includes("节奏舒缓")&&!g.textContent.includes("成年男性")})()'), `Voice and guidance are distinct saved inputs at ${width}`);
        await js('document.querySelector(".input-snapshot").scrollIntoView({block:"center"})');
        await capture(`input-${width}`);
        await click('.input-snapshot .instruction-snapshot summary');
        ok(await js(`document.querySelector(".input-snapshot .instruction-snapshot").open&&document.querySelector(".input-snapshot .instruction-snapshot .snapshot-copy").textContent===${JSON.stringify(host.repo.workspace.tasks[0].units[0].input.instruction)}`), `Expanded instruction preserves the exact submitted text at ${width}`);
        await js('document.querySelector(".instruction-snapshot").scrollIntoView({block:"center"})');
        await capture(`instruction-${width}`);
        await click('.input-snapshot .instruction-snapshot summary');
        await js('document.querySelector(".output-details").open=true; document.querySelector(".output-input").scrollIntoView({block:"center"})');
        await capture(`audio-input-${width}`);
        ok(await js('document.querySelector(".output-input section[aria-label=使用音色]").textContent.includes("温暖、清晰")&&document.querySelector(".output-input section[aria-label=演绎指导]").textContent.includes("节奏舒缓")'), `Audio detail uses the same separated layout at ${width}`);
      }
      const base = structuredClone(host.repo.workspace.tasks[0].units[0].input);
      const cases = [
        {name:"descriptions-long",input:{...base,text:"长文稿包含独立换行。\n".repeat(60),voiceName:"自由描述",instruction:"声音原文\n指导原文",presentation:{voiceSource:"description",voiceDescription:"低沉清晰的声音。\n".repeat(35),directionSource:"description",directionEnabled:true,direction:"缓慢而有层次地讲述。\n".repeat(35)}}},
        {name:"reference",input:{...base,reference:{assetId:asset,name:"角色参考录音",transcript:"这是参考录音逐字稿。"},instruction:"轻声讲述",presentation:{voiceSource:"library",voiceDescription:"",directionSource:"description",directionEnabled:true,direction:"轻声讲述"}}},
        {name:"default-off",input:{...base,voiceName:"默认声音",instruction:"",presentation:{voiceSource:"library",voiceDescription:"",directionSource:"description",directionEnabled:false,direction:""}}},
        {name:"legacy",input:{...base,instruction:"旧记录的声音与指导原文，不能通过换行猜测边界。",presentation:undefined}},
      ];
      win.setContentSize(1320,920);
      for (const c of cases) {
        host.repo.transaction(w => { w.tasks[0].units[0].input=c.input as any; w.outputs[0].input=c.input as any; });
        await win.loadURL(host.address + "/?record-case=" + c.name + "#tasks");
        await waitFor('.task');
        await delay(700);
        await js('(()=>{const b=document.querySelector(".task-detail-actions .button");if(b.getAttribute("aria-expanded")!=="true")b.click()})()');
        await waitFor('.input-snapshot');
        if(c.name==='reference') { await click('.input-snapshot .reference-snapshot summary'); ok(await js('document.querySelector(".input-snapshot .reference-snapshot").textContent.includes("这是参考录音逐字稿。")&&!document.querySelector(".input-snapshot section[aria-label=使用音色]").textContent.includes("默认声音")'), 'Reference input keeps its name and transcript, not a default voice label'); }
        if(c.name==='default-off') ok(await js('document.querySelector(".input-snapshot section[aria-label=演绎指导]").textContent.includes("未启用")&&document.querySelector(".input-snapshot section[aria-label=使用音色]").textContent.includes("默认声音")'), 'No description and disabled guidance have explicit accurate states');
        if(c.name==='legacy') ok(await js('!document.querySelector(".input-snapshot .instruction-snapshot").open&&document.querySelector(".input-snapshot section[aria-label=演绎指导]").textContent.includes("无法准确还原")&&!document.querySelector(".input-snapshot section[aria-label=使用音色]").textContent.includes("见下方")'), 'Historical missing fields are explicit; combined text stays collapsed');
        if(c.name==='descriptions-long') { ok(await js('[...document.querySelectorAll(".input-snapshot .snapshot-fields .snapshot-copy")].every(e=>e.scrollHeight>e.clientHeight)'), 'Long manuscript, voice and guidance have bounded scrolling'); await js('document.querySelectorAll(".input-snapshot .snapshot-fields .snapshot-copy").forEach(e=>e.scrollTop=e.scrollHeight)'); ok(await js('[...document.querySelectorAll(".input-snapshot .snapshot-fields .snapshot-copy")].every(e=>e.scrollTop>0)'), 'Every long input can scroll to its end'); }
        await js('document.querySelector(".input-snapshot").scrollIntoView({block:"center"})');
        await capture(c.name);
        if(c.name==='legacy') { await click('.input-snapshot .instruction-snapshot summary'); ok(await js('document.querySelector(".input-snapshot .instruction-snapshot").open&&document.querySelector(".input-snapshot .instruction-snapshot .snapshot-copy").textContent.includes("不能通过换行猜测边界")'), 'Click opens the unchanged historical model instruction'); await js('document.querySelector(".instruction-snapshot").scrollIntoView({block:"center"})'); await capture('legacy-expanded'); }
        ok(await js('document.documentElement.scrollWidth<=innerWidth'), `${c.name} does not overflow horizontally`);
      }
      await input('.record-toolbar input','不存在的文稿');
      ok(await js('!document.querySelector(".task")&&document.body.textContent.includes("没有符合筛选的任务")'), 'Search still filters actual records');
      await click('.empty .button','清除筛选');
      await waitFor('.task');
      await click('.record-toolbar [aria-label="任务状态"]');
      await click('.select-menu [role=option][aria-label="需要继续"]');
      ok(await js('!document.querySelector(".task")'), 'Status dropdown still filters tasks');
      ok(errors.length===0,'No console errors in record and audio input flows');
      fs.writeFileSync(path.join(evidence,'functional.json'),JSON.stringify({assertions,errors,notes:['Isolated recorded input fixtures and PCM audio; no model downloads or user workspace changes. Actual Electron sizes 1320x920 and 1152x648.']},null,2));
      fs.rmSync(path.join(evidence,'failure.txt'),{force:true});
      console.log(JSON.stringify({assertions:assertions.length,errors,evidence}));
      return;
    }
    if (process.argv.includes("--setup-confirm")) {
      win.setContentSize(1320, 920);
      await win.loadURL(host.address + "/#settings");
      await waitFor(".settings-page");
      while (host.installer.runtime.busy) await delay(100);
      const kinds = ["uv", "python", "dependencies", "model"] as const;
      const checkUnlock = async (complete: number) => {
        for (const [index, kind] of kinds.entries()) {
          Object.assign(host.installer.runtime[kind], { status: index < complete ? "ready" : "missing", error: undefined });
        }
        await delay(900);
        const allowed = await js('[...document.querySelectorAll(".install-row")].map(row=>[...row.querySelectorAll(".actions button")].every(b=>!b.disabled))');
        ok(JSON.stringify(allowed) === JSON.stringify(kinds.map((_, index) => index <= complete)), `Only completed resources and the next step are actionable after ${complete} completed steps`);
      };
      for (const complete of [0, 1, 2, 3, 4]) await checkUnlock(complete);
      ok(await js('document.querySelectorAll(".resource-path .path-label").length===4&&[...document.querySelectorAll(".resource-path code")].every(e=>e.textContent.trim().length>0)'), 'Four resource paths have explicit installation labels and preserved values');
      host.installer.runtime.service.status = "running";
      await delay(900);
      ok(await js('[...document.querySelectorAll(".install-row .actions button")].every(b=>!b.disabled)'), 'Ready resources remain recheckable and reinstallable while service runs');
      host.installer.runtime.service.status = "stopped";
      for (const kind of kinds) Object.assign(host.installer.runtime[kind], { status: "missing", error: undefined });
      await delay(900);
      await capture("settings-initial");
      // Real internal uv check, followed by a genuinely missing isolated Python.
      await click('.install-row[data-resource="uv"] button', "校验");
      await delay(900);
      ok(await js('!!document.querySelector(".validation-feedback.success")'), 'Actual internal uv validates and unlocks Python');
      await click('.install-row[data-resource="python"] button', "校验");
      await delay(650);
      ok(await js('!!document.querySelector(".validation-feedback.failure")&&[...document.querySelectorAll(".install-row[data-resource=dependencies] button")].every(b=>b.disabled)'), 'Missing Python reports failure and keeps dependent operations locked');
      await capture("settings-validation-failed");
      await js('document.querySelector(".install-row[data-resource=model]").scrollIntoView({block:"center"})');
      await capture("settings-model-locked");
      host.repo.transaction(w => {
        const project = w.projects[0];
        project.title = "这是一个很长的作品名称用于下拉测试";
        for (let n = 1; n <= 8; n++) editWorkspace(w, { type: "project.create", patch: { title: `第${n}个长名称作品测试` } });
        editWorkspace(w, { type: "project.open", projectId: project.id });
      });
      for (const width of [1320, 1152]) {
        win.setContentSize(width, 920);
        for (const route of ["projects", "voices", "directions", "tasks"]) {
          await win.loadURL(host.address + "/#" + route);
          await waitFor(".inline-page-head");
          await delay(400);
          const head = await js('(()=>{const h=document.querySelector(".inline-page-head"),t=h.querySelector("h1").getBoundingClientRect(),d=h.querySelector("p").getBoundingClientRect(),b=h.querySelector("button")?.getBoundingClientRect();return {aligned:Math.abs((t.top+t.height/2)-(d.top+d.height/2))<2,descriptionRight:getComputedStyle(h.querySelector("p")).textAlign==="right",buttonLast:!b||b.left>=d.right-0.5,overflow:document.documentElement.scrollWidth>innerWidth,descriptionEnd:d.right,buttonStart:b?.left}})()');
          await capture(`${route}-${width}`);
          if (!head.aligned || !head.descriptionRight || !head.buttonLast || head.overflow) console.log(route, width, head);
          ok(head.aligned && head.descriptionRight && head.buttonLast && !head.overflow, `${route} heading keeps inline right-aligned description and rightmost actions at ${width}px`);
        }
        await click('button[aria-label="作品集范围"]');
        ok(await js('[...document.querySelectorAll(".select-menu [role=option]")].every(e=>{const full=e.getAttribute("aria-label"),parts=Array.from(new Intl.Segmenter("zh-CN",{granularity:"grapheme"}).segment(full),x=>x.segment);return e.title===full&&e.querySelector("span").textContent===(parts.length>5?parts.slice(0,5).join("")+"...":full)})'), 'All project menu labels truncate after five graphemes and retain full accessible names');
        ok(await js('(()=>{const list=document.querySelector(".select-menu"),r=list.getBoundingClientRect();return [...list.children].filter(e=>{const q=e.getBoundingClientRect();return q.bottom>r.top+4&&q.top<r.bottom-4}).length<=5&&list.scrollHeight>list.clientHeight})()'), 'Long project menu retains five-item cap and internal scrolling');
        await capture(`project-menu-${width}`);
        await js('document.querySelector("button[aria-label=作品集范围]").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))');
        await delay(100);
        await js('document.querySelector("button[aria-label=作品集范围]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
        await delay();
        ok(await js('(()=>{const b=document.querySelector("button[aria-label=作品集范围]");return b.title.startsWith("第8个")&&b.getAttribute("aria-description")===b.title&&b.querySelector("span").textContent.endsWith("...")&&!document.querySelector(".select-menu")})()'), 'Keyboard selects the actual last project; trigger is shortened but preserves full title');
        await win.loadURL(host.address + "/#settings");
        await waitFor(".settings-page");
        await capture(`settings-${width}`);
        ok(await js('document.documentElement.scrollWidth<=innerWidth'), `Settings fits ${width}px`);
      }
      win.setMinimumSize(0, 0);
      win.setContentSize(390, 844);
      for (const route of ["settings", "voices", "tasks"]) {
        await win.loadURL(host.address + "/#" + route);
        await waitFor(route === "settings" ? ".settings-page" : ".inline-page-head");
        ok(await js('document.documentElement.scrollWidth<=innerWidth'), `${route} narrow reflow has no horizontal overflow`);
        await capture(`${route}-narrow`);
      }
      ok(errors.length === 0, "No console errors in focused settings and page-heading flows");
      fs.writeFileSync(path.join(evidence, "functional.json"), JSON.stringify({ assertions, errors, root, notes: ["Setup ready/missing combinations are isolated state fixtures; uv success and Python failure use actual internal resources. No downloads or user workspace changes.", "Widths 1320/1152 are actual renderer content widths at height 920; 390px is only a stress reflow fixture, not a supported desktop window."] }, null, 2));
      console.log(JSON.stringify({ assertions: assertions.length, errors, evidence }));
      fs.rmSync(path.join(evidence, "failure.txt"), { force: true });
      return;
    }
    if (process.argv.includes("--frame-only")) {
      win.setContentSize(1320, 920);
      win.webContents.setAudioMuted(true);
      await win.loadURL(host.address + "/#studio");
      await delay(700);
      await frameFlows();
      ok(errors.length === 0, "No application console errors in the editing frame flows");
      fs.writeFileSync(path.join(evidence, "frame-confirmation.json"), JSON.stringify({ assertions, errors }, null, 2));
      console.log(JSON.stringify({ frameAssertions: assertions.length, errors }));
      return;
    }
    if (process.argv.includes("--lists-only")) {
      await listFlows();
      fs.writeFileSync(path.join(evidence, "list-confirmation.json"), JSON.stringify({assertions,errors,notes:["Narrow confirmation after the library route key/search reset; complete core regression is recorded separately in functional.json."]}, null, 2));
      console.log(
        JSON.stringify({ listAssertions: assertions.length, errors }),
      );
      return;
    }
    ok(
      JSON.stringify(win.getMinimumSize()) === JSON.stringify([1152, 648]),
      "Native client registers a 16:9 minimum of 1152 by 648",
    );
    win.setSize(500, 300);
    await delay();
    ok(
      win.getSize()[0] >= 1152 && win.getSize()[1] >= 648,
      "Native window size cannot shrink below the configured minimum",
    );
    win.setContentSize(1320, 920);
    win.webContents.setAudioMuted(true);
    await win.loadURL(host.address + "/#studio");
    await delay(700);
    await js('console.error("__probe__")');
    await delay(50);
    ok(errors.includes("__probe__"), "Console error collector is active");
    errors.splice(errors.indexOf("__probe__"), 1);
    ok(
      await js(
        'document.querySelectorAll(".controls-column .selected-material").length===2&&!document.querySelector(".controls-column .choice")',
      ),
      "Two compact replaceable single selection cards retained",
    );
    ok(
      await js(
        'JSON.stringify([...document.querySelectorAll(".controls-column section:nth-child(2) .segmented button")].map(e=>e.textContent))===JSON.stringify(["预设演绎","演绎描述"])',
      ),
      "Guidance tabs match voice library/description order",
    );
    ok(
      await js(
        '(()=>{const a=document.querySelector(".segment-rail").getBoundingClientRect(),b=document.querySelector(".manuscript").getBoundingClientRect(),rows=[...document.querySelectorAll(".rail-segment")].map(e=>e.getBoundingClientRect());return Math.abs(a.right-b.left)<1&&rows[1].top>rows[0].bottom&&!document.querySelector(".paragraph-tools,.segment-toolbar");})()',
      ),
      "Vertical segment rail left of manuscript; old row gone",
    );
    ok(
      await js(
        'document.querySelectorAll(".rail-actions button").length===2&&[...document.querySelectorAll(".rail-actions button")].every(e=>!e.textContent.trim())',
      ),
      "Add and delete are adjacent icon controls below rail",
    );
    await capture("desktop");
    win.setContentSize(1271, 720);
    await capture("user-1271");
    ok(
      await js(
        'document.querySelector(".project-quickbar").classList.contains("surface")&&getComputedStyle(document.querySelector("#project-picker")).fontSize==="16px"',
      ),
      "Project quick management uses a matching surface and a smaller name",
    );
    ok(
      await js(
        '(()=>{const row=document.querySelector(".rail-segment").getBoundingClientRect(),a=document.querySelector(".rail-actions").getBoundingClientRect(),b=[...document.querySelectorAll(".rail-actions button")].map(e=>e.getBoundingClientRect());return Math.abs(row.left-a.left)<1&&Math.abs(row.right-a.right)<1&&Math.abs(b[0].width-b[1].width)<1&&b.every(x=>x.height>=42);})()',
      ),
      "Rail add/delete split the segment row width evenly",
    );
    win.setContentSize(1152, 648);
    await capture("minimum");
    await js(
      'document.querySelector(".generation-panel").scrollIntoView({block:"start"})',
    );
    await capture("generation-audio");
    ok(await js('document.querySelector(".segment-rail").getBoundingClientRect().bottom<=document.querySelector(".generation-panel").getBoundingClientRect().top'), "Scrolling to generation never overlays it with the segment panel");
    await js("window.scrollTo(0,0)");
    ok(
      await js(
        '(()=>{const g=document.querySelector(".generation-panel").getBoundingClientRect(),r=document.querySelector(".result-section").getBoundingClientRect(),a=[".segment-rail",".manuscript",".controls-column"].map(s=>document.querySelector(s).getBoundingClientRect());return a.every(b=>b.bottom<=g.top)&&r.top>=g.bottom&&g.width===r.width&&getComputedStyle(document.querySelector(".workspace-heading")).fontSize===getComputedStyle(document.querySelector(".rail-heading h2")).fontSize&&document.querySelector(".result-section").classList.contains("surface")&&!document.querySelector(".generation-panel .advanced");})()',
      ),
      "Generation spans below all editors, audio follows in a matching surface, and project heading matches panel type",
    );
    ok(
      await js("document.documentElement.scrollWidth<=innerWidth"),
      "Minimum client viewport stays within horizontal bounds",
    );
    win.setContentSize(1271, 720);
    ok(
      await js(
        '!document.body.innerText.includes("作品音频")&&!document.body.innerText.includes("导出选用音频")&&!document.body.innerText.includes("段后停顿")&&![...document.querySelectorAll("button")].some(e=>/^(取消选用|选用音频|下载)$/.test(e.textContent.trim()))',
      ),
      "Selection, merge export and orphan pause controls removed",
    );
    ok(
      await js(
        '(()=>{const a=getComputedStyle(document.querySelector(".segment-rail")),b=getComputedStyle(document.querySelector(".manuscript")),c=getComputedStyle(document.querySelector(".controls-column"));return a.backgroundColor===b.backgroundColor&&b.backgroundColor===c.backgroundColor&&a.borderTopLeftRadius===c.borderTopRightRadius&&b.borderRadius==="0px"&&a.borderTopColor===b.borderTopColor&&a.borderTopWidth===b.borderTopWidth;})()',
      ),
      "Joined editor surfaces share the ground and outer border with square internal divisions",
    );
    await frameFlows();
    const chosenDir = path.join(
      project,
      ".runtime/ui-review/saved-" + Date.now(),
    );
    fs.mkdirSync(chosenDir, { recursive: true });
    const target = path.join(chosenDir, "另存音频.wav");
    let resolveChooser: (value: {
      canceled: boolean;
      filePath?: string;
    }) => void = () => {};
    chooser = () =>
      new Promise((resolve) => {
        resolveChooser = resolve;
      });
    await click(".output button", "保存至...");
    await js(
      'document.querySelector(".output").scrollIntoView({block:"center"})',
    );
    ok(
      await js(
        'document.querySelector(".output button[aria-busy=true]").disabled',
      ),
      "Save opens immediately with a disabled busy button",
    );
    await capture("save-pending");
    ok(
      chooserCalls === 1 &&
        chooserParent === win &&
        chooserOptions.title === "保存音频" &&
        chooserOptions.defaultPath.endsWith("波形验收音频.wav") &&
        chooserOptions.filters[0].extensions[0] === "wav" &&
        chooserOptions.properties.includes("showOverwriteConfirmation"),
      "Real IPC requests a parented native WAV save dialog with overwrite confirmation",
    );
    resolveChooser({ canceled: false, filePath: target });
    await delay(600);
    ok(
      fs.readFileSync(target).equals(wav) &&
        fs
          .readFileSync(paths.inside("data/references/" + asset + ".wav"))
          .equals(wav),
      "Save copies exact WAV bytes and retains internal audio",
    );
    ok(
      await js(
        'document.querySelector(".audio-save-feedback.success").textContent.includes("另存音频.wav")',
      ),
      "Save completion is visible beside the audio",
    );
    await capture("save-success");
    fs.writeFileSync(target, "old target");
    chooser = async () => ({ canceled: false, filePath: target });
    await click(".output button", "保存至...");
    ok(
      fs.readFileSync(target).equals(wav),
      "Confirmed destination overwrite replaces bytes correctly",
    );
    chooser = async () => ({ canceled: true });
    await click(".output button", "保存至...");
    ok(
      await js(
        'document.querySelector(".audio-save-feedback.neutral").textContent.includes("已取消保存")',
      ),
      "Cancellation provides feedback and leaves save available",
    );
    ok(
      fs.readFileSync(target).equals(wav),
      "Save cancellation preserves existing destination",
    );
    await capture("save-cancelled");
    chooser = async () => ({
      canceled: false,
      filePath: path.join(chosenDir, "missing/音频.wav"),
    });
    await click(".output button", "保存至...");
    ok(
      await js(
        'document.querySelector(".audio-save-feedback.failure").textContent.includes("目录已移除")&&!document.querySelector(".output button").disabled',
      ),
      "Missing destination shows a readable failure and restores retry",
    );
    await capture("save-failure");
    chooser = async () => ({ canceled: false, filePath: target });
    await click(".output button", "保存至...");
    ok(
      await js('!!document.querySelector(".audio-save-feedback.success")'),
      "Saving succeeds again after a failed destination",
    );
    await click(".selected-material");
    await capture("voice-picker");
    await click("dialog .choice strong", "清澈女声");
    await delay(750);
    ok(
      host.repo.workspace.projects[0].segments[0].voiceId === "clear",
      "Voice picker replaces card",
    );
    const second = p.segments[1];
    await input('textarea[aria-label="待合成文稿"]', "切段前的最新文稿");
    await nativeDouble(".rail-segment:nth-child(2)");
    await waitFor("dialog input");
    ok(
      host.repo.workspace.projects[0].segments.find((x) => x.id === s.id)!
        .text === "切段前的最新文稿",
      "Native double click on inactive segment preserves pending manuscript",
    );
    await input("dialog input", "开场");
    await capture("duplicate-name");
    ok(
      await js(
        'document.querySelector("dialog .inline-error").textContent.includes("同名")&&document.querySelector("dialog .primary").disabled',
      ),
      "Duplicate name blocked inline",
    );
    await input("dialog input", "这是第二段完整名称");
    await click("dialog button", "保存名称");
    ok(
      await js(
        'document.querySelector(".rail-segment:nth-child(2) > span").textContent==="这是第..."&&document.querySelector(".rail-segment:nth-child(2)").getAttribute("aria-label")==="这是第二段完整名称"',
      ),
      "Three graphemes plus literal dots; full accessible name retained",
    );
    await click(".rail-segment:nth-child(1)");
    const snapshot = structuredClone(host.repo.workspace.projects[0].segments);
    await drag(
      ".rail-segment:nth-child(1)",
      ".rail-segment:nth-child(2)",
      true,
      false,
    );
    ok(
      JSON.stringify(snapshot) ===
        JSON.stringify(host.repo.workspace.projects[0].segments),
      "Abandoned HTML drag preserves order and every segment field",
    );
    await drag(".rail-segment:nth-child(1)", ".rail-segment:nth-child(2)");
    ok(
      host.repo.workspace.projects[0].segments[1].id === s.id &&
        host.repo.workspace.projects[0].currentId === s.id,
      "HTML drag reorder keeps selection and identity",
    );
    ok(
      host.repo.workspace.projects[0].segments[1].text === "切段前的最新文稿",
      "Reorder preserves manuscript",
    );
    await key(".rail-segment:nth-child(2)", "Up", true);
    ok(
      host.repo.workspace.projects[0].segments[0].id === s.id,
      "Accessible keyboard reorder works",
    );
    await key(".rail-segment:nth-child(1)", "F2");
    await waitFor("dialog input");
    await click("dialog button", "取消");
    await click('button[aria-label="删除当前段落"]');
    await click("dialog button", "取消");
    ok(
      host.repo.workspace.projects[0].segments.length === 2,
      "Delete cancellation keeps segment and audio",
    );
    await click('button[aria-label="添加段落"]');
    ok(
      host.repo.workspace.projects[0].segments.length === 3,
      "Add icon creates one uniquely named segment",
    );
    await js(
      'document.querySelector(".result-section").scrollIntoView({block:"center"})',
    );
    ok(
      await js(
        '!document.body.innerText.includes("选用")&&document.body.innerText.includes("将喜欢的音频保存至所选位置")',
      ),
      "Empty audio state explains saving without obsolete selection",
    );
    await capture("audio-empty");
    await click('button[aria-label="删除当前段落"]');
    await click("dialog button.danger");
    ok(
      host.repo.workspace.projects[0].segments.length === 2,
      "Delete icon confirmation permanently deletes only current segment",
    );
    await click(".rail-segment:nth-child(1)");
    await click(
      ".controls-column section:nth-child(2) .segmented button",
      "演绎描述",
    );
    await input('textarea[aria-label="演绎描述"]', "自己的描述");
    await js(
      '(()=>{const e=document.querySelector("textarea[aria-label=演绎描述]");e.focus();e.setSelectionRange(2,2);e.dispatchEvent(new Event("select",{bubbles:true}));})()',
    );
    await click(".controls-column button", "插入指导");
    await click("dialog .choice strong", "故事讲述");
    ok(
      await js(
        'document.querySelector("textarea[aria-label=演绎描述]").value==="自己轻声讲述，节奏舒缓，在转折处自然停顿。的描述"',
      ),
      "Guidance insertion keeps text on both sides of caret",
    );
    await click(
      ".controls-column section:nth-child(2) .segmented button",
      "预设演绎",
    );
    await click("[role=switch]");
    ok(
      await js('document.querySelectorAll(".selected-material").length===1'),
      "Guidance off hides guidance components",
    );
    await click("[role=switch]");
    await js("window.scrollTo(0,0)");
    await click("[role=combobox][aria-label=语言]");
    await capture("language-menu");
    await key("[role=combobox][aria-label=语言]", "Down");
    await key("[role=combobox][aria-label=语言]", "Enter");
    ok(
      await js(
        'document.querySelector("[role=combobox][aria-label=语言]").textContent.includes("English")&&!document.querySelector("[role=listbox]")',
      ),
      "Custom dropdown keyboard selects language and closes",
    );
    await click("[role=combobox][aria-label=语言]");
    await key("[role=combobox][aria-label=语言]", "Escape");
    ok(
      await js('!document.querySelector("[role=listbox]")'),
      "Escape cancels dropdown",
    );
    await click("[role=combobox][aria-label=语言]");
    await js(
      'document.querySelector("h2").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))',
    );
    ok(
      await js('!document.querySelector("[role=listbox]")'),
      "Outside pointer closes dropdown",
    );
    await js(
      'document.querySelector(".wave-player").scrollIntoView({block:"center"})',
    );
    await waitFor(".wave-player svg.waveform");
    await delay(400);
    ok(
      await js(
        'document.querySelector(".wave-player audio").readyState>0&&document.querySelectorAll(".wave-unplayed rect").length===128',
      ),
      "Real sampled waveform and native audio metadata loaded",
    );
    await input(".wave-player input[type=range]", "2");
    ok(
      await js(
        'Math.abs(document.querySelector(".wave-player audio").currentTime-2)<.1&&document.querySelector(".waveform clipPath rect").getAttribute("width")==="200"',
      ),
      "Seeking waveform moves actual audio time and progress clip",
    );
    await capture("waveform-seek");
    await click(".wave-player button");
    await delay(300);
    ok(
      await js(
        '!document.querySelector(".wave-player audio").paused&&document.querySelector(".wave-player button").getAttribute("aria-label").startsWith("暂停")',
      ),
      "Waveform play controls real audio and shows pause state",
    );
    await click(".wave-player button");
    // The reference card is reused within the same segment. A prior audio error
    // must not follow the user when they replace the reference recording.
    const referenceB = uid();
    fs.writeFileSync(paths.inside(`data/references/${referenceB}.wav`), wav);
    host.repo.transaction((w) => {
      for (const [id, name, assetId] of [
        ["ref-a", "参考 A", asset],
        ["ref-b", "参考 B", referenceB],
      ]) {
        editWorkspace(w, {
          type: "voice.save",
          item: {
            id,
            name,
            kind: "reference",
            description: "",
            seed: 42,
            assetId,
            transcript: "参考录音",
            consent: true,
          },
        });
      }
    });
    await delay(900);
    await js(
      'document.querySelector(".controls-column .control-panel").scrollIntoView({block:"start"})',
    );
    await click(".selected-material");
    await click("dialog .choice strong", "参考 A");
    await click(".reference-context summary");
    await js('(()=>{const c=document.querySelector(".voice-content"),p=c.querySelector(".wave-player");c.scrollTop+=p.getBoundingClientRect().top-c.getBoundingClientRect().top-4;})()');
    await delay();
    ok(await js('document.querySelector(".voice-content").scrollTop>0'), 'Expanded reference audition is reachable within the fixed voice region');
    await waitFor(".reference-context .waveform");
    await js(
      'document.querySelector(".reference-context audio").dispatchEvent(new Event("error"))',
    );
    await capture("reference-a-error");
    ok(
      await js(
        '!!document.querySelector(".reference-context .wave-error")&&document.querySelector(".reference-context button").disabled',
      ),
      "Reference A shows audio failure and disables its failed player",
    );
    await click(".selected-material");
    await click("dialog .choice strong", "参考 B");
    await waitFor(".reference-context .waveform");
    await delay(450);
    ok(
      await js(
        '!document.querySelector(".reference-context .wave-error")&&!document.querySelector(".reference-context button").disabled&&document.querySelector(".reference-context audio").readyState>0',
      ),
      "Replacing failed reference within same segment resets error and loads B",
    );
    await click(".reference-context .wave-player button");
    ok(
      await js('!document.querySelector(".reference-context audio").paused'),
      "Replacement reference B actually plays",
    );
    await capture("reference-b-recovered");
    await click(".reference-context .wave-player button");
    await click(".selected-material");
    await click("dialog .choice strong", "清澈女声");
    // Below the shipping desktop minimum: responsive web stress inspection only.
    win.setMinimumSize(0, 0);
    win.setContentSize(390, 844);
    await js("window.scrollTo(0,0)");
    await capture("mobile");
    ok(
      await js(
        '(()=>{const a=document.querySelector(".manuscript"),b=document.querySelector(".controls-column"),c=document.querySelector(".result-section");return !!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(b.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING)&&document.querySelector(".controls-column").firstElementChild.getBoundingClientRect().bottom<c.getBoundingClientRect().top;})()',
      ),
      "Narrow reading and focus order follows manuscript, controls, then audio results",
    );
    ok(
      await js(
        'getComputedStyle(document.querySelector(".segment-rail")).position==="static"',
      ),
      "Narrow segment surface stays in normal document flow",
    );
    ok(
      await js("document.documentElement.scrollWidth<=innerWidth"),
      "Narrow studio has no horizontal overflow",
    );
    await click("[role=combobox][aria-label=语言]");
    await capture("mobile-menu");
    ok(
      await js(
        '(()=>{const r=document.querySelector("[role=listbox]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()',
      ),
      "Narrow dropdown stays inside viewport",
    );
    await key("[role=combobox][aria-label=语言]", "Escape");
    await js(
      'document.querySelector(".controls-column .control-panel").scrollIntoView()',
    );
    await capture("mobile-controls");
    win.setContentSize(1320, 920);
    await win.loadURL(host.address + "/#tasks");
    await waitFor(".record-toolbar");
    await capture("records");
    await waitFor(".input-snapshot");
    await capture("record-input");
    ok(
      await js(
        '!!document.querySelector(".snapshot-fields")&&document.querySelectorAll(".snapshot-params dt").length===3&&!document.querySelector(".task-input")',
      ),
      "Record snapshot separates copy, instruction and exact parameters",
    );
    await click(".task-detail-actions button", "运行过程");
    ok(
      await js(
        '!document.querySelector(".input-snapshot")&&!!document.querySelector("[aria-label=任务运行过程]")',
      ),
      "Record inputs and events are independently findable and replace the detail view",
    );
    host.repo.transaction((w) => {
      const t = w.tasks.find((t) => t.id === "fixture")!;
      t.createdAt = Date.now() - 61000;
      t.events = [
        { at: t.createdAt, message: "等待生成" },
        { at: t.createdAt + 1000, message: "第 1 次运行" },
        { at: t.createdAt + 60000, message: "生成完成" },
      ];
    });
    await delay(950);
    await capture("record-events");
    ok(
      await js(
        'document.querySelectorAll(".run-events time").length===3&&document.querySelector(".run-events .event-success").textContent.includes("生成完成")',
      ),
      "Run events align timestamps, messages and actual completion state",
    );
    host.repo.transaction((w) => {
      const t = w.tasks.find((t) => t.id === "fixture")!;
      t.units.push({
        ...structuredClone(t.units[0]),
        id: "unit-second",
        index: 1,
        outputId: null,
        input: {
          ...structuredClone(t.units[0].input),
          text: "第二候选的固定文稿",
        },
      });
      t.status = "interrupted";
      t.error = "模型服务已关闭；已完成的音频保留。";
    });
    await delay(950);
    await click(".task-detail-actions button", "合成输入");
    await click("[role=combobox][aria-label=查看候选输入]");
    await click("[role=option]", "开场 · 候选 2");
    ok(
      await js(
        'document.querySelector(".snapshot-copy").textContent==="第二候选的固定文稿"&&document.querySelector(".snapshot-params dd:nth-child(2)")!==null&&document.querySelector(".input-snapshot").textContent.includes("43")',
      ),
      "Candidate selector displays one fixed input and its actual candidate seed",
    );
    await capture("record-candidate");
    host.repo.transaction((w) => {
      const t = w.tasks.find((t) => t.id === "fixture")!;
      t.status = "interrupted";
      t.error = "模型服务已关闭；已完成的音频保留。";
      t.events.push({ at: Date.now(), message: "模型服务已关闭" });
    });
    await delay(950);
    await click(".task-detail-actions button", "运行过程");
    await capture("record-interrupted");
    ok(
      await js(
        'document.querySelector(".task").textContent.includes("已中断")&&!!document.querySelector(".task .output")',
      ),
      "Interrupted task retains its completed audio beside the recovery context",
    );
    chooser = async () => ({
      canceled: false,
      filePath: path.join(chosenDir, "记录音频.wav"),
    });
    await click(".output button", "保存至...");
    ok(
      fs.readFileSync(path.join(chosenDir, "记录音频.wav")).equals(wav),
      "Record audio uses the same native save flow",
    );
    ok(
      await js(
        '!document.body.innerText.includes("暂停队列")&&!document.body.innerText.includes("继续队列")&&!document.querySelector("select")',
      ),
      "Record page has no global queue controls and no unstyled native selectors",
    );
    await win.loadURL(host.address + "/#projects");
    await waitFor(".projects-list");
    await capture("projects");
    ok(
      await js(
        'document.querySelector("nav a[aria-current=page]").getAttribute("href")==="#projects"&&document.querySelector(".project-row").textContent.includes("1 份音频")&&document.querySelector(".project-row").textContent.includes("待继续")',
      ),
      "Projects navigation exposes management and truthful output/recovery counts",
    );
    await input("input[aria-label=搜索作品]", "找不到的作品");
    await capture("projects-search-empty");
    await click("button", "清除搜索");
    await click(".page-head button", "新建作品");
    ok(
      await js('document.querySelector("dialog .primary").disabled'),
      "Named project creation blocks a blank title",
    );
    await input("dialog input", "配音草稿");
    await click("dialog button", "创建作品");
    ok(
      host.repo.workspace.projects.length === 2 &&
        host.repo.workspace.projects.some((p) => p.title === "配音草稿"),
      "Projects creation persists a named independent project",
    );
    await click('button[aria-label="重命名作品配音草稿"]');
    await input("dialog input", "片尾旁白");
    await click("dialog button", "保存名称");
    ok(
      host.repo.workspace.projects.some((p) => p.title === "片尾旁白"),
      "Project name edit updates its shared identity",
    );
    await click('button[aria-label="删除作品片尾旁白"]');
    await click("dialog button", "取消");
    ok(
      host.repo.workspace.projects.length === 2,
      "Cancelling project deletion keeps both projects",
    );
    await click('button[aria-label="删除作品片尾旁白"]');
    await click("dialog button.danger");
    ok(
      host.repo.workspace.projects.length === 1 &&
        host.repo.workspace.outputs.length === 1,
      "Deleting a separate project preserves other project audio",
    );
    await click(".project-row button", "生成记录 · 1");
    await waitFor(".record-toolbar");
    ok(
      await js(
        'document.querySelector("[aria-label=作品集范围]").textContent.includes("未命名作品")',
      ),
      "Project records action opens the correct filtered collection",
    );
    await win.loadURL(host.address + "/#studio");
    await waitFor(".segment-rail");
    host.repo.transaction((w) => {
      for (let n = 0; n < 18; n++) editWorkspace(w, { type: "segment.create" });
    });
    await delay(950);
    await js("window.scrollTo(0,0)");
    await capture("segments-many");
    ok(
      await js(
        '(()=>{const a=document.querySelector(".rail-list"),b=a.querySelector("[aria-pressed=true]").getBoundingClientRect(),r=a.getBoundingClientRect(),f=document.querySelector(".rail-actions").getBoundingClientRect();return a.scrollHeight>a.clientHeight&&r.height>320&&f.top-r.bottom<=26&&a.scrollTop>0&&b.top>=r.top&&b.bottom<=r.bottom;})()',
      ),
      "Many segments use the column height, scroll excess and reveal the newly added current item",
    );
    await js('document.querySelector(".rail-list").scrollTop=0');
    await click(".rail-segment:first-child");
    ok(
      await js('document.querySelector(".rail-list").scrollTop<10'),
      "Selecting a different segment changes only list positioning",
    );
    host.repo.transaction((w) => {
      const pp = w.projects[0];
      pp.segments = pp.segments.slice(0, 2);
      pp.currentId = pp.segments[0].id;
    });
    await delay(950);
    await win.loadURL(host.address + "/#settings");
    await waitFor(".settings-page");
    await delay(400);
    await capture("settings");
    const stamp = fs.statSync(paths.uv).mtimeMs;
    await click(".install-row button", "校验");
    await delay(600);
    await capture("validation-success");
    ok(
      await js(
        'document.querySelector(".validation-feedback.success").textContent.includes("校验通过")',
      ),
      "Actual internal uv validation gives persistent success chip",
    );
    ok(
      await js(
        '[...document.querySelector(".install-row").querySelectorAll("button")].every(e=>!e.disabled)',
      ),
      "Validation remains repeatable after success",
    );
    await click(".install-row button", "重新安装");
    await delay(650);
    await click("dialog button", "完成");
    ok(
      fs.statSync(paths.uv).mtimeMs === stamp,
      "Reinstallation reuses intact uv without download",
    );
    // Isolated slow-validation fixture exercises latency/cancel feedback without downloads.
    const original = host.installer.validate.bind(host.installer);
    host.installer.validate = async (kind: any) => {
      await delay(1800);
      return original(kind);
    };
    await click(".install-row button", "校验");
    await capture("validation-loading");
    ok(
      await js(
        'document.querySelector(".download-state").textContent.includes("正在检查")&&document.querySelector(".install-row .badge").textContent.includes("校验中")',
      ),
      "Slow validation gives immediate local busy and header state",
    );
    await delay(1800);
    host.installer.validate = original;
    await click('.install-row[data-resource="python"] button', "校验");
    await delay(500);
    await capture("validation-failure");
    ok(
      await js('!!document.querySelector(".validation-feedback.failure")'),
      "Missing Python yields explicit validation failure and retry controls",
    );
    host.installer.runtime.service.status = "starting";
    host.installer.runtime.service.message = "启动中…";
    await delay(900);
    await capture("service-starting");
    ok(
      await js('document.querySelector(".service.starting").disabled'),
      "Starting service disables conflicting action and displays spinner",
    );
    host.installer.runtime.service.status = "stopped";
    host.installer.runtime.service.message = "未启动";
    await delay(900);
    win.setContentSize(390, 844);
    await capture("settings-mobile");
    ok(
      await js("document.documentElement.scrollWidth<=innerWidth"),
      "Narrow settings remains within viewport",
    );
    ok(errors.length === 0, "No application console errors in tested flows");
    await listFlows();
    fs.writeFileSync(
      path.join(evidence, "functional.json"),
      JSON.stringify(
        {
          root,
          assertions,
          errors,
          notes: [
            "Audio is a real PCM waveform fixture, not a model generation result.",
            "Drag/drop uses native DOM DragEvents with DataTransfer. Double click and keyboard are native Electron input.",
            "Slow validation is an isolated latency fixture; uv success and missing Python failure use actual internal resources.",
            "Reference A failure is an injected native audio error event; reference B recovery loads and plays a real internal PCM file.",
            "Save uses the production preload, IPC and copier; only the native dialog choice is stubbed in this isolated test. Windows dialog appearance and physical user interaction are not automated.",
            "Minimum window options are shared with production and native getSize enforces them. 390px captures explicitly lift the minimum only inside the isolated harness to stress web reflow, not a supported desktop window size.",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ assertions: assertions.length, evidence, errors }),
    );
    if (fs.existsSync(path.join(evidence, "failure.txt")))
      fs.unlinkSync(path.join(evidence, "failure.txt"));
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
