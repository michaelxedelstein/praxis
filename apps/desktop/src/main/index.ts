/**
 * Electron main process — the Jarvis command center's backend.
 *
 * Runs the Praxis brain in-process (so keys never reach the renderer), owns the
 * project graph, the task board, the sub-agent conductor, MCP connections, and
 * the multi-monitor window manager. Everything the renderer needs is exposed
 * over a typed IPC surface (see ../shared/ipc.ts).
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import type { ChatMessage, DispatchResult, StructuredTask } from "@praxis/shared-types";
import type { SubAgentSpec } from "@praxis/core";
import { loadDesktopEnv, type DesktopEnv } from "./env.js";
import { buildDesktopBrain, type DesktopBrain, type DispatchObserver } from "./brain.js";
import { ProjectGraphService } from "./projects.js";
import { TaskStore } from "./tasks.js";
import { WindowManager } from "./windows.js";
import { listConnections, saveConnection } from "./connections.js";
import {
  IPC,
  type AgentRecord,
  type ConfirmResolveRequest,
  type DispatchTaskRequest,
  type DisplayInfo,
  type LayoutMode,
  type McpConnectionInfo,
  type ProcessAudioRequest,
  type ProcessResult,
  type ProcessTextRequest,
  type ProjectActionRequest,
  type ProjectDetail,
  type ProjectGraph,
  type PraxisStatus,
  type RunToolRequest,
  type RunToolResult,
  type SaveMcpConnectionRequest,
  type TaskRecord,
  type ToolInfo,
} from "../shared/ipc.js";

let env: DesktopEnv;
let desktop: DesktopBrain | null = null;
let graph: ProjectGraphService;
let tasks: TaskStore;
let windows: WindowManager;

/** Per-project conversation histories (keyed by node id; "" = global HUD). */
const histories = new Map<string, ChatMessage[]>();
/** Pending destructive-action confirmations, resolved by the renderer. */
const pendingConfirms = new Map<string, (approved: boolean) => void>();

function historyFor(projectId?: string): ChatMessage[] {
  const key = projectId ?? "";
  let h = histories.get(key);
  if (!h) {
    h = [];
    histories.set(key, h);
  }
  return h;
}

/* ------------------------------ conversation ------------------------------ */

async function handleProcessText(
  _e: IpcMainInvokeEvent,
  req: ProcessTextRequest,
): Promise<ProcessResult> {
  return runTurnAndSpeak(req.text, "", req.projectId);
}

async function handleProcessAudio(
  _e: IpcMainInvokeEvent,
  req: ProcessAudioRequest,
): Promise<ProcessResult> {
  if (!desktop?.eleven) throw new Error("Voice is not configured (set ELEVENLABS_API_KEY).");
  const filename = req.mimeType.includes("webm") ? "clip.webm" : "clip.wav";
  const userText = await desktop.eleven.transcribe({
    audio: new Uint8Array(req.audio),
    filename,
  });
  return runTurnAndSpeak(userText, userText, req.projectId);
}

async function runTurnAndSpeak(
  userText: string,
  heard: string,
  projectId?: string,
): Promise<ProcessResult> {
  if (!desktop) throw new Error("Brain not ready.");
  if (!userText.trim()) {
    return {
      userText: heard,
      result: { reply: "I didn't catch that — say it again?", intent: "chat", toolsUsed: [] },
      audioBase64: null,
    };
  }

  const history = historyFor(projectId);
  const context = projectId ? await buildProjectContext(projectId) : undefined;

  const result = await desktop.brain.runTurn({
    history,
    userText,
    context,
    onStatus: (detail) => windows.broadcast(IPC.turnStatus, { projectId, detail }),
  });
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: result.reply });

  let audioBase64: string | null = null;
  if (desktop.eleven && desktop.voiceId) {
    try {
      const buf = await desktop.eleven.synthesize({ text: result.reply });
      audioBase64 = Buffer.from(buf).toString("base64");
    } catch {
      audioBase64 = null;
    }
  }
  return { userText: heard, result, audioBase64 };
}

