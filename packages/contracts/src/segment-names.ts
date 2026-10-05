import type { Project } from "./index.ts";
export const cleanSegmentName = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ");
export const segmentNameKey = (value: string) =>
  cleanSegmentName(value).normalize("NFKC").toLocaleLowerCase("zh-CN");
export function availableSegmentName(
  names: Iterable<string>,
  start = 1,
): string {
  const used = new Set([...names].map(segmentNameKey));
  while (used.has(segmentNameKey(`第 ${start} 段`))) start++;
  return `第 ${start} 段`;
}
export function repairSegmentNames(project: Project): boolean {
  const used = new Set<string>();
  let changed = false;
  for (const segment of project.segments) {
    const base =
      cleanSegmentName(segment.name || "段落").slice(0, 80) || "段落";
    let name = base,
      index = 2;
    while (used.has(segmentNameKey(name))) {
      const suffix = ` (${index++})`;
      name = base.slice(0, 80 - suffix.length) + suffix;
    }
    used.add(segmentNameKey(name));
    if (segment.name !== name) {
      segment.name = name;
      changed = true;
    }
  }
  return changed;
}
