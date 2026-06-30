/**
 * Talks to the Praxis brain server. The phone never holds the ElevenLabs API
 * key — it asks the server to mint a short-lived conversation token, presenting
 * the shared bearer secret.
 */
import { VoiceTokenResponseSchema, type VoiceTokenResponse } from "@praxis/shared-types";
import { config, httpBase } from "./config";

export async function fetchVoiceToken(): Promise<VoiceTokenResponse> {
  const res = await fetch(`${httpBase()}/voice/token`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.authSecret}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status})`);
  }
  const json = await res.json();
  return VoiceTokenResponseSchema.parse(json);
}

/** Liveness check against the server. */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${httpBase()}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}