/** Compact grounding for a repo-scoped conversation. */
async function buildProjectContext(projectId: string): Promise<string | undefined> {
  const detail = await graph.detail(projectId);
  if (!detail) return undefined;
  const { node, readme, fileTree, commits } = detail;
  const parts = [
    `You are focused on the project "${node.name}"${node.path ? ` at ${node.path}` : ""}.`,
    node.branch ? `Branch: ${node.branch}${node.dirty ? " (uncommitted changes)" : ""}.` : "",
    node.github ? `GitHub: ${node.github.fullName}.` : "",
    commits.length ? `Recent commits:\n${commits.slice(0, 5).map((c) => `- ${c.subject}`).join("\n")}` : "",
    fileTree.length ? `File tree (partial):\n${fileTree.slice(0, 50).join("\n")}` : "",
    readme ? `README excerpt:\n${readme.slice(0, 800)}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

/* -------------------------------- summon ---------------------------------- */

function summon(): void {
  const win = windows.ensureMain();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send(IPC.summon);
}

/* --------------------------- project graph IPC ---------------------------- */

async function refreshAndBroadcast(): Promise<ProjectGraph> {
  const g = await graph.refresh();
  windows.broadcast(IPC.projectsUpdated, g);
  return g;
}

/* ------------------------------ actions ----------------------------------- */

async function handleProjectAction(_e: IpcMainInvokeEvent, req: ProjectActionRequest): Promise<void> {
  const node = graph.current().nodes.find((n) => n.id === req.id);
  if (!node) return;
  switch (req.action) {
    case "revealInFinder":
      if (node.path) shell.showItemInFolder(node.path);
      break;
    case "openInCursor":
      if (node.path) await shell.openExternal(`cursor://file/${node.path}`);
      break;
    case "openGitHub":
      if (node.github?.url) await shell.openExternal(node.github.url);
      break;
  }
}

async function handleDispatchTask(
  _e: IpcMainInvokeEvent,
  req: DispatchTaskRequest,
): Promise<DispatchResult> {
  if (!desktop) throw new Error("Brain not ready.");
  const task: StructuredTask = {
    project: req.project,
    instruction: req.instruction,
    ...(req.mode ? { mode: req.mode } : {}),
  };
  // Route through the observing dispatcher so the task board records it.
  return desktop.dispatcher.dispatchTask(task);
}

/* ------------------------------ sub-agents -------------------------------- */

function spawnAgents(specs: SubAgentSpec[]): string[] {
  if (!desktop) return [];
  return desktop.conductor.spawn(specs);
}

function agentsToRecords(): AgentRecord[] {
  if (!desktop) return [];
  return desktop.conductor.list().map((a) => ({
    id: a.id,
    title: a.title,
    projectId: a.projectId,
    status: a.status,
    transcript: a.transcript,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    result: a.result,
  }));
}

/** Ask the renderer to approve a destructive action; resolves with its answer. */
export function requestConfirm(description: string): Promise<boolean> {
  const id = randomUUID();
  return new Promise<boolean>((resolve) => {
    pendingConfirms.set(id, resolve);
    windows.broadcast(IPC.confirmRequest, { id, description });
    // Auto-deny after 60s so a closed UI never blocks forever.
    setTimeout(() => {
      if (pendingConfirms.has(id)) {
        pendingConfirms.delete(id);
        resolve(false);
      }
    }, 60_000);
  });
}

/* --------------------------------- IPC ------------------------------------ */

