import type { ExpoConfig } from "expo/config";

/**
 * Expo config. ElevenLabs Voice Engine needs native modules (LiveKit WebRTC), so
 * this is a custom dev/prod build via EAS — plain Expo Go won't work. The
 * `expo-build-properties` plugin enables the native settings WebRTC requires.
 *
 * Runtime config (brain endpoint + auth secret) is injected via `extra` from
 * environment variables so the same binary can point at the relay or a local
 * desktop instance without a rebuild.
 */
const config: ExpoConfig = {
  name: "Praxis",
  slug: "praxis",
  scheme: "praxis",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "com.edelstein.praxis",
    supportsTablet: true,
    infoPlist: {
      NSMicrophoneUsageDescription: "Praxis uses your microphone for voice conversation.",
      UIBackgroundModes: ["audio"],
    },
  },
  android: {
    package: "com.edelstein.praxis",
    permissions: ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "INTERNET"],
  },
  plugins: [
    "expo-dev-client",
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "15.1" },
        android: { minSdkVersion: 24 },
      },
    ],
  ],
  extra: {
    // Default to the always-on relay; override with PRAXIS_BRAIN_ENDPOINT for dev
    // (e.g. ws://<your-desktop-lan-ip>:8080).
    brainEndpoint: process.env.PRAXIS_BRAIN_ENDPOINT ?? "wss://praxis.edelsteinconsulting.com",
    authSecret: process.env.PRAXIS_AUTH_SECRET ?? "",
    elevenAgentId: process.env.ELEVENLABS_AGENT_ID ?? "",
  },
};

export default config;
