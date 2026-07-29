#!/usr/bin/env bash
# Unit-style checks for pg-restore-format.sh (no docker required).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/pg-restore-format.sh
source "${SCRIPT_DIR}/../lib/pg-restore-format.sh"

assert_eq() {
  local got="$1" want="$2" label="$3"
  if [ "$got" != "$want" ]; then
    echo "FAIL ${label}: got '${got}', want '${want}'" >&2
    exit 1
  fi
}

assert_psql() {
  local key="$1" prepared="${2:-}"
  if ! pg_uses_psql "$key" ${prepared:+"$prepared"}; then
    echo "FAIL expected psql for key=${key} prepared=${prepared:-<key>}" >&2
    exit 1
  fi
}

assert_pg_restore() {
  local key="$1" prepared="${2:-}"
  if pg_uses_psql "$key" ${prepared:+"$prepared"}; then
    echo "FAIL expected pg_restore for key=${key} prepared=${prepared:-<key>}" >&2
    exit 1
  fi
}

assert_eq "$(pg_archive_suffix 'twenty-pg/20260729T020000Z.sql.gz')" '.sql.gz' 'suffix sql.gz'
assert_eq "$(pg_archive_suffix 'twenty-pg/dump.custom')" '.bin' 'suffix unknown'

assert_psql 'twenty-pg/foo.sql'
assert_psql 'twenty-pg/foo.sql.xz'
assert_psql 'twenty-pg/foo.sql.gz' '/tmp/twenty-pg.sql'

assert_pg_restore 'twenty_db/twenty-pg/foo.sql.gz'
assert_pg_restore 'twenty_db/twenty-pg/foo.sql.gz' '/tmp/twenty-pg.decompressed'
assert_pg_restore 'twenty-pg/foo.dump'
assert_pg_restore 'twenty-pg/foo.backup'
assert_pg_restore 'twenty-pg/foo.custom' '/tmp/twenty-pg.decompressed'

needs_decompress '/tmp/twenty-pg.sql.gz' || { echo 'FAIL needs_decompress .sql.gz'; exit 1; }
needs_decompress '/tmp/twenty-pg.sql' && { echo 'FAIL needs_decompress plain .sql'; exit 1; }

assert_eq "$(pg_prepared_path '/tmp/restore' '/tmp/restore/twenty-pg.sql.gz')" '/tmp/restore/twenty-pg.sql' 'prepared sql.gz'
assert_eq "$(pg_prepared_path '/tmp/restore' '/tmp/restore/twenty-pg.sql.gz' 'twenty_db/twenty-pg/foo.sql.gz')" '/tmp/restore/twenty-pg.decompressed' 'prepared dokploy sql.gz'

echo 'pg-restore-format.test.sh: ok'
