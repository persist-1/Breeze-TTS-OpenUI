// Inspect exported files and real Windows PE icon resources without rebuilding a release.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.join(
  root,
  ".runtime/brand-exe-review",
  String(Date.now()),
);
fs.mkdirSync(scratch, { recursive: true });
for (const key of ["TEMP", "TMP", "TMPDIR"]) process.env[key] = scratch;
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const read = (name) => fs.readFileSync(path.join(root, name));
const provenance = JSON.parse(read("licenses/provenance.json"));
for (const source of provenance.sources)
  assert.equal(hash(read(source.file)), source.sha256);
const ico = read("assets/brand/app.ico");
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 7);
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size, i) => {
  const p = 6 + i * 16;
  assert.equal(ico[p] || 256, size);
  assert.equal(ico[p + 1] || 256, size);
  const png = ico.subarray(
    ico.readUInt32LE(p + 12),
    ico.readUInt32LE(p + 12) + ico.readUInt32LE(p + 8),
  );
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
  assert.deepEqual(png, read(`assets/brand/icon-${size}.png`));
  return hash(png);
});
for (const name of ["logo.svg", "icon-32.png", "icon-256.png"])
  assert.deepEqual(
    read(`assets/brand/${name}`),
    read(`apps/desktop/public/brand/${name}`),
  );
const original = path.join(root, "node_modules/electron/dist/electron.exe");
const originalHash = hash(fs.readFileSync(original));
const exe = path.join(scratch, "OpenUI-icon-check.exe");
fs.copyFileSync(original, exe);
await rcedit(exe, {
  icon: path.join(root, "assets/brand/app.ico"),
  "version-string": {
    ProductName: "OpenUI",
    FileDescription: "OpenUI community speech workspace",
  },
});
assert.equal(
  hash(fs.readFileSync(original)),
  originalHash,
  "开发 Electron 不应被改动",
);
const pe = fs.readFileSync(exe);
const nt = pe.readUInt32LE(0x3c);
assert.equal(pe.toString("ascii", nt, nt + 4), "PE\0\0");
const opt = nt + 24;
const dirs = opt + (pe.readUInt16LE(opt) === 0x20b ? 112 : 96);
const sectionTable = opt + pe.readUInt16LE(nt + 20);
const sections = Array.from({ length: pe.readUInt16LE(nt + 6) }, (_, i) => {
  const p = sectionTable + i * 40;
  return {
    rva: pe.readUInt32LE(p + 12),
    size: Math.max(pe.readUInt32LE(p + 8), pe.readUInt32LE(p + 16)),
    offset: pe.readUInt32LE(p + 20),
  };
});
const offset = (rva) => {
  const section = sections.find((s) => rva >= s.rva && rva < s.rva + s.size);
  assert(section, "资源 RVA 需对应有效节");
  return section.offset + rva - section.rva;
};
const resources = offset(pe.readUInt32LE(dirs + 16));
const entries = [];
function walk(relative = 0, ids = []) {
  const dir = resources + relative;
  const count = pe.readUInt16LE(dir + 12) + pe.readUInt16LE(dir + 14);
  for (let i = 0; i < count; i++) {
    const p = dir + 16 + i * 8;
    const id = pe.readUInt32LE(p),
      next = pe.readUInt32LE(p + 4);
    if (next & 0x80000000) walk(next & 0x7fffffff, [...ids, id]);
    else {
      const data = resources + next;
      const start = offset(pe.readUInt32LE(data));
      entries.push({
        ids: [...ids, id],
        bytes: pe.subarray(start, start + pe.readUInt32LE(data + 4)),
      });
    }
  }
}
walk();
const icons = entries.filter((e) => e.ids[0] === 3);
const groups = entries.filter((e) => e.ids[0] === 14);
assert(
  groups.some((g) => g.bytes.readUInt16LE(4) === 7),
  "EXE 需含七尺寸图标组",
);
for (const png of pngs)
  assert(
    icons.some((i) => hash(i.bytes) === png),
    "EXE 需包含实际导出的每一档 PNG",
  );
fs.mkdirSync(path.join(root, ".impeccable/review/brand"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".impeccable/review/brand/artifacts.json"),
  JSON.stringify(
    {
      licenseHashesVerified: true,
      icoSizes: sizes,
      publicAssetsMatch: true,
      actualPeIconFramesVerified: true,
      originalElectronUnchanged: true,
      isolatedExecutable: exe,
      originalHash,
    },
    null,
    2,
  ),
);
console.log(
  "许可哈希、七尺寸 ICO、public 同步、真实 EXE 图标资源通过；已有程序与发行包未修改。",
);
