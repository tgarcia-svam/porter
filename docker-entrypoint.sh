#!/bin/sh
set -e

echo "Pushing database schema..."
npx prisma db push

echo "Seeding default users..."
npx tsx prisma/seed.ts

echo "Starting app..."
exec node server.js
