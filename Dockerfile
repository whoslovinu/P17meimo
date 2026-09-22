# P17 H5meimo Demo — multi-stage Next.js production image.
# Build:  docker build -t p17-h5meimo:latest .
# Run:    docker run -p 3000:3000 --env-file .env.local p17-h5meimo:latest
#
# Notes:
#   • Does NOT assume `output: 'standalone'` in next.config.ts (yet).
#   • Runs `next start` from a slim node image.
#   • Healthcheck hits /api/time (cheap, no auth, returns 200 always).

# ════════════════════════════════════════════════════════════════════════════
# Stage 1: deps — install with cache
# ════════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat wget
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# ════════════════════════════════════════════════════════════════════════════
# Stage 2: builder — produce .next/ build artefacts
# ════════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:no-lint

# ════════════════════════════════════════════════════════════════════════════
# Stage 3: runner — minimal runtime, runs `next start`
# ════════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache wget
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Production node_modules (prune devDependencies to save size)
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=builder /app/.next       ./.next
COPY --from=builder /app/public      ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/middleware.ts ./middleware.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/time > /dev/null 2>&1 || exit 1

CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]