/**
 * ProjectGraphService — the data source behind the hive-mind.
 *
 * Builds a unified graph of every project you work on:
 *   - LOCAL: scans the same project roots the cursor-slack-bridge uses, reading
 *     git metadata (branch, dirty state, last commit) straight from disk.
 *   - GITHUB: your repos via the GitHub REST API (token from env, or falling
 *     back to `gh auth token` since the CLI is already authenticated).
 *   - Local + remote entries that point at the same repository are merged into
 *     one node.
 *
 * The graph also computes edges (same owner, same primary language, recency)
 * so the renderer can draw a meaningful constellation instead of a hairball.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ProjectCommit,
  ProjectDetail,
  ProjectGraph,
  ProjectLink,
  ProjectNode,
} from "../shared/ipc.js";

const run = promisify(execFile);

const GIT_TIMEOUT = 5_000;
const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".turbo",
  "coverage", ".expo", "release", "Pods", ".venv", "venv", "__pycache__",
]);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT });
  return stdout.trim();
}

/** Normalize a git remote URL so ssh/https forms of the same repo compare equal. */
function normalizeRemote(url: string): string {
  return url
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

/** Cheap primary-language sniff from files present at the project root. */
async function sniffLanguage(dir: string): Promise<string | undefined> {
  try {
    const entries = new Set(await readdir(dir));
    if (entries.has("package.json")) {
      return entries.has("tsconfig.json") ? "TypeScript" : "JavaScript";
    }
    if (entries.has("Cargo.toml")) return "Rust";
    if (entries.has("go.mod")) return "Go";
    if (entries.has("pyproject.toml") || entries.has("requirements.txt")) return "Python";
    if (entries.has("Gemfile")) return "Ruby";
    if (entries.has("Package.swift") || [...entries].some((e) => e.endsWith(".xcodeproj"))) {
      return "Swift";
    }
  } catch {
    /* unreadable dir — skip */
  }
  return undefined;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  private: boolean;
  pushed_at: string;
  owner: { login: string };
  fork: boolean;
  archived: boolean;
}

export interface ProjectGraphOptions {
  roots: string[];
  githubToken?: string;
  log?: (msg: string) => void;
}

export class ProjectGraphService {
  private graph: ProjectGraph = { nodes: [], links: [], updatedAt: 0 };
  private refreshing: Promise<ProjectGraph> | null = null;
  private readonly roots: string[];
  private githubToken?: string;
  private readonly log: (msg: string) => void;

  constructor(opts: ProjectGraphOptions) {
    this.roots = opts.roots.filter((r) => existsSync(r));
    this.githubToken = opts.githubToken;
    this.log = opts.log ?? (() => {});
  }

  current(): ProjectGraph {
    return this.graph;
  }

  /** Rebuild the graph. Concurrent callers share one in-flight refresh. */
  refresh(): Promise<ProjectGraph> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => (this.refreshing = null));
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<ProjectGraph> {
    const [local, remote] = await Promise.all([this.scanLocal(), this.fetchGitHub()]);

    // Merge: local nodes absorb their matching GitHub repo (by remote URL).
    const byRemote = new Map<string, GitHubRepo>();
    for (const r of remote) byRemote.set(normalizeRemote(r.html_url), r);

    const nodes: ProjectNode[] = [];
    const seenRemotes = new Set<string>();

    for (const node of local) {
      if (node.remoteUrl) {
        const gh = byRemote.get(node.remoteUrl);
        if (gh) {
          seenRemotes.add(node.remoteUrl);
          node.github = {
            fullName: gh.full_name,
            url: gh.html_url,
            description: gh.description ?? undefined,
            stars: gh.stargazers_count,
            isPrivate: gh.private,
            pushedAt: Date.parse(gh.pushed_at) || undefined,
          };
          node.language = node.language ?? gh.language ?? undefined;
        }
      }
      nodes.push(node);
    }

    for (const gh of remote) {
      if (gh.fork || gh.archived) continue;
      if (seenRemotes.has(normalizeRemote(gh.html_url))) continue;
      nodes.push({
        id: `gh:${gh.full_name}`,
        name: gh.name,
        kind: "github",
        language: gh.language ?? undefined,
        lastActivity: Date.parse(gh.pushed_at) || undefined,
        github: {
          fullName: gh.full_name,
          url: gh.html_url,
          description: gh.description ?? undefined,
          stars: gh.stargazers_count,
          isPrivate: gh.private,
          pushedAt: Date.parse(gh.pushed_at) || undefined,
        },
      });
    }

    this.graph = { nodes, links: computeLinks(nodes), updatedAt: Date.now() };
    this.log(`project graph: ${nodes.length} nodes, ${this.graph.links.length} links`);
    return this.graph;
  }

  /* -------------------------------- local ------------------------------- */

  private async scanLocal(): Promise<ProjectNode[]> {
    const nodes: ProjectNode[] = [];
    for (const root of this.roots) {
      let entries: string[] = [];
      try {
        entries = await readdir(root);
      } catch {
        continue;
      }
      const results = await Promise.all(
        entries
          .filter((e) => !e.startsWith(".") && !IGNORED_DIRS.has(e))
          .map((e) => this.readLocalProject(join(root, e))),
      );
      for (const n of results) if (n) nodes.push(n);
    }
    return nodes;
  }

  private async readLocalProject(dir: string): Promise<ProjectNode | null> {
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) return null;
    } catch {
      return null;
    }

    const isRepo = existsSync(join(dir, ".git"));
    const name = basename(dir);
    const node: ProjectNode = {
      id: `local:${name}`,
      name,
      kind: "local",
      path: dir,
      language: await sniffLanguage(dir),
    };

    if (isRepo) {
      // Each git read is best-effort; a broken repo still shows as a node.
      const [branch, last, dirty, remote] = await Promise.all([
        git(dir, "rev-parse", "--abbrev-ref", "HEAD").catch(() => undefined),
        git(dir, "log", "-1", "--format=%ct%x00%s").catch(() => undefined),
        git(dir, "status", "--porcelain", "--untracked-files=no").catch(() => undefined),
        git(dir, "remote", "get-url", "origin").catch(() => undefined),
      ]);
      node.branch = branch;
      node.dirty = dirty !== undefined ? dirty.length > 0 : undefined;
      node.remoteUrl = remote ? normalizeRemote(remote) : undefined;
      if (last) {
        const [ct, subject] = last.split("\u0000");
        const ts = Number(ct) * 1000;
        node.lastActivity = Number.isFinite(ts) ? ts : undefined;
        node.lastCommit = subject;
      }
    }
    return node;
  }

  /* -------------------------------- github ------------------------------ */

  private async fetchGitHub(): Promise<GitHubRepo[]> {
    const token = await this.resolveToken();
    if (!token) return [];
    const repos: GitHubRepo[] = [];
    try {
      for (let page = 1; page <= 3; page++) {
        const res = await fetch(
          `https://api.github.com/user/repos?per_page=100&sort=pushed&page=${page}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "praxis-desktop",
            },
          },
        );
        if (!res.ok) {
          this.log(`github fetch failed: ${res.status}`);
          break;
        }
        const batch = (await res.json()) as GitHubRepo[];
        repos.push(...batch);
        if (batch.length < 100) break;
      }
    } catch (err) {
      this.log(`github fetch error: ${(err as Error).message}`);
    }
    return repos;
  }

  private async resolveToken(): Promise<string | undefined> {
    if (this.githubToken) return this.githubToken;
    try {
      const { stdout } = await run("gh", ["auth", "token"], { timeout: 5000 });
      this.githubToken = stdout.trim() || undefined;
    } catch {
      this.githubToken = undefined;
    }
    return this.githubToken;
  }

  /* -------------------------------- detail ------------------------------ */

  /** Rich context for one project — used by the repo panel and brain sessions. */
  async detail(id: string): Promise<ProjectDetail | null> {
    const node = this.graph.nodes.find((n) => n.id === id);
    if (!node) return null;

    const detail: ProjectDetail = { node, commits: [], fileTree: [], readme: undefined };
    if (!node.path) return detail;

    const dir = node.path;
    const [logOut, readme, tree] = await Promise.all([
      git(dir, "log", "-8", "--format=%h%x00%ct%x00%an%x00%s").catch(() => ""),
      readReadme(dir),
      listTree(dir),
    ]);

    detail.commits = logOut
      .split("\n")
      .filter(Boolean)
      .map((line): ProjectCommit => {
        const [hash = "", ct = "0", author = "", subject = ""] = line.split("\u0000");
        return { hash, date: Number(ct) * 1000, author, subject };
      });
    detail.readme = readme;
    detail.fileTree = tree;
    return detail;
  }
}

async function readReadme(dir: string): Promise<string | undefined> {
  for (const name of ["README.md", "readme.md", "README.txt", "README"]) {
    try {
      const text = await readFile(join(dir, name), "utf8");
      return text.slice(0, 2000);
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Two-level file tree, capped, ignoring build artifacts. */
async function listTree(dir: string, depth = 2, cap = 120): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string, prefix: string, level: number): Promise<void> {
    if (out.length >= cap || level > depth) return;
    let entries: string[] = [];
    try {
      entries = (await readdir(d)).filter((e) => !e.startsWith(".") && !IGNORED_DIRS.has(e));
    } catch {
      return;
    }
    for (const e of entries.slice(0, 40)) {
      if (out.length >= cap) return;
      const full = join(d, e);
      let isDir = false;
      try {
        isDir = (await stat(full)).isDirectory();
      } catch {
        continue;
      }
      out.push(prefix + e + (isDir ? "/" : ""));
      if (isDir) await walk(full, prefix + "  ", level + 1);
    }
  }
  await walk(dir, "", 1);
  return out;
}

/* ---------------------------------- links -------------------------------- */

/**
 * Edges for the constellation: same GitHub owner and same primary language,
 * capped per node so dense clusters stay readable.
 */
function computeLinks(nodes: ProjectNode[]): ProjectLink[] {
  const links: ProjectLink[] = [];
  const degree = new Map<string, number>();
  const MAX_DEGREE = 4;

  const bump = (id: string): boolean => {
    const d = degree.get(id) ?? 0;
    if (d >= MAX_DEGREE) return false;
    degree.set(id, d + 1);
    return true;
  };

  const byLanguage = new Map<string, ProjectNode[]>();
  for (const n of nodes) {
    if (!n.language) continue;
    const list = byLanguage.get(n.language) ?? [];
    list.push(n);
    byLanguage.set(n.language, list);
  }

  for (const [language, group] of byLanguage) {
    // Chain within a language group sorted by activity (not a full mesh).
    const sorted = [...group].sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (!a || !b) continue;
      if (bump(a.id) && bump(b.id)) {
        links.push({ source: a.id, target: b.id, kind: "language", label: language });
      }
    }
  }
  return links;
}
