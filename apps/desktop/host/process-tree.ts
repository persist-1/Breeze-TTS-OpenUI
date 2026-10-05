import { spawn, type ChildProcess } from "node:child_process";

/** A live ChildProcess we launched, never a lookup by executable name or port. */
export function terminateOwnedChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null)
    return Promise.resolve();
  if (process.platform !== "win32" || !child.pid) {
    child.kill();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => {
      child.kill();
      resolve();
    });
    killer.once("exit", (code) => {
      if (code !== 0) child.kill();
      resolve();
    });
  });
}
