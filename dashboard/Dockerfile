# --- deps: build tools only needed if better-sqlite3 has no prebuilt binary
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- build: Next standalone output (next/font fetches Google Fonts at build time: needs network)
FROM deps AS build
COPY . .
RUN npm run build

# --- runtime: no compilers
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Runs as root on purpose: the dashboard writes the target into the monitor's SQLite file,
# which the monitor (root) created; a non-root user could not write it on a Linux host.
EXPOSE 3000
CMD ["node", "server.js"]
