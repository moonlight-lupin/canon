# Canon — church system. Multi-stage build: compile the web app, then run the TypeScript server
# directly on Node 24 (native type stripping) with production dependencies only.
#
#   docker compose up -d            # see docker-compose.yml and docs/DOCKER.md
#
# Data (SQLite database, Bible source files, uploaded logo) lives in /app/data — mount a volume there.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    CANON_HOST=0.0.0.0 \
    CANON_PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
# from the build: `npm run build` brings the languages (shared/locales.generated.ts, the Traditional Chinese files)
# up to date first, so the server and the web app always agree
COPY --from=build /app/shared ./shared
# translations: e-mails, the visitor form and the AI sign-in page read locales/<code>/server.json at run time
COPY --from=build /app/locales ./locales
# The agent handbook and user guide are served to MCP clients as resources (canon://guide/*).
COPY --from=build /app/docs ./docs
# Data and backups are writable volumes. Canon runs as the unprivileged "node" user: scripts/docker-start.mjs starts
# as root only to make those two folders node's (a NAS creates a bind-mounted ./backups as root), then drops to it.
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
VOLUME ["/app/data", "/app/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CANON_PORT||3000)+'/api/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "scripts/docker-start.mjs"]
