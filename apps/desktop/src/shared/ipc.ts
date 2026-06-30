/**
 * IPC contract shared between the Electron main process and the renderer. Kept
 * in one place so both sides stay in sync. The brain runs in MAIN; the renderer
 * only captures the mic and plays audio — so the ElevenLabs key never reaches
 * the renderer (a deliberate hardening of the prompt's "STT/TTS in renderer").
 */
import type { TurnResult } from "@praxis/shared-types";

export const IPC = {
  processAudio: "praxis:processAudio",
  processText: "praxis:processText",
  getStatus: "praxis:getStatus",
  summon: "praxis:summon",
} as const;

/** Renderer → main: an audio clip to transcribe + answer + speak. */
export interface ProcessAudioRequest {
  /** Raw audio bytes (e.g. webm/opus from MediaRecorder). */
  audio: ArrayBuffer;
  mimeType: string;
}

/** Renderer → main: a typed utterance (no STT needed). */
export interface ProcessTextRequest {
  text: string;
}

/** Main → renderer: the full result of a turn. */
export interface ProcessResult {
  /** What we heard (empty for typed input). */
  userText: string;
  result: TurnResult;
  /** base64-encoded mp3 of the spoken reply, or null if TTS unavailable. */
  audioBase64: string | null;
}

export interface PraxisStatus {
  brainReady: boolean;
  hasVoice: boolean;
  userName: string;
}

/** The API surface exposed on `window.praxis` by the preload script. */
export interface PraxisBridge {
  processAudio(req: ProcessAudioRequest): Promise<ProcessResult>;
  processText(req: ProcessTextRequest): Promise<ProcessResult>;
  getStatus(): Promise<PraxisStatus>;
  /** Subscribe to global-hotkey summons; returns an unsubscribe fn. */
  onSummon(cb: () => void): () => void;
}
