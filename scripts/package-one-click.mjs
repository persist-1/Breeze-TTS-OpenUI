import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fs.realpathSync(fileURLToPath(new URL("../", import.meta.url)));
process.chdir(root);
function localPath(target) {
  let cursor = target;
  while (!fs.existsSync(cursor)) cursor = path.dirname(cursor);
  const relative = path.relative(root, fs.realpathSync(cursor));
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw Error("打包日志、缓存和临时目录必须位于项目内部：" + target);
  return target;
}
const logDir = localPath(path.join(root, ".runtime/logs"));
fs.mkdirSync(logDir, { recursive: true });
const log = path.join(logDir, "package-" + Date.now() + ".log");
const print = (text) => {
  console.log(text);
  fs.appendFileSync(log, text + "\n");
};
const temp = localPath(path.join(root, ".runtime/tmp")),
  cache = localPath(path.join(root, ".runtime/cache"));
for (const dir of [temp, cache]) fs.mkdirSync(dir, { recursive: true });
const env = {
  ...process.env,
  TEMP: temp,
  TMP: temp,
  TMPDIR: temp,
  npm_config_cache: path.join(cache, "npm"),
  ELECTRON_CACHE: path.join(cache, "electron"),
  electron_config_cache: path.join(cache, "electron"),
};
const lock = localPath(path.join(root, ".runtime/package.lock"));
let ownsLock = false;
let phase = "准备",
  started = Date.now(),
  timer;
async function run(number, title, args) {
  phase = `[${number}/6] ${title}`;
  started = Date.now();
  print("\n" + phase);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const [stream, output] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ])
    stream.on("data", (chunk) => {
      output.write(chunk);
      fs.appendFileSync(log, chunk);
    });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0)
    throw Error(title + "失败（退出码 " + code + "）。未继续打包。");
  print(`${phase} 完成，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
}
try {
  print("Breeze 一键打包 · 日志：" + log);
  print("[1/6] 检查项目与打包依赖");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw Error("需要 Node.js 24 或更高版本。");
  for (const file of [
    "node_modules/typescript/bin/tsc",
    "node_modules/vite/bin/vite.js",
    "node_modules/electron/dist/electron.exe",
    "node_modules/rcedit/bin/rcedit-x64.exe",
    "node_modules/adm-zip/adm-zip.js",
    "node_modules/tsx/dist/loader.mjs",
  ]) {
    const target = path.join(root, file);
    if (!fs.existsSync(target))
      throw Error(
        "项目内依赖缺失：" + file + "。请先按 README 完成开发依赖安装。",
      );
    const rel = path.relative(root, fs.realpathSync(target));
    if (rel.startsWith("..") || path.isAbsolute(rel))
      throw Error("开发依赖必须位于项目目录内：" + file);
  }
  // Recover only a lock left by an exited process; a live owner blocks duplicates.
  if (fs.existsSync(lock)) {
    const old = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (!Number.isSafeInteger(old.pid) || old.pid <= 0)
      throw Error("打包锁文件无效，请检查 .runtime/package.lock。");
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
      else throw error;
    }
    if (alive) throw Error("另一个打包进程仍在运行，请等待其完成。");
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    { flag: "wx" },
  );
  ownsLock = true;
  timer = setInterval(
    () =>
      print(
        `${phase} · 进行中，已用 ${Math.floor((Date.now() - started) / 1000)} 秒`,
      ),
    5000,
  );
  await run(2, "检查 TypeScript", [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
  ]);
  const tests = fs
    .readdirSync(path.join(root, "tests"))
    .filter((n) => n.endsWith(".test.ts"))
    .map((n) => "tests/" + n);
  if (!tests.length) throw Error("未找到自动检查文件。");
  await run(3, "运行自动检查", ["--import", "tsx", "--test", ...tests]);
  await run(4, "构建前端", ["node_modules/vite/bin/vite.js", "build"]);
  await run(5, "构建桌面宿主", ["scripts/build-host.mjs"]);
  await run(6, "复制、压缩并校验免安装包", ["scripts/package.mjs"]);
  print(
    "\n打包完成。ZIP 和内容校验报告已写入项目 release 目录；旧发行包保留。",
  );
} catch (error) {
  print("\n打包失败：" + error.message);
  print("详细日志：" + log);
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  if (ownsLock) fs.unlinkSync(lock);
}
