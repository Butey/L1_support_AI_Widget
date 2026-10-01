# Multi-stage build for production
FROM node:20-slim AS builder

WORKDIR /app

# Set memory limit for the build process to prevent OOM on small VPS
ENV NODE_OPTIONS="--max-old-space-size=512"

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (npm install is used instead of ci to handle out-of-sync lockfile)
RUN npm install --no-audit --no-fund

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove devDependencies before copying to the final image to save space
RUN npm prune --omit=dev --no-audit --no-fund && npm cache clean --force

# Final production image
FROM node:20-slim

WORKDIR /app

# Copy package info and production node_modules from builder
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Create storage directory for settings persistence
RUN mkdir -p /app/storage && chown -R node:node /app/storage

# Default port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Intentionally NOT setting `USER node` here. `./storage` is bind-mounted
# from the host (see docker-compose.yml); on a fresh VPS deploy Docker
# auto-creates that host folder owned by root, which shadows the `chown`
# above the moment the volume is attached. If we started as `node`
# unconditionally, the app could never write settings.json/kb.json to a
# root-owned mount (previously a silent failure - see server.ts). Instead,
# server.ts itself detects at startup whether it's running as root, fixes
# /app/storage ownership if so, and immediately drops to the unprivileged
# `node` user before serving any requests - covering both a fresh bind
# mount and an image where /app/storage is already owned correctly.
CMD ["node", "dist/server.cjs"]
