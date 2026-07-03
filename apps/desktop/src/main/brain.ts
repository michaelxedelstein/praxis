/**
 * Build the in-process brain for the desktop main process. This is the SAME
 * `@praxis/core` brain the headless server runs — but the desktop assembles a
 * much richer tool surface: GitHub MCP, the mac-control MCP, every MCP the user
 * already uses in Cursor (via the importer), and a `spawn_subagents` tool backed
 * by the Conductor. Fully local-first: works with no relay.
 */
import {
  AnthropicLlmClient,
  Brain,
  Conductor,
  McpManager,
  SPAWN_TOOL_NAME,
  buildSpawnToolDef,
  type ExtraTool,
  type SubAgentSpec,
  type TaskDispatcher,
} from "@praxis/core";
import { SlackBridgeAdapter } from "@praxis/bridge-adapter";
import { ElevenLabsClient } from "@praxis/voice-elevenlabs";
import { discoverAll } from "@praxis/mcp-importer";
import { DESTRUCTIVE_TOOLS, serverEntryPath as macControlEntry } from "@praxis/mcp-mac-control";
import type { McpToolProvider, ToolResult, ToolSpec } from "@praxis/core";
import type { DispatchResult, McpServerConfig, StructuredTask } from "@praxis/shared-types";
import type { DesktopEnv } from "./env.js";

class NoDispatcher implements TaskDispatcher {
  async dispatchTask(_t: StructuredTask): Promise<DispatchResult> {
    return { ok: false, detail: "Dispatch not configured (set SLACK_BOT_TOKEN + CURSOR_BRIDGE_BOT_ID)." };
  }
}

/**
 * A dispatcher wrapper that records every dispatched task so the UI task board
 * can show live status. The inner dispatcher does the real Slack posting.
 */
export interface DispatchObserver {
  onDispatch(task: StructuredTask, result: DispatchResult, source: "brain" | "subagent"): void;
}

class ObservingDispatcher implements TaskDispatcher {
  constructor(
    private readonly inner: TaskDispatcher,
    private readonly observer: DispatchObserver,
    private readonly source: "brain" | "subagent" = "brain",
  ) {}
  async dispatchTask(task: StructuredTask): Promise<DispatchResult> {
    const result = await this.inner.dispatchTask(task);
    this.observer.onDispatch(task, result, this.source);
    return result;
  }
}

export interface DesktopBrain {
  brain: Brain;
  /** Guarded tool surface used by the palette (destructive tools ask first). */
  mcp: McpToolProvider;
  conductor: Conductor;
  dispatcher: TaskDispatcher;
  eleven: ElevenLabsClient | null;
  voiceId?: string;
  ready: boolean;
  toolCount: number;
  hasDispatch: boolean;
  close: () => Promise<void>;
}

export interface BuildBrainDeps {
  observer: DispatchObserver;
  /** Called when the brain wants to spawn sub-agents (returns their ids). */
  onSpawn: (specs: SubAgentSpec[]) => string[];
  /** Asks the user to approve a destructive action; resolves true/false. */
  confirm: (description: string) => Promise<boolean>;
  projectRoots: string[];
  log?: (m: string) => void;
}

/**
 * Wraps the MCP surface so destructive tools (deletes, sends) require the user's
 * approval via the HUD before they run. Everything else passes straight through.
 */
