# MCPortal MCP server. Node runs the TypeScript directly (no build step). The only
# runtime dependency is `pg`, for Postgres storage when DATABASE_URL is set.
FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY test/fixtures ./test/fixtures

# HOST=0.0.0.0 makes the server reachable from outside the container. It refuses
# to start that way unless auth is configured (GitHub OAuth or MCPORTAL_TOKEN).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    MCPORTAL_DATA_DIR=/data

# Runs as root on purpose: Railway mounts volumes root-owned at runtime, so a
# non-root user can't write /data. The process has no other privileges to lose
# inside the container; revisit if you deploy somewhere volumes are chown-able.
RUN mkdir -p /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "bin/mcportal.mjs"]
