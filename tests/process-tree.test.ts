import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { terminateOwnedChild } from "../apps/desktop/host/process-tree.ts";

test(
  "Windows termination removes only the owned process tree",
  { skip: process.platform !== "win32", timeout: 10000 },
  async () => {
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { windowsHide: true, stdio: "ignore" },
    );
    const owned = spawn(
      process.execPath,
      [
        "-e",
        "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});c.once('spawn',()=>process.send({pid:c.pid}));setInterval(()=>{},1000)",
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    try {
      const exited = once(owned, "exit");
      const [message] = (await once(owned, "message")) as [{ pid: number }];
      await terminateOwnedChild(owned);
      await exited;
      assert.throws(() => process.kill(message.pid, 0));
      assert.doesNotThrow(() => process.kill(unrelated.pid!, 0));
    } finally {
      await terminateOwnedChild(owned);
      unrelated.kill();
    }
  },
);
