#!/bin/sh
# Starts the MAVY NEWS server inside its container (Hostinger VPS, project "mavy-news").
set -e
cd /src/apps/api
echo "== installing server packages"
npm install --no-audit --no-fund --loglevel=error
echo "== building"
npm run build
echo "== updating database"
node dist/db/migrate.js
node dist/db/seed.js
echo "== starting"
exec node dist/main.js
