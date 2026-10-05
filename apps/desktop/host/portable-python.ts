import fs from "node:fs";
import path from "node:path";
import { PortablePaths } from "./paths.ts";
export function prepareInternalPython(paths: PortablePaths) {
  const file = paths.inside(".runtime/venv/pyvenv.cfg");
  if (!fs.existsSync(file)) throw Error("尚未安装 Python，请在设置中下载。");
  let config = fs.readFileSync(file, "utf8");
  const home = config.match(/^home\s*=\s*(.+)$/m)?.[1].trim();
  if (!home) throw Error("内部 Python 配置不完整，请重新安装。");
  const venv = paths.inside(".runtime/venv");
  let target = path.isAbsolute(home) ? home : path.resolve(venv, home);
  try {
    paths.inside(target);
  } catch {
    const portable = paths.inside(
      path.join(".runtime/python", path.basename(home)),
    );
    if (!fs.existsSync(path.join(portable, "python.exe")))
      throw Error("迁移后的 Python 未找到内部解释器，请在设置中重新安装。");
    target = portable;
    config = config.replace(/^home\s*=.*$/m, "home = " + portable);
    fs.writeFileSync(file, config);
  }
  paths.inside(path.join(target, "python.exe"));
  if (!fs.existsSync(path.join(target, "python.exe")))
    throw Error("内部 Python 文件缺失，请重新安装。");
  return paths.python;
}
