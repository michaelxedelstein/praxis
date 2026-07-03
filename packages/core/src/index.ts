/**
 * @praxis/core — the shared brain. Public surface consumed by every Praxis
 * surface (desktop main process, headless server, tests).
 */
export { Brain } from "./brain.js";
export type { BrainOptions, RunTurnArgs } from "./brain.js";

export { BrainConfigSchema, resolveBrainConfig } from "./config.js";
export type { BrainConfig } from "./config.js";

export { AnthropicLlmClient } from "./anthropic.js";
export type { AnthropicClientOptions } from "./anthropic.js";

export { McpManager } from "./mcp/manager.js";

export { Conductor, SPAWN_TOOL_NAME, buildSpawnToolDef } from "./conductor.js";
export type {
  ConductorOptions,
  ConductorListener,
  SubAgentSpec,
  SubAgentState,
  SubAgentStatus,
} from "./conductor.js";

export { looksLikeWork, pickModel } from "./classifier.js";
export { buildSystemPrompt, DISPATCH_TOOL_NAME } from "./prompt.js";

export type {
  ExtraTool,
  LlmClient,
  LlmRequest,
  LlmResponse,
  LlmMessage,
  LlmToolDef,
  LlmContentBlock,
  McpToolProvider,
  TaskDispatcher,
  ToolSpec,
  ToolResult,
  StatusEmitter,
} from "./types.js";
