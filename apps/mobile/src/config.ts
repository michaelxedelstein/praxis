/**
 * Runtime config, read from Expo `extra` (populated from env at build time).
 * One `brainEndpoint` switch points the app at the always-on relay (default) or
 * a local desktop instance for dev — no rebuild needed beyond changing env.
 */
import Constants from "expo-constants";

interface Extra {
  brainEndpoint: string;
  authSecret: string;
  elevenAgentId: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

export const config = {
  /** wss://… brain endpoint (relay by default). */
  brainEndpoint: extra.brainEndpoint ?? "wss://praxis.edelsteinconsulting.com",
  /** PRAXIS_AUTH_SECRET — bearer for the brain + token endpoint. */
  authSecret: extra.authSecret ?? "",
  /** ElevenLabs Voice Engine agent id. */
  elevenAgentId: extra.elevenAgentId ?? "",
};

/** Derive the HTTPS API base (for /voice/token) from the WS brain endpoint. */
export function httpBase(): string {
  return config.brainEndpoint
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/ws$/, "");
}
