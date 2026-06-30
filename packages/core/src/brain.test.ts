/**
 * Brain loop tests, driven by a scripted mock LLM, a mock MCP provider, and a
 * mock dispatcher. These prove the three behaviors that matter:
 *   1. Multi-step tool chaining (loop continues past the first tool call).
 *   2. Task classification → dispatch through the injected dispatcher.
 *   3. Plain conversational answers don't dispatch anything.
 */
import { describe, it, expect, vi } from "vitest";
import { Brain } from "./brain.js";
import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  McpToolProvider,
  TaskDispatcher,
  ToolSpec,
} from "./types.js";
import type { StructuredTask } from "@praxis/shared-types";

/** A mock LLM that returns a scripted sequence of responses, one per call. */
function scriptedLlm(responses: LlmResponse[]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let i = 0;
  return {
    calls,
    async createMessage(req: LlmRequest): Promise<LlmResponse> {
      calls.push(req);
      const res = responses[Math.min(i, responses.length - 1)];
      i++;
      return res!;
    },
  };
}

function mockMcp(tools: ToolSpec[], results: Record<string, string> = {}): McpToolProvider {
  return {
    async listTools() {
      return tools;
    },
    async callTool(name) {
      return { text: results[name] ?? `result of ${name}`, isError: false };
    },
    async close() {},
  };
}

const ghTool: ToolSpec = {
  name: "github__list_commits",
  description: "List recent commits",
  inputSchema: { type: "object", properties: {} },
};

describe("Brain.runTurn", () => {
  it("chains multiple tool calls before answering (conversational query)", async () => {
    const llm = scriptedLlm([
      // Round 1: ask for a tool
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "github__list_commits", input: {} }],
      },
      // Round 2: ask for the SAME tool again (proves it doesn't stop after one)
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "t2", name: "github__list_commits", input: {} }],
      },
      // Round 3: final spoken answer
      {
        stopReason: "end_turn",
        content: [
          { type: "text", text: "Hey Michael, you just merged the login fix on Roomies. What next?" },
        ],
      },
    ]);
    const dispatcher: TaskDispatcher = { dispatchTask: vi.fn() };

    const brain = new Brain({ llm, mcp: mockMcp([ghTool]), dispatcher });
    const result = await brain.runTurn({ userText: "what did we just do on Roomies?" });

    expect(result.intent).toBe("chat");
    expect(result.dispatched).toBeUndefined();
    expect(result.toolsUsed).toEqual(["github__list_commits", "github__list_commits"]);
    expect(llm.calls.length).toBe(3); // proves chaining, not single-shot
    expect(dispatcher.dispatchTask).not.toHaveBeenCalled();
    expect(result.reply).toContain("Michael");
  });

  it("classifies a work request and dispatches it through the adapter", async () => {
    const task: StructuredTask = {
      project: "roomies",
      instruction: "Add a feature that shows each roommate's pending chores on the dashboard.",
    };
    const llm = scriptedLlm([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "d1", name: "dispatch_task", input: task }],
      },
      {
        stopReason: "end_turn",
        content: [
          { type: "text", text: "Done — I sent that over to Roomies. Anything else you want to add?" },
        ],
      },
    ]);
    const dispatchTask = vi.fn(async () => ({
      ok: true,
      channelId: "C123",
      messageTs: "1.2",
    }));
    const dispatcher: TaskDispatcher = { dispatchTask };

    const brain = new Brain({ llm, mcp: mockMcp([ghTool]), dispatcher });
    const result = await brain.runTurn({
      userText: "add a feature that shows pending chores per roommate",
    });

    expect(result.intent).toBe("task");
    expect(result.dispatched?.ok).toBe(true);
    expect(dispatchTask).toHaveBeenCalledOnce();
    expect(dispatchTask).toHaveBeenCalledWith(expect.objectContaining({ project: "roomies" }));
  });

  it("answers plainly with no tools and no dispatch", async () => {
    const llm = scriptedLlm([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "All good here, Michael. What do you want to dig into?" }],
      },
    ]);
    const dispatcher: TaskDispatcher = { dispatchTask: vi.fn() };
    const brain = new Brain({ llm, mcp: mockMcp([]), dispatcher });
    const result = await brain.runTurn({ userText: "you up?" });

    expect(result.intent).toBe("chat");
    expect(result.toolsUsed).toEqual([]);
    expect(dispatcher.dispatchTask).not.toHaveBeenCalled();
  });

  it("reports a failed dispatch back into the loop", async () => {
    const llm = scriptedLlm([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "d1",
            name: "dispatch_task",
            input: { project: "roomies", instruction: "do the thing" },
          },
        ],
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "Hit a snag dispatching that — want me to retry?" }],
      },
    ]);
    const dispatcher: TaskDispatcher = {
      dispatchTask: vi.fn(async () => ({ ok: false, detail: "bridge offline" })),
    };
    const brain = new Brain({ llm, mcp: mockMcp([]), dispatcher });
    const result = await brain.runTurn({ userText: "fix the build on roomies" });

    expect(result.intent).toBe("task");
    expect(result.dispatched?.ok).toBe(false);
    expect(result.dispatched?.detail).toBe("bridge offline");
  });
});
