# Praxis — Architecture Findings (Phase 0)

This document is the agreed integration surface before building. It records what
already exists, how Praxis hooks into it, and the decisions made where the build
prompt left a choice open. Where the prompt conflicts with reality, the real
behavior wins and the conflict is flagged here.

---

## 1. State of the existing repos

### 1.1 `praxis` (this repo)
- **Effectively empty.** Single `Initial commit` (`7ffebae`), a one-line `README.md`
  ("Created via Cursor Bridge from Slack"), a `.gitignore`, and the build prompt.
- Remote: `https://github.com/michaelxedelstein/praxis.git`.
- **There is no existing orchestration loop or GitHub MCP wiring to extend.** The
  prompt's "extend, don't rewrite" instruction assumes prior Praxis code; there is
  none. **Decision:** build the monorepo fresh, but conform to the conventions of
  the surrounding ecosystem (Node ≥20, ESM, the bridge's Slack-first dispatch
  model). This is the only real conflict with the prompt, and it's resolved in
  favor of "there's nothing to extend, so build it cleanly."

### 1.2 `cursor-slack-bridge` (sibling repo)
Location: `/Volumes/ExternalSSD/Developer/Projects/cursor-slack-bridge`
Remote: `https://github.com/michaelxedelstein/cursor-slack-bridge.git`

**What it is:** a Node ESM app (`@slack/bolt`, Socket Mode) that runs on the local
Mac. It listens to Slack and, for a message in a `#proj-<name>` channel, runs the
**Cursor CLI** (`cursor-agent`) inside the matching local repo folder, then posts
the result back into the Slack thread.

**Public interface / entry point**
- Entry: `src/index.js` (started via `npm start`). No HTTP server, no exported
  library API — it is a **Slack-driven daemon**, not a callable module.
- Always-on via `install-service.sh` (launchd, keeps the Mac awake).

**How a task is submitted to it (the dispatch contract):**
1. A message is posted into a **public** Slack channel named `proj-<name>`.
2. The message must trigger the bridge's `app_mention` handler — i.e. it must
   contain the bridge bot's mention token `<@BRIDGE_BOT_USER_ID>`. (Plain DMs work
   too but a DM channel is **not** named `proj-*`, so it can't be mapped to a repo
   — channel dispatch is the only way to target a specific project.)
3. The bridge maps the channel → a local folder via `resolveRepoPath`
   (`src/config.js`): explicit `config.json#channels` entry first, otherwise the
   `proj-<name>` → folder-name convention across `projectsRoots`.
4. It strips the mention, parses optional leading directives, and runs:
   `cursor-agent -p --output-format text --force --trust [--mode …] [--model …] "<prompt>"`
   in that folder (`src/runAgent.js`), with a 30-minute timeout.
5. It posts the agent's stdout back into the thread. Any file the agent drops in
   `.bridge-outbox/` at the repo root is uploaded to the thread too.

**Task payload shape it expects:** there is no JSON schema — the payload is simply
the **Slack message text** (natural language instruction), optionally prefixed
with directives the bridge parses (`src/index.js#parseDirectives`):
- `/plan <task>` — read-only planning
- `/ask <task>` — read-only Q&A
- `/edit <task>` — force normal edit mode (overrides config default)
- `/model <name> <task>` — pick a model in plain English (e.g. `/model opus 4.8 high thinking …`)
- `/claude [opus|sonnet|haiku] <task>` — run via Claude Code on the Anthropic key
- Follow-up replies inside an engaged thread need **no** re-mention.

**What it returns:** a human-readable Slack message (`:white_check_mark: Done.` +
agent stdout, chunked to 3500 chars), plus optional uploaded media. It does **not**
return a structured result object — the "result" is asynchronous Slack chatter in
the thread.

**Config knobs (`config.json`):**
- `projectsRoots`: `["/Volumes/ExternalSSD/Developer/Projects", "/Users/michaeledelstein/Developer"]`
- `agentCommand`: `cursor-agent`, `agentArgs`: `["-p","--output-format","text","--force","--trust"]`
- `autoJoinPrefix`: `proj-` (auto-joins matching public channels on boot + on create)
- `statusUserId`: `U0AUPA1691U`, `defaultModel`: `composer-2.5-fast`
- `channels`: explicit channel→path overrides.

**Secrets the bridge needs (`.env`):** `SLACK_BOT_TOKEN` (`xoxb-`),
`SLACK_APP_TOKEN` (`xapp-`, Socket Mode), optional `ANTHROPIC_API_KEY` (for `/claude`).

---

## 2. How Praxis integrates (the dispatch decision)

Praxis treats the bridge as a **fire-and-forget Slack-routed task sink**. The
`bridge-adapter` package does exactly one thing: post a well-formed task message
into the correct `#proj-<name>` channel, mentioning the bridge bot, so the bridge
picks it up on the Mac independently.

```
Praxis brain ──(Slack chat.postMessage)──▶ #proj-<name>  ──▶ cursor-slack-bridge (Mac) ──▶ cursor-agent
```

