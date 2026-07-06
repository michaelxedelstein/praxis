/**
 * Known-service registry: maps a Cursor plugin name to a runnable public MCP
 * server. Cursor's plugin MCPs authenticate through Cursor itself, so Praxis
 * can't reuse those sessions — instead each service gets a "connect card":
 * you provide the key once, and the importer produces a standard stdio
 * McpServerConfig the existing McpManager can launch.
 *
 * Remote (SSE/HTTP) servers are bridged over stdio with `mcp-remote`.
 */

export interface ServiceTemplate {
  id: string;
  title: string;
  /** Env var names the user must supply on the connect card. */
  requiredEnv: string[];
  command: string;
  /** May reference required env values as ${VAR}. */
  args: string[];
  /** Extra env passed to the child (values may reference ${VAR}). */
  env?: Record<string, string>;
  note?: string;
  /**
   * How the service authenticates. Governs whether Praxis auto-connects it on
   * launch:
   *   - "apikey" (default when requiredEnv is set): connect once the key exists.
   *   - "none": public, no auth — safe to auto-connect.
   *   - "cli":  reuses a local CLI login (e.g. `firebase login`) — auto-connect.
   *   - "oauth": needs an interactive browser sign-in. NOT auto-connected; the
   *     user opts in from the Connections panel so launch stays quiet.
   */
  auth?: "apikey" | "none" | "cli" | "oauth";
}

export const SERVICE_REGISTRY: ServiceTemplate[] = [
  {
    id: "github",
    title: "GitHub",
    requiredEnv: ["GITHUB_TOKEN"],
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
  },
  {
    id: "slack",
    title: "Slack",
    requiredEnv: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}", SLACK_TEAM_ID: "${SLACK_TEAM_ID}" },
  },
  {
    id: "stripe",
    title: "Stripe",
    requiredEnv: ["STRIPE_SECRET_KEY"],
    command: "npx",
    args: ["-y", "@stripe/mcp", "--tools=all", "--api-key=${STRIPE_SECRET_KEY}"],
  },
  {
    id: "linear",
    title: "Linear",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.linear.app/mcp"],
    auth: "oauth",
    note: "Opens a browser window once for OAuth. Enable from Connections when you want it.",
  },
  {
    id: "sentry",
    title: "Sentry",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.sentry.dev/mcp"],
    auth: "oauth",
    note: "Opens a browser window once for OAuth. Enable from Connections when you want it.",
  },
  {
    id: "vercel",
    title: "Vercel",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.vercel.com"],
    auth: "oauth",
    note: "Opens a browser window once for OAuth. Enable from Connections when you want it.",
  },
  {
    id: "supabase",
    title: "Supabase",
    requiredEnv: ["SUPABASE_ACCESS_TOKEN"],
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase@latest"],
    env: { SUPABASE_ACCESS_TOKEN: "${SUPABASE_ACCESS_TOKEN}" },
  },
  {
    id: "figma",
    title: "Figma",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.figma.com/mcp"],
    auth: "oauth",
    note: "Opens a browser window once for OAuth. Enable from Connections when you want it.",
  },
  {
    id: "posthog",
    title: "PostHog",
    requiredEnv: ["POSTHOG_PERSONAL_API_KEY"],
    command: "npx",
    args: [
      "-y",
      "mcp-remote",
      "https://mcp.posthog.com/mcp",
      "--header",
      "Authorization: Bearer ${POSTHOG_PERSONAL_API_KEY}",
    ],
  },
  {
    id: "firebase",
    title: "Firebase",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "firebase-tools@latest", "experimental:mcp"],
    auth: "cli",
    note: "Uses your local `firebase login` session.",
  },
  {
    id: "cloudflare",
    title: "Cloudflare Docs",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "mcp-remote", "https://docs.mcp.cloudflare.com/sse"],
    auth: "none",
  },
  {
    id: "resend",
    title: "Resend",
    requiredEnv: ["RESEND_API_KEY"],
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.resend.com/mcp", "--header", "Authorization: Bearer ${RESEND_API_KEY}"],
  },
  {
    id: "higgsfield",
    title: "Higgsfield",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.higgsfield.ai/mcp"],
    auth: "oauth",
    note: "Image/video/audio generation. Opens a browser once for OAuth. Enable from Connections.",
  },
  {
    id: "revenuecat",
    title: "RevenueCat",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.revenuecat.ai/mcp"],
    auth: "oauth",
    note: "Subscription/billing config + data. Opens a browser once for OAuth. Enable from Connections.",
  },
  {
    id: "metaquest",
    title: "Meta Quest (hzdb)",
    requiredEnv: [],
    command: "npx",
    args: ["-y", "@meta-quest/hzdb", "mcp", "server"],
    auth: "none",
    note: "Local stdio server for Meta Quest agentic tools; no sign-in needed.",
  },
];

/** Cursor plugin folder names → registry ids (folders seen in ~/.cursor/plugins/cache). */
export const PLUGIN_TO_SERVICE: Record<string, string> = {
  slack: "slack",
  stripe: "stripe",
  linear: "linear",
  sentry: "sentry",
  vercel: "vercel",
  supabase: "supabase",
  figma: "figma",
  posthog: "posthog",
  firebase: "firebase",
  cloudflare: "cloudflare",
  resend: "resend",
  higgsfield: "higgsfield",
  revenuecat: "revenuecat",
  "revenuecat-play-billing": "revenuecat",
  "meta-quest-agentic-tools": "metaquest",
};
