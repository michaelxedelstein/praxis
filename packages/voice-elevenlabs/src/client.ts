/**
 * Thin ElevenLabs wrappers. Platform-agnostic (uses global fetch/FormData/Blob,
 * available in Node ≥18 and browsers), so the same helpers run in the Electron
 * main process and in the headless server. No ElevenLabs SDK dependency.
 *
 *   - Desktop wires Scribe STT + TTS directly.
 *   - The server mints short-lived Voice Engine conversation tokens for mobile,
 *     so the API key never reaches the phone.
 */
import type { VoiceTokenResponse } from "@praxis/shared-types";

const DEFAULT_BASE = "https://api.elevenlabs.io";

export interface ElevenLabsOptions {
  apiKey: string;
  /** Override the API base (testing/proxy). */
  baseUrl?: string;
  /** STT model id. */
  sttModelId?: string;
  /** TTS model id. */
  ttsModelId?: string;
  /** Default voice id for TTS. */
  defaultVoiceId?: string;
}

export interface TranscribeOptions {
  /** Audio bytes (wav/mp3/webm/etc.). */
  audio: Blob | ArrayBuffer | Uint8Array;
  /** Filename hint for the multipart upload. */
  filename?: string;
  /** Optional language code (auto-detect if omitted). */
  languageCode?: string;
}

export interface SynthesizeOptions {
  text: string;
  voiceId?: string;
  /** Output format, e.g. "mp3_44100_128". */
  outputFormat?: string;
}

/** A voice from the account's library, as returned by GET /v1/voices. */
export interface VoiceSummary {
  voiceId: string;
  name: string;
  category?: string;
  previewUrl?: string;
}

/** Basic account info from GET /v1/user (used to verify a key + show the tier). */
export interface AccountInfo {
  tier?: string;
  characterCount?: number;
  characterLimit?: number;
}

