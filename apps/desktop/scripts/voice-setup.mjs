#!/usr/bin/env node
/**
 * Praxis voice setup — gets the desktop app's ElevenLabs voice ready in one go.
 *
 *   pnpm --filter @praxis/desktop voice:setup -- --key=<ELEVENLABS_KEY>
 *   pnpm --filter @praxis/desktop voice:setup -- --voice="Rachel" --test
 *
 * What it does:
 *   1. Reads apps/desktop/.env (or takes --key) and verifies the ElevenLabs key.
 *   2. Lists the voices on your account.
 *   3. Picks a voice (by --voice name/id, else interactive prompt, else a sane
 *      default) and writes ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID back to .env.
 *   4. With --test, synthesizes a short line and plays it so you hear it.
 *   5. With --create-agent, also creates a Voice Engine agent for mobile/relay.
 *
 * No secrets are printed; the key is only ever written to the local .env (600).
 */
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { ElevenLabsClient } from "@praxis/voice-elevenlabs";

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(here, "..", ".env");
// The packaged .app can't read the dev .env, so it reads this stable per-user
// file instead. Keep both in sync so voice works in dev and in the built app.
const USER_ENV_PATH = join(homedir(), ".praxis", "desktop.env");
const PLACEHOLDER = /^(paste|pending|your|sk_your|xxx|<)/i;

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
  }
  return args;
}

/** Minimal .env reader that keeps it simple (KEY=VALUE, no interpolation). */
function readEnv(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Upsert keys into an existing .env, preserving comments/order/other lines. */
function writeEnvFile(path, updates) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const seen = new Set();
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
}

/** Write to both the dev .env and the per-user file the packaged app reads. */
function writeEnv(_path, updates) {
  writeEnvFile(ENV_PATH, updates);
  writeEnvFile(USER_ENV_PATH, updates);
}

function isReal(v) {
  return typeof v === "string" && v.length > 0 && !PLACEHOLDER.test(v);
}

async function main() {
  const args = parseArgs(process.argv);
  const env = readEnv(ENV_PATH);

  const apiKey = isReal(args.key) ? args.key : env.get("ELEVENLABS_API_KEY");
  if (!isReal(apiKey)) {
    console.error(
      "\n✗ No ElevenLabs API key found.\n" +
        "  Get one at https://elevenlabs.io → Profile → API Keys, then run:\n" +
        '  pnpm --filter @praxis/desktop voice:setup -- --key=YOUR_KEY\n',
    );
    process.exit(1);
  }

  const client = new ElevenLabsClient({ apiKey });

  process.stdout.write("Verifying your ElevenLabs key… ");
  const account = await client.verifyKey();
  console.log(`ok (tier: ${account.tier ?? "unknown"}).`);

  const voices = await client.listVoices();
  if (voices.length === 0) {
    console.error("✗ No voices on this account. Add one in the ElevenLabs Voice Library first.");
    process.exit(1);
  }

  // Resolve the target voice: --voice (name or id) → prompt → default.
  let chosen = null;
  if (isReal(args.voice)) {
    const q = String(args.voice).toLowerCase();
    chosen =
      voices.find((v) => v.voiceId.toLowerCase() === q) ??
      voices.find((v) => v.name.toLowerCase() === q) ??
      voices.find((v) => v.name.toLowerCase().includes(q));
    if (!chosen) console.warn(`(couldn't match "${args.voice}"; falling back)`);
  }

  if (!chosen && process.stdin.isTTY) {
    console.log("\nYour voices:");
    voices.forEach((v, i) => console.log(`  ${i + 1}. ${v.name}${v.category ? `  (${v.category})` : ""}`));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nPick a voice [1-${voices.length}] (default 1): `);
    await rl.close();
    const idx = Number(answer.trim() || "1") - 1;
    chosen = voices[idx] ?? voices[0];
  }

  if (!chosen) {
    // Non-interactive default: aim for a smooth British "JARVIS" voice, then a
    // sensible fallback, then whatever the account has.
    const preferred = ["Daniel", "George", "Brian", "Charlotte", "Rachel", "Adam"];
    chosen =
      preferred.map((n) => voices.find((v) => v.name === n)).find(Boolean) ?? voices[0];
  }

  writeEnv(ENV_PATH, { ELEVENLABS_API_KEY: apiKey, ELEVENLABS_VOICE_ID: chosen.voiceId });
  console.log(`\n✓ Voice set to "${chosen.name}" (${chosen.voiceId}).`);
  console.log(`✓ Wrote ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID to apps/desktop/.env`);
  console.log(`✓ Mirrored to ~/.praxis/desktop.env (used by the packaged app)`);

  if (args.test) {
    process.stdout.write("\nSynthesizing a test line… ");
    const buf = await client.synthesize({
      text: "Praxis online. All systems ready.",
      voiceId: chosen.voiceId,
    });
    const file = join(tmpdir(), "praxis-voice-test.mp3");
    writeFileSync(file, Buffer.from(buf));
    console.log(`saved ${file}`);
    if (process.platform === "darwin") {
      console.log("Playing…");
      await new Promise((r) => {
        const p = spawn("afplay", [file], { stdio: "ignore" });
        p.on("close", r);
        p.on("error", r);
      });
    }
  }

  if (args["create-agent"]) {
    const serverUrl = isReal(args["server-url"])
      ? args["server-url"]
      : "https://praxis.edelsteinconsulting.com/v1/chat/completions";
    process.stdout.write("\nCreating a Voice Engine agent for mobile/relay… ");
    const agentId = await client.createConvaiAgent({
      name: "Praxis",
      voiceId: chosen.voiceId,
      customLlmUrl: serverUrl,
    });
    writeEnv(ENV_PATH, { ELEVENLABS_AGENT_ID: agentId });
    console.log(`done.\n✓ Agent id ${agentId} written to .env (point mobile/server at it).`);
  }

  console.log("\nAll set. Launch with:  pnpm desktop:dev\n");
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
