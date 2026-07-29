#!/usr/bin/env bash
# restore-host.sh — restore a prod snapshot into staging or prod data volumes.
# Never modifies env files or compose environment; data volumes + Postgres only.
set -euo pipefail

TARGET=""
SNAPSHOT_ID=""
MANIFEST=""
DRY_RUN=false
SKIP_HTTP_HEALTH=false
WORKDIR=""

MC_ALIAS="${MINIO_MC_ALIAS:-minio-home}"
MINIO_BUCKET="${MINIO_BUCKET:-dokploy}"

TWENTY_PROJECT=""
CRMPARSER_PROJECT=""
TWENTY_FILES_VOLUME=""
CRMPARSER_VOLUME=""
PG_VOLUME=""
PG_DB="${PG_DB:-default}"
PG_USER="${PG_USER:-postgres}"

SERVICES_STOPPED=false
RESTORE_SUCCEEDED=false

usage() {
  cat <<'EOF'
Usage: restore-host.sh --target staging|prod --snapshot-id ID --manifest PATH [--dry-run] [--workdir DIR] [--skip-http-health]

Restores twentyPg + twentyFiles + crmparserSqlite from a capture manifest into the
target stack. Stops twenty + crmparser compose projects, restores data, then starts
services only when all restore steps succeed (fail-closed).

Environment (optional):
  MINIO_MC_ALIAS   mc alias (default: minio-home)
  MINIO_BUCKET     MinIO bucket (default: dokploy)
  PG_DB            Postgres database name (default: default)
  PG_USER          Postgres user (default: postgres)

Never rewrites env files or Dokploy compose environment.
EOF
}

log() { printf '[restore] %s\n' "$*" >&2; }
run() {
  if $DRY_RUN; then
    printf '[dry-run] %s\n' "$*"
  else
    log "exec: $*"
    "$@"
  fi
}

die() {
  log "ERROR: $*"
  exit 1
}

on_err() {
  local code=$?
  if ! $DRY_RUN && [ "$RESTORE_SUCCEEDED" != true ]; then
    log "Restore failed (exit ${code}). Services remain stopped — fix and re-run with the same snapshot id."
  fi
  exit "$code"
}
trap on_err ERR

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --target)
        TARGET="${2:-}"; shift 2 ;;
      --snapshot-id)
        SNAPSHOT_ID="${2:-}"; shift 2 ;;
      --manifest)
        MANIFEST="${2:-}"; shift 2 ;;
      --workdir)
        WORKDIR="${2:-}"; shift 2 ;;
      --dry-run)
        DRY_RUN=true; shift ;;
      --skip-http-health)
        SKIP_HTTP_HEALTH=true; shift ;;
      -h|--help)
        usage; exit 0 ;;
      *)
        die "Unknown argument: $1" ;;
    esac
  done

  [ -n "$TARGET" ] || die "--target staging|prod is required"
  [ -n "$SNAPSHOT_ID" ] || die "--snapshot-id is required"
  [ -n "$MANIFEST" ] || die "--manifest is required"
  [ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

  case "$TARGET" in
    staging|prod) ;;
    *) die "--target must be staging or prod" ;;
  esac

  if [ -z "$WORKDIR" ]; then
    WORKDIR="/tmp/restore-${SNAPSHOT_ID}-$$"
  fi
}

resolve_target() {
  case "$TARGET" in
    staging)
      TWENTY_PROJECT="twenty-staging"
      CRMPARSER_PROJECT="crmparser-staging"
      TWENTY_FILES_VOLUME="twenty-staging_server-local-data"
      CRMPARSER_VOLUME="crmparser-staging_crmparser-data"
      PG_VOLUME="twenty-staging_db-data"
      ;;
    prod)
      TWENTY_PROJECT="twenty"
      CRMPARSER_PROJECT="crmparser"
      TWENTY_FILES_VOLUME="twenty_server-local-data"
      CRMPARSER_VOLUME="crmparser_crmparser-data"
      PG_VOLUME="twenty_db-data"
      ;;
  esac
  log "target=${TARGET} twenty_project=${TWENTY_PROJECT} crmparser_project=${CRMPARSER_PROJECT}"
  log "volumes: pg=${PG_VOLUME} files=${TWENTY_FILES_VOLUME} crmparser=${CRMPARSER_VOLUME}"
}

read_manifest_component() {
  local component="$1"
  node -e "
    const fs = require('node:fs');
    const m = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const c = m.components?.[process.argv[2]];
    if (!c?.key) process.exit(2);
    process.stdout.write(String(c.key));
  " "$MANIFEST" "$component"
}

validate_manifest() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if command -v node >/dev/null 2>&1 && [ -f "${script_dir}/lib/manifest.js" ]; then
    if ! (cd "$script_dir" && node --input-type=module -e "
      import { readFileSync } from 'node:fs';
      import { assertManifest } from './lib/manifest.js';
      assertManifest(JSON.parse(readFileSync(process.argv[1], 'utf8')));
    " "$MANIFEST"); then
      die "manifest validation failed"
    fi
    log "manifest validated"
    return 0
  fi
  log "manifest shape check skipped (node/lib unavailable); proceeding with component keys"
}

