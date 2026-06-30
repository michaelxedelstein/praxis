/**
 * Internal contracts for the brain. These keep `core` platform-agnostic: the
 * LLM, the MCP tool surface, and the task dispatcher are all injected behind
 * interfaces, so the loop can be unit-tested with mocks and the same brain runs
 * in Electron, in the headless server, or anywhere else.
 */
import type { StructuredTask, DispatchResult } from "@praxis/shared-types";

/* ----------------------------- Tool surface ------------------------------- */

/** A JSON-schema-described tool the model may call (from MCP or built-in). */
export interface ToolSpec {
  /** Namespaced, model-visible name (e.g. "github__search_repositories"). */
  name: string;
  description: string;
  /** JSON Schema object describing the tool input. */
  inputSchema: Record<string, unknown>;
}

/** Result of invoking a tool. `text` is fed back to the model. */
export interface ToolResult {
  text: string;
  isError: boolean;
}

/** Aggregates one or more MCP servers behind a single tool namespace. */
export interface McpToolProvider {
  /** All tools currently available across connected servers. */
  listTools(): Promise<ToolSpec[]>;
  /** Invoke a tool by its namespaced name. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** Tear down all server connections. */
  close(): Promise<void>;
}

/** Dispatches executable work to the outside world (the bridge-adapter). */
export interface TaskDispatcher {
  dispatchTask(task: StructuredTask): Promise<DispatchResult>;
}

/* ------------------------------- LLM client ------------------------------- */

/** A content block in an assistant response. */
export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/** A message in the LLM conversation (provider-neutral subset). */
export interface LlmMessage {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
        | {
            type: "tool_result";
            tool_use_id: string;
            content: string;
            is_error?: boolean;
          }
      >;
}

/** A tool definition handed to the LLM. */
export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  maxTokens: number;
}

export interface LlmResponse {
  /** "tool_use" means the model wants tools run before continuing. */
  stopReason: "tool_use" | "end_turn" | "max_tokens" | "stop_sequence" | string;
  content: LlmContentBlock[];
}

/** Minimal LLM surface the loop needs; AnthropicLlmClient implements it. */
export interface LlmClient {
  createMessage(req: LlmRequest): Promise<LlmResponse>;
}

/* ------------------------------- Telemetry -------------------------------- */

/** Optional hook the loop calls as it progresses (for UI/voice status). */
export type StatusEmitter = (detail: string) => void;
