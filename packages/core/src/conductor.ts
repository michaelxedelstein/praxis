/**
 * Conductor — the sub-agent manager.
 *
 * The main brain (or the user) can spawn scoped sub-agents: each one is its own
 * Brain sharing the LLM + MCP surface but with its own persona, task, and
 * optional repo context. The conductor runs them with a concurrency cap and a
 * turn budget, and emits events so a UI can render live orbiting agents.
 */
import type { DispatchResult, StructuredTask, TurnResult } from "@praxis/shared-types";
import { Brain } from "./brain.js";
import type { BrainConfig } from "./config.js";
import type { LlmClient, McpToolProvider, TaskDispatcher } from "./types.js";

export type SubAgentStatus = "queued" | "running" | "done" | "failed";

export interface SubAgentSpec {
  /** Short human title shown in the UI ("Audit praxis deps"). */
  title: string;
  /** The instruction the sub-agent works on autonomously. */
  task: string;
  /** Optional grounding context (repo tree, README, constraints). */
  context?: string;
  /** Optional project node id the agent is scoped to (for the UI). */
  projectId?: string;
}

export interface SubAgentState {
  id: string;
  title: string;
  projectId?: string;
  status: SubAgentStatus;
  transcript: Array<{ role: "user" | "assistant" | "status"; text: string; at: number }>;
  createdAt: number;
  updatedAt: number;
  result?: string;
}

export type ConductorListener = (agents: SubAgentState[]) => void;

export interface ConductorOptions {
  llm: LlmClient;
  mcp: McpToolProvider;
  /** Sub-agents may dispatch too; wrap with guards if needed. */
  dispatcher: TaskDispatcher;
  config?: Partial<BrainConfig>;
  /** Max sub-agents running at once. */
  concurrency?: number;
}

/** Dispatcher wrapper: sub-agents describe, the host decides. Default deny. */
class SubAgentDispatcher implements TaskDispatcher {
  constructor(private readonly inner: TaskDispatcher) {}
  async dispatchTask(task: StructuredTask): Promise<DispatchResult> {
    return this.inner.dispatchTask(task);
  }
}

let nextId = 1;

export class Conductor {
  private readonly opts: ConductorOptions;
  private readonly agents = new Map<string, SubAgentState>();
  private readonly queue: Array<{ state: SubAgentState; spec: SubAgentSpec }> = [];
  private running = 0;
  private readonly listeners = new Set<ConductorListener>();

  constructor(opts: ConductorOptions) {
    this.opts = opts;
  }

  onChange(listener: ConductorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): SubAgentState[] {
    return [...this.agents.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Queue a batch of sub-agents; returns their ids immediately. */
  spawn(specs: SubAgentSpec[]): string[] {
    const ids: string[] = [];
    for (const spec of specs) {
      const state: SubAgentState = {
        id: `agent-${nextId++}`,
        title: spec.title,
        projectId: spec.projectId,
        status: "queued",
        transcript: [{ role: "user", text: spec.task, at: Date.now() }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.agents.set(state.id, state);
      this.queue.push({ state, spec });
      ids.push(state.id);
    }
    this.emit();
    this.pump();
    return ids;
  }

  /** Wait until a given set of agents settles (done or failed). */
  async settled(ids: string[]): Promise<SubAgentState[]> {
    const pending = () =>
      ids.some((id) => {
        const a = this.agents.get(id);
        return a && (a.status === "queued" || a.status === "running");
      });
    while (pending()) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return ids.map((id) => this.agents.get(id)).filter((a): a is SubAgentState => Boolean(a));
  }

  private pump(): void {
    const cap = this.opts.concurrency ?? 3;
    while (this.running < cap && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.running++;
      void this.runOne(next.state, next.spec).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async runOne(state: SubAgentState, spec: SubAgentSpec): Promise<void> {
    state.status = "running";
    state.updatedAt = Date.now();
    this.emit();

    const brain = new Brain({
      llm: this.opts.llm,
      mcp: this.opts.mcp,
      dispatcher: new SubAgentDispatcher(this.opts.dispatcher),
      config: {
        ...this.opts.config,
        // Sub-agents get a tighter budget than the main loop.
        maxToolRounds: 6,
      },
    });

    try {
      const result: TurnResult = await brain.runTurn({
        userText: spec.task,
        context: [
          `You are a focused sub-agent spawned by Praxis. Work the task to completion using your tools, then report your findings plainly.`,
          spec.context ?? "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        onStatus: (detail) => {
          state.transcript.push({ role: "status", text: detail, at: Date.now() });
          state.updatedAt = Date.now();
          this.emit();
        },
      });
      state.transcript.push({ role: "assistant", text: result.reply, at: Date.now() });
      state.result = result.reply;
      state.status = "done";
    } catch (err) {
      state.result = (err as Error).message;
      state.transcript.push({
        role: "status",
        text: `failed: ${(err as Error).message}`,
        at: Date.now(),
      });
      state.status = "failed";
    }
    state.updatedAt = Date.now();
    this.emit();
  }

  private emit(): void {
    const snapshot = this.list();
    for (const l of this.listeners) l(snapshot);
  }
}

/** Tool definition the host registers on the main brain to enable spawning. */
export const SPAWN_TOOL_NAME = "spawn_subagents";

export function buildSpawnToolDef(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  return {
    name: SPAWN_TOOL_NAME,
    description:
      "Spawn one or more autonomous sub-agents to work parts of a bigger job in parallel " +
      "(e.g. one per repo). Each runs its own tool-using loop and reports back. " +
      "Use for fan-out work; do NOT use for simple single-step questions.",
    inputSchema: {
      type: "object",
      properties: {
        agents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short label, e.g. 'Audit praxis deps'." },
              task: { type: "string", description: "Self-contained instruction for the agent." },
              project: {
                type: "string",
                description: "Optional project short-name this agent is scoped to.",
              },
            },
            required: ["title", "task"],
          },
        },
        wait: {
          type: "boolean",
          description:
            "If true (default), wait for all agents and get their reports. If false, fire and forget.",
        },
      },
      required: ["agents"],
    },
  };
}
