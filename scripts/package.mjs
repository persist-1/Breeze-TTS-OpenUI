import { fileURLToPath } from "node:url";
import { packagePortable } from "./portable-package.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
let lastPhase = "",
  lastPercent = -1;
const audit = await packagePortable(root, (phase, n, total) => {
  const percent = Math.floor((n / total) * 100);
  if (phase !== lastPhase || percent !== lastPercent) {
    console.log(`${phase}：${percent}% (${n}/${total})`);
    lastPhase = phase;
    lastPercent = percent;
  }
});
console.log(`免安装包：${audit.output}`);
console.log(`SHA-256：${audit.sha256}`);
