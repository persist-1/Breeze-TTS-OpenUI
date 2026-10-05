import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Task, Unit } from "../../../packages/contracts/src/index.ts";
import { Installer } from "./installer.ts";
import { Repository } from "./repository.ts";
import { uid, unitsFor } from "./domain.ts";
import { wavHeader } from "./audio.ts";

export class Scheduler {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private current: {
    task: Task;
    unit: Unit;
    file: string;
    rate: number;
    bytes: number;
  } | null = null;
  private cancelTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private stoppingPromise: Promise<void> | null = null;
  constructor(
    readonly repo: Repository,
    readonly installer: Installer,
    readonly changed: () => void,
  ) {}
  get running() {
    return this.installer.runtime.service.status === "running";
  }
  async start() {
    if (
      this.worker ||
      this.stoppingPromise ||
      this.installer.runtime.busy ||
      this.installer.runtime.service.status === "starting"
    )
      throw Error("当前正在运行或安装，请等待。");
    this.installer.runtime.service = {
      status: "starting",
      message: "正在加载模型与音频解码器…",
    };
    this.changed();
    try {
      for (const kind of ["python", "dependencies", "model"] as const)
        await this.installer.validate(kind);
    } catch (e) {
      this.installer.runtime.service = {
        status: "error",
        message: "运行资源未就绪",
        error: String(e),
      };
      this.changed();
      throw e;
    }
    this.stopping = false;
    const p = this.repo.paths;
    const child = spawn(
      p.python,
      [
        "-X",
        "utf8",
        "-u",
        "-B",
        "-I",
        p.inside("services/python/worker.py"),
        p.root,
      ],
      { cwd: p.root, env: p.env(), windowsHide: true, stdio: "pipe" },
    );
    this.worker = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let pending = "";
    child.stdout.on("data", (b) => {
      if (this.worker !== child) return;
      pending += String(b);
      if (pending.length > 8_000_000) {
        this.fail("模型返回的数据超出协议限制。");
        return;
      }
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        try {
          this.message(JSON.parse(line));
        } catch (e) {
          this.fail("模型输出处理失败：" + String(e));
        }
      }
    });
    child.stderr.on("data", (b) => this.installer.log(String(b)));
    child.on("error", (e) => {
      if (this.worker === child) this.fail(String(e));
    });
    child.on("close", (code) => {
      if (this.worker !== child) return;
      this.worker = null;
      if (this.stopping) {
        this.installer.runtime.service = {
          status: "stopped",
          message: "模型服务已关闭",
        };
      } else this.fail(`模型进程已退出（${code}）。请查看设置中的运行日志。`);
      this.changed();
    });
  }
  stop(): Promise<void> {
    if (this.stoppingPromise) return this.stoppingPromise;
    this.stopping = true;
    this.installer.runtime.service = {
      status: "stopping",
      message: "正在关闭模型服务…",
    };
    this.interrupt("服务已关闭，已完成音频保留。");
    const child = this.worker;
    this.worker = null;
    this.changed();
    this.stoppingPromise = new Promise<void>((resolve, reject) => {
      if (
        !child ||
        typeof child.once !== "function" ||
        child.exitCode != null
      ) {
        child?.kill();
        resolve();
        return;
      }
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        this.worker = child;
        reject(Error("模型进程尚未退出，修复未开始。请稍后重试。"));
      }, 15000);
      const closed = () => {
        clearTimeout(timeout);
        if (timedOut) {
          if (this.worker === child) this.worker = null;
          this.installer.runtime.service = {
            status: "stopped",
            message: "模型服务已关闭",
          };
          this.changed();
        }
        resolve();
      };
      child.once("close", closed);
      child.kill();
    })
      .then(() => {
        this.installer.runtime.service = {
          status: "stopped",
          message: "模型服务已关闭",
        };
      })
      .catch((e) => {
        this.installer.runtime.service = {
          status: "stopping",
          message: "等待模型进程退出，请稍后重试修复",
          error: String(e),
        };
        throw e;
      })
      .finally(() => {
        this.stoppingPromise = null;
        this.changed();
      });
    return this.stoppingPromise;
  }
  shutdown() {
    void this.stop().catch((e) => this.installer.log(String(e)));
    this.installer.cancel();
  }
  private fail(message: string) {
    this.interrupt(message);
    const child = this.worker;
    this.worker = null;
    child?.kill();
    this.installer.runtime.service = {
      status: "error",
      message: "模型服务异常",
      error: message,
    };
    this.installer.log(message);
    this.changed();
  }
  private interrupt(message: string) {
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    this.cancelTimer = null;
    if (this.current) {
      const { task, file } = this.current;
      this.repo.transaction((w) => {
        const t = w.tasks.find((t) => t.id === task.id)!;
        t.status = "interrupted";
        delete t.cancelRequested;
        t.error = message;
        delete t.stream;
        t.events.push({ at: Date.now(), message });
      });
      fs.rmSync(file, { force: true });
      this.current = null;
    }
  }
  enqueue(projectId: string, all: boolean) {
    if (!this.running) throw Error("请先启动模型服务。");
    this.requireResources();
    this.repo.transaction((w) => {
      const p = w.projects.find((p) => p.id === projectId);
      if (!p) throw Error("作品不存在。");
      const units = unitsFor(p, w, all, this.installer.runtime.model.version!);
      for (const u of units)
        if (
          u.input.reference &&
          !fs.existsSync(
            this.repo.paths.inside(
              `data/references/${u.input.reference.assetId}.wav`,
            ),
          )
        )
          throw Error("参考录音文件缺失，请重新导入。");
      w.tasks.unshift({
        id: uid(),
        projectId: p.id,
        projectTitle: p.title,
        createdAt: Date.now(),
        status: "queued",
        attempts: 0,
        units,
        error: null,
        events: [{ at: Date.now(), message: "等待生成" }],
      });
    });
    this.tick();
  }
  retry(id: string) {
    if (!this.running) throw Error("请先启动模型服务。");
    this.requireResources();
    this.repo.transaction((w) => {
      const t = w.tasks.find((t) => t.id === id);
      if (!t || !["failed", "interrupted", "cancelled"].includes(t.status))
        throw Error("该任务无法继续。");
      if (
        t.units.some(
          (u) => u.input.model !== this.installer.runtime.model.version,
        )
      )
        throw Error("模型文件已变化，请从草稿新建任务，避免混用不同模型。");
      for (const u of t.units)
        if (
          !u.outputId &&
          u.input.reference &&
          !fs.existsSync(
            this.repo.paths.inside(
              `data/references/${u.input.reference.assetId}.wav`,
            ),
          )
        )
          throw Error("原参考录音已删除。");
      t.status = "queued";
      t.error = null;
      t.events.push({ at: Date.now(), message: "继续未完成部分" });
    });
    this.tick();
  }
  private resourcesReady() {
    return (
      !this.installer.runtime.busy &&
      ["python", "dependencies", "model"].every(
        (k) => this.installer.runtime[k as "python"].status === "ready",
      )
    );
  }
  private requireResources() {
    if (!this.resourcesReady())
      throw Error("运行资源正在校验或未就绪，请到设置完成校验／修复后继续。");
  }
  cancel(id: string) {
    const task = this.repo.workspace.tasks.find((t) => t.id === id);
    if (!task) throw Error("任务不存在。");
    if (this.current?.task.id === id) {
      if (this.cancelTimer) return;
      this.repo.transaction((w) => {
        const t = w.tasks.find((t) => t.id === id)!;
        t.cancelRequested = true;
        t.events.push({ at: Date.now(), message: "正在取消，已完成音频保留" });
      });
      this.worker?.stdin.write(JSON.stringify({ type: "cancel" }) + "\n");
      this.cancelTimer = setTimeout(
        () => this.fail("任务未及时响应取消，模型服务已关闭。已完成音频保留。"),
        10000,
      );
    } else
      this.repo.transaction((w) => {
        const t = w.tasks.find((t) => t.id === id)!;
        if (t.status === "queued") {
          t.status = "cancelled";
          t.events.push({ at: Date.now(), message: "已取消排队" });
        }
      });
    this.changed();
  }
  tick() {
    if (!this.running || this.current || !this.resourcesReady()) return;
    const task =
      this.repo.workspace.tasks.find((t) => t.status === "running") ||
      this.repo.workspace.tasks.toReversed().find((t) => t.status === "queued");
    if (!task) return;
    const unit = task.units.find((u) => u.outputId === null);
    if (!unit) {
      this.repo.transaction((w) => {
        const t = w.tasks.find((t) => t.id === task.id)!;
        t.status = "completed";
        t.events.push({ at: Date.now(), message: "生成完成" });
      });
      this.changed();
      this.tick();
      return;
    }
    const file = this.repo.paths.inside(`data/audio/${unit.id}.pcm.part`);
    fs.writeFileSync(file, Buffer.alloc(0));
    this.current = { task, unit, file, rate: 24000, bytes: 0 };
    this.repo.transaction((w) => {
      const t = w.tasks.find((t) => t.id === task.id)!;
      if (t.status === "queued") {
        t.attempts++;
        t.events.push({ at: Date.now(), message: `第 ${t.attempts} 次运行` });
      }
      t.status = "preparing";
    });
    this.worker!.stdin.write(
      JSON.stringify({
        type: "generate",
        id: unit.id,
        input: { ...unit.input, seed: unit.input.seed + unit.index },
      }) + "\n",
    );
    this.changed();
  }
  private message(m: any) {
    if (m.type === "stage") {
      this.installer.runtime.service.message = m.message;
      this.changed();
      return;
    }
    if (m.type === "ready") {
      this.installer.runtime.service = {
        status: "running",
        message: "模型服务已启动",
      };
      this.changed();
      this.tick();
      return;
    }
    if (m.type === "fatal") {
      this.fail(m.message);
      return;
    }
    const c = this.current;
    if (!c || m.id !== c.unit.id) return;
    if (m.type === "pcm") {
      const bytes = Buffer.from(m.data, "base64");
      if (
        ![16000, 22050, 24000, 44100, 48000].includes(m.sampleRate) ||
        bytes.length % 2
      )
        throw Error("无效音频帧。");
      if (c.bytes && c.rate !== m.sampleRate)
        throw Error("音频采样率发生变化。");
      c.rate = m.sampleRate;
      fs.appendFileSync(c.file, bytes);
      c.bytes += bytes.length;
      const t = this.repo.workspace.tasks.find((t) => t.id === c.task.id)!;
      t.status = "running";
      t.stream = {
        file: this.repo.paths.relative(c.file),
        sampleRate: c.rate,
        bytes: c.bytes,
      };
      this.changed();
      return;
    }
    if (!["done", "error", "cancelled"].includes(m.type)) return;
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    this.cancelTimer = null;
    if (m.type === "done" && c.bytes) {
      const id = uid(),
        relative = `data/audio/${id}.wav`,
        target = this.repo.paths.inside(relative);
      const pcm = fs.readFileSync(c.file);
      fs.writeFileSync(
        target + ".pending",
        Buffer.concat([wavHeader(c.rate, pcm.length), pcm]),
      );
      fs.renameSync(target + ".pending", target);
      try {
        this.repo.transaction((w) => {
          w.outputs.unshift({
            id,
            taskId: c.task.id,
            projectId: c.task.projectId,
            segmentId: c.unit.segmentId,
            name: `${c.unit.segmentName} · ${c.unit.index + 1}`,
            createdAt: Date.now(),
            file: relative,
            duration: c.bytes / (c.rate * 2),
            input: c.unit.input,
            candidateSeed: c.unit.input.seed + c.unit.index,
            feedback: "",
            truncated: !!m.truncated,
          });
          const t = w.tasks.find((t) => t.id === c.task.id)!;
          t.units.find((u) => u.id === c.unit.id)!.outputId = id;
          t.status = t.cancelRequested ? "cancelled" : "running";
          delete t.cancelRequested;
          delete t.stream;
        });
      } catch (e) {
        fs.rmSync(target, { force: true });
        throw e;
      }
    } else
      this.repo.transaction((w) => {
        const t = w.tasks.find((t) => t.id === c.task.id)!;
        t.status = m.type === "cancelled" ? "cancelled" : "failed";
        t.error =
          m.type === "cancelled"
            ? null
            : m.message || "模型未返回音频，请调整文稿后重试。";
        delete t.stream;
        delete t.cancelRequested;
        t.events.push({
          at: Date.now(),
          message: t.error || "已取消；已完成音频保留",
        });
      });
    fs.rmSync(c.file, { force: true });
    this.current = null;
    this.changed();
    if (m.fatal) {
      this.fail(m.message);
      return;
    }
    this.tick();
  }
}