function registerIpc(): void {
  ipcMain.handle(IPC.processText, handleProcessText);
  ipcMain.handle(IPC.processAudio, handleProcessAudio);
  ipcMain.handle(IPC.getStatus, async (): Promise<PraxisStatus> => ({
    brainReady: Boolean(desktop?.ready),
    hasVoice: Boolean(desktop?.eleven),
    hasDispatch: Boolean(desktop?.hasDispatch),
    userName: env.userName,
    toolCount: desktop?.toolCount ?? 0,
  }));

  ipcMain.handle(IPC.listProjects, async (): Promise<ProjectGraph> => {
    const current = graph.current();
    return current.nodes.length > 0 ? current : refreshAndBroadcast();
  });
  ipcMain.handle(IPC.refreshProjects, () => refreshAndBroadcast());
  ipcMain.handle(IPC.getProjectDetail, (_e, id: string): Promise<ProjectDetail | null> =>
    graph.detail(id),
  );

  ipcMain.handle(IPC.projectAction, handleProjectAction);
  ipcMain.handle(IPC.dispatchTask, handleDispatchTask);
  ipcMain.handle(IPC.listTasks, async (): Promise<TaskRecord[]> => tasks.list());

  ipcMain.handle(IPC.listTools, async (): Promise<ToolInfo[]> => {
    if (!desktop) return [];
    const specs = await desktop.mcp.listTools().catch(() => []);
    return specs.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  });
  ipcMain.handle(IPC.runTool, async (_e, req: RunToolRequest): Promise<RunToolResult> => {
    if (!desktop) return { text: "Brain not ready.", isError: true };
    return desktop.mcp.callTool(req.name, req.args);
  });

  ipcMain.handle(IPC.listMcpConnections, (): Promise<McpConnectionInfo[]> =>
    listConnections({ projectRoots: env.projectRoots }),
  );
  ipcMain.handle(IPC.saveMcpConnection, (_e, req: SaveMcpConnectionRequest) =>
    saveConnection(req, { projectRoots: env.projectRoots }),
  );

  ipcMain.handle(IPC.listAgents, async (): Promise<AgentRecord[]> => agentsToRecords());
  ipcMain.handle(IPC.confirmResolve, async (_e, req: ConfirmResolveRequest) => {
    const resolve = pendingConfirms.get(req.id);
    if (resolve) {
      pendingConfirms.delete(req.id);
      resolve(req.approved);
    }
  });

  ipcMain.handle(IPC.getDisplayInfo, async (): Promise<DisplayInfo> => windows.info());
  ipcMain.handle(IPC.setLayout, async (_e, mode: LayoutMode): Promise<DisplayInfo> =>
    windows.setLayout(mode),
  );
}

/* --------------------------------- boot ----------------------------------- */

app.whenReady().then(async () => {
  env = loadDesktopEnv();

  tasks = new TaskStore();
  tasks.onChange((t) => windows.broadcast(IPC.tasksUpdated, t));

  graph = new ProjectGraphService({
    roots: env.projectRoots,
    githubToken: env.githubToken,
    log: (m) => console.log("[graph]", m),
  });

  windows = new WindowManager({
    onLayout: (info) => windows.broadcast(IPC.layoutChanged, info),
  });

  registerIpc();
  windows.ensureMain();

  const observer: DispatchObserver = {
    onDispatch: (task, result, source) => tasks.record(task, result, source),
  };

  try {
    desktop = await buildDesktopBrain(env, {
      observer,
      onSpawn: spawnAgents,
      confirm: requestConfirm,
      projectRoots: env.projectRoots,
      log: (m) => console.log("[brain]", m),
    });
    desktop.conductor.onChange(() => windows.broadcast(IPC.agentsUpdated, agentsToRecords()));
  } catch (err) {
    console.error("Failed to build brain:", err);
  }

  // Kick off the first project scan in the background.
  void refreshAndBroadcast();

  const ok = globalShortcut.register(env.hotkey, summon);
  if (!ok) console.warn(`Could not register hotkey ${env.hotkey}`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.ensureMain();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", async () => {
  globalShortcut.unregisterAll();
  windows?.closeAll();
  await desktop?.close();
});
