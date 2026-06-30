/**
 * Preload bridge — the only channel between the sandboxed renderer and main.
 * Exposes a typed `window.praxis` API; no node access leaks to the renderer.
 */
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type PraxisBridge,
  type ProcessAudioRequest,
  type ProcessTextRequest,
} from "../shared/ipc.js";

const api: PraxisBridge = {
  processAudio: (req: ProcessAudioRequest) => ipcRenderer.invoke(IPC.processAudio, req),
  processText: (req: ProcessTextRequest) => ipcRenderer.invoke(IPC.processText, req),
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  onSummon: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.summon, listener);
    return () => ipcRenderer.removeListener(IPC.summon, listener);
  },
};

contextBridge.exposeInMainWorld("praxis", api);
