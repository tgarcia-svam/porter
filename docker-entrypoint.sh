#!/bin/sh
set -e

echo "Pushing database schema..."
npx prisma db push

echo "Applying AuditLog immutability policy..."
npx tsx prisma/apply-rls.ts

echo "Syncing report views..."
npx tsx prisma/sync-views.ts

echo "Seeding default users..."
npx tsx prisma/seed.ts

echo "Starting app..."
exec node server.js
