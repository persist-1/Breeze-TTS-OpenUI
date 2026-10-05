import test from "node:test";
import assert from "node:assert/strict";
import { fresh, editWorkspace } from "../apps/desktop/host/domain.ts";
test("named projects create independently and reject blank or oversized titles without changing active content", () => {
  const w = fresh(),
    original = structuredClone(w.projects[0]);
  for (const title of [" ", "x".repeat(101)])
    assert.throws(
      () => editWorkspace(w, { type: "project.create", patch: { title } }),
      /作品名称/,
    );
  assert.equal(w.projects.length, 1);
  assert.equal(w.currentProjectId, original.id);
  editWorkspace(w, {
    type: "project.create",
    patch: { title: "  片尾旁白  " },
  });
  const next = w.projects[1];
  assert.equal(next.title, "片尾旁白");
  assert.equal(w.currentProjectId, next.id);
  assert.deepEqual(w.projects[0], original);
  assert.throws(
    () =>
      editWorkspace(w, {
        type: "project.update",
        projectId: next.id,
        patch: { title: " " },
      }),
    /作品名称/,
  );
  assert.equal(next.title, "片尾旁白");
  editWorkspace(w, {
    type: "project.update",
    projectId: next.id,
    patch: { title: "  新名称  " },
  });
  assert.equal(next.title, "新名称");
  editWorkspace(w, { type: "project.open", projectId: original.id });
  assert.equal(w.currentProjectId, original.id);
  assert.deepEqual(w.projects[0].segments, original.segments);
});
