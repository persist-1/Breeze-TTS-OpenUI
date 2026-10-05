import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";

const forbidden = (name) =>
  /(^|\/)(\.runtime|data|node_modules|__pycache__|\.venv|venv|前端原型设计)(\/|$)|\.(safetensors|ckpt|pt|pth|pyc|onnx|gguf)$|(^|\/)(uv|python|pythonw)\.exe$|(^|\/)(pytorch_model|model|weights)([-_.][^/]*)?\.bin$/i.test(
    name,
  ) ||
  (/(^|\/)models(\/|$)/.test(name) && !name.includes("/vendor/breeze/models/"));
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return (
    rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)
  );
};
async function files(root, dir, skip = () => false) {
  const output = [];
  for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (skip(file)) continue;
    if (
      item.isSymbolicLink() ||
      !inside(root, await fs.promises.realpath(file))
    )
      throw Error("打包源含外部链接：" + file);
    if (item.isDirectory()) output.push(...(await files(root, file, skip)));
    else if (item.isFile()) output.push(file);
    else throw Error("打包源不是普通文件：" + file);
  }
  return output;
}

// Only application code and Electron are copied; never installed runtime resources.
export async function packagePortable(root, progress = () => {}, options = {}) {
  root = await fs.promises.realpath(root);
  const version = JSON.parse(
    await fs.promises.readFile(path.join(root, "package.json"), "utf8"),
  ).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw Error("项目版本号无效。");
  const release = path.join(root, "release");
  await fs.promises.mkdir(release, { recursive: true });
  if (!inside(root, await fs.promises.realpath(release)))
    throw Error("release 目录必须位于项目内部。");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-");
  const name = `Breeze-${version}-win-x64-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  const stage = path.join(release, name),
    partial = path.join(release, name + ".zip.partial"),
    archive = path.join(release, name + ".zip");
  const sources = [];
  const collect = async (relative, prefix, skip) => {
    const dir = path.join(root, relative);
    if (!inside(root, await fs.promises.realpath(dir)))
      throw Error("打包源必须位于项目内部：" + relative);
    for (const file of await files(root, dir, skip))
      sources.push({
        file,
        target: path.join(prefix, path.relative(dir, file)),
      });
  };
  await collect("node_modules/electron/dist", "");
  await collect("build/renderer", "resources/app/build/renderer");
  for (const file of ["main.cjs", "preload.cjs"])
    sources.push({
      file: path.join(root, "build/desktop", file),
      target: "resources/app/build/desktop/" + file,
    });
  await collect("services/python", "services/python", (file) =>
    /(^|[\\/])__pycache__([\\/]|$)|\.pyc$/.test(file),
  );
  for (const pkg of ["react", "react-dom", "adm-zip"])
    sources.push({
      file: path.join(root, "node_modules", pkg, "LICENSE"),
      target: `licenses/${pkg}.txt`,
    });
  sources.push({
    file: path.join(root, "THIRD_PARTY_NOTICES.md"),
    target: "THIRD_PARTY_NOTICES.md",
  });
  for (const file of [
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
    sources.push({ file: path.join(root, file), target: file });
  for (const source of sources) {
    if (forbidden("/" + source.target.replaceAll("\\", "/")))
      throw Error("发行内容含禁止项：" + source.target);
    if (!inside(root, await fs.promises.realpath(source.file)))
      throw Error("打包文件来自外部：" + source.file);
  }
  if (!sources.some((s) => s.target === "electron.exe"))
    throw Error("项目内 Electron 程序缺失。");
  await fs.promises.mkdir(stage);
  let published = false;
  try {
    let count = 0;
    for (const { file, target } of sources) {
      const out = path.join(stage, target);
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      await fs.promises.copyFile(file, out);
      progress("复制应用文件", ++count, sources.length);
    }
    await fs.promises.rename(
      path.join(stage, "electron.exe"),
      path.join(stage, "Breeze.exe"),
    );
    progress("配置应用图标", 0, 1);
    const stampIcon =
      options.stampIcon ??
      (async (exe, icon) => {
        const { rcedit } = await import("rcedit");
        await rcedit(exe, {
          icon,
          "version-string": {
            ProductName: "OpenUI",
            FileDescription: "OpenUI community speech workspace",
          },
        });
      });
    await stampIcon(
      path.join(stage, "Breeze.exe"),
      path.join(stage, "assets/brand/app.ico"),
    );
    progress("配置应用图标", 1, 1);
    await fs.promises.writeFile(
      path.join(stage, "resources/app/package.json"),
      JSON.stringify({
        name: "breeze-tts-openui",
        version,
        license: "Apache-2.0",
        main: "build/desktop/main.cjs",
      }),
    );
    await fs.promises.writeFile(
      path.join(stage, "使用说明.md"),
      (await fs.promises.readFile(path.join(root, "README.md"), "utf8")).split(
        /\r?\n## 开发/,
      )[0],
    );
    await fs.promises.writeFile(
      path.join(stage, "启动 Breeze.cmd"),
      '@echo off\r\ncd /d "%~dp0"\r\nstart "" "%~dp0Breeze.exe"\r\n',
    );
    const zip = new AdmZip();
    zip.addLocalFolder(stage, name);
    const total = zip.getEntries().filter((e) => !e.isDirectory).length;
    let compressed = 0;
    const buffer = await new Promise((resolve, reject) =>
      zip.toBuffer(resolve, reject, undefined, (item) => {
        if (!item.endsWith("/")) progress("压缩 ZIP", ++compressed, total);
      }),
    );
    await fs.promises.writeFile(partial, buffer, { flag: "wx" });
    progress("检查发行内容", 0, 1);
    const entries = new AdmZip(partial).getEntries();
    for (const entry of entries) {
      if (
        forbidden("/" + entry.entryName) ||
        entry.entryName.startsWith("/") ||
        entry.entryName.split("/").includes("..")
      )
        throw Error("发行包含禁止内容：" + entry.entryName);
      if (!entry.isDirectory) entry.getData();
    }
    const audit = {
      output: archive,
      version,
      bytes: buffer.length,
      files: entries.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      containsUv: false,
      containsPython: false,
      containsWeights: false,
      containsPersonalData: false,
    };
    await fs.promises.writeFile(
      path.join(release, name + ".audit.json"),
      JSON.stringify(audit, null, 2),
      { flag: "wx" },
    );
    await fs.promises.rename(partial, archive);
    published = true;
    progress("检查发行内容", 1, 1);
    return audit;
  } finally {
    if (!published) {
      // Only our random, newly created outputs are removed; no existing release.
      for (const file of [partial, path.join(release, name + ".audit.json")])
        await fs.promises.rm(file, { force: true }).catch(() => {});
      if (inside(release, stage) && path.dirname(stage) === release)
        await fs.promises
          .rm(stage, { recursive: true, force: true })
          .catch(() => {});
    }
  }
}
