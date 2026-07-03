/**
 * @praxis/mcp-mac-control — public surface.
 *
 * The MCP server itself lives in server.ts (launched over stdio). This module
 * exports metadata hosts need: which tools are destructive (require a user
 * confirmation step) and a helper to locate the built server script.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Tools that change the world visibly — hosts should confirm before running. */
export const DESTRUCTIVE_TOOLS = new Set(["finder_trash", "imessage_send"]);

/** Absolute path to the built stdio server entry (dist/server.js). */
export function serverEntryPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "server.js");
}

export type { MacToolResult } from "./tools.js";
