#!/usr/bin/env bash
# Shared read-only measurement helpers. Source, don't execute.
set -euo pipefail
SSH_HOST="${SSH_HOST:-proxmox}"

node_mem() {
  ssh "$SSH_HOST" 'echo "[loadavg] $(cat /proc/loadavg)"; free -h; echo "[swap]"; swapon --show; echo "[vmstat 1 3]"; vmstat 1 3'
}
lxc_stats() {
  ssh "$SSH_HOST" 'pct exec 103 -- docker stats --no-stream --format "{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.Name}}" | sort -k2 -h -r | head -20'
}
pg_health() { # $1 = prod|staging  -> container name
  local c; [ "$1" = prod ] && c=twenty-postgres || c=twenty-staging-postgres
  ssh "$SSH_HOST" "pct exec 103 -- docker exec $c psql -U postgres -tAc \"SELECT 'cache_hit_ratio', round(sum(blks_hit)*100.0/nullif(sum(blks_hit+blks_read),0),2) FROM pg_stat_database;\" ;
    pct exec 103 -- docker exec $c psql -U postgres -tAc \"SHOW shared_buffers;\" ;
    pct exec 103 -- docker exec $c psql -U postgres -tAc \"SHOW random_page_cost;\""
}
frontend_timing() { # $1 = base URL
  local u="$1"
  echo "[html] $(curl -s -o /dev/null --compressed -D - "$u/" -w 'http=%{http_version} ttfb=%{time_starttransfer}s total=%{time_total}s' | tr -d '\r' | egrep -i '^(http|cache-control|content-encoding)|^http=' | tr '\n' ' ')"
  local asset
  asset=$(curl -s "$u/" | grep -oE '/assets/index-[^"]+\.js' | head -1)
  if [ -n "$asset" ]; then
    echo "[main-js $asset] $(curl -s -o /dev/null --compressed -D - "$u$asset" -w 'size=%{size_download} total=%{time_total}s' | tr -d '\r' | egrep -i '^(cache-control|content-encoding)|size=' | tr '\n' ' ')"
  fi
}
