/**
 * Preload bridge — the only channel between the sandboxed renderer and main.
 * Exposes a typed `window.praxis` API; no node access leaks to the renderer.
 */
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type AgentRecord,
  type ConfirmRequestEvent,
  type ConfirmResolveRequest,
  type DispatchTaskRequest,
  type DisplayInfo,
  type LayoutMode,
  type PraxisBridge,
  type ProcessAudioRequest,
  type ProcessTextRequest,
  type ProjectActionRequest,
  type PraxisStatus,
  type ProjectGraph,
  type RunToolRequest,
  type SaveMcpConnectionRequest,
  type SetVoiceConfigRequest,
  type TaskRecord,
  type TurnStatusEvent,
  type TurnSpeakEvent,
  type UsageSnapshot,
  type WakeCheckRequest,
} from "../shared/ipc.js";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: PraxisBridge = {
  processAudio: (req: ProcessAudioRequest) => ipcRenderer.invoke(IPC.processAudio, req),
  processText: (req: ProcessTextRequest) => ipcRenderer.invoke(IPC.processText, req),
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  onStatusUpdated: (cb: (s: PraxisStatus) => void) => subscribe(IPC.statusUpdated, cb),
  onSummon: (cb: () => void) => subscribe<void>(IPC.summon, () => cb()),
  onTurnStatus: (cb: (e: TurnStatusEvent) => void) => subscribe(IPC.turnStatus, cb),
  onTurnSpeak: (cb: (e: TurnSpeakEvent) => void) => subscribe(IPC.turnSpeak, cb),

  getVoices: (apiKey?: string) => ipcRenderer.invoke(IPC.getVoices, apiKey),
  setVoiceConfig: (req: SetVoiceConfigRequest) => ipcRenderer.invoke(IPC.setVoiceConfig, req),
  wakeCheck: (req: WakeCheckRequest) => ipcRenderer.invoke(IPC.wakeCheck, req),

  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  refreshProjects: () => ipcRenderer.invoke(IPC.refreshProjects),
  getProjectDetail: (id: string) => ipcRenderer.invoke(IPC.getProjectDetail, id),
  onProjectsUpdated: (cb: (g: ProjectGraph) => void) => subscribe(IPC.projectsUpdated, cb),

  projectAction: (req: ProjectActionRequest) => ipcRenderer.invoke(IPC.projectAction, req),
  dispatchTask: (req: DispatchTaskRequest) => ipcRenderer.invoke(IPC.dispatchTask, req),
  listTasks: () => ipcRenderer.invoke(IPC.listTasks),
  onTasksUpdated: (cb: (tasks: TaskRecord[]) => void) => subscribe(IPC.tasksUpdated, cb),

  listTools: () => ipcRenderer.invoke(IPC.listTools),
  runTool: (req: RunToolRequest) => ipcRenderer.invoke(IPC.runTool, req),

  getUsage: () => ipcRenderer.invoke(IPC.getUsage),
  onUsageUpdated: (cb: (u: UsageSnapshot) => void) => subscribe(IPC.usageUpdated, cb),

  listMcpConnections: () => ipcRenderer.invoke(IPC.listMcpConnections),
  saveMcpConnection: (req: SaveMcpConnectionRequest) => ipcRenderer.invoke(IPC.saveMcpConnection, req),

  listAgents: () => ipcRenderer.invoke(IPC.listAgents),
  onAgentsUpdated: (cb: (agents: AgentRecord[]) => void) => subscribe(IPC.agentsUpdated, cb),
  onConfirmRequest: (cb: (e: ConfirmRequestEvent) => void) => subscribe(IPC.confirmRequest, cb),
  confirmResolve: (req: ConfirmResolveRequest) => ipcRenderer.invoke(IPC.confirmResolve, req),

  getDisplayInfo: () => ipcRenderer.invoke(IPC.getDisplayInfo),
  setLayout: (mode: LayoutMode) => ipcRenderer.invoke(IPC.setLayout, mode),
  onLayoutChanged: (cb: (info: DisplayInfo) => void) => subscribe(IPC.layoutChanged, cb),
};

contextBridge.exposeInMainWorld("praxis", api);
