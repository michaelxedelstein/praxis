#!/usr/bin/env bash
#
# One-shot hardening for a fresh Ubuntu 24.04 VPS that will run the Praxis relay.
# Run as root (or via sudo) right after first login. Idempotent-ish; safe to
# re-run. Review before executing — it changes SSH and firewall settings.
#
#   curl -fsSL .../provision.sh | bash      # (or copy it over and run)
#
set -euo pipefail

NONROOT_USER="${PRAXIS_USER:-praxis}"

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> Installing essentials (docker, ufw, fail2ban, unattended-upgrades)"
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades

# Docker (official convenience script).
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Creating non-root user '${NONROOT_USER}' and adding to docker group"
if ! id "${NONROOT_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${NONROOT_USER}"
fi
usermod -aG docker "${NONROOT_USER}"

echo "==> Firewall: allow 22/80/443 only"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Hardening SSH (key-only, no root login)"
SSHD=/etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD"
systemctl reload ssh || systemctl reload sshd || true
# NOTE: make sure your SSH public key is in /home/${NONROOT_USER}/.ssh/authorized_keys
# BEFORE you log out, or you'll lock yourself out.

echo "==> Enabling automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "==> fail2ban on by default for sshd"
systemctl enable --now fail2ban

echo "==> Done. Next:"
echo "    1) Put your SSH key in /home/${NONROOT_USER}/.ssh/authorized_keys"
echo "    2) As ${NONROOT_USER}: clone the repo, create deploy/.env (chmod 600),"
echo "       point DNS at this box, then: docker compose -f deploy/docker-compose.yml up -d"
