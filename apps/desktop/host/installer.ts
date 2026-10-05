import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import type {
  Runtime,
  InstallKind,
  Resource,
  InstallPlan,
} from "../../../packages/contracts/src/index.ts";
import { PortablePaths } from "./paths.ts";
import { prepareInternalPython } from "./portable-python.ts";
const missing = (p: string): Resource => ({
  path: p,
  status: "missing",
  stage: "未安装",
  progress: null,
});
export function validateModel(paths: PortablePaths): string {
  const root = paths.model,
    read = (name: string) =>
      JSON.parse(fs.readFileSync(paths.inside(path.join(root, name)), "utf8"));
  for (const f of [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "audio_tokenizer/config.json",
  ])
    read(f);
  const index = read("model.safetensors.index.json");
  const shards = new Set<string>(Object.values(index.weight_map));
  if (!shards.size) throw Error("权重索引为空。");
  const validateShard = (name: string) => {
    const file = paths.inside(path.join(root, name)),
      stat = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    let headerHash = "";
    try {
      const header = Buffer.alloc(8);
      if (fs.readSync(fd, header, 0, 8, 0) !== 8)
        throw Error("权重文件不完整：" + name);
      const length = Number(header.readBigUInt64LE());
      if (length < 2 || length > 100_000_000 || length + 8 >= stat.size)
        throw Error("权重文件未下载完整：" + name);
      const b = Buffer.alloc(length);
      fs.readSync(fd, b, 0, length, 8);
      headerHash = createHash("sha256").update(b).digest("hex");
      const tensors = JSON.parse(b.toString()),
        end = Math.max(
          ...Object.values(tensors)
            .filter((v: any) => v.data_offsets)
            .map((v: any) => Number(v.data_offsets[1])),
        );
      if (!Number.isFinite(end) || end + 8 + length !== stat.size)
        throw Error("权重文件长度校验失败：" + name);
    } finally {
      fs.closeSync(fd);
    }
    return `${name}:${stat.size}:${headerHash}`;
  };
  const verified = [...shards].map(validateShard);
  const codec = fs
    .readdirSync(paths.inside(path.join(root, "audio_tokenizer")))
    .filter((f) => f.endsWith(".safetensors"));
  if (!codec.length) throw Error("缺少 audio_tokenizer 权重。");
  for (const f of codec) verified.push(validateShard("audio_tokenizer/" + f));
  return createHash("sha256")
    .update(JSON.stringify(index) + verified.join("|"))
    .digest("hex");
}
export class Installer {
  runtime: Runtime;
  child: ChildProcessWithoutNullStreams | null = null;
  controller: AbortController | null = null;
  private cancelled = false;
  constructor(
    readonly paths: PortablePaths,
    readonly changed: () => void,
  ) {
    this.runtime = {
      root: paths.root,
      uv: missing(".runtime/uv/uv.exe"),
      python: missing(".runtime/venv"),
      dependencies: missing(".runtime/venv"),
      model: missing("models/Breeze-TTS-2"),
      service: { status: "stopped", message: "模型服务未启动" },
      busy: null,
      logs: [],
    };
  }
  log(text: string) {
    text = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
    if (!text) return;
    const logfile = this.paths.inside("data/logs/runtime.log");
    if (fs.existsSync(logfile) && fs.statSync(logfile).size > 5_000_000)
      fs.renameSync(logfile, logfile + ".previous");
    this.runtime.logs = [...this.runtime.logs, text.trim()]
      .filter(Boolean)
      .slice(-60);
    fs.appendFileSync(this.paths.inside("data/logs/runtime.log"), text + "\n");
    this.changed();
  }
  private state(kind: InstallKind, patch: Partial<Resource>) {
    Object.assign(this.runtime[kind], patch);
    this.changed();
  }
  async probe() {
    for (const kind of ["uv", "python", "dependencies", "model"] as const)
      await this.validate(kind).catch(() => {});
    for (const kind of ["uv", "python", "dependencies", "model"] as const)
      if (this.runtime[kind].status === "missing") {
        this.runtime[kind].error = undefined;
        this.runtime[kind].stage = "未安装";
      }
    this.changed();
  }
  async validate(kind: InstallKind, inspectionOwner?: InstallKind) {
    if (this.runtime.busy && !inspectionOwner)
      throw Error("请等待当前安装或校验结束。");
    this.cancelled = false;
    this.runtime.busy = inspectionOwner || kind;
    this.state(kind, {
      status: "busy",
      stage: "正在校验",
      progress: null,
      error: undefined,
    });
    try {
      let version = "";
      if (kind === "uv")
        version = (await this.run(this.paths.uv, ["--version"])).trim();
      else if (kind === "python")
        version = (
          await this.run(this.paths.python, [
            "-I",
            "-c",
            "import sys; print(sys.version.split()[0]); assert sys.prefix.startswith(sys.argv[1]); assert sys.base_prefix.startswith(sys.argv[1])",
            this.paths.root,
          ])
        ).trim();
      else if (kind === "dependencies") {
        if (this.runtime.python.status !== "ready")
          throw Error("请先安装 Python。");
        version = (
          await this.run(this.paths.python, [
            "-I",
            "-c",
            "import torch,torchaudio,transformers,qwen_tts,numpy,soundfile,modelscope;print(torch.__version__);assert torch.version.cuda,'需要 CUDA 版 PyTorch'",
          ])
        ).trim();
      } else version = validateModel(this.paths);
      this.state(kind, {
        status: "ready",
        stage: "校验通过",
        version,
        error: undefined,
        progress: null,
      });
    } catch (e) {
      this.state(kind, {
        status: this.cancelled
          ? "cancelled"
          : kind === "dependencies" &&
              String(e).includes("No module named 'torch'")
            ? "missing"
            : fs.existsSync(
                  kind === "uv"
                    ? this.paths.uv
                    : kind === "model"
                      ? this.paths.model
                      : this.paths.python,
                )
              ? "error"
              : "missing",
        stage: this.cancelled ? "校验已取消" : "未就绪",
        error: String(e),
        progress: null,
      });
      throw e;
    } finally {
      if (!inspectionOwner) this.runtime.busy = null;
      this.changed();
    }
  }
  async inspect(kind: InstallKind): Promise<InstallPlan> {
    if (this.runtime.busy) throw Error("请等待当前安装或校验结束。");
    this.runtime.busy = kind;
    try {
      if (kind === "dependencies")
        await this.validate("python", kind).catch((e) => {
          if (this.cancelled) throw e;
        });
      let reason = "";
      try {
        await this.validate(kind, kind);
        return { kind, valid: true, blockers: [] };
      } catch (e) {
        if (this.cancelled) throw e;
        reason = String(e).replace(/^Error: /, "");
      }
      const prerequisites: InstallKind[] =
        kind === "uv" ? [] : kind === "python" ? ["uv"] : ["uv", "python"];
      const blockers: InstallKind[] = [];
      for (const item of prerequisites) {
        try {
          await this.validate(item, kind);
        } catch (e) {
          if (this.cancelled) throw e;
          blockers.push(item);
        }
      }
      return { kind, valid: false, reason, blockers };
    } finally {
      this.runtime.busy = null;
      this.changed();
    }
  }
  async install(kind: InstallKind, stopService?: () => void | Promise<void>) {
    const plan = await this.inspect(kind);
    if (plan.valid) {
      this.state(kind, { stage: "已有文件完整，已复用；无需重复下载" });
      return;
    }
    if (plan.blockers.length)
      throw Error("请先安装并校验：" + plan.blockers.join("、"));
    if (
      ["running", "starting", "stopping"].includes(this.runtime.service.status)
    ) {
      if (!stopService) throw Error("修复需要关闭模型服务，请确认后再执行。");
    }
    this.cancelled = false;
    this.runtime.busy = kind;
    this.state(kind, {
      status: "busy",
      stage: "准备安装",
      progress: null,
      error: undefined,
    });
    try {
      if (
        ["running", "starting", "stopping"].includes(
          this.runtime.service.status,
        )
      ) {
        this.state(kind, { stage: "等待模型进程退出后修复" });
        await stopService!();
      }
      if (this.cancelled) throw Error("操作已取消");
      if (kind === "uv") await this.installUv();
      else if (kind === "python") await this.installPython();
      else if (kind === "dependencies") {
        this.state(kind, { stage: "下载与安装 CUDA 推理依赖；已下载包会复用" });
        await this.run(this.paths.uv, [
          "pip",
          "install",
          "--python",
          this.paths.python,
          "-r",
          this.paths.inside("services/python/requirements-inference.txt"),
        ]);
        await this.run(this.paths.uv, [
          "pip",
          "install",
          "--python",
          this.paths.python,
          "-r",
          this.paths.inside("services/python/requirements-download.txt"),
        ]);
      } else {
        this.state(kind, { stage: "安装 ModelScope 下载组件" });
        await this.run(this.paths.uv, [
          "pip",
          "install",
          "--python",
          this.paths.python,
          "-r",
          this.paths.inside("services/python/requirements-download.txt"),
        ]);
        this.state(kind, { stage: "连接 ModelScope，读取文件清单" });
        await this.run(
          this.paths.python,
          [
            "-I",
            this.paths.inside("services/python/download_model.py"),
            this.paths.root,
          ],
          (message) => {
            try {
              const m = JSON.parse(message);
              if (m.type === "progress")
                this.state(kind, {
                  stage: m.stage,
                  downloaded: m.downloaded,
                  total: m.total,
                  progress: m.total
                    ? Math.min(99, (m.downloaded / m.total) * 100)
                    : null,
                });
            } catch {}
          },
        );
      }
      if (this.cancelled) throw Error("操作已取消");
      this.runtime.busy = null;
      await this.validate(kind);
      if (kind === "model")
        this.state(kind, { progress: 100, stage: "下载完成并校验通过" });
    } catch (e) {
      this.state(kind, {
        status: this.cancelled ? "cancelled" : "error",
        stage: this.cancelled ? "已取消，可继续安装" : "安装失败，可重试",
        error: this.cancelled ? undefined : String(e),
        progress: null,
      });
      this.log(String(e));
    } finally {
      this.runtime.busy = null;
      this.child = null;
      this.controller = null;
      this.changed();
    }
  }
  cancel() {
    this.cancelled = true;
    this.controller?.abort();
    this.child?.kill();
  }
  private async installUv() {
    if (process.platform !== "win32" || process.arch !== "x64")
      throw Error("当前发行版本支持 Windows x64。");
    this.controller = new AbortController();
    const options = {
      signal: this.controller.signal,
      headers: { "User-Agent": "breeze-tts-openui" },
    };
    const official =
      "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip";
    const asset = { browser_download_url: official },
      checksum = { browser_download_url: official + ".sha256" };
    const hashResponse = await fetch(checksum.browser_download_url, options);
    if (!hashResponse.ok) throw Error("无法下载 uv 校验值。");
    const expected = (await hashResponse.text())
      .trim()
      .split(/\s/)[0]
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected))
      throw Error("uv 官方校验文件格式无效。");
    const binary = await fetch(asset.browser_download_url, options);
    if (!binary.ok || !binary.body)
      throw Error("无法下载 uv：" + binary.status);
    const total = Number(binary.headers.get("content-length")) || 0,
      parts: Buffer[] = [];
    let downloaded = 0;
    this.state("uv", { stage: "下载 uv CLI", total, downloaded: 0 });
    for await (const chunk of binary.body) {
      const b = Buffer.from(chunk);
      parts.push(b);
      downloaded += b.length;
      if (downloaded > 100_000_000) throw Error("uv 发行包大小异常。");
      this.state("uv", {
        downloaded,
        total,
        progress: total ? (downloaded / total) * 100 : null,
      });
    }
    const buffer = Buffer.concat(parts);
    if (createHash("sha256").update(buffer).digest("hex") !== expected)
      throw Error("uv SHA256 校验失败，未执行该文件。");
    const zip = new AdmZip(buffer),
      entry = zip
        .getEntries()
        .find((e) => path.basename(e.entryName) === "uv.exe");
    if (!entry) throw Error("uv 发行包缺少 uv.exe。");
    fs.writeFileSync(this.paths.uv + ".pending", entry.getData());
    fs.renameSync(this.paths.uv + ".pending", this.paths.uv);
    this.state("uv", { stage: "执行版本校验", progress: null });
  }
  private async installPython() {
    this.state("python", { stage: "通过项目内 uv 下载 Python 3.11" });
    await this.run(this.paths.uv, ["python", "install", "3.11", "--no-config"]);
    const python = (
      await this.run(this.paths.uv, [
        "python",
        "find",
        "3.11",
        "--no-python-downloads",
        "--no-config",
      ])
    )
      .trim()
      .split(/\r?\n/)
      .at(-1)!;
    const executable = this.paths.inside(python);
    this.state("python", { stage: "创建项目内可迁移虚拟环境" });
    await this.run(this.paths.uv, [
      "venv",
      "--relocatable",
      "--allow-existing",
      "--python",
      executable,
      this.paths.inside(".runtime/venv"),
      "--no-config",
    ]);
    this.state("dependencies", {
      status: "missing",
      stage: "等待安装推理依赖",
      error: undefined,
      version: undefined,
    });
  }
  run(
    executable: string,
    args: string[],
    onLine?: (line: string) => void,
  ): Promise<string> {
    this.paths.inside(executable);
    if (executable === this.paths.python) {
      prepareInternalPython(this.paths);
      args = ["-X", "utf8", "-u", "-B", ...args];
    }
    return new Promise((resolve, reject) => {
      let output = "",
        error = "",
        pending = "";
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executable, args, {
          cwd: this.paths.root,
          env: this.paths.env(),
          windowsHide: true,
          stdio: "pipe",
        });
      } catch (e) {
        reject(e);
        return;
      }
      if (this.runtime.busy) this.child = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (b) => {
        output = (output + String(b)).slice(-100000);
        pending += String(b);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        for (const line of lines) {
          onLine?.(line);
          if (!line.startsWith("{")) this.log(line);
        }
      });
      child.stderr.on("data", (b) => {
        error = (error + String(b)).slice(-8000);
        this.log(String(b));
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (this.child === child) this.child = null;
        if (code === 0 && !this.cancelled) resolve(output);
        else
          reject(
            Error(
              this.cancelled
                ? "操作已取消"
                : error.trim() || `程序退出，代码 ${code}`,
            ),
          );
      });
    });
  }
}