export class ElevenLabsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly sttModelId: string;
  private readonly ttsModelId: string;
  private readonly defaultVoiceId?: string;

  constructor(opts: ElevenLabsOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.sttModelId = opts.sttModelId ?? "scribe_v1";
    this.ttsModelId = opts.ttsModelId ?? "eleven_turbo_v2_5";
    this.defaultVoiceId = opts.defaultVoiceId;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "xi-api-key": this.apiKey, ...extra };
  }

  /**
   * Verify the API key by hitting the lightweight /v1/user endpoint. Returns
   * account info on success; throws with a friendly message on an invalid key.
   */
  async verifyKey(): Promise<AccountInfo> {
    const res = await fetch(`${this.baseUrl}/v1/user`, { headers: this.headers() });
    if (res.status === 401) throw new Error("That ElevenLabs API key was rejected (401). Double-check it.");
    if (!res.ok) throw new Error(`ElevenLabs /v1/user failed (${res.status}): ${await safeText(res)}`);
    const json = (await res.json()) as {
      subscription?: { tier?: string; character_count?: number; character_limit?: number };
    };
    return {
      tier: json.subscription?.tier,
      characterCount: json.subscription?.character_count,
      characterLimit: json.subscription?.character_limit,
    };
  }

  /** List the voices available to this account (built-in + cloned). */
  async listVoices(): Promise<VoiceSummary[]> {
    const res = await fetch(`${this.baseUrl}/v1/voices`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ElevenLabs /v1/voices failed (${res.status}): ${await safeText(res)}`);
    const json = (await res.json()) as {
      voices?: Array<{ voice_id: string; name: string; category?: string; preview_url?: string }>;
    };
    return (json.voices ?? []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      previewUrl: v.preview_url,
    }));
  }

  /**
   * Create a Conversational-AI (Voice Engine) agent configured as a "custom LLM"
   * that calls back into a Praxis server endpoint. Used for the mobile/relay
   * flow; returns the new agent id. Desktop voice does NOT need this.
   */
  async createConvaiAgent(opts: {
    name: string;
    voiceId: string;
    /** OpenAI-compatible chat completions URL (the Praxis server seam). */
    customLlmUrl: string;
    /** First words the agent speaks; keep short. */
    firstMessage?: string;
    /** System prompt for the agent persona. */
    prompt?: string;
  }): Promise<string> {
    const body = {
      name: opts.name,
      conversation_config: {
        agent: {
          first_message: opts.firstMessage ?? "Praxis online. What do you need?",
          prompt: {
            prompt: opts.prompt ?? "You are Praxis, a concise, voice-driven engineering assistant.",
            llm: "custom-llm",
            custom_llm: { url: opts.customLlmUrl },
          },
        },
        tts: { voice_id: opts.voiceId },
      },
    };
    const res = await fetch(`${this.baseUrl}/v1/convai/agents/create`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ElevenLabs agent create failed (${res.status}): ${await safeText(res)}`);
    const json = (await res.json()) as { agent_id?: string };
    if (!json.agent_id) throw new Error("ElevenLabs agent create response missing 'agent_id'.");
    return json.agent_id;
  }

  /** Speech → text via Scribe. Returns the transcript string. */
  async transcribe(opts: TranscribeOptions): Promise<string> {
    const blob = toBlob(opts.audio);
    const form = new FormData();
    form.append("file", blob, opts.filename ?? "audio.webm");
    form.append("model_id", this.sttModelId);
    if (opts.languageCode) form.append("language_code", opts.languageCode);

    const res = await fetch(`${this.baseUrl}/v1/speech-to-text`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs STT failed (${res.status}): ${await safeText(res)}`);
    }
    const json = (await res.json()) as { text?: string };
    return json.text ?? "";
  }

  /** Text → speech. Returns the raw audio bytes (e.g. mp3). */
  async synthesize(opts: SynthesizeOptions): Promise<ArrayBuffer> {
    const voiceId = opts.voiceId ?? this.defaultVoiceId;
    if (!voiceId) throw new Error("synthesize() requires a voiceId (no defaultVoiceId set).");
    const query = opts.outputFormat ? `?output_format=${encodeURIComponent(opts.outputFormat)}` : "";
    const res = await fetch(`${this.baseUrl}/v1/text-to-speech/${voiceId}${query}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", accept: "audio/mpeg" }),
      body: JSON.stringify({ text: opts.text, model_id: this.ttsModelId }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${await safeText(res)}`);
    }
    return res.arrayBuffer();
  }

  /** Streaming TTS — returns the fetch Response so callers can pipe the body. */
  async synthesizeStream(opts: SynthesizeOptions): Promise<Response> {
    const voiceId = opts.voiceId ?? this.defaultVoiceId;
    if (!voiceId) throw new Error("synthesizeStream() requires a voiceId.");
    const res = await fetch(`${this.baseUrl}/v1/text-to-speech/${voiceId}/stream`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", accept: "audio/mpeg" }),
      body: JSON.stringify({ text: opts.text, model_id: this.ttsModelId }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS stream failed (${res.status}): ${await safeText(res)}`);
    }
    return res;
  }

  /**
   * Mint a short-lived Voice Engine (Conversational AI) conversation token for
   * the mobile client. Called server-side only — the resulting token is scoped
   * and safe to hand to the phone; the API key is not.
   */
  async mintConversationToken(agentId: string): Promise<VoiceTokenResponse> {
    const url = `${this.baseUrl}/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`;
    const res = await fetch(url, { method: "GET", headers: this.headers() });
    if (!res.ok) {
      throw new Error(`ElevenLabs token mint failed (${res.status}): ${await safeText(res)}`);
    }
    const json = (await res.json()) as { token?: string };
    if (!json.token) throw new Error("ElevenLabs token response missing 'token'.");
    return { token: json.token, agentId };
  }

  /**
   * Alternative: a signed WebSocket URL for the Voice Engine session (some SDK
   * versions take a signed URL instead of a token).
   */
  async getSignedUrl(agentId: string): Promise<string> {
    const url = `${this.baseUrl}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
    const res = await fetch(url, { method: "GET", headers: this.headers() });
    if (!res.ok) {
      throw new Error(`ElevenLabs signed-url failed (${res.status}): ${await safeText(res)}`);
    }
    const json = (await res.json()) as { signed_url?: string };
    if (!json.signed_url) throw new Error("ElevenLabs signed-url response missing 'signed_url'.");
    return json.signed_url;
  }
}

function toBlob(audio: Blob | ArrayBuffer | Uint8Array): Blob {
  if (audio instanceof Blob) return audio;
  // Both ArrayBuffer and Uint8Array are valid BlobParts at runtime; the cast
  // sidesteps the lib's strict ArrayBuffer-vs-SharedArrayBuffer narrowing.
  return new Blob([audio as BlobPart]);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
