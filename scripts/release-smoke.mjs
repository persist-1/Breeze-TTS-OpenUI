import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const candidates = fs
  .readdirSync("release")
  .filter(
    (name) =>
      name.startsWith(`Breeze-${version}-win-x64`) && name.endsWith(".zip"),
  )
  .map((name) => path.resolve("release", name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const archive = candidates[0];
if (!archive) throw Error("没有当前版本的发行包，请先运行一键打包.cmd。");
const target = path.resolve(".runtime/release-smoke/便携 验收-" + Date.now());
fs.mkdirSync(target, { recursive: true });
const zip = new AdmZip(archive),
  entries = zip.getEntries();
assert(
  !entries.some((e) =>
    /(^|\/)(\.runtime|data|node_modules)(\/|$)|\.safetensors$|(^|\/)uv\.exe$|(^|\/)python\.exe$/i.test(
      e.entryName,
    ),
  ),
);
zip.extractAllTo(target, false);
const root = path.join(target, path.basename(archive, ".zip"));
async function run(flag) {
  const child = spawn(path.join(root, "Breeze.exe"), [flag], {
    cwd: root,
    windowsHide: true,
    stdio: "pipe",
  });
  let errors = "";
  child.stderr.on("data", (b) => {
    errors += b;
  });
  const timer = setTimeout(() => child.kill(), 30_000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearTimeout(timer);
  assert.equal(code, 0, errors);
}
await run("--smoke");
const load = JSON.parse(
  fs.readFileSync(path.join(root, "data/logs/electron-smoke.json"), "utf8"),
);
assert(load.loaded);
assert.equal(load.root, root);
for (const name of ["userData", "sessionData", "temp"]) {
  const relative = path.relative(root, load[name]);
  assert(!relative.startsWith("..") && !path.isAbsolute(relative));
}
const workspace = JSON.parse(
  fs.readFileSync(path.join(root, "data/workspace.json"), "utf8"),
);
assert.equal(workspace.projects.length, 1);
assert.equal(workspace.outputs.length, 0);
assert.equal(workspace.voices.length, 0);
assert(!fs.existsSync(path.join(root, ".runtime/uv/uv.exe")));
assert(!fs.existsSync(path.join(root, ".runtime/venv/Scripts/python.exe")));
await run("--smoke-close");
const close = JSON.parse(
  fs.readFileSync(
    path.join(root, "data/logs/electron-close-smoke.json"),
    "utf8",
  ),
);
const download = JSON.parse(
  fs.readFileSync(
    path.join(root, "data/logs/electron-download-smoke.json"),
    "utf8",
  ),
);
assert(close.flushed);
assert.equal(download.state, "completed");
assert(download.file.startsWith(path.join(root, "data/exports") + path.sep));
fs.writeFileSync(
  archive.replace(/\.zip$/, ".smoke.json"),
  JSON.stringify(
    {
      archive,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(archive))
        .digest("hex"),
      bytes: fs.statSync(archive).size,
      extractedRoot: root,
      load,
      close,
      download,
      freshWorkspace: true,
      noRuntimeResources: true,
    },
    null,
    2,
  ),
);
console.log(
  "Extracted ZIP launched without Python or model; internal paths, download and close handshake passed.",
);
