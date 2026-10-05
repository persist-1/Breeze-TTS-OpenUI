import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Installer } from "../apps/desktop/host/installer.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
const paths = new PortablePaths(process.cwd()),
  i = new Installer(paths, () => {});
i.runtime.service.status = "running";
// Any network during intact-resource reinstall is a regression.
globalThis.fetch = async () => {
  throw Error("Unexpected network during resource reuse");
};
const files = [
    paths.uv,
    paths.python,
    path.join(paths.model, "model.safetensors.index.json"),
  ],
  before = files.map((f) => fs.statSync(f).mtimeMs);
const verified = [];
for (const kind of ["uv", "python", "dependencies", "model"] as const) {
  const plan = await i.inspect(kind);
  assert(plan.valid, kind + ": " + plan.reason);
  await i.install(kind);
  assert.equal(i.runtime.service.status, "running");
  verified.push({
    kind,
    version: i.runtime[kind].version,
    stage: i.runtime[kind].stage,
  });
}
assert.deepEqual(
  files.map((f) => fs.statSync(f).mtimeMs),
  before,
);
fs.writeFileSync(
  paths.inside(".impeccable/review/refinement/resource-reuse.json"),
  JSON.stringify(
    { verified, networkCalls: 0, resourceFilesUnchanged: true },
    null,
    2,
  ),
);
console.log(
  "All four real internal resources reused without network or stopping service.",
);
