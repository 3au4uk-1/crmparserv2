#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; source "$DIR/lib/measure.sh"
ENV="${1:-prod}"
PROD_URL="https://twenty.dosugmayak.ru"
STAGING_URL="https://twenty-staging.dosugmayak.ru"
[ "$ENV" = prod ] && URL="$PROD_URL" || URL="$STAGING_URL"
echo "=== BASELINE $ENV @ $(date -u +%FT%TZ) ==="
echo "--- NODE ---";     node_mem
echo "--- LXC103 (top mem) ---"; lxc_stats
echo "--- PG ($ENV) ---"; pg_health "$ENV"
echo "--- FRONTEND ($URL) ---"; frontend_timing "$URL"
