import fs from "node:fs";
import path from "node:path";
export class PortablePaths {
  readonly root: string;
  constructor(root: string) {
    this.root = fs.realpathSync(root);
    for (const p of [
      "data",
      "data/audio",
      "data/references",
      "data/exports",
      "data/logs",
      ".runtime/tmp",
      ".runtime/cache",
      ".runtime/home",
      ".runtime/uv",
      "models",
    ])
      fs.mkdirSync(this.inside(p), { recursive: true });
  }
  inside(relative: string): string {
    const resolved = path.resolve(this.root, relative);
    const rel = path.relative(this.root, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      throw new Error("路径必须位于应用目录内部。");
    let cursor = resolved;
    while (!fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    if (fs.existsSync(cursor)) {
      const real = fs.realpathSync(cursor),
        r = path.relative(this.root, real);
      if (r.startsWith("..") || path.isAbsolute(r))
        throw new Error("不能引用应用目录外的链接。");
    }
    return resolved;
  }
  relative(absolute: string): string {
    this.inside(absolute);
    return path.relative(this.root, absolute).replaceAll("\\", "/");
  }
  get uv() {
    return this.inside(".runtime/uv/uv.exe");
  }
  get python() {
    return this.inside(".runtime/venv/Scripts/python.exe");
  }
  get model() {
    return this.inside("models/Breeze-TTS-2");
  }
  env(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (/^(PYTHON|CONDA|VIRTUAL_ENV|UV_|HF_|MODELSCOPE)/.test(key))
        delete env[key];
    Object.assign(env, {
      HOME: this.inside(".runtime/home"),
      USERPROFILE: this.inside(".runtime/home"),
      APPDATA: this.inside("data/appdata"),
      LOCALAPPDATA: this.inside("data/appdata/local"),
      TEMP: this.inside(".runtime/tmp"),
      TMP: this.inside(".runtime/tmp"),
      TMPDIR: this.inside(".runtime/tmp"),
      UV_CACHE_DIR: this.inside(".runtime/cache/uv"),
      UV_PYTHON_INSTALL_DIR: this.inside(".runtime/python"),
      UV_PYTHON_BIN_DIR: this.inside(".runtime/bin"),
      UV_TOOL_DIR: this.inside(".runtime/tools"),
      UV_TOOL_BIN_DIR: this.inside(".runtime/bin"),
      UV_PYTHON_PREFERENCE: "only-managed",
      UV_PYTHON_INSTALL_BIN: "0",
      UV_PYTHON_INSTALL_REGISTRY: "0",
      UV_NO_MODIFY_PATH: "1",
      UV_NO_CONFIG: "1",
      UV_NO_SYSTEM_CONFIG: "1",
      UV_LINK_MODE: "copy",
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1",
      HF_HOME: this.inside(".runtime/cache/huggingface"),
      HF_HUB_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
      GRADIO_ANALYTICS_ENABLED: "False",
      GRADIO_TEMP_DIR: this.inside(".runtime/tmp/gradio"),
      TRANSFORMERS_OFFLINE: "1",
      MODELSCOPE_CACHE: this.inside(".runtime/cache/modelscope"),
      XDG_CACHE_HOME: this.inside(".runtime/cache"),
      XDG_CONFIG_HOME: this.inside(".runtime/config"),
      XDG_DATA_HOME: this.inside("data"),
      XDG_STATE_HOME: this.inside("data/state"),
      PATH: [
        this.inside(".runtime/venv/Scripts"),
        this.inside(".runtime/uv"),
        path.join(process.env.SystemRoot || "C:/Windows", "System32"),
        process.env.SystemRoot || "C:/Windows",
      ].join(path.delimiter),
      TORCH_HOME: this.inside(".runtime/cache/torch"),
      TORCH_EXTENSIONS_DIR: this.inside(".runtime/cache/torch-extensions"),
      TORCHINDUCTOR_CACHE_DIR: this.inside(".runtime/cache/torch-inductor"),
      CUDA_CACHE_PATH: this.inside(".runtime/cache/cuda"),
      TRITON_CACHE_DIR: this.inside(".runtime/cache/triton"),
      NUMBA_CACHE_DIR: this.inside(".runtime/cache/numba"),
      MPLCONFIGDIR: this.inside(".runtime/cache/matplotlib"),
      PIP_CACHE_DIR: this.inside(".runtime/cache/pip"),
      NO_COLOR: "1",
    });
    for (const name of [
      "HOME",
      "APPDATA",
      "LOCALAPPDATA",
      "UV_CACHE_DIR",
      "UV_PYTHON_INSTALL_DIR",
      "UV_PYTHON_BIN_DIR",
      "UV_TOOL_DIR",
      "HF_HOME",
      "MODELSCOPE_CACHE",
      "TORCH_HOME",
      "TORCH_EXTENSIONS_DIR",
    ])
      fs.mkdirSync(env[name]!, { recursive: true });
    return env;
  }
}
