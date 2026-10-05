import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { PortablePaths } from "../apps/desktop/host/paths.ts";
import { Repository } from "../apps/desktop/host/repository.ts";
import { makeBackup, importBackup } from "../apps/desktop/host/backup.ts";
import { prepareInternalPython } from "../apps/desktop/host/portable-python.ts";
test("backup imports as independent projects without changing existing drafts", () => {
  const base = path.resolve(".runtime/test-cases");
  fs.mkdirSync(base, { recursive: true });
  const repo = new Repository(
    new PortablePaths(fs.mkdtempSync(path.join(base, "backup-"))),
  );
  repo.workspace.projects[0].segments[0].text = "保留原文";
  repo.save();
  const original = repo.workspace.projects[0].id;
  const result = importBackup(repo, makeBackup(repo));
  assert.equal(result.projects, 1);
  assert.equal(repo.workspace.projects.length, 2);
  assert.equal(repo.workspace.projects[0].id, original);
  assert.notEqual(repo.workspace.projects[1].id, original);
  assert.equal(repo.workspace.projects[1].segments[0].text, "保留原文");
});
test("backup rejects archive traversal before creating any files", () => {
  const base = path.resolve(".runtime/test-cases");
  const repo = new Repository(
    new PortablePaths(fs.mkdtempSync(path.join(base, "unsafe-"))),
  );
  const zip = new AdmZip();
  zip.addFile("unknown.exe", Buffer.from("invalid"));
  assert.throws(() => importBackup(repo, zip.toBuffer()), /不支持/);
  assert.equal(repo.workspace.projects.length, 1);
});
test("moving a portable directory rewrites venv home before executing Python", () => {
  const base = path.resolve(".runtime/test-cases");
  const p = new PortablePaths(fs.mkdtempSync(path.join(base, "moved-")));
  fs.mkdirSync(p.inside(".runtime/python/cpython-3.11-windows-x86_64-none"), {
    recursive: true,
  });
  fs.writeFileSync(
    p.inside(".runtime/python/cpython-3.11-windows-x86_64-none/python.exe"),
    "test fixture",
  );
  fs.mkdirSync(p.inside(".runtime/venv/Scripts"), { recursive: true });
  fs.writeFileSync(
    p.inside(".runtime/venv/pyvenv.cfg"),
    "home = D:\\old-location\\.runtime\\python\\cpython-3.11-windows-x86_64-none\n",
  );
  prepareInternalPython(p);
  assert.match(
    fs.readFileSync(p.inside(".runtime/venv/pyvenv.cfg"), "utf8"),
    new RegExp(p.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
