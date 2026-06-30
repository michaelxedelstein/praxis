/**
 * Assemble a live Brain from the environment: the Anthropic LLM client, the
 * config-driven MCP manager (GitHub first), and the Slack-routed task
 * dispatcher. Returns the brain plus a teardown handle for clean shutdown.
 */
import {
  AnthropicLlmClient,
  Brain,
  McpManager,
  type TaskDispatcher,
} from "@praxis/core";
import { SlackBridgeAdapter } from "@praxis/bridge-adapter";
import type { DispatchResult, StructuredTask } from "@praxis/shared-types";
import type { ServerEnv } from "./env.js";
import { buildMcpServers } from "./mcp-config.js";

/** Used when Slack isn't configured: refuses dispatch with a clear message. */
class UnconfiguredDispatcher implements TaskDispatcher {
  async dispatchTask(_task: StructuredTask): Promise<DispatchResult> {
    return {
      ok: false,
      detail:
        "Task dispatch isn't configured on this brain (set SLACK_BOT_TOKEN + CURSOR_BRIDGE_BOT_ID).",
    };
  }
}

export interface BuiltBrain {
  brain: Brain;
  mcp: McpManager;
  /** Whether at least one MCP server connected (used by /healthz). */
  ready: boolean;
  close: () => Promise<void>;
}

export async function buildBrain(
  env: ServerEnv,
  log: (msg: string) => void = console.log,
): Promise<BuiltBrain> {
  const llm = new AnthropicLlmClient({ apiKey: env.ANTHROPIC_API_KEY });

  const mcpServers = buildMcpServers(env);
  const mcp = await McpManager.create(mcpServers, log);
  const ready = (await mcp.listTools()).length > 0 || mcpServers.length === 0;

  const dispatcher: TaskDispatcher = env.SLACK_BOT_TOKEN
    ? new SlackBridgeAdapter({
        token: env.SLACK_BOT_TOKEN,
        bridgeBotId: env.CURSOR_BRIDGE_BOT_ID,
        log,
      })
    : new UnconfiguredDispatcher();

  const brain = new Brain({
    llm,
    mcp,
    dispatcher,
    config: {
      ...(env.PRAXIS_REASONING_MODEL ? { reasoningModel: env.PRAXIS_REASONING_MODEL } : {}),
      ...(env.PRAXIS_CHAT_MODEL ? { chatModel: env.PRAXIS_CHAT_MODEL } : {}),
      ...(env.PRAXIS_USER_NAME ? { userName: env.PRAXIS_USER_NAME } : {}),
      ...(env.PRAXIS_DEFAULT_PROJECT ? { defaultProject: env.PRAXIS_DEFAULT_PROJECT } : {}),
    },
  });

  return {
    brain,
    mcp,
    ready,
    close: async () => {
      await mcp.close();
    },
  };
}
