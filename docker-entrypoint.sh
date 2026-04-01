#!/bin/sh
set -e

echo "Pushing database schema..."
npx prisma db push

echo "Applying AuditLog immutability policy..."
npx tsx prisma/apply-rls.ts

echo "Seeding default users..."
npx tsx prisma/seed.ts

echo "Starting app..."
exec node server.js
