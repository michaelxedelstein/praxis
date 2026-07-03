/**
 * @praxis/mcp-importer — discovers every MCP server you already use in Cursor
 * and turns the reachable ones into configs the Praxis McpManager can launch.
 *
 * Three sources, in priority order:
 *   1. Direct configs: `~/.cursor/mcp.json` and any `<project>/.cursor/mcp.json`
 *      — these are plain stdio definitions, imported as-is.
 *   2. Cursor plugin catalog: `~/.cursor/plugins/cache/<marketplace>/<plugin>`
 *      — mapped to public equivalents via the service registry (connect cards).
 *   3. The Praxis connection store (`~/.praxis/mcp-connections.json`) — where
 *      the user's saved keys/toggles live. Never committed anywhere.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { McpServerConfigSchema, type McpServerConfig } from "@praxis/shared-types";
import { PLUGIN_TO_SERVICE, SERVICE_REGISTRY, type ServiceTemplate } from "./registry.js";

export { SERVICE_REGISTRY, PLUGIN_TO_SERVICE } from "./registry.js";
export type { ServiceTemplate } from "./registry.js";

/* ------------------------- 1. direct cursor configs ------------------------ */

/** Shape of a Cursor mcp.json ("mcpServers": { name: { command, args, env } }). */
const CursorMcpFileSchema = z.object({
  mcpServers: z
    .record(
      z.object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        url: z.string().optional(),
      }),
    )
    .default({}),
});

/**
 * Read stdio server definitions from Cursor's mcp.json files. URL-only entries
 * are bridged through `mcp-remote` so everything speaks stdio.
 */
