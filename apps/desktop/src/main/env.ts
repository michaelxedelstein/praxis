/**
 * Desktop environment. Loaded from a local `.env` (never committed). The brain
 * runs in-process here, so this machine holds the keys directly.
 */
import "dotenv/config";

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

  /** Global hotkey accelerator to summon the voice window. */
  hotkey: string;
}

export function loadDesktopEnv(): DesktopEnv {
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
    hotkey: e.PRAXIS_HOTKEY ?? "CommandOrControl+Shift+Space",
  };
}
