/**
 * @praxis/shared-types
 *
 * The single source of truth for every payload that crosses a boundary in
 * Praxis: task dispatch, transport (WS) messages, tool results, and config.
 * Everything is a zod schema first; the TS types are inferred from them so the
 * runtime validation and the compile-time types can never drift apart.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Conversation                                                              */
/* -------------------------------------------------------------------------- */

export const RoleSchema = z.enum(["user", "assistant"]);
export type Role = z.infer<typeof RoleSchema>;

/** One turn of conversation history handed to the brain. */
export const ChatMessageSchema = z.object({
  role: RoleSchema,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/* -------------------------------------------------------------------------- */
/*  Task dispatch (bridge-adapter contract)                                   */
/* -------------------------------------------------------------------------- */

/** How the downstream Cursor agent should run the dispatched task. */
export const TaskModeSchema = z.enum(["edit", "plan", "ask"]);
export type TaskMode = z.infer<typeof TaskModeSchema>;

/**
 * A structured, executable task the brain decided to dispatch. Rendered by the
 * bridge-adapter into the cursor-slack-bridge's text contract and posted into
 * the matching `#proj-<project>` Slack channel.
 */
export const StructuredTaskSchema = z.object({
  /** Target project; maps to `#proj-<project>` and the local repo folder. */
  project: z.string().min(1),
  /** Concise, self-contained instruction for the coding agent. */
  instruction: z.string().min(1),
  /** Optional run mode (defaults to the bridge's own default = edit). */
  mode: TaskModeSchema.optional(),
  /** Optional model phrase the bridge understands (e.g. "opus 4.8 high thinking"). */
  model: z.string().optional(),
  /** Extra context appended below the instruction (recent work, constraints). */
  context: z.string().optional(),
});
export type StructuredTask = z.infer<typeof StructuredTaskSchema>;

/** Result of attempting to dispatch a task to the bridge. */
export const DispatchResultSchema = z.object({
  ok: z.boolean(),
  /** Slack channel id the task was posted to (when ok). */
  channelId: z.string().optional(),
  /** Slack message ts (thread root) of the posted task (when ok). */
  messageTs: z.string().optional(),
  /** Human-readable detail, especially on failure. */
  detail: z.string().optional(),
});
export type DispatchResult = z.infer<typeof DispatchResultSchema>;

/* -------------------------------------------------------------------------- */
/*  Brain turn results                                                        */
/* -------------------------------------------------------------------------- */

/** Classification of a single user utterance. */
export const IntentKindSchema = z.enum(["chat", "task"]);
export type IntentKind = z.infer<typeof IntentKindSchema>;

/** What a single brain turn produced. */
export const TurnResultSchema = z.object({
  /** Natural, spoken-style reply for the voice layer to read aloud. */
  reply: z.string(),
  /** Whether this turn classified the utterance as work and dispatched it. */
  intent: IntentKindSchema,
  /** Present when a task was dispatched this turn. */
  dispatched: DispatchResultSchema.optional(),
  /** Names of MCP tools the loop invoked this turn (for telemetry/UI). */
  toolsUsed: z.array(z.string()).default([]),
});
export type TurnResult = z.infer<typeof TurnResultSchema>;

/* -------------------------------------------------------------------------- */
/*  MCP server configuration (config-driven manager)                          */
/* -------------------------------------------------------------------------- */

/** A single MCP server the manager can spin up over stdio. */
export const McpServerConfigSchema = z.object({
  /** Stable id used in logs and tool namespacing. */
  id: z.string().min(1),
  /** Executable to launch (e.g. "npx", "docker", "github-mcp-server"). */
  command: z.string().min(1),
  /** Arguments passed to the command. */
  args: z.array(z.string()).default([]),
  /** Extra env vars merged into the child process env. */
  env: z.record(z.string()).default({}),
  /** If false, the manager skips this server (without code changes). */
  enabled: z.boolean().default(true),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/* -------------------------------------------------------------------------- */
/*  Transport (WS) messages — shared by every surface                          */
/* -------------------------------------------------------------------------- */

/** Client → brain: a transcribed user utterance to process. */
export const ClientUtteranceSchema = z.object({
  type: z.literal("utterance"),
  /** Correlates the reply back to this request. */
  id: z.string(),
  text: z.string(),
});
export type ClientUtterance = z.infer<typeof ClientUtteranceSchema>;

/** Client → brain: liveness ping. */
export const ClientPingSchema = z.object({
  type: z.literal("ping"),
});
export type ClientPing = z.infer<typeof ClientPingSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientUtteranceSchema,
  ClientPingSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Brain → client: incremental status while the loop runs (optional UI). */
export const ServerStatusSchema = z.object({
  type: z.literal("status"),
  id: z.string(),
  /** e.g. "thinking", "calling tool: github.search", "dispatching task". */
  detail: z.string(),
});
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

/** Brain → client: the final spoken reply for a given utterance id. */
export const ServerReplySchema = z.object({
  type: z.literal("reply"),
  id: z.string(),
  result: TurnResultSchema,
});
export type ServerReply = z.infer<typeof ServerReplySchema>;

/** Brain → client: an error tied to an utterance (or connection-level). */
export const ServerErrorSchema = z.object({
  type: z.literal("error"),
  id: z.string().optional(),
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerErrorSchema>;

/** Brain → client: pong for a ping. */
export const ServerPongSchema = z.object({
  type: z.literal("pong"),
});
export type ServerPong = z.infer<typeof ServerPongSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerStatusSchema,
  ServerReplySchema,
  ServerErrorSchema,
  ServerPongSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/* -------------------------------------------------------------------------- */
/*  Voice token endpoint (server → mobile)                                     */
/* -------------------------------------------------------------------------- */

/** Response from `POST /voice/token` — the ElevenLabs key never leaves here. */
export const VoiceTokenResponseSchema = z.object({
  /** Short-lived ElevenLabs conversation token for the client SDK. */
  token: z.string(),
  /** Optional agent/voice id the client should attach to. */
  agentId: z.string().optional(),
  /** Unix seconds the token expires (advisory for the client). */
  expiresAt: z.number().optional(),
});
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Parse + validate an inbound client message, throwing on malformed input. */
export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw);
}

/** Parse + validate an inbound server message. */
export function parseServerMessage(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw);
}
