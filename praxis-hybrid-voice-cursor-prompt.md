# Praxis — Hybrid Voice Architecture Build Prompt

> Paste this whole file into a Cursor agent at the root of the Praxis workspace.
> It is written as instructions **to you, the agent.** Read the "Discover First" section before writing any code.

---

## 0. Mission & End State

Build **Praxis** into a voice-driven, autonomous agent that I own end to end, delivered as:

1. **A full working desktop client** — Electron, packaged and runnable on **both macOS and Windows**.
2. **A mobile extension** — a downloadable **React Native** app (iOS + Android) that talks to the same brain.

The defining principle is **hybrid**: *I own the reasoning loop; I rent the voice plumbing.*

- **The brain** (Claude agentic loop + MCP orchestration + task dispatch) is self-owned. This is the existing "Path B" decision and it stands. Do not hand the orchestration to a managed agent platform.
- **The voice layer** (speech-to-text, turn-taking, interruption handling, text-to-speech) uses **ElevenLabs' Voice Engine** so we are not hand-building real-time audio plumbing — especially on mobile, where latency and turn-taking matter most.
- **Task dispatch** routes through my existing **`cursor-slack-bridge`** (local folder + GitHub repo) so that when Claude decides something is an executable task, it fires the same way I already dispatch work today.

The agent must be able to do things like: "review my project Roomies and tell me what we just did," respond conversationally by voice, understand a follow-up like "add a feature that does X and Y," recognize that as a task, turn it into a concise structured request, and dispatch it through `cursor-slack-bridge` to my machine — all hands-free.

---

## 1. Discover First (do this before writing any code)

Do not assume the contents of my existing repos. Inspect them and conform to what is already there.

1. **Read the current Praxis repo** in this workspace (the GitHub repo this Cursor session is attached to). Map the existing structure, the orchestration loop, how Claude is currently called, and how the GitHub MCP integration is wired. Reuse and extend it — do not rewrite from scratch.
2. **Read the local `cursor-slack-bridge` folder** (it lives alongside this workspace; if you cannot find it, search the parent directory and ask me for the path before proceeding). Document:
   - Its public interface / entry points
   - How a task is currently submitted to it (function call, HTTP endpoint, CLI, Slack webhook, file drop — whatever it is)
   - The exact shape of a task payload it expects and what it returns
3. Produce a short `ARCHITECTURE_FINDINGS.md` summarizing both before you start building, so we agree on the integration surface. **Pause and show me this file** before Phase 1.

If anything in this prompt conflicts with what already exists in those repos, prefer the existing code's conventions and flag the conflict in `ARCHITECTURE_FINDINGS.md`.

---

## 2. Architecture Overview (the hybrid)

```
                         ┌─────────────────────────────────┐
                         │     ORCHESTRATION CORE (brain)   │
                         │  - Claude agentic loop (own loop)│
                         │  - MCP manager (GitHub first,    │
                         │    pluggable)                    │
                         │  - Multi-step tool chaining       │
                         │  - Task classifier (chat vs task)│
                         └───────────────┬─────────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 │                       │                       │
        ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼─────────┐
        │  GitHub MCP      │     │ cursor-slack-    │     │  (future MCPs:   │
        │  (repos/commits/ │     │ bridge adapter   │     │  filesystem,     │
        │   PRs/issues)    │     │ (dispatch tasks) │     │  shell, etc.)    │
        └──────────────────┘     └──────────────────┘     └──────────────────┘

   THE BRAIN IS EXPOSED OVER A LOCAL/RELAY TRANSPORT (WebSocket) ───────────────┐
                                                                                │
   ┌───────────────────────────────┐         ┌──────────────────────────────────▼─┐
   │  DESKTOP (Electron, Mac+Win)  │         │  MOBILE (React Native, iOS+Android) │
   │  - Runs core in main process  │         │  - Thin client                      │
   │  - ElevenLabs STT/TTS in       │         │  - ElevenLabs Voice Engine SDK      │
   │    renderer                    │         │    (turn-taking + interruption)     │
   │  - Local-first, low setup      │         │  - Streams intent to brain over WS  │
   └───────────────────────────────┘         │  - Speaks responses back            │
                                              └─────────────────────────────────────┘
```