export async function discoverCursorConfigs(opts?: {
  home?: string;
  projectRoots?: string[];
}): Promise<McpServerConfig[]> {
  const home = opts?.home ?? homedir();
  const candidates = [join(home, ".cursor", "mcp.json")];

  for (const root of opts?.projectRoots ?? []) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(root, e, ".cursor", "mcp.json");
      if (existsSync(p)) candidates.push(p);
    }
  }

  const out: McpServerConfig[] = [];
  const seen = new Set<string>();
  for (const file of candidates) {
    let parsed: z.infer<typeof CursorMcpFileSchema>;
    try {
      parsed = CursorMcpFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch {
      continue;
    }
    for (const [name, def] of Object.entries(parsed.mcpServers)) {
      const id = `cursor-${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (def.command) {
        out.push(
          McpServerConfigSchema.parse({
            id,
            command: def.command,
            args: def.args ?? [],
            env: def.env ?? {},
            enabled: true,
          }),
        );
      } else if (def.url) {
        out.push(
          McpServerConfigSchema.parse({
            id,
            command: "npx",
            args: ["-y", "mcp-remote", def.url],
            env: def.env ?? {},
            enabled: true,
          }),
        );
      }
    }
  }
  return out;
}

/* --------------------------- 2. plugin catalog ----------------------------- */

/** List Cursor plugin names present in the local plugin cache. */
export async function listInstalledCursorPlugins(home = homedir()): Promise<string[]> {
  const cacheRoot = join(home, ".cursor", "plugins", "cache");
  const names = new Set<string>();
  let marketplaces: string[] = [];
  try {
    marketplaces = await readdir(cacheRoot);
  } catch {
    return [];
  }
  for (const m of marketplaces) {
    try {
      for (const plugin of await readdir(join(cacheRoot, m))) {
        if (!plugin.startsWith(".")) names.add(plugin);
      }
    } catch {
      /* skip marketplace */
    }
  }
  return [...names];
}

/* ------------------------- 3. praxis connection store ---------------------- */

const ConnectionStoreSchema = z.record(
  z.object({
    env: z.record(z.string()).default({}),
    enabled: z.boolean().default(true),
  }),
);
export type ConnectionStore = z.infer<typeof ConnectionStoreSchema>;

export function connectionStorePath(home = homedir()): string {
  return join(home, ".praxis", "mcp-connections.json");
}

export async function loadConnectionStore(home = homedir()): Promise<ConnectionStore> {
  try {
    return ConnectionStoreSchema.parse(
      JSON.parse(await readFile(connectionStorePath(home), "utf8")),
    );
  } catch {
    return {};
  }
}

export async function saveConnectionStore(store: ConnectionStore, home = homedir()): Promise<void> {
  const file = connectionStorePath(home);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/* ------------------------------ assembly ---------------------------------- */

export interface DiscoveredConnection {
  id: string;
  title: string;
  source: "cursor-config" | "plugin-catalog" | "praxis";
  status: "connected" | "needs-key" | "needs-auth" | "disabled" | "error";
  requiredEnv: string[];
  note?: string;
  /** Present when the connection is launchable right now. */
  config?: McpServerConfig;
}

function substitute(value: string, env: Record<string, string>): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => env[name] ?? "");
}

function templateToConfig(t: ServiceTemplate, userEnv: Record<string, string>): McpServerConfig {
  return McpServerConfigSchema.parse({
    id: t.id,
    command: t.command,
    args: t.args.map((a) => substitute(a, userEnv)),
    env: Object.fromEntries(
      Object.entries(t.env ?? {}).map(([k, v]) => [k, substitute(v, userEnv)]),
    ),
    enabled: true,
  });
}

/**
 * The full picture: direct Cursor configs (always launchable), plus every
 * installed plugin mapped through the registry with its connect-card status.
 */
export async function discoverAll(opts?: {
  home?: string;
  projectRoots?: string[];
  /** Ambient env (e.g. process.env) used to satisfy requiredEnv without a card. */
  ambientEnv?: Record<string, string | undefined>;
}): Promise<DiscoveredConnection[]> {
  const home = opts?.home ?? homedir();
  const [direct, plugins, store] = await Promise.all([
    discoverCursorConfigs({ home, projectRoots: opts?.projectRoots }),
    listInstalledCursorPlugins(home),
    loadConnectionStore(home),
  ]);

  const out: DiscoveredConnection[] = direct.map((cfg) => ({
    id: cfg.id,
    title: cfg.id.replace(/^cursor-/, ""),
    source: "cursor-config",
    status: "connected",
    requiredEnv: [],
    config: cfg,
  }));

  const wantedServices = new Set<string>();
  for (const p of plugins) {
    const svc = PLUGIN_TO_SERVICE[p];
    if (svc) wantedServices.add(svc);
  }
  // GitHub is always offered (it's Praxis's first-class integration).
  wantedServices.add("github");

  for (const t of SERVICE_REGISTRY) {
    if (!wantedServices.has(t.id)) continue;
    if (out.some((c) => c.id === t.id)) continue;

    const saved = store[t.id];
    const userEnv: Record<string, string> = { ...saved?.env };
    // Ambient env (e.g. GITHUB_TOKEN in .env) can satisfy requirements too.
    for (const name of t.requiredEnv) {
      if (!userEnv[name] && opts?.ambientEnv?.[name]) {
        userEnv[name] = opts.ambientEnv[name] as string;
      }
    }
    const missing = t.requiredEnv.filter((name) => !userEnv[name]);
    // OAuth services stay opt-in: unless the user explicitly enabled them, they
    // are NOT auto-connected (each would pop a browser sign-in on launch).
    const optedIn = saved?.enabled === true;
    const defaultEnabled = saved?.enabled ?? t.auth !== "oauth";

    let status: DiscoveredConnection["status"];
    if (saved?.enabled === false) status = "disabled";
    else if (missing.length > 0) status = "needs-key";
    else if (t.auth === "oauth" && !optedIn) status = "needs-auth";
    else status = "connected";

    out.push({
      id: t.id,
      title: t.title,
      source: "plugin-catalog",
      status,
      requiredEnv: t.requiredEnv,
      note: t.note,
      config: status === "connected" && defaultEnabled ? templateToConfig(t, userEnv) : undefined,
    });
  }
  return out;
}
