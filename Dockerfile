FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY build.mjs ./
COPY src ./src
RUN npm run build

FROM node:24.19.0-bookworm-slim AS runtime
ENV NODE_ENV=production BIND_ADDRESS=0.0.0.0 PORT=13000 DATABASE_PATH=/data/lab.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node db ./db
COPY --chown=node:node src/lessons.js ./src/lessons.js
COPY --chown=node:node scripts/check-health.mjs scripts/check-model.mjs ./scripts/
USER node
EXPOSE 13000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD ["node", "scripts/check-health.mjs"]
CMD ["node", "server/index.mjs"]