minio_object_path() {
  local key="$1"
  printf '%s/%s' "${MC_ALIAS}/${MINIO_BUCKET}" "${key}"
}

download_component() {
  local key="$1"
  local dest="$2"
  local src
  src="$(minio_object_path "$key")"
  if $DRY_RUN; then
    printf '[dry-run] mc cp %q %q\n' "$src" "$dest"
    return 0
  fi
  log "download ${src} -> ${dest}"
  mc cp "$src" "$dest"
}

project_containers() {
  local project="$1"
  docker ps -aq --filter "label=com.docker.compose.project=${project}" 2>/dev/null || true
}

stop_target_services() {
  local ids twenty_ids crmparser_ids
  twenty_ids="$(project_containers "$TWENTY_PROJECT")"
  crmparser_ids="$(project_containers "$CRMPARSER_PROJECT")"
  ids="$(printf '%s\n%s\n' "$twenty_ids" "$crmparser_ids" | sed '/^$/d' | sort -u)"
  if [ -z "$ids" ]; then
    log "no running containers for ${TWENTY_PROJECT} / ${CRMPARSER_PROJECT} (may already be stopped)"
    SERVICES_STOPPED=true
    return 0
  fi
  # shellcheck disable=SC2086
  run docker stop $ids
  SERVICES_STOPPED=true
}

find_db_container() {
  local id
  id="$(docker ps -aq \
    --filter "label=com.docker.compose.project=${TWENTY_PROJECT}" \
    --filter "label=com.docker.compose.service=db" | head -n1)"
  if [ -n "$id" ]; then
    printf '%s' "$id"
    return 0
  fi
  id="$(docker ps -aq --filter "name=^${TWENTY_PROJECT}-db" | head -n1)"
  [ -n "$id" ] || die "db container not found for project ${TWENTY_PROJECT}"
  printf '%s' "$id"
}

start_db_container() {
  local db_id
  db_id="$(find_db_container)"
  run docker start "$db_id"
  if $DRY_RUN; then
    printf '[dry-run] wait pg_isready in %s\n' "$db_id"
    return 0
  fi
  local i
  for i in $(seq 1 60); do
    if docker exec "$db_id" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
      log "postgres ready (${db_id})"
      return 0
    fi
    sleep 2
  done
  die "postgres did not become ready in db container ${db_id}"
}

decompress_if_needed() {
  local src="$1"
  local out="${2:-}"
  if ! needs_decompress "$src"; then
    printf '%s' "$src"
    return 0
  fi
  if [ -z "$out" ]; then
    case "$src" in
      *.gz) out="${src%.gz}" ;;
      *.xz) out="${src%.xz}" ;;
    esac
  fi
  case "$src" in
    *.gz)
      if $DRY_RUN; then printf '[dry-run] gunzip -c %q > %q\n' "$src" "$out"; printf '%s' "$out"; return 0; fi
      gunzip -c "$src" > "$out"
      ;;
    *.xz)
      if $DRY_RUN; then printf '[dry-run] xz -dc %q > %q\n' "$src" "$out"; printf '%s' "$out"; return 0; fi
      xz -dc "$src" > "$out"
      ;;
  esac
  printf '%s' "$out"
}

restore_postgres() {
  local pg_key="$1"
  local suffix archive prepared prepared_out db_id
  suffix="$(pg_archive_suffix "$pg_key")"
  archive="${WORKDIR}/twenty-pg${suffix}"
  download_component "$pg_key" "$archive"

  if $DRY_RUN; then
    prepared_out="$(pg_prepared_path "$WORKDIR" "$archive")"
    if needs_decompress "$archive"; then
      printf '[dry-run] decompress %q -> %q\n' "$archive" "$prepared_out"
    fi
    if pg_uses_psql "$pg_key" "$prepared_out"; then
      printf '[dry-run] restore via psql (%s)\n' "$prepared_out"
    else
      printf '[dry-run] restore via pg_restore (%s)\n' "$prepared_out"
    fi
    printf '[dry-run] start db container for project %s\n' "$TWENTY_PROJECT"
    return 0
  fi

  db_id="$(find_db_container)"
  run docker start "$db_id"
  wait_pg() {
    local i
    for i in $(seq 1 60); do
      if docker exec "$db_id" pg_isready -U "$PG_USER" >/dev/null 2>&1; then return 0; fi
      sleep 2
    done
    return 1
  }
  wait_pg || die "postgres not ready before restore"

  prepared_out="$(pg_prepared_path "$WORKDIR" "$archive")"
  prepared="$(decompress_if_needed "$archive" "$prepared_out")"

  log "terminating connections to ${PG_DB}"
  docker exec "$db_id" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PG_DB}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true

  docker exec "$db_id" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"${PG_DB}\";" \
    -c "CREATE DATABASE \"${PG_DB}\";"

  if pg_uses_psql "$pg_key" "$prepared"; then
    log "restore via psql (${prepared})"
    docker exec -i "$db_id" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 < "$prepared"
  else
    log "restore via pg_restore (${prepared})"
    docker cp "$prepared" "${db_id}:/tmp/restore.dump"
    docker exec "$db_id" pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner --no-privileges /tmp/restore.dump
    docker exec "$db_id" rm -f /tmp/restore.dump
  fi

  log "postgres restore complete"
}

