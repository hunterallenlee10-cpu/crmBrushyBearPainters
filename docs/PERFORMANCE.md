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

## Lighthouse on a local production build _(Phase 10)_

**Target (SPEC Phase 10):** Performance, Accessibility and Best Practices ≥ 90 on login, home, lead list, job detail and the proposal page.

**How measured:** `pnpm build && pnpm start` against the local Supabase stack loaded with demo data (`DEMO_DATA=true pnpm seed:demo`: 300 leads, 120 jobs), Lighthouse 12.6 with headless Chromium, one page at a time, signed in as the owner (session cookie passed as a header) except login and the proposal page. Desktop = Lighthouse's desktop preset; Mobile = its default phone emulation (Moto G-class CPU ×4 slowdown, slow 4G). Machine: the 4-core build container, 27 October 2026.

| Page                     | Desktop: Perf / A11y / BP | LCP   | Mobile: Perf / A11y / BP | LCP   | CLS (mobile) |
| ------------------------ | ------------------------- | ----- | ------------------------ | ----- | ------------ |
| `/login`                 | **100 / 100 / 100**       | 0.7 s | 92 / 100 / 100           | 2.7 s | 0.000        |
| `/` (Executive Overview) | **99 / 100 / 100**        | 0.8 s | 79 / 100 / 100           | 3.0 s | 0.000        |
| `/leads/list`            | **100 / 100 / 100**       | 0.8 s | 87 / 100 / 100           | 3.4 s | 0.000        |
| `/jobs/[id]`             | **99 / 100 / 100**        | 0.8 s | 90 / 100 / 100           | 2.7 s | 0.003        |
| `/p/[token]` (proposal)  | **99 / 100 / 100**        | 0.8 s | 87 / 100 / 100           | 2.7 s | 0.000        |

**Result:** every page meets ≥ 90 on all three categories on desktop, and Accessibility and Best Practices are 100 everywhere on mobile too. Under the mobile throttling, Performance is 90+ on login and job detail and 79–87 on the Executive Overview, Lead List and proposal page (React hydration of a large page on a 4×-slowed CPU: total blocking time 180–590 ms). Mobile scores move ±5 between runs.

**What changed in Phase 10:**

1. **Fonts through `next/font`** (`app/fonts.ts`, self-hosted from the @fontsource files): preloaded, with a metric-matched fallback, so text no longer reflows when the web font arrives. Job detail on mobile: CLS 0.36 → 0.003, Performance 60–65 → 90.
2. **The offline sync line keeps its height** before the queue loads (no jump under the job header).
3. **zod runs "jitless" in the browser**: its `new Function("")` probe tripped the Content-Security-Policy (logged as a browser issue, Best Practices 96 → 100).

**Known gap (mobile):** the Executive Overview hydrates a dozen charts at once. Lazy-loading the charts below the fold (with fixed-height placeholders) is the next step if the owners use it on phones; owners mostly use it on desktop, where it scores 99.
