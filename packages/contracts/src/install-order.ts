import type { InstallKind } from "./index.ts";

export const installOrder: readonly InstallKind[] = [
  "uv",
  "python",
  "dependencies",
  "model",
];

export function installPrerequisites(
  kind: InstallKind,
): readonly InstallKind[] {
  return installOrder.slice(0, installOrder.indexOf(kind));
}
