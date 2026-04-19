#!/bin/sh
set -e

# Admin tasks (schema changes, RLS, views) require table ownership — use admin
# credentials when available, fall back to DATABASE_URL for local dev where
# both point to the same superuser account.
ADMIN_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}"

echo "Pushing database schema..."
DATABASE_URL="$ADMIN_URL" npx prisma db push

echo "Applying RLS policies..."
DATABASE_URL="$ADMIN_URL" npx tsx prisma/apply-rls.ts

echo "Syncing report views..."
DATABASE_URL="$ADMIN_URL" npx tsx prisma/sync-views.ts

echo "Seeding default users..."
npx tsx prisma/seed.ts

echo "Starting app..."
exec node server.js
