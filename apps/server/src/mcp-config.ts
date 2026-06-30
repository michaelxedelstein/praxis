/**
 * Build the MCP server list from the environment. GitHub is the first-class,
 * default integration; additional servers can be added entirely through the
 * `PRAXIS_MCP_SERVERS` JSON env (config-driven, no code changes).
 */
import { McpServerConfigSchema, type McpServerConfig } from "@praxis/shared-types";
import type { ServerEnv } from "./env.js";

export function buildMcpServers(env: ServerEnv): McpServerConfig[] {
  const servers: McpServerConfig[] = [];

  // --- GitHub MCP (first integration) -------------------------------------
  const githubEnabled = (env.MCP_GITHUB_ENABLED ?? "true").toLowerCase() !== "false";
  if (githubEnabled && env.githubToken) {
    const command = env.MCP_GITHUB_COMMAND ?? "npx";
    const args = env.MCP_GITHUB_ARGS
      ? env.MCP_GITHUB_ARGS.split(" ").filter(Boolean)
      : ["-y", "@modelcontextprotocol/server-github"];
    servers.push(
      McpServerConfigSchema.parse({
        id: "github",
        command,
        args,
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: env.githubToken },
        enabled: true,
      }),
    );
  }

  // --- Extra servers from JSON env ----------------------------------------
  if (env.PRAXIS_MCP_SERVERS) {
    try {
      const raw = JSON.parse(env.PRAXIS_MCP_SERVERS) as unknown[];
      for (const item of raw) {
        servers.push(McpServerConfigSchema.parse(item));
      }
    } catch (err) {
      throw new Error(`PRAXIS_MCP_SERVERS is not valid: ${(err as Error).message}`);
    }
  }

  return servers;
}