class GuardedMcp implements McpToolProvider {
  constructor(
    private readonly inner: McpToolProvider,
    private readonly confirm: (description: string) => Promise<boolean>,
  ) {}
  listTools(): Promise<ToolSpec[]> {
    return this.inner.listTools();
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // Namespaced as "<serverId>__<toolName>"; guard the mac server's risky ones.
    const bare = name.includes("__") ? name.slice(name.indexOf("__") + 2) : name;
    if (DESTRUCTIVE_TOOLS.has(bare)) {
      const approved = await this.confirm(
        `Praxis wants to run "${bare}" with ${JSON.stringify(args)}. Allow?`,
      );
      if (!approved) return { text: "User declined this action.", isError: true };
    }
    return this.inner.callTool(name, args);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}

export async function buildDesktopBrain(
  env: DesktopEnv,
  deps: BuildBrainDeps,
): Promise<DesktopBrain> {
  const log = deps.log ?? console.log;
  const llm = new AnthropicLlmClient({ apiKey: env.anthropicApiKey });

  // 1. Assemble the MCP server list: GitHub + mac-control + imported Cursor MCPs.
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

  if (env.macControlEnabled && process.platform === "darwin") {
    servers.push({
      id: "mac",
      command: process.execPath,
      args: [macControlEntry()],
      // ELECTRON_RUN_AS_NODE lets us reuse Electron's bundled Node to run the
      // stdio server without requiring a separate node on PATH.
      env: { ELECTRON_RUN_AS_NODE: "1" },
      enabled: true,
    });
  }

  // Everything the user already connected in Cursor that is ready to launch.
  try {
    const discovered = await discoverAll({
      projectRoots: deps.projectRoots,
      ambientEnv: process.env,
    });
    for (const c of discovered) {
      if (c.config && c.status === "connected" && !servers.some((s) => s.id === c.config!.id)) {
        servers.push(c.config);
      }
    }
  } catch (err) {
    log(`mcp import failed: ${(err as Error).message}`);
  }

  const mcpManager = await McpManager.create(servers, log);
  const mcp = new GuardedMcp(mcpManager, deps.confirm);
  const toolCount = (await mcp.listTools().catch(() => [])).length;
  const ready = servers.length === 0 || toolCount > 0;

  // 2. Dispatch: Slack bridge (observed for the task board) or a no-op.
  const baseDispatcher: TaskDispatcher = env.slackBotToken
    ? new SlackBridgeAdapter({
        token: env.slackBotToken,
        bridgeBotId: env.cursorBridgeBotId,
        log,
      })
    : new NoDispatcher();
  const dispatcher = new ObservingDispatcher(baseDispatcher, deps.observer, "brain");

  const config = {
    ...(env.reasoningModel ? { reasoningModel: env.reasoningModel } : {}),
    ...(env.chatModel ? { chatModel: env.chatModel } : {}),
    userName: env.userName,
    ...(env.defaultProject ? { defaultProject: env.defaultProject } : {}),
  };

  // 3. Conductor for sub-agents (shares the LLM + MCP surface).
  const conductor = new Conductor({
    llm,
    mcp,
    dispatcher: new ObservingDispatcher(baseDispatcher, deps.observer, "subagent"),
    config,
    concurrency: env.subAgentConcurrency,
  });

  // 4. The spawn tool the main brain can call to fan out work.
  const spawnDef = buildSpawnToolDef();
  const spawnTool: ExtraTool = {
    name: SPAWN_TOOL_NAME,
    description: spawnDef.description,
    inputSchema: spawnDef.inputSchema,
    run: async (input) => {
      const agents = Array.isArray(input.agents) ? (input.agents as Array<Record<string, unknown>>) : [];
      const specs: SubAgentSpec[] = agents.map((a) => ({
        title: String(a.title ?? "sub-agent"),
        task: String(a.task ?? ""),
        projectId: a.project ? `local:${String(a.project)}` : undefined,
      }));
      if (specs.length === 0) return { text: "No agents specified.", isError: true };
      const ids = deps.onSpawn(specs);
      const wait = input.wait !== false;
      if (!wait) {
        return { text: `Spawned ${ids.length} sub-agent(s): ${specs.map((s) => s.title).join(", ")}.`, isError: false };
      }
      const settled = await conductor.settled(ids);
      const report = settled
        .map((s) => `• ${s.title} [${s.status}]: ${s.result ?? "(no result)"}`)
        .join("\n");
      return { text: `Sub-agents finished:\n${report}`, isError: false };
    },
  };

  const brain = new Brain({ llm, mcp, dispatcher, config, extraTools: [spawnTool] });

  const eleven = env.elevenLabsApiKey
    ? new ElevenLabsClient({ apiKey: env.elevenLabsApiKey, defaultVoiceId: env.elevenLabsVoiceId })
    : null;
  log(
    eleven
      ? `[brain] voice: configured (voice ${env.elevenLabsVoiceId ?? "default"})`
      : "[brain] voice: NOT configured (set ELEVENLABS_API_KEY)",
  );

  return {
    brain,
    mcp,
    conductor,
    dispatcher,
    eleven,
    voiceId: env.elevenLabsVoiceId,
    ready,
    toolCount,
    hasDispatch: Boolean(env.slackBotToken),
    close: async () => {
      await mcp.close();
    },
  };
}
