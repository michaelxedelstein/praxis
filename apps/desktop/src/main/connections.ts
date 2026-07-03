/**
 * Bridges the mcp-importer to the renderer's connect-card UI. Lists every
 * discoverable MCP service with its status, and persists user-supplied keys to
 * the local connection store (never the repo).
 */
import {
  discoverAll,
  loadConnectionStore,
  saveConnectionStore,
} from "@praxis/mcp-importer";
import type { McpConnectionInfo, SaveMcpConnectionRequest } from "../shared/ipc.js";

export interface ConnectionsDeps {
  projectRoots: string[];
}

export async function listConnections(deps: ConnectionsDeps): Promise<McpConnectionInfo[]> {
  const discovered = await discoverAll({
    projectRoots: deps.projectRoots,
    ambientEnv: process.env,
  });
  return discovered.map((c) => ({
    id: c.id,
    title: c.title,
    source: c.source,
    status: c.status,
    requiredEnv: c.requiredEnv,
    detail: c.note,
  }));
}

export async function saveConnection(
  req: SaveMcpConnectionRequest,
  deps: ConnectionsDeps,
): Promise<McpConnectionInfo[]> {
  const store = await loadConnectionStore();
  store[req.id] = { env: req.env, enabled: req.enabled };
  await saveConnectionStore(store);
  return listConnections(deps);
}
