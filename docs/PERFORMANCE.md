# Performance

## Lead List at 50,000 leads _(Phase 2)_

**Target (SPEC Phase 2 "done when"):** the Lead List handles 50k leads with a server query under 300 ms.

**How to reproduce** (local database only; the script refuses anything else):

```bash
pnpm bench:leads            # seeds 50,000 obviously fake leads (tagged bench-50k) if needed, then times the queries
pnpm bench:leads --cleanup  # removes them
```

Each query runs as a signed-in user under row security, exactly as the app sends it (`EXPLAIN ANALYZE`, planning + execution, median of 5 runs). Machine: the 4-core build container, local Supabase in Docker, 26 October 2026.

| Query                                                               | Owner, before | Owner, after | Estimator (own scope), after |
| ------------------------------------------------------------------- | ------------: | -----------: | ---------------------------: |
| Active tab, page 1 (25 rows)                                        |        147 ms |     **4 ms** |                         8 ms |
| Active tab, exact count                                             |        127 ms |     **9 ms** |                        10 ms |
| Search "smith", page 1                                              |        175 ms |    **63 ms** |                        35 ms |
| Search "smith", count                                               |        172 ms |    **55 ms** |                        31 ms |
| Phone search (7 digits)                                             |        207 ms |    **39 ms** |                        25 ms |
| Hot chip                                                            |         38 ms |     **1 ms** |                         3 ms |
| Advanced filter (score > 70, last 90 days, sorted by last activity) |         15 ms |     **6 ms** |                         7 ms |
| Page 200 (row 5,000)                                                |        131 ms |    **10 ms** |                        11 ms |
| Tab counts (`lead_status_counts`)                                   |        759 ms |    **18 ms** |                        18 ms |
| Lead Dashboard (`lead_stats`)                                       |        466 ms |   **141 ms** |                        95 ms |
| Universal search (`search_records`)                                 |        228 ms |    **50 ms** |                        32 ms |

**Result: every list query is under 300 ms**, most under 20 ms. A list page runs the page, the count and the tab counts in parallel, so the slowest of the three is what matters (≈ 65 ms worst case, while searching).

**What changed** (migration `20261026001000_lead_list_performance`, see DECISIONS):

1. Indexes that match the list's sort (`created_at desc nulls last, id`) and include the columns row security reads.
2. Row-security policies spell out the scope rule instead of calling `app.scope_match()`, which Postgres couldn't inline and so ran once per row.
3. Tab counts read the current user once instead of per row.
4. Dashboard stats aggregate in a few passes instead of about 15 scans.

Production note: these numbers assume autovacuum keeps the visibility map current (Supabase does this by default), which lets counts use index-only scans.
