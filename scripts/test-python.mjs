import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
const paths = new PortablePaths(process.cwd());
if (!fs.existsSync(paths.python))
  throw Error("请先从应用设置安装项目内 Python；不会使用系统 Python。");
const code =
  "import ast, pathlib, sys; root=pathlib.Path(sys.argv[1]).resolve(); assert pathlib.Path(sys.executable).resolve().is_relative_to(root); files=list((root/'services'/'python').rglob('*.py')); [ast.parse(f.read_text(encoding='utf-8-sig'),filename=str(f)) for f in files]; print(f'{len(files)} Python source files parsed; internal interpreter confirmed')";
const run = spawnSync(paths.python, ["-I", "-c", code, paths.root], {
  cwd: paths.root,
  env: paths.env(),
  encoding: "utf8",
  windowsHide: true,
});
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
process.exit(run.status || 0);
