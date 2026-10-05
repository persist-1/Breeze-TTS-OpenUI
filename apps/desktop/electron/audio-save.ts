import { dialog, ipcMain, type BrowserWindow } from "electron";
import type { Repository } from "../host/repository.ts";
import { createAudioSaver } from "../host/save-audio.ts";
export function registerAudioSave(
  repo: Repository,
  window: () => BrowserWindow,
  allowed: (event: Electron.IpcMainInvokeEvent) => void,
) {
  const save = createAudioSaver(repo, async (defaultPath) => {
    const result = await dialog.showSaveDialog(window(), {
      title: "保存音频",
      buttonLabel: "保存",
      defaultPath,
      filters: [{ name: "WAV 音频", extensions: ["wav"] }],
      properties: ["showOverwriteConfirmation"],
    });
    return result.canceled ? null : result.filePath || null;
  });
  ipcMain.handle("audio.save", (event, id: string) => {
    allowed(event);
    if (event.sender !== window().webContents)
      throw Error("不允许此窗口保存音频。");
    return save(id);
  });
}
