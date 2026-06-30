/**
 * Electron main process. Runs the Praxis brain in-process, exposes a tiny IPC
 * surface to the renderer, and registers a global hotkey to summon the voice
 * window from anywhere. The voice loop is orchestrated here so the ElevenLabs
 * key stays out of the renderer:
 *
 *   renderer mic ──▶ main: STT (Scribe) ──▶ brain.runTurn ──▶ TTS ──▶ renderer speaker
 */
import { join } from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ChatMessage } from "@praxis/shared-types";
import { loadDesktopEnv, type DesktopEnv } from "./env.js";
import { buildDesktopBrain, type DesktopBrain } from "./brain.js";
import {
  IPC,
  type ProcessAudioRequest,
  type ProcessTextRequest,
  type ProcessResult,
  type PraxisStatus,
} from "../shared/ipc.js";

let mainWindow: BrowserWindow | null = null;
let env: DesktopEnv;
let desktop: DesktopBrain | null = null;
const history: ChatMessage[] = [];

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 640,
    show: false,
    frame: true,
    title: "Praxis",
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => (mainWindow = null));
}

/** Bring the window to the front and tell the renderer to start listening. */
function summon(): void {
  if (!mainWindow) {
    createWindow();
    const w = mainWindow as BrowserWindow | null;
    w?.once("ready-to-show", () => w.webContents.send(IPC.summon));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send(IPC.summon);
}

async function handleProcessText(
  _e: IpcMainInvokeEvent,
  req: ProcessTextRequest,
): Promise<ProcessResult> {
  return runTurnAndSpeak(req.text, "");
}

async function handleProcessAudio(
  _e: IpcMainInvokeEvent,
  req: ProcessAudioRequest,
): Promise<ProcessResult> {
  if (!desktop?.eleven) {
    throw new Error("Voice is not configured (set ELEVENLABS_API_KEY).");
  }
  const filename = req.mimeType.includes("webm") ? "clip.webm" : "clip.wav";
  const userText = await desktop.eleven.transcribe({
    audio: new Uint8Array(req.audio),
    filename,
  });
  return runTurnAndSpeak(userText, userText);
}

async function runTurnAndSpeak(userText: string, heard: string): Promise<ProcessResult> {
  if (!desktop) throw new Error("Brain not ready.");
  if (!userText.trim()) {
    return {
      userText: heard,
      result: { reply: "I didn't catch that — say it again?", intent: "chat", toolsUsed: [] },
      audioBase64: null,
    };
  }

  const result = await desktop.brain.runTurn({ history, userText });
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: result.reply });

  let audioBase64: string | null = null;
  if (desktop.eleven && desktop.voiceId) {
    try {
      const buf = await desktop.eleven.synthesize({ text: result.reply });
      audioBase64 = Buffer.from(buf).toString("base64");
    } catch {
      audioBase64 = null; // speech is best-effort; UI still shows the text
    }
  }
  return { userText: heard, result, audioBase64 };
}

function registerIpc(): void {
  ipcMain.handle(IPC.processText, handleProcessText);
  ipcMain.handle(IPC.processAudio, handleProcessAudio);
  ipcMain.handle(IPC.getStatus, async (): Promise<PraxisStatus> => ({
    brainReady: Boolean(desktop?.ready),
    hasVoice: Boolean(desktop?.eleven),
    userName: env.userName,
  }));
}

app.whenReady().then(async () => {
  env = loadDesktopEnv();
  registerIpc();
  createWindow();

  try {
    desktop = await buildDesktopBrain(env, (m) => console.log("[brain]", m));
  } catch (err) {
    console.error("Failed to build brain:", err);
  }

  const ok = globalShortcut.register(env.hotkey, summon);
  if (!ok) console.warn(`Could not register hotkey ${env.hotkey}`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Stay resident on macOS so the global hotkey keeps working.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", async () => {
  globalShortcut.unregisterAll();
  await desktop?.close();
});
