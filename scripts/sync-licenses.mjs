// Retrieve license texts verbatim; never synthesize or edit their legal clauses.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const revision = "3e28c5151381a722f1d8661b4118c298caa77aa4";
const sources = [
  { file: "LICENSE", url: "https://www.apache.org/licenses/LICENSE-2.0.txt" },
  {
    file: "MODEL_LICENSE",
    url: `https://huggingface.co/BreezeBlue/Breeze-TTS-2/resolve/${revision}/LICENSE`,
    revision,
  },
];
const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw Error(`许可下载失败 ${r.status}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
};
const downloads = await Promise.all(
  sources.map(async (s) => ({ ...s, bytes: await get(s.url) })),
);
const apache = downloads[0].bytes.toString("utf8");
const model = downloads[1].bytes.toString("utf8");
if (
  !apache.includes("Apache License") ||
  !apache.includes("Version 2.0, January 2004") ||
  !apache.includes("END OF TERMS AND CONDITIONS")
)
  throw Error("Apache 模板内容校验失败。");
if (
  !model.startsWith(
    "BREEZEBLUE RESEARCH AND NON-COMMERCIAL LICENSE AGREEMENT",
  ) ||
  !model.includes("Version 1.1") ||
  !model.includes("7.4 Trademarks.")
)
  throw Error("模型协议内容校验失败。");
const mirrorUrl =
  "https://www.modelscope.cn/models/BreezeBlue/Breeze-TTS-2/resolve/master/LICENSE";
const mirror = await get(mirrorUrl);
if (!mirror.equals(downloads[1].bytes))
  throw Error(
    "ModelScope 与固定版本官方模型协议不一致，请人工复核；未写入任何许可文件。",
  );
const notice = model.match(
  /"(Breeze TTS 2 is licensed under the BreezeBlue Research and Non-Commercial[\s\S]*?All Rights Reserved\.)"/,
);
if (!notice) throw Error("未找到模型协议要求的完整署名声明。");
const manifest = downloads.map(({ bytes, ...s }) => ({
  ...s,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
}));
await fs.mkdir(path.join(root, "licenses"), { recursive: true });
for (const item of downloads)
  await fs.writeFile(path.join(root, item.file), item.bytes);
await fs.writeFile(
  path.join(root, "NOTICE"),
  [
    "breeze-tts-openui — independent community frontend",
    "Copyright 2026 breeze-tts-openui contributors.",
    "Application source code: Apache License, Version 2.0 (LICENSE).",
    "Upstream inference code: https://github.com/breezeblue-ai/breeze-tts",
    "Vendored source attribution: services/python/vendor/breeze/NOTICE.md",
    "",
    "Model license notice (verbatim from official agreement, Section 4):",
    notice[1],
    "",
    "Model weights are downloaded separately; they are not included in the application ZIP.",
    "MODEL_LICENSE applies to model materials and self-hosted outputs, not to Apache-licensed code.",
    "This community project is not affiliated with or endorsed by BreezeBlue / RESONIA, INC.",
    "No upstream trademark or logo license is granted by this project.",
    "",
  ].join("\n"),
);
await fs.writeFile(
  path.join(root, "licenses/provenance.json"),
  JSON.stringify(
    {
      retrievedAt: new Date().toISOString(),
      sources: manifest,
      modelScopeMirror: { url: mirrorUrl, matchesPinnedModelLicense: true },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "已取得 Apache 官方模板及未修改的模型自定义协议；ModelScope/Hugging Face 原文一致。",
);
console.log(manifest.map((s) => `${s.file}: ${s.sha256}`).join("\n"));
