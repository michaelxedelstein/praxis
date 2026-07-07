/**
 * Brain — the self-driven agentic loop.
 *
 * Flow per turn:
 *   1. Take conversation history + the new user utterance.
 *   2. Call the LLM with the system persona + all MCP tools + the built-in
 *      `dispatch_task` tool.
 *   3. If the LLM asks for tools, run them (MCP or dispatch), feed results back,
 *      and LOOP — this multi-step chaining is the whole point; it does not stop
 *      after one tool call.
 *   4. When the LLM produces a final answer, return it as a spoken-style reply,
 *      tagged chat-vs-task by whether `dispatch_task` was called.
 *
 * The brain is platform-agnostic: LLM, tools, and dispatcher are all injected.
 */
import {
  StructuredTaskSchema,
  type ChatMessage,
  type DispatchResult,
  type TurnResult,
} from "@praxis/shared-types";
import type { BrainConfig } from "./config.js";
import { resolveBrainConfig } from "./config.js";
import { pickModel } from "./classifier.js";
import { buildSystemPrompt, buildDispatchToolDef, DISPATCH_TOOL_NAME } from "./prompt.js";
import type {
  ExtraTool,
  LlmClient,
  LlmMessage,
  LlmToolDef,
  McpToolProvider,
  StatusEmitter,
  TaskDispatcher,
} from "./types.js";

export interface BrainOptions {
  llm: LlmClient;
  mcp: McpToolProvider;
  dispatcher: TaskDispatcher;
  config?: Partial<BrainConfig>;
  /** Host-provided built-in tools (e.g. spawn_subagents on desktop). */
  extraTools?: ExtraTool[];
}

export interface RunTurnArgs {
  /** Prior conversation (oldest first). */
  history?: ChatMessage[];
  /** The new transcribed user utterance. */
  userText: string;
  /** Optional progress callback for UI/voice status updates. */
  onStatus?: StatusEmitter;
  /**
   * Optional extra grounding appended to the system prompt for this turn —
   * e.g. the focused repo's file tree, README, and recent commits.
   */
  context?: string;
}

export class Brain {
  private readonly llm: LlmClient;
  private readonly mcp: McpToolProvider;
  private readonly dispatcher: TaskDispatcher;
  private readonly config: BrainConfig;
  private readonly extraTools: Map<string, ExtraTool>;

  constructor(opts: BrainOptions) {
    this.llm = opts.llm;
    this.mcp = opts.mcp;
    this.dispatcher = opts.dispatcher;
    this.config = resolveBrainConfig(opts.config ?? {});
    this.extraTools = new Map((opts.extraTools ?? []).map((t) => [t.name, t]));
  }

  async runTurn(args: RunTurnArgs): Promise<TurnResult> {
    const { userText, history = [], onStatus, context } = args;
    const emit: StatusEmitter = onStatus ?? (() => {});

    const system = context
      ? `${buildSystemPrompt(this.config)}\n\nCURRENT FOCUS:\n${context}`
      : buildSystemPrompt(this.config);
    const model = pickModel(userText, this.config);

    // Assemble the tool surface: every MCP tool, host extras, and dispatch.
    const mcpTools = await this.mcp.listTools();
    const tools: LlmToolDef[] = [
      ...mcpTools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
      ...[...this.extraTools.values()].map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
      buildDispatchToolDef(),
    ];

    const messages: LlmMessage[] = [
      // Drop any empty history turns — a blank content string is also rejected
      // by the API ("text content blocks must be non-empty").
      ...history
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }) satisfies LlmMessage),
      { role: "user", content: userText },
    ];

    const toolsUsed: string[] = [];
    let dispatched: DispatchResult | undefined;
    // Accumulate token spend across every LLM call this turn makes.
    const usage = { model, inputTokens: 0, outputTokens: 0 };
    const tally = (u?: { inputTokens: number; outputTokens: number }): void => {
      if (!u) return;
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
    };

    for (let round = 0; round < this.config.maxToolRounds; round++) {
      emit(round === 0 ? "thinking" : "thinking (continuing)");
      const res = await this.llm.createMessage({
        model,
        system,
        messages,
        tools,
        maxTokens: this.config.maxTokens,
      });
      tally(res.usage);

      const toolUses = res.content.filter(
        (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          b.type === "tool_use",
      );

      // No tools requested → this is the final spoken answer.
      if (res.stopReason !== "tool_use" || toolUses.length === 0) {
        const reply = res.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        return {
          reply: reply || "Sorry, I didn't catch that — can you say it again?",
          intent: dispatched ? "task" : "chat",
          dispatched,
          toolsUsed,
          usage,
        };
      }

      // Record the assistant's tool-use turn so the thread stays valid. Newer
      // Claude models can emit an EMPTY text block alongside tool_use; echoing
      // that back trips Anthropic's "text content blocks must be non-empty"
      // 400, so drop any empty/whitespace-only text blocks first (tool_use
      // blocks are always kept).
      const assistantContent = res.content.filter(
        (b) => b.type !== "text" || b.text.trim().length > 0,
      );
      messages.push({ role: "assistant", content: assistantContent });

      // Execute each requested tool and collect results for the next round.
      const toolResults: LlmMessage["content"] = [];
      for (const call of toolUses) {
        toolsUsed.push(call.name);

        if (call.name === DISPATCH_TOOL_NAME) {
          emit("dispatching task");
          const result = await this.handleDispatch(call.input);
          dispatched = result.dispatch;
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: result.text,
            is_error: !result.dispatch.ok,
          });
          continue;
        }

        const extra = this.extraTools.get(call.name);
        if (extra) {
          emit(`running: ${call.name}`);
          const out = await extra
            .run(call.input)
            .catch((err: Error) => ({ text: `Tool failed: ${err.message}`, isError: true }));
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: out.text || "(no output)",
            is_error: out.isError,
          });
          continue;
        }

        emit(`calling tool: ${call.name}`);
        const out = await this.mcp.callTool(call.name, call.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: out.text || "(no output)",
          is_error: out.isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    // Ran out of tool rounds — ask the model for a final wrap-up with no tools.
    emit("wrapping up");
    const finalRes = await this.llm.createMessage({
      model,
      system,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Wrap up out loud now in a sentence or two based on what you found, and hand control back to me.",
        },
      ],
      tools: [],
      maxTokens: this.config.maxTokens,
    });
    tally(finalRes.usage);
    const reply = finalRes.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return {
      reply: reply || "I did some digging but ran long — ask me to continue?",
      intent: dispatched ? "task" : "chat",
      dispatched,
      toolsUsed,
      usage,
    };
  }

  /** Validate the model's dispatch args and route through the bridge adapter. */
  private async handleDispatch(
    input: Record<string, unknown>,
  ): Promise<{ dispatch: DispatchResult; text: string }> {
    // Fall back to a default project if the model omitted one but we have one.
    const withDefaults = {
      ...input,
      project: input.project ?? this.config.defaultProject,
    };
    const parsed = StructuredTaskSchema.safeParse(withDefaults);
    if (!parsed.success) {
      const detail = `Task was malformed: ${parsed.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`;
      return { dispatch: { ok: false, detail }, text: detail };
    }
    const dispatch = await this.dispatcher.dispatchTask(parsed.data);
    const text = dispatch.ok
      ? `Task dispatched to #proj-${parsed.data.project}.`
      : `Dispatch failed: ${dispatch.detail ?? "unknown error"}`;
    return { dispatch, text };
  }
}
