/**
 * The stable per-user env file (`~/.praxis/desktop.env`). This is where runtime
 * settings (like an ElevenLabs key entered in the app) are persisted, so they
 * survive restarts and are readable by the packaged app — which, unlike the dev
 * build, has no project `.env` beside it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function userEnvPath(): string {
  return join(homedir(), ".praxis", "desktop.env");
}

/** Upsert KEY=VALUE pairs, preserving existing lines/comments. Also updates the
 *  live process.env so changes take effect immediately. */
export function saveUserEnv(updates: Record<string, string>): void {
  const path = userEnvPath();
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && updates[m[1]] !== undefined) {
      seen.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out.join("\n"));
  chmodSync(path, 0o600);
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;
}
