import { useSyncExternalStore } from "react";
import type {
  Snapshot,
  Command,
} from "../../../packages/contracts/src/index.ts";
let current: Snapshot | null = null,
  error = "",
  pending = 0;
let sequence = 0,
  appliedSequence = 0,
  connectionFailures = 0;
const connectionError = "无法连接本地工作区，请重新启动应用。";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const apply = (next: Snapshot, id = ++sequence) => {
  if (
    id < appliedSequence ||
    (current && next.workspace.revision < current.workspace.revision)
  )
    return;
  appliedSequence = id;
  current = next;
  emit();
};
export const state = {
  get: () => current,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
export function useSnapshot() {
  return useSyncExternalStore(state.subscribe, state.get);
}
export function report(message: string) {
  error = message;
  emit();
}
export function useError() {
  return useSyncExternalStore(state.subscribe, () => error);
}
let chain: Promise<unknown> = Promise.resolve();
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let data;
    try {
      data = await res.json();
    } catch {}
    throw Error(data?.error || `请求失败（${res.status}）`);
  }
  return res.json();
}
export function command(c: Command): Promise<void> {
  pending++;
  const run = chain
    .catch(() => {})
    .then(async () => {
      const id = ++sequence;
      try {
        apply(
          await request<Snapshot>("/api/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          }),
          id,
        );
      } catch (e) {
        report(String(e).replace(/^Error: /, ""));
        throw e;
      } finally {
        pending--;
      }
    });
  chain = run;
  return run;
}
export function act(c: Command) {
  void command(c).catch(() => {});
}
let started = false;
const draftFlushers = new Set<() => Promise<unknown>>();
export function registerDraftFlush(flush: () => Promise<unknown>) {
  draftFlushers.add(flush);
  return () => {
    draftFlushers.delete(flush);
  };
}
export async function flushDrafts() {
  for (const save of [...draftFlushers]) await save();
  await chain;
}
export function startStore() {
  if (started) return;
  started = true;
  window.breeze?.onBeforeClose?.(async () => {
    try {
      await Promise.all([...draftFlushers].map((fn) => fn()));
      await chain;
      return true;
    } catch (e) {
      report("编辑尚未保存，请检查错误后再退出。");
      return false;
    }
  });
  const poll = async () => {
    const id = ++sequence;
    try {
      const next = await request<Snapshot>("/api/snapshot");
      connectionFailures = 0;
      if (error === connectionError) {
        error = "";
        emit();
      }
      if (!pending) apply(next, id);
      else if (current) {
        current = { ...current, runtime: next.runtime };
        emit();
      }
    } catch (e) {
      connectionFailures++;
      if (!current || connectionFailures >= 3) report(connectionError);
    } finally {
      setTimeout(poll, 800);
    }
  };
  void poll();
}
export function flush() {
  return chain.catch(() => {});
}
export async function download(url: string, name: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const data = await res.json();
      throw Error(data.error);
    }
    const object = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = object;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(object), 10000);
  } catch (e) {
    report(String(e).replace(/^Error: /, ""));
  }
}
