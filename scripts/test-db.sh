#!/usr/bin/env bash
# Runs SQL/RLS tests in supabase/tests/*.test.sql.
#
#   DATABASE_URL set   → run against that database (CI: the real `supabase start`
#                        stack, where migrations + seed are already applied).
#   DATABASE_URL unset → boot a throwaway Postgres, apply the Supabase shim,
#                        migrations and seed, run the tests, then shut it down.
#                        (For machines without Docker; see docs/DECISIONS.md.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_DIR="$ROOT/supabase/tests"
PSQL_OPTS=(-X -q -v ON_ERROR_STOP=1)

run_sql() { psql "${PSQL_OPTS[@]}" "$URL" -f "$1"; }

cleanup() {
  if [[ -n "${PGDATA_DIR:-}" && -d "${PGDATA_DIR}" ]]; then
    as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK_DIR"
  fi
}

as_pg() {
  # initdb/postgres refuse to run as root; drop to the postgres user when needed.
  if [[ "$(id -u)" == "0" ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  URL="$DATABASE_URL"
  echo "▸ Using DATABASE_URL (migrations assumed applied)"
else
  PG_BIN="$(pg_config --bindir 2>/dev/null || true)"
  if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  fi
  [[ -x "$PG_BIN/initdb" ]] || { echo "Postgres binaries not found. Install Postgres 15+ or set DATABASE_URL." >&2; exit 1; }

  PORT="${DB_TEST_PORT:-54329}"
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bb-db-test.XXXXXX")"
  PGDATA_DIR="$WORK_DIR/data"
  chmod 755 "$WORK_DIR"
  [[ "$(id -u)" == "0" ]] && chown postgres "$WORK_DIR"
  trap cleanup EXIT

  echo "▸ Booting throwaway Postgres ($("$PG_BIN/postgres" --version)) on port $PORT"
  as_pg "$PG_BIN/initdb" -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
  as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -l "$WORK_DIR/postgres.log" -w \
    -o "-p $PORT -k $WORK_DIR -c listen_addresses='' -c fsync=off" start >/dev/null
  URL="postgresql://postgres@/postgres?host=$WORK_DIR&port=$PORT"

  echo "▸ Applying Supabase shim, migrations and seed"
  run_sql "$TESTS_DIR/shim/supabase_shim.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    run_sql "$f"
  done
  run_sql "$ROOT/supabase/seed.sql"
fi

run_sql "$TESTS_DIR/helpers.sql"

shopt -s nullglob
files=("$TESTS_DIR"/*.test.sql)
[[ ${#files[@]} -gt 0 ]] || { echo "No tests found." >&2; exit 1; }

failed=0
for f in "${files[@]}"; do
  name="$(basename "$f")"
  if out="$(psql "${PSQL_OPTS[@]}" "$URL" -f "$f" 2>&1)"; then
    count="$(grep -c 'ok - ' <<<"$out" || true)"
    echo "  ✓ $name ($count assertions)"
  else
    failed=1
    echo "  ✗ $name"
    grep -E 'ok - |FAIL|ERROR' <<<"$out" | sed 's/^/      /'
  fi
done

if [[ $failed -ne 0 ]]; then
  echo "DB tests failed." >&2
  exit 1
fi
echo "▸ All DB tests passed."
