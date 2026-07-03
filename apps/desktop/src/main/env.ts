/**
 * Desktop environment. Loaded from a local `.env` (never committed). The brain
 * runs in-process here, so this machine holds the keys directly.
 *
 * We don't rely on `dotenv/config` (which only reads `./.env` relative to the
 * process cwd) because the cwd differs between `electron-vite dev` and a
 * packaged `.app`. Instead we look in a few deterministic places, including a
 * stable per-user file (`~/.praxis/desktop.env`) that the packaged app can use.
 */
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

let envLoaded = false;
/** Load .env from every known location once, without clobbering real env vars. */
function ensureEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;
  const candidates = [
    join(process.cwd(), ".env"),
    join(homedir(), ".praxis", "desktop.env"),
  ];
  try {
    // In dev this is apps/desktop; when packaged it's the app resources dir.
    candidates.unshift(join(app.getAppPath(), ".env"));
  } catch {
    /* app not available (e.g. unit test) — cwd + home candidates still apply */
  }
  for (const path of candidates) {
    if (existsSync(path)) dotenv.config({ path, override: false });
  }
}

export interface DesktopEnv {
  anthropicApiKey: string;
  reasoningModel?: string;
  chatModel?: string;
  userName: string;
  defaultProject?: string;

  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;

  slackBotToken?: string;
  cursorBridgeBotId?: string;

  githubToken?: string;
  githubEnabled: boolean;

  /** Enable the mac-control MCP (browser/Finder/iMessage). */
  macControlEnabled: boolean;
  /** Max sub-agents the conductor runs at once. */
  subAgentConcurrency: number;
  /** Roots scanned for local projects (mirrors the cursor-slack-bridge). */
  projectRoots: string[];

  /** Global hotkey accelerator to summon the voice window. */
  hotkey: string;
}

export function loadDesktopEnv(): DesktopEnv {
  ensureEnvLoaded();
  const e = process.env;
  if (!e.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required (copy .env.example to .env).");
  }
  return {
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    reasoningModel: e.PRAXIS_REASONING_MODEL,
    chatModel: e.PRAXIS_CHAT_MODEL,
    userName: e.PRAXIS_USER_NAME ?? "Michael",
    defaultProject: e.PRAXIS_DEFAULT_PROJECT,
    elevenLabsApiKey: e.ELEVENLABS_API_KEY,
    elevenLabsVoiceId: e.ELEVENLABS_VOICE_ID,
    slackBotToken: e.SLACK_BOT_TOKEN,
    cursorBridgeBotId: e.CURSOR_BRIDGE_BOT_ID,
    githubToken: e.GITHUB_TOKEN ?? e.GITHUB_PERSONAL_ACCESS_TOKEN,
    githubEnabled: (e.MCP_GITHUB_ENABLED ?? "true").toLowerCase() !== "false",
    macControlEnabled: (e.PRAXIS_MAC_CONTROL ?? "true").toLowerCase() !== "false",
    subAgentConcurrency: Number(e.PRAXIS_SUBAGENT_CONCURRENCY ?? "3") || 3,
    projectRoots: (e.PRAXIS_PROJECT_ROOTS ?? defaultRoots()).split(",").map((s) => s.trim()).filter(Boolean),
    hotkey: e.PRAXIS_HOTKEY ?? "CommandOrControl+Shift+Space",
  };
}

/** The same roots the cursor-slack-bridge scans, so nodes line up with dispatch. */
function defaultRoots(): string {
  return [
    "/Volumes/ExternalSSD/Developer/Projects",
    join(homedir(), "Developer"),
  ].join(",");
}
