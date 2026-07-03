# Praxis

**A voice-driven agent whose brain you actually own.**

Praxis is a hands-free assistant you can talk to from your desktop or your phone.
You speak, it reasons, it uses tools (via MCP), and when you ask it to ship work it
hands the task off to [`cursor-slack-bridge`](https://github.com/michaelxedelstein/cursor-slack-bridge),
which runs Cursor's agent inside the right local repo and reports back.

The guiding idea is a clean split:

- **You own the reasoning.** The Claude agentic loop, the MCP tool orchestration,
  and task dispatch all live in code in this repo. Nothing about *how Praxis thinks*
  is hidden behind someone else's product.
- **You rent the voice plumbing.** Speech-to-text, text-to-speech, and real-time
  turn-taking come from ElevenLabs. That's commodity infrastructure, so there's no
  point rebuilding it.

The same brain powers three surfaces — a desktop app, a mobile app, and an
always-on relay server — so you get the same assistant whether you're at your Mac
or out with just your phone.

---

## How it fits together

```
        ┌─────────────┐        ┌─────────────┐
        │  Desktop    │        │   Mobile    │
        │ (Electron)  │        │ (Expo RN)   │
        │ brain runs  │        │ thin client │
        │ locally     │        │ over WSS    │
        └──────┬──────┘        └──────┬──────┘
               │                      │
               │            wss://  + bearer
               │                      │
               │               ┌──────▼───────┐
               │               │ Relay server │   always-on VPS
               │               │  (Fastify)   │   Caddy TLS in front
               │               │ brain runs   │
               │               │ here too     │
               └──────┐  ┌─────┘
                      ▼  ▼
              ┌──────────────────┐
              │   Praxis brain   │  Claude loop + MCP manager + task classifier
              └───────┬──────────┘
                      │ "ship this" → Slack chat.postMessage
                      ▼
            #proj-<name>  ──▶  cursor-slack-bridge (your Mac)  ──▶  cursor-agent
```

Voice is wired up two different (deliberate) ways:

- **Desktop** uses ElevenLabs STT + TTS directly from the Electron main process
  (your API key never touches the renderer).
- **Mobile** uses ElevenLabs Voice Engine with a "bring-your-own-LLM" setup: the
  server mints a short-lived conversation token, the phone streams audio to
  ElevenLabs, and ElevenLabs calls *back into the Praxis brain* through an
  OpenAI-compatible endpoint on the server. Your reasoning stays yours; the
  ElevenLabs key never leaves the server.

For the full reasoning behind these choices, see
[`ARCHITECTURE_FINDINGS.md`](./ARCHITECTURE_FINDINGS.md).

---

## Repository layout

It's a pnpm + Turborepo monorepo. Shared logic lives in `packages/`; each runnable
surface lives in `apps/`.

| Path | What it is |
|---|---|
| `packages/shared-types` | Zod schemas for every cross-boundary payload (tasks, transport messages). The contract everything agrees on. |
| `packages/core` | The brain: the Claude agentic loop, the MCP tool manager, and the task classifier. Tested with a mock MCP. |
| `packages/bridge-adapter` | Turns a structured task into a Slack message that triggers `cursor-slack-bridge`. |
| `packages/transport` | The WebSocket protocol (zod-typed messages) and bearer auth helpers. |
| `packages/voice-elevenlabs` | Thin wrappers around ElevenLabs STT, TTS, and Voice Engine token minting. |
| `packages/mcp-importer` | Discovers the MCP servers you already use in Cursor and turns the reachable ones into launchable configs. |
| `packages/mcp-mac-control` | An MCP server for macOS automation: browser, Finder, iMessage, app focus, clipboard, notifications. |
| `apps/server` | The headless relay: WS transport, `/voice/token`, `/healthz`, and the OpenAI-compatible LLM endpoint. |
| `apps/desktop` | The Jarvis command center (macOS + Windows). Hive-mind of your repos, repo chat + dispatch, tool palette, sub-agents, multi-monitor. |
| `apps/mobile` | Expo / React Native app. A thin voice client that talks to a brain over WSS. |
| `deploy/` | Everything to stand up the relay: Dockerfile, compose, Caddy, VPS provisioning, and `DEPLOY.md`. |

---

## Quick start

**Prereqs:** Node ≥ 20 and pnpm 10 (`corepack enable` will set pnpm up for you).

```bash
pnpm install          # install the whole workspace
pnpm build            # build every package + app
pnpm test             # run the brain's unit tests
pnpm typecheck        # type-check everything
```

Then pick a surface to run below. Each one reads its own `.env` — copy the matching
`.env.example` and fill in your keys first.

### Run the desktop app

```bash
cp apps/desktop/.env.example apps/desktop/.env   # then fill in your keys
pnpm desktop:dev
```

You'll need an `ANTHROPIC_API_KEY`, an `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`
for spoken replies, and (to dispatch work) a `SLACK_BOT_TOKEN` and
`CURSOR_BRIDGE_BOT_ID`. Summon the window anywhere with the global hotkey
(default `Cmd/Ctrl+Shift+Space`).

### The Jarvis command center

The desktop app opens on a **hive-mind**: a holographic 3D constellation of every
project you work on, local and on GitHub, merged into one graph. Nodes glow by
recency, ring when a task is running or the repo has uncommitted changes, and
cluster by language. Click one and the camera flies in, opening a panel where you
can talk to that repo (grounded in its actual files and recent commits), dispatch
a task to your Mac through the Cursor Bridge, or jump to Cursor / Finder / GitHub.

- **Voice everywhere** — hold the orb or Space to talk from the global HUD or any
  repo panel; toggle hands-free for a continuous conversation.
- **Tool palette (`Cmd/Ctrl+K`)** — every MCP tool the brain has, searchable and
  runnable inline. New connections show up automatically.
- **Connections** — Praxis discovers the MCP servers you already use in Cursor and
  maps them to public equivalents; drop in a key once per service and it's live.
- **Sub-agents** — big jobs fan out to autonomous helpers (one per repo, say) that
  work in parallel and report back; watch them on the task board.
- **Mac control** — it can open browser tabs, reveal files in Finder, send an
  iMessage, focus apps, and more. Destructive actions ask before they run.
- **Multi-monitor** — hit Expand to spread the hive, the active conversation, and
  the task board across 2-3 screens; Collapse pulls it back to one window.

First launch will trigger macOS permission prompts (microphone, and Automation for
each app it controls). Reading iMessage history additionally needs Full Disk Access,
which you can grant in System Settings if you want that feature.

To package installers:

```bash
pnpm build:mac        # macOS .dmg
pnpm build:win        # Windows installer
```

### Run the relay server

```bash
cp apps/server/.env.example apps/server/.env     # then fill in your keys
pnpm server:dev
```

It listens on `127.0.0.1:8080` by default with `/healthz`, `/voice/token`, the
`/ws` transport, and the `/v1/chat/completions` Custom-LLM seam. Production
deployment (Docker + Caddy + TLS on a VPS) is documented in
[`deploy/DEPLOY.md`](./deploy/DEPLOY.md).

### Run the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env     # then point it at your brain
cd apps/mobile && pnpm start
```

By default it talks to the always-on relay. For local dev, set
`PRAXIS_BRAIN_ENDPOINT` to your desktop's LAN address (e.g.
`ws://192.168.1.50:8080`) and make sure `PRAXIS_AUTH_SECRET` matches the server's.

---

## How task dispatch works

When you say something like *"have Praxis fix the login bug in the billing repo,"*
the brain classifies it as a task, builds a structured payload
(`{ project, instruction, mode?, model?, context? }`), and the bridge adapter posts
it into the `#proj-<project>` Slack channel, mentioning the bridge bot. Your
existing `cursor-slack-bridge` running on your Mac picks it up, runs `cursor-agent`
in the matching repo, and posts the result back into the thread.

The neat part: the relay never touches your laptop directly. It only needs a Slack
token, so there's no tunnel and no inbound ports on your machine — dispatch works
identically whether the brain is running on your desktop or on the VPS. Details and
the one setup gotcha (which bot posts the message) are in
[`ARCHITECTURE_FINDINGS.md`](./ARCHITECTURE_FINDINGS.md) §2.

---

## Configuration

Every surface is configured purely through environment variables, validated at
boot so a bad config fails loudly instead of misbehaving later. Start from the
`.env.example` in each app:

- `apps/server/.env.example` — the relay
- `apps/desktop/.env.example` — the desktop app
- `apps/mobile/.env.example` — the mobile client
- `deploy/.env.example` — the production VPS (also drives Caddy TLS)

The keys you'll most likely need: `ANTHROPIC_API_KEY` (reasoning),
`PRAXIS_AUTH_SECRET` (a long random string shared between your devices and the
server), `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` / `ELEVENLABS_VOICE_ID`
(voice), and `SLACK_BOT_TOKEN` + `CURSOR_BRIDGE_BOT_ID` (dispatch).

---

## A note on security

This is intentionally a **single-user** system. There's no account system — access
is one shared bearer secret (`PRAXIS_AUTH_SECRET`) checked on the WebSocket
handshake and the `/voice/token` endpoint. The relay binds only to localhost and
sits behind Caddy, which terminates TLS. The provisioning script
(`deploy/provision.sh`) locks the VPS down to ports 22/80/443, key-only SSH, and a
non-root user. Keep your `.env` files out of git (they already are) and generate a
genuinely random auth secret.

---

## Status

All core phases are built and verified: the shared brain, the Slack-routed bridge
adapter, the WS transport, the desktop and mobile clients, and the deployable
relay (the server image builds, boots, serves `/healthz`, and enforces auth). The
first tool integration is the GitHub MCP server, wired through a config-driven MCP
manager so adding more tools is just configuration.
