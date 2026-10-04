#!/bin/sh
set -eu

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "POSTGRES_PASSWORD is missing in the container environment" >&2
  exit 1
fi

# Use the unique container name so this never resolves to another project's
# postgres service on the shared Nginx Docker network.
export DATABASE_URL="postgresql://migrants:${POSTGRES_PASSWORD}@migrants-postgres:5432/migrants?schema=public"
export REDIS_HOST="${REDIS_HOST:-migrants-redis}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export PORT="${PORT:-3000}"

npx prisma migrate deploy
exec node dist/main.js