restore_volume_from_tar() {
  local archive="$1"
  local volume="$2"
  local label="$3"
  if $DRY_RUN; then
    printf '[dry-run] extract %q into docker volume %q (%s)\n' "$archive" "$volume" "$label"
    return 0
  fi
  log "restore volume ${volume} from ${archive} (${label})"
  docker run --rm \
    -v "${volume}:/target" \
    -v "${WORKDIR}:/backup:ro" \
    alpine:3.20 sh -eu -c '
      archive="$1"
      cd /target
      rm -rf ./* ./.[!.]* ..?* 2>/dev/null || true
      case "$archive" in
        *.tar.gz|*.tgz) tar -xzf "/backup/$(basename "$archive")" -C /target ;;
        *.tar.xz) tar -xJf "/backup/$(basename "$archive")" -C /target ;;
        *.tar) tar -xf "/backup/$(basename "$archive")" -C /target ;;
        *.gz) gzip -dc "/backup/$(basename "$archive")" | tar -xf - -C /target ;;
        *) echo "unsupported archive: $archive" >&2; exit 1 ;;
      esac
    ' sh "$(basename "$archive")"
}

restore_file_volumes() {
  local files_key crmparser_key
  files_key="$(read_manifest_component twentyFiles)"
  crmparser_key="$(read_manifest_component crmparserSqlite)"

  local files_archive="${WORKDIR}/twenty-files$(archive_suffix "$files_key")"
  local crmparser_archive="${WORKDIR}/crmparser-data$(archive_suffix "$crmparser_key")"

  download_component "$files_key" "$files_archive"
  download_component "$crmparser_key" "$crmparser_archive"

  restore_volume_from_tar "$files_archive" "$TWENTY_FILES_VOLUME" "twenty-files"
  restore_volume_from_tar "$crmparser_archive" "$CRMPARSER_VOLUME" "crmparser-sqlite"
}

archive_suffix() {
  local key="$1"
  case "$key" in
    *.tar.gz) printf '.tar.gz' ;;
    *.tar.xz) printf '.tar.xz' ;;
    *.tgz) printf '.tgz' ;;
    *.tar) printf '.tar' ;;
    *.gz) printf '.gz' ;;
    *) printf '.bin' ;;
  esac
}

start_target_services() {
  local ids twenty_ids crmparser_ids
  twenty_ids="$(docker ps -aq --filter "label=com.docker.compose.project=${TWENTY_PROJECT}")"
  crmparser_ids="$(docker ps -aq --filter "label=com.docker.compose.project=${CRMPARSER_PROJECT}")"
  ids="$(printf '%s\n%s\n' "$twenty_ids" "$crmparser_ids" | sed '/^$/d' | sort -u)"
  [ -n "$ids" ] || die "no containers found to start for ${TARGET}"
  # shellcheck disable=SC2086
  run docker start $ids
}

wait_for_health() {
  if $DRY_RUN; then
    printf '[dry-run] wait pg_isready + twenty server health\n'
    return 0
  fi
  start_db_container

  local server_id
  server_id="$(docker ps -q \
    --filter "label=com.docker.compose.project=${TWENTY_PROJECT}" \
    --filter "label=com.docker.compose.service=server" | head -n1)"
  if [ -z "$server_id" ]; then
    if $SKIP_HTTP_HEALTH; then
      log "twenty server container not found; skipping HTTP health check (--skip-http-health)"
      return 0
    fi
    die "twenty server container not found for project ${TWENTY_PROJECT}"
  fi

  local i
  for i in $(seq 1 90); do
    if docker exec "$server_id" sh -c 'wget -q -O- http://127.0.0.1:3000/healthz 2>/dev/null || wget -q -O- http://127.0.0.1:3000/health 2>/dev/null' >/dev/null 2>&1; then
      log "twenty server health check passed"
      return 0
    fi
    sleep 2
  done
  die "twenty server health check failed after restore"
}

main() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=lib/pg-restore-format.sh
  source "${script_dir}/lib/pg-restore-format.sh"

  parse_args "$@"
  resolve_target
  validate_manifest

  local pg_key
  pg_key="$(read_manifest_component twentyPg)"

  log "snapshot=${SNAPSHOT_ID} manifest=${MANIFEST} dry_run=${DRY_RUN} workdir=${WORKDIR}"

  if ! $DRY_RUN; then
    mkdir -p "$WORKDIR"
  else
    printf '[dry-run] mkdir -p %q\n' "$WORKDIR"
  fi

  stop_target_services

  restore_postgres "$pg_key"
  restore_file_volumes

  RESTORE_SUCCEEDED=true
  start_target_services
  wait_for_health

  log "restore complete for target=${TARGET} snapshot=${SNAPSHOT_ID}"
  if ! $DRY_RUN; then
    rm -rf "$WORKDIR"
  fi
}

main "$@"
