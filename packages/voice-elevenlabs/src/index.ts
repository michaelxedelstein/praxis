/**
 * @praxis/voice-elevenlabs — thin STT (Scribe), TTS, and Voice Engine
 * conversation-token helpers around the ElevenLabs HTTP API.
 */
export { ElevenLabsClient } from "./client.js";
export type {
  ElevenLabsOptions,
  TranscribeOptions,
  SynthesizeOptions,
} from "./client.js";
export type { VoiceTokenResponse } from "@praxis/shared-types";
