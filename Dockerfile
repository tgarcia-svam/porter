# ── Stage 1: install dependencies ────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: build ────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# Dummy build-time env vars so Next.js static analysis doesn't fail
ARG DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ARG NEXTAUTH_SECRET=build-time-secret
ARG NEXTAUTH_URL=http://localhost:3000
ENV DATABASE_URL=$DATABASE_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV NEXTAUTH_URL=$NEXTAUTH_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (no DB connection needed at build time)
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate

RUN mkdir -p /app/public && npm run build

# ── Stage 3: production runner ────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy standalone output and static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static   ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

# Copy full node_modules for prisma CLI + tsx (needed to run seed at startup)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma

# Entrypoint: push schema + seed, then start app
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
