/**
 * Build the in-process brain for the desktop main process. This is the SAME
 * `@praxis/core` brain the headless server runs — assembled here so the desktop
 * is fully local-first and works even with no relay.
 */
import {
  AnthropicLlmClient,
  Brain,
  McpManager,
  type TaskDispatcher,
} from "@praxis/core";
import { SlackBridgeAdapter } from "@praxis/bridge-adapter";
import { ElevenLabsClient } from "@praxis/voice-elevenlabs";
import type { DispatchResult, McpServerConfig, StructuredTask } from "@praxis/shared-types";
import type { DesktopEnv } from "./env.js";

class NoDispatcher implements TaskDispatcher {
  async dispatchTask(_t: StructuredTask): Promise<DispatchResult> {
    return { ok: false, detail: "Dispatch not configured (set SLACK_BOT_TOKEN + CURSOR_BRIDGE_BOT_ID)." };
  }
}

export interface DesktopBrain {
  brain: Brain;
  eleven: ElevenLabsClient | null;
  voiceId?: string;
  ready: boolean;
  close: () => Promise<void>;
}

export async function buildDesktopBrain(
  env: DesktopEnv,
  log: (m: string) => void = console.log,
): Promise<DesktopBrain> {
  const llm = new AnthropicLlmClient({ apiKey: env.anthropicApiKey });

  const servers: McpServerConfig[] = [];
  if (env.githubEnabled && env.githubToken) {
    servers.push({
      id: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: env.githubToken },
      enabled: true,
    });
  }
  const mcp = await McpManager.create(servers, log);
  const ready = servers.length === 0 || (await mcp.listTools()).length > 0;

  const dispatcher: TaskDispatcher = env.slackBotToken
    ? new SlackBridgeAdapter({
        token: env.slackBotToken,
        bridgeBotId: env.cursorBridgeBotId,
        log,
      })
    : new NoDispatcher();

  const brain = new Brain({
    llm,
    mcp,
    dispatcher,
    config: {
      ...(env.reasoningModel ? { reasoningModel: env.reasoningModel } : {}),
      ...(env.chatModel ? { chatModel: env.chatModel } : {}),
      userName: env.userName,
      ...(env.defaultProject ? { defaultProject: env.defaultProject } : {}),
    },
  });

  const eleven = env.elevenLabsApiKey
    ? new ElevenLabsClient({ apiKey: env.elevenLabsApiKey, defaultVoiceId: env.elevenLabsVoiceId })
    : null;

  return {
    brain,
    eleven,
    voiceId: env.elevenLabsVoiceId,
    ready,
    close: async () => {
      await mcp.close();
    },
  };
}
