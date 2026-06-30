/**
 * Wire codec for the brain WebSocket protocol. Every frame is JSON text,
 * validated against the zod schemas in @praxis/shared-types so nothing untyped
 * ever crosses the transport boundary (a hard guardrail).
 */
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@praxis/shared-types";

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClientMessage(raw: string | Buffer): ClientMessage {
  const json = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  return ClientMessageSchema.parse(json);
}

export function decodeServerMessage(raw: string | Buffer): ServerMessage {
  const json = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  return ServerMessageSchema.parse(json);
}

/** Non-throwing variant for the server's receive loop. */
export function tryDecodeClientMessage(
  raw: string | Buffer,
): { ok: true; value: ClientMessage } | { ok: false; error: string } {
  try {
    return { ok: true, value: decodeClientMessage(raw) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
