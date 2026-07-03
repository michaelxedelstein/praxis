import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAll, discoverCursorConfigs, PLUGIN_TO_SERVICE, SERVICE_REGISTRY } from "./index.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "praxis-importer-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function writeCursorConfig(dir: string, content: unknown): Promise<void> {
  await mkdir(join(dir, ".cursor"), { recursive: true });
  await writeFile(join(dir, ".cursor", "mcp.json"), JSON.stringify(content));
}

/** Simulate an installed Cursor plugin so its registry service is "wanted". */
async function installPlugin(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, ".cursor", "plugins", "cache", "test-mp", name), { recursive: true });
}

describe("discoverCursorConfigs", () => {
  it("imports stdio servers verbatim", async () => {
    await writeCursorConfig(home, {
      mcpServers: {
        local: { command: "node", args: ["server.js"], env: { FOO: "bar" } },
      },
    });
    const found = await discoverCursorConfigs({ home });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "cursor-local", command: "node", args: ["server.js"] });
    expect(found[0]?.env).toEqual({ FOO: "bar" });
  });

  it("bridges url-only servers through mcp-remote", async () => {
    await writeCursorConfig(home, { mcpServers: { remote: { url: "https://x.example/sse" } } });
    const found = await discoverCursorConfigs({ home });
    expect(found[0]?.command).toBe("npx");
    expect(found[0]?.args).toContain("mcp-remote");
    expect(found[0]?.args).toContain("https://x.example/sse");
  });

  it("returns nothing when no config exists", async () => {
    expect(await discoverCursorConfigs({ home })).toEqual([]);
  });
});

describe("discoverAll", () => {
  it("marks a service connected when ambient env satisfies its key", async () => {
    const all = await discoverAll({ home, ambientEnv: { GITHUB_TOKEN: "ghp_x" } });
    const gh = all.find((c) => c.id === "github");
    expect(gh?.status).toBe("connected");
    expect(gh?.config?.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_x");
  });

  it("flags a service needing a key when nothing supplies it", async () => {
    const all = await discoverAll({ home, ambientEnv: {} });
    const gh = all.find((c) => c.id === "github");
    expect(gh?.status).toBe("needs-key");
    expect(gh?.config).toBeUndefined();
  });

  it("does not auto-connect OAuth services on launch", async () => {
    await installPlugin(home, "linear");
    const all = await discoverAll({ home, ambientEnv: {} });
    const linear = all.find((c) => c.id === "linear");
    expect(linear?.status).toBe("needs-auth");
    expect(linear?.config).toBeUndefined();
  });

  it("connects an OAuth service once the user opts in", async () => {
    await installPlugin(home, "linear");
    await mkdir(join(home, ".praxis"), { recursive: true });
    await writeFile(
      join(home, ".praxis", "mcp-connections.json"),
      JSON.stringify({ linear: { env: {}, enabled: true } }),
    );
    const all = await discoverAll({ home, ambientEnv: {} });
    const linear = all.find((c) => c.id === "linear");
    expect(linear?.status).toBe("connected");
    expect(linear?.config?.args).toContain("mcp-remote");
  });
});

describe("registry", () => {
  it("maps every known plugin to a real registry entry", () => {
    const ids = new Set(SERVICE_REGISTRY.map((s) => s.id));
    for (const svc of Object.values(PLUGIN_TO_SERVICE)) {
      expect(ids.has(svc)).toBe(true);
    }
  });
});
