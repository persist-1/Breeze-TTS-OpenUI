import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fresh, editWorkspace } from "../apps/desktop/host/domain.ts";
import {
  repairSegmentNames,
  segmentNameKey,
} from "../packages/contracts/src/segment-names.ts";
import { Installer } from "../apps/desktop/host/installer.ts";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
test("segment names reject normalized duplicates, preserve custom name on split, and skip occupied defaults", () => {
  const w = fresh(),
    p = w.projects[0],
    first = p.segments[0];
  editWorkspace(w, {
    type: "segment.update",
    segmentId: first.id,
    patch: { name: " 序章 " },
  });
  editWorkspace(w, { type: "segment.create" });
  const second = p.segments[1];
  assert.throws(
    () =>
      editWorkspace(w, {
        type: "segment.update",
        segmentId: second.id,
        patch: { name: "序章" },
      }),
    /同名/,
  );
  editWorkspace(w, {
    type: "segment.update",
    segmentId: second.id,
    patch: { name: "ＡＢＣ" },
  });
  assert.throws(
    () =>
      editWorkspace(w, {
        type: "segment.update",
        segmentId: first.id,
        patch: { name: "abc" },
      }),
    /同名/,
  );
  editWorkspace(w, { type: "segment.open", segmentId: first.id });
  editWorkspace(w, {
    type: "segment.update",
    segmentId: first.id,
    patch: { text: "第一部分\n\n第二部分\n\n第三部分" },
  });
  editWorkspace(w, { type: "segment.split" });
  assert.equal(p.segments[0].name, "序章");
  assert.equal(p.segments[0].id, first.id);
  assert.equal(
    new Set(p.segments.map((s) => segmentNameKey(s.name))).size,
    p.segments.length,
  );
  editWorkspace(w, { type: "segment.create" });
  assert.equal(
    new Set(p.segments.map((s) => segmentNameKey(s.name))).size,
    p.segments.length,
  );
});
test("legacy duplicate names repair deterministically without changing segment identity", () => {
  const p = fresh().projects[0],
    s = p.segments[0];
  p.segments = [
    s,
    { ...s, id: "other" },
    { ...s, id: "third", name: s.name + " (2)" },
  ];
  assert.equal(repairSegmentNames(p), true);
  assert.deepEqual(
    p.segments.map((s) => s.id),
    [s.id, "other", "third"],
  );
  assert.equal(new Set(p.segments.map((s) => segmentNameKey(s.name))).size, 3);
  assert.equal(repairSegmentNames(p), false);
});
function installer() {
  const base = path.resolve(".runtime/test-cases");
  fs.mkdirSync(base, { recursive: true });
  return new Installer(
    new PortablePaths(fs.mkdtempSync(path.join(base, "repair-"))),
    () => {},
  );
}
test("ready resource reinstallation probes actual files and skips all download work, including while service runs", async () => {
  const i = installer();
  let downloads = 0,
    probes = 0;
  (i as any).installUv = async () => {
    downloads++;
  };
  i.run = async () => {
    probes++;
    return "uv 0.12";
  };
  i.runtime.service.status = "running";
  await i.install("uv");
  assert.equal(probes, 1);
  assert.equal(downloads, 0);
  assert.equal(i.runtime.uv.status, "ready");
  assert.match(i.runtime.uv.stage, /复用/);
  assert.equal(i.runtime.service.status, "running");
});
test("moved or broken file is detected despite ready status; inspection does not stop service; repair requires confirmed stop", async () => {
  const i = installer();
  i.runtime.uv.status = "ready";
  i.runtime.service.status = "running";
  let repaired = false,
    downloads = 0,
    stops = 0;
  i.run = async () => {
    if (!repaired) throw Error("file moved");
    return "uv 0.12";
  };
  (i as any).installUv = async () => {
    downloads++;
    repaired = true;
  };
  const p = await i.inspect("uv");
  assert.equal(p.valid, false);
  assert.equal(downloads, 0);
  assert.equal(i.runtime.service.status, "running");
  await assert.rejects(i.install("uv"), /确认/);
  assert.equal(downloads, 0);
  await i.install("uv", () => {
    stops++;
    i.runtime.service.status = "stopped";
  });
  assert.equal(stops, 1);
  assert.equal(downloads, 1);
  assert.equal(i.runtime.uv.status, "ready");
});
test("inspection reports unavailable prerequisites without starting a download", async () => {
  const i = installer();
  i.run = async () => {
    throw Error("missing file");
  };
  const p = await i.inspect("python");
  assert.deepEqual(p.blockers, ["uv"]);
  await assert.rejects(i.install("python"), /先安装/);
  assert.equal(i.runtime.busy, null);
});
test("validation rejects out-of-order requests before launching an interpreter", async () => {
  const i = installer();
  let calls = 0;
  i.run = async () => {
    calls++;
    return "unexpected";
  };
  await assert.rejects(i.validate("python"), /第 1 步.*uv CLI/);
  i.runtime.uv.status = "ready";
  i.runtime.python.status = "ready";
  await assert.rejects(i.validate("model"), /第 3 步.*推理依赖/);
  assert.equal(calls, 0);
  assert.equal(i.runtime.busy, null);
  assert.equal(i.runtime.model.status, "missing");
});
test("model installation checks inference dependencies and refuses download until they pass", async () => {
  const i = installer();
  let launches = 0;
  i.run = async () => {
    launches++;
    throw Error("must not install");
  };
  i.validate = async (kind) => {
    if (kind === "model") throw Error("模型缺失");
    if (kind === "dependencies") throw Error("推理依赖缺失");
    i.runtime[kind].status = "ready";
  };
  const plan = await i.inspect("model");
  assert.deepEqual(plan.blockers, ["dependencies"]);
  await assert.rejects(i.install("model"), /先安装并校验.*dependencies/);
  assert.equal(launches, 0);
  assert.equal(i.runtime.busy, null);
});
test("repair awaits confirmed asynchronous service shutdown before writing files", async () => {
  const i = installer();
  i.runtime.service.status = "running";
  let exited = false,
    repaired = false;
  i.run = async () => {
    if (!repaired) throw Error("broken");
    return "uv 0.12";
  };
  (i as any).installUv = async () => {
    assert(exited);
    repaired = true;
  };
  const task = i.install("uv", async () => {
    i.runtime.service.status = "stopping";
    await new Promise((r) => setTimeout(r, 20));
    exited = true;
    i.runtime.service.status = "stopped";
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(repaired, false);
  assert.equal(i.runtime.uv.stage, "等待模型进程退出后修复");
  await task;
  assert.equal(repaired, true);
});
test("multi-resource inspection keeps operation locked between prerequisite checks", async () => {
  const i = installer(),
    busyStates: (string | null)[] = [];
  (i as any).changed = () => busyStates.push(i.runtime.busy);
  i.run = async () => {
    throw Error("missing");
  };
  await i.inspect("dependencies");
  assert.equal(busyStates.at(-1), null);
  assert(busyStates.slice(0, -1).every((k) => k === "dependencies"));
});
