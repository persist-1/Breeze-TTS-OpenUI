import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("breeze", {
  onBeforeClose: (handler: () => Promise<boolean>) => {
    const listener = () =>
      void handler()
        .then((ok) => ipcRenderer.send("app:flushed", ok))
        .catch(() => ipcRenderer.send("app:flushed", false));
    ipcRenderer.on("app:before-close", listener);
    return () => ipcRenderer.removeListener("app:before-close", listener);
  },
  pickReference: () => ipcRenderer.invoke("reference.pick"),
  openFolder: (kind: string) => ipcRenderer.invoke("folder.open", kind),
  saveAudio: (id: string) => ipcRenderer.invoke("audio.save", id),
});
