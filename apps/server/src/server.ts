/**
 * The headless brain HTTP/WS server.
 *
 *   GET  /healthz       — liveness + brain readiness (used by Docker/compose).
 *   POST /voice/token   — mints a short-lived ElevenLabs conversation token for
 *                         the mobile client. The API key never leaves here.
 *   WS   /ws            — bearer-authenticated stream of utterances → spoken
 *                         replies, one running conversation per connection.
 *
 * All boundaries are bearer-authenticated with PRAXIS_AUTH_SECRET (single-user).
 */
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { isAuthorized, encode, tryDecodeClientMessage } from "@praxis/transport";
import type { ChatMessage, ServerMessage } from "@praxis/shared-types";
import { ElevenLabsClient } from "@praxis/voice-elevenlabs";
import type { ServerEnv } from "./env.js";
import { buildBrain, type BuiltBrain } from "./brain-factory.js";

export interface PraxisServer {
  app: FastifyInstance;
  listen: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createServer(env: ServerEnv): Promise<PraxisServer> {
  // Use an explicit Node http server so we can attach a raw WebSocketServer to
  // the same port and handle the upgrade ourselves (with auth) before fastify.
  const httpServer = createHttpServer();
  const app = Fastify({ logger: true, serverFactory: (handler) => {
    httpServer.on("request", handler);
    return httpServer;
  } });

  const log = (msg: string) => app.log.info(msg);
  const built: BuiltBrain = await buildBrain(env, log);

  const eleven =
    env.ELEVENLABS_API_KEY != null
      ? new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY })
      : null;

  /* ----------------------------- HTTP routes ----------------------------- */

  app.get("/healthz", async () => ({
    ok: true,
    brainReady: built.ready,
    uptime: process.uptime(),
  }));

  app.post("/voice/token", async (request, reply) => {
    if (!isAuthorized(request.raw, env.PRAXIS_AUTH_SECRET)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!eleven || !env.ELEVENLABS_AGENT_ID) {
      return reply
        .code(503)
        .send({ error: "voice not configured (need ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID)" });
    }
    try {
      const token = await eleven.mintConversationToken(env.ELEVENLABS_AGENT_ID);
      return reply.send(token);
    } catch (err) {
      request.log.error(err);
      return reply.code(502).send({ error: "token mint failed" });
    }
  });

  /* ------------------------------- WS layer ------------------------------ */

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (!isAuthorized(req as IncomingMessage, env.PRAXIS_AUTH_SECRET)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    // One running conversation per connection.
    const history: ChatMessage[] = [];
    app.log.info("WS client connected");

    ws.on("message", async (raw) => {
      const decoded = tryDecodeClientMessage(raw as Buffer);
      if (!decoded.ok) {
        send(ws, { type: "error", message: `bad message: ${decoded.error}` });
        return;
      }
      const msg = decoded.value;
      if (msg.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }

      // utterance
      const id = msg.id;
      try {
        const result = await built.brain.runTurn({
          history,
          userText: msg.text,
          onStatus: (detail) => send(ws, { type: "status", id, detail }),
        });
        history.push({ role: "user", content: msg.text });
        history.push({ role: "assistant", content: result.reply });
        send(ws, { type: "reply", id, result });
      } catch (err) {
        app.log.error(err);
        send(ws, { type: "error", id, message: (err as Error).message });
      }
    });

    ws.on("close", () => app.log.info("WS client disconnected"));
  });

  return {
    app,
    listen: async () => {
      await app.ready();
      await new Promise<void>((resolve, reject) => {
        httpServer.listen(env.port, env.host, () => resolve());
        httpServer.once("error", reject);
      });
      app.log.info(`Praxis brain listening on ${env.host}:${env.port}`);
    },
    close: async () => {
      wss.close();
      await built.close();
      await app.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(encode(msg));
}
