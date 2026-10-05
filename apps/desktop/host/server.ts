import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type {
  Command,
  Snapshot,
} from "../../../packages/contracts/src/index.ts";
import { PortablePaths } from "./paths.ts";
import { Repository } from "./repository.ts";
import { Installer } from "./installer.ts";
import { Scheduler } from "./scheduler.ts";
import { editWorkspace, uid } from "./domain.ts";
import { inspectWav } from "./audio.ts";
import { makeBackup, importBackup } from "./backup.ts";
import { readWaveform } from "./waveform.ts";

export async function createHost(root: string, port = 0, renderer?: string) {
  const paths = new PortablePaths(root),
    repo = new Repository(paths);
  let version = 0;
  const waveforms = new Map<
    string,
    { stamp: string; value: ReturnType<typeof readWaveform> }
  >();
  let scheduler: Scheduler;
  const installer = new Installer(paths, () => {
    version++;
    scheduler?.tick();
  });
  scheduler = new Scheduler(repo, installer, () => version++);
  const snapshot = (): Snapshot => ({
    workspace: repo.workspace,
    runtime: installer.runtime,
  });
  const json = (res: http.ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const body = async (req: http.IncomingMessage, max = 1_000_000) => {
    let size = 0;
    const parts: Buffer[] = [];
    for await (const data of req) {
      const b = Buffer.from(data);
      size += b.length;
      if (size > max) throw Error("文件或请求超过允许大小。");
      parts.push(b);
    }
    return Buffer.concat(parts);
  };
  const file = (
    res: http.ServerResponse,
    filename: string,
    mime: string,
    download?: string,
    range?: string,
  ) => {
    if (!fs.existsSync(filename))
      throw Error("文件已移除，请从记录中删除失效音频。");
    const size = fs.statSync(filename).size;
    let start = 0,
      end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      start = match[1]
        ? Number(match[1])
        : Math.max(0, size - Number(match[2]));
      end =
        match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      ) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": mime,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      "Cache-Control": "no-store",
      ...(download
        ? {
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download)}`,
          }
        : {}),
    });
    fs.createReadStream(filename, { start, end }).pipe(res);
  };
  let address = "";
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(address).host) {
        json(res, { error: "无效的本地地址" }, 403);
        return;
      }
      const url = new URL(req.url || "/", address),
        route = url.pathname;
      if (
        req.method === "POST" &&
        ![address, "http://127.0.0.1:4320"].includes(String(req.headers.origin))
      ) {
        json(res, { error: "请求来源不受信任" }, 403);
        return;
      }
      if (route === "/api/snapshot") {
        json(res, { ...snapshot(), version });
        return;
      }
      if (route === "/api/backup" && req.method === "GET") {
        const buffer = makeBackup(repo),
          name = "Breeze-工作区-" + Date.now() + ".zip";
        const target = paths.inside("data/exports/" + name);
        fs.writeFileSync(target, buffer);
        file(res, target, "application/zip", name);
        return;
      }
      if (route === "/api/backup" && req.method === "POST") {
        if (
          repo.workspace.tasks.some((t) =>
            ["preparing", "running"].includes(t.status),
          )
        )
          throw Error("请先结束当前生成再导入备份。");
        const result = importBackup(repo, await body(req, 500_000_000));
        json(res, { ...snapshot(), imported: result });
        return;
      }
      if (route.startsWith("/api/stream/")) {
        const id = route.split("/").at(-1)!,
          t = repo.workspace.tasks.find((t) => t.id === id);
        if (!t?.stream) {
          res.writeHead(204);
          res.end();
          return;
        }
        const from = Math.max(0, Number(url.searchParams.get("from") || 0));
        if (!Number.isInteger(from) || from % 2 || from > t.stream.bytes)
          throw Error("无效音频帧位置");
        const count = t.stream.bytes - from;
        if (!count) {
          res.writeHead(204);
          res.end();
          return;
        }
        const fd = fs.openSync(paths.inside(t.stream.file), "r"),
          pcm = Buffer.alloc(count);
        try {
          fs.readSync(fd, pcm, 0, count, from);
        } finally {
          fs.closeSync(fd);
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "X-Sample-Rate": String(t.stream.sampleRate),
          "X-Next-Offset": String(t.stream.bytes),
          "Cache-Control": "no-store",
        });
        res.end(pcm);
        return;
      }
      if (route === "/api/install-plan" && req.method === "POST") {
        const { kind } = JSON.parse((await body(req)).toString());
        if (!["uv", "python", "dependencies", "model"].includes(kind))
          throw Error("安装项无效");
        json(res, await installer.inspect(kind));
        return;
      }
      if (route === "/api/command" && req.method === "POST") {
        const c = JSON.parse((await body(req)).toString()) as Command;
        if (c.type === "service.start") await scheduler.start();
        else if (c.type === "service.stop") await scheduler.stop();
        else if (c.type === "install.start") {
          if (
            !["uv", "python", "dependencies", "model"].includes(String(c.value))
          )
            throw Error("安装项无效");
          void installer
            .install(
              c.value as any,
              c.patch?.stopService === true
                ? () => scheduler.stop()
                : undefined,
            )
            .catch((e) => installer.log(String(e)));
        } else if (c.type === "install.validate") {
          if (
            !["uv", "python", "dependencies", "model"].includes(String(c.value))
          )
            throw Error("校验项无效");
          await installer.validate(c.value as any);
        } else if (c.type === "install.cancel") installer.cancel();
        else if (c.type === "task.create")
          scheduler.enqueue(
            c.projectId || repo.workspace.currentProjectId,
            !!c.all,
          );
        else if (c.type === "task.retry") scheduler.retry(c.id!);
        else if (c.type === "task.cancel") scheduler.cancel(c.id!);
        else if (c.type === "delete") repo.delete(String(c.value), c.id!);
        else if (c.type === "reference.discard") {
          if (!/^[a-f\d-]{36}$/.test(c.id || "")) throw Error("无效录音标识");
          if (
            !repo.workspace.voices.some((v) => v.assetId === c.id) &&
            !repo.workspace.tasks.some((t) =>
              t.units.some((u) => u.input.reference?.assetId === c.id),
            ) &&
            !repo.workspace.outputs.some(
              (o) => o.input.reference?.assetId === c.id,
            )
          )
            fs.rmSync(paths.inside(`data/references/${c.id}.wav`), {
              force: true,
            });
        } else {
          repo.transaction((w) => editWorkspace(w, c));
          scheduler.tick();
        }
        json(res, snapshot());
        return;
      }
      if (route === "/api/reference" && req.method === "POST") {
        const bytes = await body(req, 60_000_000),
          meta = inspectWav(bytes),
          id = uid();
        fs.writeFileSync(paths.inside(`data/references/${id}.wav`), bytes);
        json(res, { id, duration: meta.duration });
        return;
      }
      if (route.startsWith("/api/waveform/")) {
        const [, , , kind, id] = route.split("/");
        let filename: string;
        if (kind === "audio") {
          const o = repo.workspace.outputs.find((o) => o.id === id);
          if (!o) throw Error("音频记录不存在。");
          filename = paths.inside(o.file);
        } else if (kind === "reference" && /^[a-f\d-]{36}$/.test(id || ""))
          filename = paths.inside(`data/references/${id}.wav`);
        else throw Error("音频标识无效。");
        const stat = fs.statSync(filename),
          stamp = stat.size + ":" + stat.mtimeMs,
          old = waveforms.get(filename);
        const value = old?.stamp === stamp ? old.value : readWaveform(filename);
        if (waveforms.size >= 128)
          waveforms.delete(waveforms.keys().next().value!);
        waveforms.set(filename, { stamp, value });
        json(res, value);
        return;
      }
      if (route.startsWith("/api/reference/")) {
        const id = route.split("/").at(-1)!;
        if (!/^[a-f\d-]{36}$/.test(id)) throw Error("无效录音标识。");
        file(
          res,
          paths.inside(`data/references/${id}.wav`),
          "audio/wav",
          undefined,
          req.headers.range,
        );
        return;
      }
      if (route.startsWith("/api/audio/")) {
        const id = route.split("/").at(-1)!,
          output = repo.workspace.outputs.find((o) => o.id === id);
        if (!output) throw Error("音频记录不存在。");
        file(
          res,
          paths.inside(output.file),
          "audio/wav",
          url.searchParams.has("download") ? output.name + ".wav" : undefined,
          req.headers.range,
        );
        return;
      }
      if (route.startsWith("/api/")) {
        json(res, { error: "接口不存在" }, 404);
        return;
      }
      if (renderer) {
        let relative = decodeURIComponent(route).replace(/^\/+/, ""),
          target = paths.inside(path.join(renderer, relative || "index.html"));
        const rendererRelative = path.relative(renderer, target);
        if (
          rendererRelative.startsWith("..") ||
          path.isAbsolute(rendererRelative)
        )
          throw Error("无法访问工作区之外的静态资源。");
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory())
          target = paths.inside(path.join(renderer, "index.html"));
        const ext = path.extname(target),
          mimes: Record<string, string> = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
          };
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
        file(res, target, mimes[ext] || "application/octet-stream");
        return;
      }
      json(res, { error: "请通过 Vite 开发预览打开界面" }, 404);
    } catch (e) {
      if (!res.headersSent)
        json(res, { error: String(e).replace(/^Error: /, "") }, 400);
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  address = `http://127.0.0.1:${(server.address() as any).port}`;
  void installer.probe();
  return {
    server,
    address,
    paths,
    repo,
    installer,
    scheduler,
    snapshot,
    close: () => {
      scheduler.shutdown();
      server.close();
    },
  };
}
