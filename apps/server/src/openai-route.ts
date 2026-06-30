/**
 * OpenAI-compatible `/v1/chat/completions` endpoint.
 *
 * This is the "bring your own LLM" seam for ElevenLabs Voice Engine: the
 * ElevenLabs ConvAI agent is configured with a Custom LLM pointing here, so the
 * SDK handles the real-time audio loop (turn-taking, barge-in, sub-second TTS)
 * on the phone while the actual reasoning — the Claude + MCP loop and task
 * dispatch — stays ours, running through `core`. ElevenLabs sends OpenAI-shaped
 * chat requests; we run a brain turn and stream back an OpenAI-shaped reply.
 *
 * Secured with the same PRAXIS_AUTH_SECRET bearer (set it as the agent's custom
 * LLM API key in the ElevenLabs dashboard).
 */
import type { FastifyInstance } from "fastify";
import { isAuthorized } from "@praxis/transport";
import type { Brain } from "@praxis/core";
import type { ChatMessage } from "@praxis/shared-types";

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
}

interface OpenAIChatRequest {
  messages: OpenAIChatMessage[];
  stream?: boolean;
  model?: string;
}

export function registerOpenAiRoute(app: FastifyInstance, brain: Brain, secret: string): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    if (!isAuthorized(request.raw, secret)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const body = request.body as OpenAIChatRequest;
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    // The last user message is the new utterance; earlier user/assistant turns
    // become history. System prompts from ElevenLabs are ignored — our persona
    // lives in core.
    let userText = "";
    const history: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const content = m.content ?? "";
      if (m.role === "user") userText = content;
      history.push({ role: m.role, content });
    }
    // Drop the final user turn from history (it's the current utterance).
    if (history.length && history[history.length - 1]?.role === "user") history.pop();

    let replyText: string;
    try {
      const result = await brain.runTurn({ history, userText });
      replyText = result.reply;
    } catch (err) {
      request.log.error(err);
      replyText = "Sorry, something went wrong on my end. Try me again?";
    }

    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = body.model ?? "praxis-brain";

    if (body.stream === false) {
      return reply.send({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: replyText },
            finish_reason: "stop",
          },
        ],
      });
    }

    // Streaming SSE (the default ElevenLabs expects).
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (obj: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    };
    const base = { id, object: "chat.completion.chunk", created, model };

    send({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { content: replyText }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
    return reply;
  });
}
