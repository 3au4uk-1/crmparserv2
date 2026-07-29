#!/usr/bin/env bash
# Pure helpers for Dokploy Postgres dump format detection (source from restore-host.sh).

pg_archive_suffix() {
  local key="$1"
  case "$key" in
    *.sql.gz) printf '.sql.gz' ;;
    *.sql.xz) printf '.sql.xz' ;;
    *.sql) printf '.sql' ;;
    *.dump) printf '.dump' ;;
    *.backup) printf '.backup' ;;
    *.gz) printf '.gz' ;;
    *.xz) printf '.xz' ;;
    *) printf '.bin' ;;
  esac
}

needs_decompress() {
  local path="$1"
  case "$path" in
    *.gz|*.xz) return 0 ;;
    *) return 1 ;;
  esac
}

pg_prepared_path() {
  local workdir="$1"
  local archive="$2"
  local key="${3:-}"
  case "$archive" in
    *.sql.gz|*.sql.xz)
      case "$key" in
        twenty_db/*) printf '%s/twenty-pg.decompressed' "$workdir" ;;
        *) printf '%s/twenty-pg.sql' "$workdir" ;;
      esac
      ;;
    *.gz) printf '%s/twenty-pg.decompressed' "$workdir" ;;
    *.xz) printf '%s/twenty-pg.decompressed' "$workdir" ;;
    *) printf '%s' "$archive" ;;
  esac
}

# Exit 0 when psql should be used; 1 for pg_restore.
pg_uses_psql() {
  local key="$1"
  local prepared="${2:-$1}"
  case "$key" in
    twenty_db/*) return 1 ;;
  esac
  case "$prepared" in
    *.sql) return 0 ;;
  esac
  case "$key" in
    *.sql) return 0 ;;
    *.sql.xz) return 0 ;;
  esac
  return 1
}
