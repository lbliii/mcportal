# MCPortal MCP server. No dependencies to install: Node runs the TypeScript directly.
FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY test/fixtures ./test/fixtures

ENV NODE_ENV=production \
    PORT=8787 \
    MCPORTAL_DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "src/server.ts"]
