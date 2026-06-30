/**
 * AnthropicLlmClient — adapts the official @anthropic-ai/sdk to the small,
 * provider-neutral `LlmClient` interface the loop depends on. Keeping this thin
 * means the loop never imports the SDK directly and stays trivially mockable.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  LlmContentBlock,
  LlmMessage,
} from "./types.js";

export interface AnthropicClientOptions {
  apiKey: string;
  /** Override base URL (e.g. a gateway/proxy). */
  baseURL?: string;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(opts: AnthropicClientOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  async createMessage(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages as Anthropic.MessageParam[],
      tools: req.tools as Anthropic.Tool[],
    });

    const content: LlmContentBlock[] = res.content.map((block) => {
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        };
      }
      // Unknown block types collapse to empty text so the loop never crashes.
      return { type: "text", text: "" };
    });

    return { stopReason: res.stop_reason ?? "end_turn", content };
  }
}

/** Re-exported for callers assembling messages by hand (e.g. tests). */
export type { LlmMessage };
