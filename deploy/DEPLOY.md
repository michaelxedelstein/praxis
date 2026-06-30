# Deploying the Praxis relay

The relay is the always-on home for `apps/server` so your phone can reach the
brain even when your desktop is asleep. It's single-user and locked down — not
multi-tenant. Target cost is ~$5–7/mo for the box; ElevenLabs + Anthropic usage
are separate, variable costs that scale with how much you actually talk to it.

> **How dispatched tasks reach your Mac (important):** the relay never touches
> your laptop. It dispatches by posting into your `#proj-<name>` Slack channels;
> your local `cursor-slack-bridge` picks them up independently. The VPS only
> needs a Slack bot token (`SLACK_BOT_TOKEN`) and the bridge bot's id
> (`CURSOR_BRIDGE_BOT_ID`). No tunnel, no inbound ports on your machine. See
> `ARCHITECTURE_FINDINGS.md` §2 / §12.1.

---

## Option A — Your own VPS (Hetzner / DigitalOcean / Vultr)

**Box:** Ubuntu 24.04 LTS, 1–2 vCPU / 2 GB RAM is plenty.

1. **Create the box** and log in as root.
2. **Provision + harden** (firewall, non-root user, key-only SSH, fail2ban,
   auto-updates, Docker):
   ```bash
   # copy deploy/provision.sh to the box, review it, then:
   sudo bash provision.sh
   ```
   Put your SSH public key in `/home/praxis/.ssh/authorized_keys` **before**
   logging out (the script disables password + root SSH).
3. **DNS:** create an `A` (and `AAAA` if you have IPv6) record for
   `praxis.edelsteinconsulting.com` pointing at the box's IP. (Prerequisite —
   nothing is hardcoded to an IP.)
4. **Get the code + env** (as the `praxis` user):
   ```bash
   git clone https://github.com/michaelxedelstein/praxis.git ~/praxis
   cd ~/praxis
   cp deploy/.env.example deploy/.env
   chmod 600 deploy/.env          # root/owner-only
   nano deploy/.env               # fill in all secrets + PRAXIS_DOMAIN
   ```
5. **First deploy:**
   ```bash
   docker compose -f deploy/docker-compose.yml up -d --build
   ```
   Caddy provisions the TLS cert automatically on first boot (ports 80/443 must
   be open — `provision.sh` does this).
6. **Verify:**
   ```bash
   curl https://praxis.edelsteinconsulting.com/healthz
   # -> {"ok":true,"brainReady":true,...}
   ```

---

## Option B — PaaS (Fly.io / Railway), same Docker image

The `deploy/Dockerfile` is the source of truth, so any platform that builds a
Dockerfile works. You won't need Caddy (the platform terminates TLS).

- **Fly.io:** `fly launch --dockerfile deploy/Dockerfile` (set internal port
  8080), then `fly secrets set ANTHROPIC_API_KEY=… PRAXIS_AUTH_SECRET=… …` for
  every key in `deploy/.env.example` (skip the Caddy-only `PRAXIS_DOMAIN` /
  `PRAXIS_ACME_EMAIL`). `fly deploy` to ship.
- **Railway:** New Project → Deploy from repo → set the Dockerfile path to
  `deploy/Dockerfile`, add the same env vars, expose port 8080.

Point the phone at the platform's HTTPS domain (`wss://<app>.fly.dev`).

---

## Config switch (which brain the clients use)

Both clients take a `BRAIN_ENDPOINT`:
- **Mobile** (`apps/mobile`): `PRAXIS_BRAIN_ENDPOINT` (Expo env). Defaults to the
  relay `wss://praxis.edelsteinconsulting.com`. For local dev against your
  desktop, set it to `ws://<your-mac-LAN-ip>:8080`.
- **Desktop** runs the brain in-process and doesn't need a relay; it can also act
  as the brain a phone points at on the LAN.

---

## CI deploy (optional)

`.github/workflows/deploy.yml` builds + pushes the image to GHCR and redeploys
over SSH on push to `main`. It's **off** until you set the repo variable
`DEPLOY_ENABLED=true` and these secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

The compose file's image is overridable via `PRAXIS_IMAGE` (defaults to a local
`praxis-server:latest` build). The CI deploy step exports `PRAXIS_IMAGE` to the
GHCR tag so `docker compose pull` resolves the pushed image instead of trying to
build locally on the box.

---

## Rolling back

Images are tagged with both `latest` and the commit SHA. To roll back:
```bash
# on the box
docker pull ghcr.io/michaelxedelstein/praxis/praxis-server:<previous-sha>
docker tag  ghcr.io/michaelxedelstein/praxis/praxis-server:<previous-sha> praxis-server:latest
docker compose -f deploy/docker-compose.yml up -d
```
(Or just re-run the deploy workflow from the previous commit.)

---

## Health, restart, logs

- Health: `GET /healthz` (used by the Docker healthcheck + compose).
- Restart policy: `unless-stopped` on both services.
- Logs: `docker compose -f deploy/docker-compose.yml logs -f praxis-server`.
