# Multi-stage build that produces a lean image running ONLY apps/server from the
# monorepo. Stage 1 builds the server (workspace packages are bundled into the
# server's dist by tsup; only third-party deps stay external). Stage 2 ships a
# pruned production node_modules + the built dist, running as a non-root user.

# ---- Stage 1: build ---------------------------------------------------------
FROM node:22-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

WORKDIR /repo
COPY . .

# Install ONLY the server + its workspace dependency graph (skips the heavy
# desktop/mobile toolchains like Electron and React Native), then build it.
RUN pnpm install --no-frozen-lockfile --filter=@praxis/server...
RUN pnpm exec turbo run build --filter=@praxis/server...

# Create a self-contained production deployment of the server in /out
# (package.json + dist + pruned prod node_modules).
RUN pnpm --filter=@praxis/server deploy --prod --legacy /out

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-slim AS runner
ENV NODE_ENV=production
# npx is used at runtime to launch MCP servers (e.g. GitHub MCP).
WORKDIR /app

# Non-root user.
RUN groupadd --system praxis && useradd --system --gid praxis --home /app praxis

COPY --from=builder --chown=praxis:praxis /out/package.json ./package.json
COPY --from=builder --chown=praxis:praxis /out/node_modules ./node_modules
COPY --from=builder --chown=praxis:praxis /out/dist ./dist

USER praxis

# Bind to all interfaces inside the container; compose maps it to 127.0.0.1 only.
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

# Lightweight healthcheck hitting /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
