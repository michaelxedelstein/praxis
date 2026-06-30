/**
 * McpManager — connects to one or more MCP servers over stdio and presents them
 * to the brain as a single, namespaced tool surface. Servers are registered via
 * config (see `McpServerConfig`), so adding GitHub, filesystem, shell, etc. is a
 * config change, not a code change.
 *
 * Tools are namespaced as `<serverId>__<toolName>` so two servers can expose a
 * tool of the same name without colliding.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "@praxis/shared-types";
import type { McpToolProvider, ToolResult, ToolSpec } from "../types.js";

const SEP = "__";

interface Connected {
  id: string;
  client: Client;
}

export class McpManager implements McpToolProvider {
  private connected: Connected[] = [];
  private toolIndex = new Map<string, { serverId: string; toolName: string }>();

  private constructor() {}

  /** Connect to every enabled server in the config. Failing servers are skipped
   * (logged) so one bad server doesn't take down the brain. */
  static async create(
    servers: McpServerConfig[],
    log: (msg: string) => void = () => {},
  ): Promise<McpManager> {
    const mgr = new McpManager();
    for (const cfg of servers) {
      if (!cfg.enabled) continue;
      try {
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          env: { ...process.env, ...cfg.env } as Record<string, string>,
        });
        const client = new Client(
          { name: `praxis-${cfg.id}`, version: "0.1.0" },
          { capabilities: {} },
        );
        await client.connect(transport);
        mgr.connected.push({ id: cfg.id, client });
        log(`MCP connected: ${cfg.id}`);
      } catch (err) {
        log(`MCP failed to connect (${cfg.id}): ${(err as Error).message}`);
      }
    }
    return mgr;
  }

  async listTools(): Promise<ToolSpec[]> {
    const specs: ToolSpec[] = [];
    this.toolIndex.clear();
    for (const { id, client } of this.connected) {
      try {
        const res = await client.listTools();
        for (const tool of res.tools) {
          const namespaced = `${id}${SEP}${tool.name}`;
          this.toolIndex.set(namespaced, { serverId: id, toolName: tool.name });
          specs.push({
            name: namespaced,
            description: tool.description ?? "",
            inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
              type: "object",
              properties: {},
            },
          });
        }
      } catch {
        // Skip a server that fails to list; others still work.
      }
    }
    return specs;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const entry = this.toolIndex.get(name);
    if (!entry) {
      return { text: `Unknown tool: ${name}`, isError: true };
    }
    const conn = this.connected.find((c) => c.id === entry.serverId);
    if (!conn) {
      return { text: `Server not connected: ${entry.serverId}`, isError: true };
    }
    try {
      const res = await conn.client.callTool({
        name: entry.toolName,
        arguments: args,
      });
      const text = extractText(res);
      const isError = Boolean((res as { isError?: boolean }).isError);
      return { text, isError };
    } catch (err) {
      return { text: `Tool error: ${(err as Error).message}`, isError: true };
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.connected.map((c) => c.client.close()));
    this.connected = [];
    this.toolIndex.clear();
  }
}

/** Flatten an MCP tool result's content blocks into plain text for the model. */
function extractText(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}
