#!/bin/sh
set -e

# Admin tasks (schema changes, RLS, views) require table ownership — use admin
# credentials when available, fall back to DATABASE_URL for local dev where
# both point to the same superuser account.
ADMIN_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}"

if [ "$NODE_ENV" = "production" ]; then
  echo "Running database migrations..."
  # migrate deploy applies pending migrations in order and never drops data.
  # db push is intentionally not used in production — it can drop columns/tables.
  DATABASE_URL="$ADMIN_URL" npx prisma migrate deploy
else
  echo "Pushing database schema (dev only)..."
  DATABASE_URL="$ADMIN_URL" npx prisma db push
fi

echo "Applying RLS policies..."
DATABASE_URL="$ADMIN_URL" npx tsx prisma/apply-rls.ts

echo "Syncing report views..."
DATABASE_URL="$ADMIN_URL" npx tsx prisma/sync-views.ts

echo "Seeding default users..."
npx tsx prisma/seed.ts

echo "Starting app..."
exec node server.js
