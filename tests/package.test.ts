import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";
import { packagePortable } from "../scripts/portable-package.mjs";

test("one-click workflow runs all six stages in a spaced path and writes only an isolated fixture release", () => {
  const { root, write } = fixture();
  for (const file of [
    "package-one-click.mjs",
    "package.mjs",
    "portable-package.mjs",
  ])
    write("scripts/" + file, fs.readFileSync("scripts/" + file, "utf8"));
  fs.cpSync("node_modules/adm-zip", path.join(root, "node_modules/adm-zip"), {
    recursive: true,
  });
  write(
    "node_modules/rcedit/package.json",
    '{"type":"module","exports":"./index.js"}',
  );
  write(
    "node_modules/rcedit/index.js",
    'export async function rcedit(exe,options){if(!options.icon)throw Error("icon missing");}',
  );
  write(
    "node_modules/typescript/bin/tsc",
    'console.log("fixture typecheck",process.env.TEMP);',
  );
  write(
    "node_modules/vite/bin/vite.js",
    'console.log("fixture frontend build");',
  );
  write("scripts/build-host.mjs", 'console.log("fixture desktop build");');
  write(
    "node_modules/tsx/package.json",
    '{"type":"module","exports":"./dist/loader.mjs"}',
  );
  write("node_modules/tsx/dist/loader.mjs", "export {};");
  write(
    "tests/ok.test.ts",
    'import test from "node:test";test("isolated fixture check",()=>{});',
  );
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/package-one-click.mjs")],
    {
      cwd: path.dirname(root),
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (let n = 1; n <= 6; n++) assert(result.stdout.includes(`[${n}/6]`));
  assert(result.stdout.includes(path.join(root, ".runtime/tmp")));
  assert(result.stdout.includes("压缩 ZIP：100%"));
  assert(result.stdout.includes("打包完成"));
  assert(!fs.existsSync(path.join(root, ".runtime/package.lock")));
  const zipFile = fs
    .readdirSync(path.join(root, "release"))
    .find((n) => n.endsWith(".zip"))!;
  assert(zipFile);
  assert(
    new AdmZip(path.join(root, "release", zipFile))
      .getEntries()
      .some((e) => e.entryName.endsWith("/Breeze.exe")),
  );
});

function fixture() {
  const base = path.resolve(".runtime/tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "打包 空格-"));
  const write = (name: string, content: string) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write("package.json", '{"version":"0.1.2"}');
  for (const f of [
    "node_modules/electron/dist/electron.exe",
    "node_modules/electron/dist/LICENSE",
    "node_modules/rcedit/bin/rcedit-x64.exe",
    "build/renderer/index.html",
    "build/desktop/main.cjs",
    "build/desktop/preload.cjs",
    "services/python/service.py",
    "services/python/vendor/breeze/models/architecture.py",
    "node_modules/react/LICENSE",
    "node_modules/react-dom/LICENSE",
    "node_modules/adm-zip/LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "LICENSE",
    "MODEL_LICENSE",
    "NOTICE",
    "licenses/provenance.json",
    "docs/LICENSING.md",
    "assets/brand/logo.svg",
    "assets/brand/logo.png",
    "assets/brand/app.ico",
    "assets/brand/README.md",
  ])
    write(f, "fixture " + f);
  write("README.md", "# 用法\n只包含应用。\n## 开发\n不可进入发行包");
  for (const f of [
    ".runtime/uv/uv.exe",
    ".runtime/venv/python.exe",
    "data/workspace.json",
    "models/weight.safetensors",
    "services/python/__pycache__/service.pyc",
  ])
    write(f, "private fixture");
  return { root, write };
}
test("packaging reports real copy/compression progress, excludes resources and never replaces old releases", async () => {
  const { root, write } = fixture();
  write("release/已有版本.zip", "retain");
  const steps: { phase: string; n: number; total: number }[] = [];
  const stampIcon = async (exe: string, icon: string) => {
    assert(exe.startsWith(path.join(root, "release") + path.sep));
    assert(icon.startsWith(path.join(root, "release") + path.sep));
    assert.equal(fs.readFileSync(icon, "utf8"), "fixture assets/brand/app.ico");
    fs.appendFileSync(exe, " stamped icon");
  };
  const a = await packagePortable(
    root,
    (phase: string, n: number, total: number) =>
      steps.push({ phase, n, total }),
    { stampIcon },
  );
  const b = await packagePortable(root, undefined, { stampIcon });
  assert.notEqual(a.output, b.output);
  assert.equal(
    fs.readFileSync(path.join(root, "release/已有版本.zip"), "utf8"),
    "retain",
  );
  const entries = new AdmZip(a.output).getEntries();
  assert(entries.some((e) => e.entryName.endsWith("/Breeze.exe")));
  assert(
    entries
      .find((e) => e.entryName.endsWith("/Breeze.exe"))!
      .getData()
      .toString()
      .endsWith("stamped icon"),
  );
  for (const file of [
    "LICENSE",
    "MODEL_LICENSE",
    "NOTICE",
    "licenses/provenance.json",
    "docs/LICENSING.md",
    "assets/brand/logo.svg",
    "assets/brand/app.ico",
  ])
    assert(
      entries.some((e) => e.entryName.endsWith("/" + file)),
      file,
    );
  assert(
    entries.some((e) =>
      e.entryName.endsWith("/vendor/breeze/models/architecture.py"),
    ),
  );
  assert(
    !entries.some((e) =>
      /\.runtime|workspace\.json|weight\.safetensors|__pycache__/.test(
        e.entryName,
      ),
    ),
  );
  assert(
    !entries
      .find((e) => e.entryName.endsWith("使用说明.md"))!
      .getData()
      .toString()
      .includes("不可进入"),
  );
  for (const phase of [
    "复制应用文件",
    "配置应用图标",
    "压缩 ZIP",
    "检查发行内容",
  ]) {
    const last = steps.filter((s) => s.phase === phase).at(-1)!;
    assert.equal(last.n, last.total);
  }
  assert.equal(a.sha256.length, 64);
  assert.equal(a.bytes, fs.statSync(a.output).size);
});
test("packing refuses accidentally bundled runtime files and directory escapes before publishing", async () => {
  const a = fixture();
  a.write("services/python/venv/python.exe", "should fail");
  await assert.rejects(packagePortable(a.root), /禁止项/);
  assert(!fs.readdirSync(path.join(a.root, "release")).length);
  const b = fixture();
  fs.symlinkSync(
    path.join(a.root, "data"),
    path.join(b.root, "release"),
    "junction",
  );
  await assert.rejects(packagePortable(b.root), /release 目录/);
  const c = fixture();
  fs.symlinkSync(
    path.join(a.root, "data"),
    path.join(c.root, "services/python/linked"),
    "junction",
  );
  await assert.rejects(packagePortable(c.root), /外部链接/);
});
test("one-click runner streams stage failures, keeps logs internal, stops before packaging and releases its lock", () => {
  const { root, write } = fixture();
  write(
    "scripts/package-one-click.mjs",
    fs.readFileSync("scripts/package-one-click.mjs", "utf8"),
  );
  for (const f of [
    "node_modules/typescript/bin/tsc",
    "node_modules/vite/bin/vite.js",
    "node_modules/adm-zip/adm-zip.js",
    "node_modules/tsx/dist/loader.mjs",
  ])
    write(f, 'console.log("isolated compiler failure");process.exit(42);');
  const r = spawnSync(
    process.execPath,
    [path.join(root, "scripts/package-one-click.mjs")],
    { cwd: path.dirname(root), encoding: "utf8", windowsHide: true },
  );
  assert.equal(r.status, 1);
  assert(r.stdout.includes("[2/6]"));
  assert(r.stdout.includes("isolated compiler failure"));
  assert(r.stdout.includes("退出码 42"));
  assert(!r.stdout.includes("[3/6]"));
  assert(!fs.existsSync(path.join(root, ".runtime/package.lock")));
  assert(!fs.existsSync(path.join(root, "release")));
  assert(
    fs
      .readdirSync(path.join(root, ".runtime/logs"))
      .some((n) => n.endsWith(".log")),
  );
  write(".runtime/package.lock", JSON.stringify({ pid: process.pid }));
  const repeated = spawnSync(
    process.execPath,
    [path.join(root, "scripts/package-one-click.mjs")],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(repeated.status, 1);
  assert(repeated.stdout.includes("另一个打包进程"));
  assert(fs.existsSync(path.join(root, ".runtime/package.lock")));
  const escaped = fixture(),
    outside = fixture();
  escaped.write(
    "scripts/package-one-click.mjs",
    fs.readFileSync("scripts/package-one-click.mjs", "utf8"),
  );
  fs.renameSync(
    path.join(escaped.root, ".runtime"),
    path.join(escaped.root, "原运行目录"),
  );
  fs.symlinkSync(
    path.join(outside.root, "data"),
    path.join(escaped.root, ".runtime"),
    "junction",
  );
  const blocked = spawnSync(
    process.execPath,
    [path.join(escaped.root, "scripts/package-one-click.mjs")],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(blocked.status, 1);
  assert(blocked.stderr.includes("必须位于项目内部"));
  assert(!fs.existsSync(path.join(outside.root, "data/logs")));
});