**Key decisions baked in:**

- **Brain is shared, not duplicated.** The Claude loop + MCP manager live in one `core` package consumed by every surface.
- **Voice layer differs by platform, brain does not.**
  - Desktop: ElevenLabs **Scribe (STT)** + **TTS** wired directly; the core runs in the Electron main process.
  - Mobile: ElevenLabs **Voice Engine** via their client SDK handles the real-time audio loop (turn detection, barge-in, sub-second cadence), but the **LLM is ours** — the SDK is wired to our brain via a conversation token + our server, not to a managed ElevenLabs agent.
- **Mobile is a thin client.** It does not run the agentic loop locally (and shouldn't — the work it dispatches needs to land on my machine). It connects to the brain over WebSocket.
- **Headless brain service.** Extract the core so it can run as a small headless service (for the phone to reach) AND in-process inside Electron (for desktop). The phone talks to either my desktop instance or a small relay running the same `server` package — make this a config switch.

---

## 3. Monorepo Structure

Use a TypeScript monorepo (pnpm workspaces + Turborepo). If the existing Praxis repo already has a layout, adapt this into it rather than imposing a new root.

```
praxis/
  packages/
    core/                # orchestration loop, Claude agent, MCP manager — shared brain
    bridge-adapter/      # integration with cursor-slack-bridge
    transport/           # WebSocket protocol + message schemas shared by all surfaces
    voice-elevenlabs/    # thin wrappers: STT (Scribe), TTS, Voice Engine session helpers
    shared-types/        # shared TS types / zod schemas
  apps/
    desktop/             # Electron app (Mac + Windows), runs core in-process
    mobile/              # React Native (Expo dev build), ElevenLabs Voice Engine client
    server/              # headless brain service for mobile to reach (same core)
  ARCHITECTURE_FINDINGS.md
  turbo.json
  pnpm-workspace.yaml
```

---

## 4. Tech Stack (pin these unless the existing repo dictates otherwise)

- **Language:** TypeScript everywhere.
- **Reasoning:** `@anthropic-ai/sdk`. Model **selectable** — default to a high-reasoning model for autonomous loops (Opus-class) and a faster model (Sonnet-class) for quick conversational turns. Expose this as config; do not hardcode one model.
- **MCP:** `@modelcontextprotocol/sdk`. GitHub MCP server is the **first** integration. Architect the MCP manager so additional servers are registered via config, not code changes.
- **Voice:** ElevenLabs.
  - Desktop: Scribe STT + ElevenLabs TTS.
  - Mobile: ElevenLabs **Voice Engine** client SDK (the "bring your own LLM/orchestration" path — obtain a conversation token, start a session, attach the voice engine to our brain). Do **not** use the fully managed Agents platform; we keep orchestration ourselves.
- **Desktop shell:** Electron + `electron-builder`. Targets: macOS `.dmg` (universal: arm64 + x64) and Windows NSIS `.exe`.
- **Mobile:** React Native via **Expo with a custom dev/prod build** (ElevenLabs SDK needs native modules, so plain Expo Go won't work — use EAS Build / a config plugin). iOS + Android.
- **Transport:** WebSocket for streaming intent/response between mobile and brain. Define the protocol once in `packages/transport` with zod-validated message types.
- **Validation:** zod for every cross-boundary payload (task dispatch, transport messages, tool results).

State any assumption you make (e.g. Expo vs bare RN, relay vs desktop-hosted brain) inline in code comments and in `ARCHITECTURE_FINDINGS.md`.

---

## 5. The Agentic Loop (core behavior)

The `core` package owns a self-driven loop:

1. Receive user intent (text, already transcribed by the voice layer).
2. Call Claude with the system prompt + conversation history + available MCP tools.
3. If Claude returns tool calls, execute them via the MCP manager, feed results back, and **continue the loop** until Claude produces a final response. This multi-step chaining is the whole point — it must not stop after one tool call.
4. **Task classification:** detect when an utterance is a request to *do work* (e.g. "add a feature that does X") vs. a *conversational query* (e.g. "what did we just do on Roomies"). When it's work, synthesize a concise, structured task request and dispatch it through the `bridge-adapter`.
5. Return a **conversational** response for the voice layer to speak — natural prose, not bullet points or text dumps. The voice persona should address me directly ("Hey Michael, here's what's going on...") and hand back control ("what do you want to do from here?").

The conversational-vs-task distinction and the spoken-not-written response style are product requirements, not nice-to-haves.

---

## 6. cursor-slack-bridge Integration (`bridge-adapter`)

- Conform to the **existing** interface discovered in Section 1. Do not invent a new dispatch mechanism if one already works.
- The adapter exposes one clean function to the core, e.g. `dispatchTask(structuredTask): Promise<DispatchResult>`, and internally routes to whatever `cursor-slack-bridge` already supports (local machine, Slack, etc.).
- A structured task should carry at minimum: target project/repo, a concise instruction, and any context the bridge needs. Match the bridge's actual expected payload shape.
- If the bridge supports multiple destinations (local vs Slack), expose that as a parameter so the agent can choose or default sensibly.

---

## 7. Per-Surface Requirements

### Desktop (`apps/desktop`) — Mac + Windows
- Electron app that runs the `core` brain in the main process and renders a minimal UI in the renderer.
- ElevenLabs STT + TTS wired in. Push-to-talk and hands-free both supported.
- A "pop open and talk" affordance — global hotkey to summon the voice interface.
- `electron-builder` config that produces signed-ready `.dmg` (universal) and Windows NSIS installer. Provide `pnpm build:mac` and `pnpm build:win` scripts. Document any signing/notarization steps as TODOs with placeholders; do not block the build on certs I don't have yet.

### Mobile (`apps/mobile`) — iOS + Android
- React Native (Expo dev build). ElevenLabs Voice Engine client SDK for the real-time conversation.
- Connects to the brain over WebSocket (`packages/transport`). Config for which brain endpoint (my desktop instance or the `server` relay).
- Optimized for the on-the-go case: open the app, talk while walking, hear conversational replies, dispatch tasks by voice.
- Provide EAS Build config so I can produce installable builds. Document the steps to get it onto my device.

### Server (`apps/server`) — headless brain for mobile
- Runs the same `core` as a standalone service exposing the WebSocket transport + the ElevenLabs conversation-token endpoint the mobile client needs.
- Auth: simple token-based auth between my devices and this service (placeholder secret via env). This is single-user (me); don't over-engineer multi-tenant.

---

## 8. Secrets & Config

Use a single `.env` per app, never commit secrets, and provide `.env.example` files. Expected keys:

- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `GITHUB_TOKEN` (or however the existing GitHub MCP integration authenticates — match it)
- `PRAXIS_AUTH_SECRET` (device ↔ server auth)
- `CURSOR_SLACK_BRIDGE_*` (whatever the bridge needs — discover and document)

Add `.env*` to `.gitignore` if not already present.

---

## 9. Guardrails & Conventions

- **Do not commit secrets or tokens.** Ever.
- **Extend, don't rewrite.** Reuse the existing Praxis orchestration loop and GitHub MCP wiring.
- **Type every boundary** with zod. No untyped payloads crossing transport, dispatch, or tool result edges.
- **Keep the brain platform-agnostic.** No Electron or React Native imports in `packages/core`.
- **Conversational output** is a hard requirement for anything the voice layer speaks — natural prose, direct address, no bullet lists read aloud.
- Commit in logical chunks with clear messages. Open a draft PR per phase if the repo workflow supports it.

---

## 10. Phased Build Plan

Execute every phase using the **loop operating model in Section 13** (roles, gate checks, self-prompting, and cost guardrails). Work in phases. **Pause for my review at the end of each phase** before moving on.

- **Phase 0 — Discovery.** Produce `ARCHITECTURE_FINDINGS.md` (Section 1). Stop and show me.
- **Phase 1 — Core extraction.** Pull the brain into `packages/core`: Claude loop, MCP manager (GitHub first), task classifier. Unit-test the loop with a mock MCP. No UI yet.
- **Phase 2 — Bridge adapter.** Build `bridge-adapter` against the discovered `cursor-slack-bridge` interface. Prove an end-to-end dispatch from a structured task to the bridge.
- **Phase 3 — Desktop client.** Electron app (Mac + Windows) running core in-process with ElevenLabs STT/TTS. Hotkey-summoned voice loop. Produce working dev builds on both OSes.
- **Phase 4 — Headless server + transport + relay deploy.** Stand up `apps/server` and `packages/transport`. Brain reachable over authenticated WebSocket. **Deploy `apps/server` to the always-on VPS relay per Section 12** so the phone can reach the brain even when my desktop is asleep.
- **Phase 5 — Mobile client.** React Native + ElevenLabs Voice Engine, wired to the brain over transport (pointed at the relay by default). On-the-go voice → conversational reply → task dispatch. Produce an installable build.
- **Phase 6 — Packaging & polish.** Finalize `electron-builder` outputs for Mac + Windows, EAS builds for mobile, harden + document the relay deploy (Section 12), and write docs for running/installing each surface.

---

## 11. Definition of Done

- `packages/core` runs the autonomous Claude + MCP loop, chaining multiple tool calls per turn, with GitHub MCP working.
- Tasks dispatch correctly through `cursor-slack-bridge` via `bridge-adapter`.
- **Desktop:** installable, runnable Praxis voice client on **both macOS and Windows**, conversational voice in and out.
- **Mobile:** installable React Native app, on-the-go voice conversation that reaches the same brain and dispatches tasks.
- The end-to-end demo works: by voice I ask about a project, get a conversational spoken summary, request a feature, and the structured task lands via the bridge — hands-free.

Start with **Phase 0** and show me `ARCHITECTURE_FINDINGS.md` before writing application code.

---

## 12. Relay Deployment Spec (always-on VPS)

The mobile client must reach the brain even when my desktop is asleep, so `apps/server` runs on a small always-on VPS. This is single-user (just me) — keep it simple and locked down, not multi-tenant.

### 12.1 How dispatch reaches my machine (read this first)
The brain runs on the VPS, but executed tasks need to land on my **local** machine where Cursor runs. **Do not** open my laptop to the internet. Resolve this in `ARCHITECTURE_FINDINGS.md` based on what `cursor-slack-bridge` actually does:

- **Preferred — Slack-routed (default if the bridge already uses Slack):** the VPS only needs Slack credentials. It posts the structured task to Slack; my existing local listener picks it up independently. The VPS never touches my laptop directly. This cleanly decouples the relay from my machine — use it if at all possible.
- **Fallback — private tunnel:** if the bridge requires direct local access, connect the VPS and my machine over a private mesh (Tailscale or a Cloudflare Tunnel). The bridge endpoint is exposed only on that private network, never publicly. Document the chosen path.

### 12.2 Provider & sizing
- Any cheap VPS: Hetzner CX22 / DigitalOcean / Vultr, ~$5–7/mo, **Ubuntu 24.04 LTS**, 1–2 vCPU / 2 GB RAM is plenty for a single Node service.
- Also provide a **PaaS alternative** (Fly.io or Railway) using the same Docker image, for one-command deploys if I'd rather skip server management. Make the Docker image the source of truth so both paths work.

### 12.3 Topology
```
  Phone ──wss──▶ Caddy (auto-HTTPS) ──▶ praxis-server (Node, core brain)
                                              │
                                              ├─ Anthropic API (reasoning)
                                              ├─ ElevenLabs API (mint conversation tokens server-side)
                                              ├─ GitHub MCP
                                              └─ cursor-slack-bridge dispatch
                                                   └─ Slack ──▶ my local listener ──▶ Cursor
```

### 12.4 Packaging
- A **Dockerfile** that builds and runs only `apps/server` from the monorepo (multi-stage; prune to the server's workspace deps).
- A **`docker-compose.yml`** with two services:
  - `praxis-server` — the Node brain, `restart: unless-stopped`, env from a root-owned `.env` (mode `600`), exposes its port only on `127.0.0.1`.
  - `caddy` — reverse proxy terminating TLS, auto-provisioning a Let's Encrypt cert, proxying `wss://` → the server. Use Caddy (not nginx+certbot) for single-command HTTPS.
- A `Caddyfile` mapping a subdomain (e.g. `praxis.<my-domain>` — I own `edelsteinconsulting.com`, so a subdomain there is fine) to the server, with WebSocket upgrade headers handled.

### 12.5 TLS & DNS
- Mobile requires secure WebSockets (`wss://`), so TLS is mandatory — Caddy handles issuance/renewal automatically.
- I'll create an `A`/`AAAA` record for the subdomain pointing at the VPS; leave it as a documented prerequisite step, don't hardcode an IP.

### 12.6 Auth & secrets
- WebSocket handshake requires a bearer token (`PRAXIS_AUTH_SECRET`); reject unauthenticated connections. Single device pairing is enough — no user system.
- **ElevenLabs API key never touches the phone.** The mobile client requests a short-lived conversation token from a `POST /voice/token` endpoint on the server; the server calls ElevenLabs with the secret key and returns only the scoped token.
- All secrets via the root-owned `.env` (mode `600`) or the PaaS secret store. Provide `.env.example`. Nothing committed.

### 12.7 Hardening (apply on provision)
- `ufw`: allow only 22 (SSH), 80, 443; deny everything else.
- SSH: key-only, root login disabled, run the service as a non-root user.
- `fail2ban` on SSH; enable `unattended-upgrades` for automatic security patches.
- Docker containers run as non-root; no host volumes beyond the env file and Caddy's cert store.

### 12.8 Health, restart & deploy
- Server exposes `GET /healthz` (returns OK + brain readiness). Compose `restart: unless-stopped` plus a Docker healthcheck hitting `/healthz`.
- Provide a **GitHub Actions** workflow (optional, behind a flag) that on push to `main`: builds the Docker image, pushes to a registry, SSHes to the VPS, and `docker compose pull && up -d`. Keep deploy creds in GitHub secrets.
- Include a one-page `DEPLOY.md`: provision steps, DNS record, env setup, first deploy, and how to roll back to the previous image tag.

### 12.9 Config switch (ties back to Section 7)
- The mobile + desktop clients take a `BRAIN_ENDPOINT` config. Default mobile to the **relay** URL; allow pointing at a local desktop instance for dev. One switch, documented in `DEPLOY.md` and the app READMEs.

### 12.10 Cost note
- Target ~$5–7/mo for the VPS. ElevenLabs Voice Engine + Anthropic usage are the variable costs and scale with how much I actually talk to it — call this out so I'm not surprised by API spend separate from the box.

---

## 13. Development Loop & Multi-Agent Operating Model

This governs **how** you build everything above. Do not free-form your way through the phases — run a disciplined, self-prompting loop with distinct roles, gate checks against this architecture, and hard cost guardrails. The loop terminates only when the Definition of Done (Section 11) is met: a functioning Praxis AI assistant and task executer.

### 13.1 Roles (adopt these as distinct sub-agents / personas each iteration)
- **Orchestrator** — owns the loop. Reads the architecture, the phased plan, and the current `PROGRESS.md`, then picks the next smallest unit of work, delegates to the right role, runs the gate checks, decides green-light, triggers the commit, and **self-prompts the next iteration**. It is the control loop, not an implementer.
- **Project Manager (PM)** — breaks each phase into discrete tasks with explicit **acceptance criteria**, tracks done-vs-pending against the architecture and DoD, and is the sole writer of `PROGRESS.md`. Decides what comes next based on what's already completed.
- **Software Engineer (SWE)** — implements the task: code + tests. Conforms to the architecture section it touches.
- **UI/UX** — designs and implements interface surfaces (Electron renderer, RN screens, voice affordances) and enforces the conversational-output requirements (natural prose, direct address, no lists read aloud).
- **Judge** — independent verifier. Reviews the SWE/UI-UX output against the task's acceptance criteria and the gate checks below. **Does not rubber-stamp.** Returns an explicit PASS/FAIL with reasons. Only a PASS green-lights a commit and advancement.

Keep the roles separated even when one model is playing all of them — the Judge must evaluate adversarially, not confirm its own work.

### 13.2 The loop (per task)
1. **Orchestrator** selects the next task from the PM backlog, chosen from current `PROGRESS.md` state + the architecture + next phase steps.
2. **SWE / UI-UX** implement the smallest viable unit.
3. **Gate Check + Judge** evaluate (Section 13.3). 
4. **GREEN** → commit properly (atomic, conventional-commit message scoped to the task); PM updates `PROGRESS.md` (status, Judge verdict, commit SHA).
5. **RED** → loop back to the implementer with the Judge's specific feedback (bounded retries, Section 13.5).
6. **Orchestrator self-prompts** the next task from the updated state and continues until the DoD is met or a stop condition fires.

### 13.3 Gate Checks (must be GREEN before commit + advance)
Per-task gates:
- Typechecks (`tsc`) and lint pass.
- The task's unit tests pass.
- **Conforms to the referenced architecture section** (e.g. no Electron/RN imports in `packages/core`; every cross-boundary payload zod-validated; brain stays platform-agnostic).
- Judge records an explicit PASS with reasons.

Phase gates (in addition to per-task):
- The phase's stated deliverable in Section 10 is demonstrably met.
- **Mandatory human review pause** — never auto-advance across a phase boundary without my explicit go-ahead. Phase 0 already stops for `ARCHITECTURE_FINDINGS.md`.

### 13.4 State & continuity (resumable)
- `PROGRESS.md` is the single source of truth: phase, task list, acceptance criteria, status, Judge verdicts, commit SHAs. The loop **reads it at the start of every iteration** so work is never duplicated and the loop is resumable after any interruption.
- `LOOP_LOG.md` appends one line per iteration: task, role outputs summary, Judge verdict, **tokens used + estimated cost**, and the resulting commit. This is my audit trail.

### 13.5 Cost & safety guardrails (do not run up absurd token spend)
These are hard requirements, not suggestions. Treat token/cost discipline as a first-class objective.

1. **Iteration caps.** Enforce a per-phase max iteration count and a global max iteration count. On hit → **stop and ask me**, do not continue.
2. **Token/cost budget.** Track cumulative tokens and estimated cost in `LOOP_LOG.md`. Warn at 75% of the session budget; **hard-stop at 100%** and report. Default the session budget conservatively and let me raise it explicitly.
3. **Bounded retries.** Max 3 RED→retry cycles per task. After that, **escalate to me** instead of looping — never infinitely retry a failing gate.
4. **No-progress kill switch.** If two consecutive iterations produce no net progress (same failing gate, no meaningful diff), halt and escalate. This prevents silent token burn.
5. **Read before redo.** Always consult `PROGRESS.md` before acting. Never re-implement completed tasks or repeatedly re-read large files you've already ingested.
6. **Model tiering.** Use a cheaper/faster model for routine roles (PM bookkeeping, simple edits, first-pass Judge triage) and reserve the high-reasoning model for genuinely hard implementation or architecture decisions. Do not spend top-tier tokens on trivial steps.
7. **Smallest viable unit.** One discrete change per iteration. No gold-plating, no unrequested features, no speculative abstraction.
8. **Plan-before-execute on big moves.** Before any large or expensive operation (scaffolding many files, bulk refactor, dependency installs), state the planned action and rough scope first; for the largest ones, **wait for my confirmation**.
9. **Human gates are absolute.** Phase boundaries and any prohibited/irreversible action (publishing, deploying to the live VPS, anything touching secrets) require my explicit approval. The relay deploy in Section 12 only runs when I say so.

### 13.6 Termination
The loop ends when the Section 11 Definition of Done is satisfied — a working, voice-driven Praxis that holds a conversation, reasons over my repos via the autonomous Claude + MCP loop, and dispatches real tasks through `cursor-slack-bridge`, across desktop (Mac + Windows) and mobile. At termination, produce a final summary: what was built, total tokens/cost from `LOOP_LOG.md`, and how to run each surface.
