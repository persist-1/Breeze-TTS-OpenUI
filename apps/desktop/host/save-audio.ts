import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AudioSaveResult } from "../../../packages/contracts/src/index.ts";
import type { Repository } from "./repository.ts";

export function audioFilename(name: string) {
  let clean =
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .replace(/[. ]+$/, "")
      .slice(0, 180) || "音频";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))
    clean = "_" + clean;
  return /\.wav$/i.test(clean) ? clean : clean + ".wav";
}
const contained = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};
export function createAudioSaver(
  repo: Repository,
  choose: (defaultPath: string) => Promise<string | null>,
) {
  let pending = false;
  const source = (id: string) => {
    if (typeof id !== "string") throw Error("音频标识无效。");
    const output = repo.workspace.outputs.find((o) => o.id === id);
    if (!output) throw Error("音频记录已删除，无法保存。");
    const file = repo.paths.inside(output.file);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      throw Error("音频文件已移除，无法保存。");
    return { file, name: audioFilename(output.name) };
  };
  return async (id: string): Promise<AudioSaveResult> => {
    if (pending) throw Error("请先完成或取消当前保存窗口。");
    pending = true;
    let temporary: string | undefined;
    try {
      const output = source(id);
      const selected = await choose(
        repo.paths.inside(path.join("data/exports", output.name)),
      );
      if (!selected) return { status: "cancelled" };
      if (
        !path.isAbsolute(selected) ||
        path.extname(selected).toLowerCase() !== ".wav"
      )
        throw Error("请选择带 .wav 扩展名的音频文件位置。");
      const parent = await fs.promises.realpath(path.dirname(selected));
      const target = path.join(parent, path.basename(selected));
      if (
        contained(repo.paths.root, target) &&
        !contained(repo.paths.inside("data/exports"), target)
      )
        throw Error(
          "应用目录内请保存到 data/exports，避免覆盖工作区或运行资源。",
        );
      if (fs.existsSync(target)) {
        const stat = await fs.promises.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw Error("目标不是普通文件，请选择其他保存位置。");
      }
      // Recheck after the dialog: the user may have deleted the result meanwhile.
      const current = source(id);
      temporary = path.join(
        parent,
        "." + path.basename(target) + ".breeze-" + randomUUID() + ".tmp",
      );
      await fs.promises.copyFile(
        current.file,
        temporary,
        fs.constants.COPYFILE_EXCL,
      );
      await fs.promises.rename(temporary, target);
      temporary = undefined;
      return { status: "saved", name: path.basename(target) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT")
        throw Error("音频文件或保存目录已移除，请重新选择。");
      if (["EACCES", "EPERM", "EBUSY"].includes(code || ""))
        throw Error("无法写入所选位置，请关闭占用文件的程序或选择其他目录。");
      if (code === "ENOSPC") throw Error("保存位置空间不足，请选择其他目录。");
      throw error;
    } finally {
      if (temporary)
        await fs.promises.rm(temporary, { force: true }).catch(() => {});
      pending = false;
    }
  };
}
