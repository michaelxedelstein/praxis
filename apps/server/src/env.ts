/**
 * Server environment — validated once at boot with zod so a misconfigured
 * deploy fails loudly instead of misbehaving at runtime. Secrets come only from
 * the environment (root-owned `.env` mode 600, or the PaaS secret store).
 */
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  // Reasoning
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  PRAXIS_REASONING_MODEL: z.string().optional(),
  PRAXIS_CHAT_MODEL: z.string().optional(),
  PRAXIS_USER_NAME: z.string().optional(),
  PRAXIS_DEFAULT_PROJECT: z.string().optional(),

  // Device ↔ server auth (WS handshake + /voice/token)
  PRAXIS_AUTH_SECRET: z.string().min(8, "PRAXIS_AUTH_SECRET must be at least 8 chars"),

  // Voice (mobile token minting). Optional: server still runs WS without it.
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(),

  // Dispatch (Slack-routed to cursor-slack-bridge)
  SLACK_BOT_TOKEN: z.string().optional(),
  CURSOR_BRIDGE_BOT_ID: z.string().optional(),

  // GitHub MCP
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_PERSONAL_ACCESS_TOKEN: z.string().optional(),
  MCP_GITHUB_ENABLED: z.string().optional(),
  MCP_GITHUB_COMMAND: z.string().optional(),
  MCP_GITHUB_ARGS: z.string().optional(),

  // Extra MCP servers as a JSON array of McpServerConfig (config-driven).
  PRAXIS_MCP_SERVERS: z.string().optional(),

  // Networking
  HOST: z.string().optional(),
  PORT: z.string().optional(),
});

export type RawEnv = z.infer<typeof EnvSchema>;

export interface ServerEnv extends RawEnv {
  host: string;
  port: number;
  githubToken?: string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = EnvSchema.parse(source);
  return {
    ...parsed,
    host: parsed.HOST ?? "127.0.0.1",
    port: parsed.PORT ? Number(parsed.PORT) : 8080,
    githubToken: parsed.GITHUB_TOKEN ?? parsed.GITHUB_PERSONAL_ACCESS_TOKEN,
  };
}