This is the prompt's **§12.1 "Preferred — Slack-routed"** path, and it's the right
one because the bridge is *already* Slack-native. **Consequences (all good):**
- The VPS relay only needs a Slack bot token to dispatch. It **never** touches the
  laptop directly — no tunnel, no inbound ports on my machine. Clean decoupling.
- Dispatch is identical whether the brain runs on my desktop or on the relay.

### 2.1 The one real gotcha: who posts the message
The bridge ignores messages where `message.bot_id` is set **in its `app.message`
handler**, but channel dispatch fires the **`app_mention`** handler, which is not
bot-filtered. So a message posted by *another* Slack app that mentions the bridge
bot will still trigger it. To be safe and explicit, the adapter is built to post
via a configurable token and mention a configurable bot id:
- `SLACK_BOT_TOKEN` — the token Praxis posts with (a **separate** "Praxis
  Dispatcher" Slack app is recommended; a user token also works and is the most
  reliable trigger).
- `CURSOR_BRIDGE_BOT_ID` — the bridge bot's user id, used to form the
  `<@…>` mention that triggers `app_mention`.

**Prerequisite flagged:** at discovery time the bridge bot was **not** a member of
`#proj-praxis` (only Michael was), implying the bridge service may be stopped or
hadn't joined yet. For dispatch to land: (a) the bridge must be running, (b) it
must be a member of the target `proj-*` channel (it auto-joins on boot), and
(c) `CURSOR_BRIDGE_BOT_ID` must be set. How to get the id: it's logged by the
bridge (`auth.test`) on startup, or read from the Slack app's "Bot User" page.
The adapter degrades gracefully (posts a non-mention note) if the id is absent.

### 2.2 Structured task → message text
The brain classifies an utterance as a task and synthesizes a `StructuredTask`
(zod, in `shared-types`): `{ project, instruction, mode?, model?, context? }`.
The adapter renders it to the bridge's text contract:
`"<@BRIDGE_BOT_ID> [/mode] [/model …] <instruction>\n\n<context>"` and posts to
`#proj-<project>`. `project` maps to the channel via the same `proj-<name>`
convention the bridge uses, so no extra mapping table is needed.

---

## 3. Decisions made autonomously (prompt left these open)

| Topic | Decision | Why |
|---|---|---|
| Monorepo tooling | pnpm workspaces + Turborepo, TypeScript project refs | Matches prompt §3; standard, cacheable. |
| Module system | ESM everywhere, NodeNext | Bridge is ESM; modern default. |
| Build | `tsup`/`tsc` per package; `tsx` for dev/test runners | Light, no heavy bundler in core. |
| Test runner | `vitest` | Fast, TS-native; used to test the loop with a mock MCP. |
| Brain transport to mobile | Slack-routed dispatch (not a tunnel) | §12.1 preferred; bridge is Slack-native. |
| Default models | Opus-class for the autonomous loop, Sonnet-class for quick chat turns; both via env | Prompt §4 "selectable, don't hardcode". |
| GitHub MCP | Launched via `@modelcontextprotocol/sdk` stdio client against the official GitHub MCP server, registered through a **config-driven** MCP manager | Prompt §4: first integration, pluggable. |
| Voice (desktop) | ElevenLabs Scribe STT + TTS via REST/WebSocket wrappers in `voice-elevenlabs` | Prompt §4. |
| Voice (mobile) | ElevenLabs Voice Engine client SDK, "bring-your-own-LLM": server mints a conversation token, SDK streams audio, transcripts route to our brain over WS | Prompt §4/§7; keeps orchestration ours. |
| Server framework | `fastify` + `ws` | Tiny, fast, easy `/healthz` + `/voice/token` + WS upgrade with bearer auth. |
| Relay default | mobile `BRAIN_ENDPOINT` defaults to the relay `wss://praxis.edelsteinconsulting.com` | Prompt §12.9. |
| Single-user auth | One shared bearer `PRAXIS_AUTH_SECRET` on the WS handshake + `/voice/token` | Prompt §12.6; no user system. |

---

## 4. Integration surface summary (the contract we're agreeing on)

- **Dispatch in:** `bridgeAdapter.dispatchTask(task: StructuredTask): Promise<DispatchResult>`
  → posts `<@bridgeBot> …` into `#proj-<task.project>` via Slack Web API.
- **Brain in:** `core.runTurn({ history, userText }): Promise<TurnResult>` runs the
  Claude + MCP loop, may call `dispatchTask`, returns a **spoken-style** reply
  string + metadata (`{ dispatched?: DispatchResult }`).
- **Transport:** zod-typed WS messages in `packages/transport` carry user
  transcripts up and spoken replies + events down. Bearer-authenticated.
- **Voice tokens:** `POST /voice/token` on the server returns a short-lived
  ElevenLabs conversation token; the ElevenLabs API key never leaves the server.

This is the surface every later phase builds against.
