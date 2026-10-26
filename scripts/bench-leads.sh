#!/usr/bin/env bash
# Lead List performance benchmark (Phase 2 "done when": list query < 300 ms at 50k leads).
#
#   pnpm bench:leads            seed 50,000 fake leads if needed, then time the queries
#   pnpm bench:leads --cleanup  remove the fake leads
#
# LOCAL DATABASES ONLY. Uses DATABASE_URL or the local Supabase default.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "Refusing to run against a non-local database: $DB" >&2; exit 1 ;;
esac
N="${BENCH_LEADS:-50000}"
RUNS="${BENCH_RUNS:-5}"

if [[ "${1:-}" == "--cleanup" ]]; then
  psql "$DB" -q -v ON_ERROR_STOP=1 -c "delete from public.activity where subject_type = 'lead' and subject_id in (select id::text from public.leads where utm_campaign = 'bench-50k');" \
    -c "delete from public.leads where utm_campaign = 'bench-50k';" -c "analyze public.leads;"
  echo "Removed benchmark leads."
  exit 0
fi

have=$(psql "$DB" -At -c "select count(*) from public.leads where utm_campaign = 'bench-50k'")
if (( have < N )); then
  echo "Seeding $((N - have)) benchmark leads (triggers included; takes a minute)…"
  psql "$DB" -q -v n="$((N - have))" -f scripts/bench/seed-leads.sql >/dev/null
fi
total=$(psql "$DB" -At -c "select count(*) from public.leads where deleted_at is null")
echo "Leads in database: $total"

owner=$(psql "$DB" -At -c "select p.id from public.profiles p join public.role_templates t on t.id = p.role_template_id where t.key = 'owner' and p.is_active order by p.created_at limit 1")
est=$(psql "$DB" -At -c "select p.id from public.profiles p join public.role_templates t on t.id = p.role_template_id where t.key = 'estimator' and p.is_active order by p.created_at limit 1")
[[ -n "$owner" ]] || { echo "No active owner profile found (run the E2E setup or pnpm seed:owners)." >&2; exit 1; }

run_as() {
  local label="$1" uid="$2"
  local tmp; tmp=$(mktemp)
  for _ in $(seq 1 "$RUNS"); do
    psql "$DB" -q -v uid="$uid" -f scripts/bench/list-queries.sql >>"$tmp"
  done
  python3 - "$label" "$tmp" "$RUNS" <<'PY'
import json, sys, statistics
label, path, runs = sys.argv[1], sys.argv[2], int(sys.argv[3])
times, cur, buf = {}, None, []
def flush():
    if cur and buf and not cur.startswith("_"):
        plan = json.loads("".join(buf))
        times.setdefault(cur, []).append(plan[0]["Execution Time"] + plan[0]["Planning Time"])
for line in open(path):
    line = line.rstrip("\n")
    if line.startswith("### "):
        flush(); cur, buf = line[4:], []
    elif line.strip():
        buf.append(line)
flush()
print(f"\n{label} (median of {runs} runs, planning + execution, ms)")
print("| query | median | max |")
print("|---|---:|---:|")
for k, v in times.items():
    print(f"| {k} | {statistics.median(v):.1f} | {max(v):.1f} |")
PY
  rm -f "$tmp"
}

run_as "Owner (scope: all)" "$owner"
[[ -n "$est" ]] && run_as "Estimator (scope: own)" "$est"
