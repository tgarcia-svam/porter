#!/bin/sh
set -e

# Admin tasks (schema changes, RLS, views) require table ownership — use admin
# credentials when available, fall back to DATABASE_URL for local dev where
# both point to the same superuser account.
ADMIN_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}"

if [ "$NODE_ENV" = "production" ]; then
  echo "Applying pending migrations..."
  # migrate deploy is non-destructive: it only applies new migration files
  # under prisma/migrations/ in order. Existing data is never touched.
  #
  # To apply a schema change in production:
  #   1. Edit prisma/schema.prisma locally.
  #   2. Generate a migration:  npx prisma migrate dev --name <change>
  #   3. Commit prisma/migrations/<timestamp>_<change>/ and deploy.
  #
  # If migrate deploy finds no pending migrations, this is a no-op.
  DATABASE_URL="$ADMIN_URL" npx prisma migrate deploy
else
  echo "Syncing dev schema..."
  # No --accept-data-loss: db push refuses destructive changes, protecting
  # against accidental column/table drops during local iteration.
  DATABASE_URL="$ADMIN_URL" npx prisma db push
fi

echo "Applying RLS policies (idempotent)..."
DATABASE_URL="$ADMIN_URL" npx tsx prisma/apply-rls.ts

echo "Syncing report views (idempotent)..."
DATABASE_URL="$ADMIN_URL" npx tsx prisma/sync-views.ts

echo "Seeding default users (upsert — idempotent)..."
npx tsx prisma/seed.ts

echo "Starting app..."
exec node server.js
