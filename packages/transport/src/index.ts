/**
 * @praxis/transport — the WebSocket protocol shared by every surface. Message
 * schemas live in @praxis/shared-types; this package adds the codec, bearer
 * auth, and a typed Node client.
 */
export {
  encode,
  decodeClientMessage,
  decodeServerMessage,
  tryDecodeClientMessage,
} from "./codec.js";
export { secretsMatch, extractBearer, isAuthorized } from "./auth.js";
export { BrainClient } from "./client.js";
export type { BrainClientOptions } from "./client.js";

// Re-export the wire types so consumers can import everything from transport.
export type {
  ClientMessage,
  ServerMessage,
  ClientUtterance,
  ServerReply,
  ServerStatus,
  ServerError,
  TurnResult,
} from "@praxis/shared-types";
