#!/usr/bin/env bash
set -euo pipefail
ZVOL="zfs1/swap"; DEV="/dev/zvol/zfs1/swap"; SIZE="8G"; PRIO=100
if [ "${1:-}" = "--rollback" ]; then
  swapoff "$DEV" 2>/dev/null || true
  swapon /dev/mapper/pve-swap 2>/dev/null || true
  sysctl -w vm.swappiness=60
  echo "[rollback] eMMC swap re-enabled; NVMe swap off (zvol left intact; destroy manually if desired)"
  exit 0
fi
# 1) Create a zvol tuned for swap if missing
if ! zfs list "$ZVOL" >/dev/null 2>&1; then
  zfs create -V "$SIZE" -b "$(getconf PAGESIZE)" \
    -o compression=zle -o logbias=throughput -o sync=always \
    -o primarycache=metadata -o secondarycache=none \
    -o com.sun:auto-snapshot=false "$ZVOL"
fi
# 2) Format + enable at high priority (idempotent)
if ! swapon --show=NAME --noheadings | grep -qx "$DEV"; then
  mkswap "$DEV"
  swapon -p "$PRIO" "$DEV"
fi
# 3) Disable slow eMMC swap (kernel migrates pages to remaining swap)
swapoff /dev/mapper/pve-swap || true
# 4) Apply swappiness now + persist
install -m 0644 "$(dirname "$0")/sysctl-perf.conf" /etc/sysctl.d/99-twenty-perf.conf
sysctl --system >/dev/null
swapon --show
sysctl vm.swappiness
