# Heatmap LOESS Consistency Enforcement — Techniques & Evaluation

## Problem Statement

The growth heatmap computes LOESS-smoothed price trends in **two independent code paths**:

1. **ETL precompute** (`scripts/src/heatmap/h3-precompute.ts`) — Runs offline over all H3 cells, writes `loess_growth`, `loess_start`, `loess_end` into `agg_h3_growth`. Used for heatmap tile coloring and summary values.
2. **Client-side render** (`webapp/src/lib/heatmap-stats.ts:loessAt()`) — Runs on-demand when a user clicks a hex cell, fitting a LOESS curve through yearly medians fetched from the fact table. Used for the detail dialog chart and tooltip values.

Both paths must produce the same result for the same cell. If they diverge, the heatmap color says one thing and the detail panel says another — an immediately visible and trust-destroying inconsistency.

We have already debugged and fixed two such divergences (see `docs/research/heatmap-value-consistency.md`):

- **Year range filtering:** ETL bounded the yearly_medians CTE to `[currentYear - yearsBack, currentYear]`; the client query returned all years. The bandwidth-based kernel already handles cutoff, so the year range filter was removed from the ETL.
- **Type precision:** ETL kept `MEDIAN(price/area)` as a float for $/sqm; the client cast to `BIGINT`. Sub-dollar medians (e.g. 0.025) were treated as zero after cast, corrupting the LOESS fit. Both paths now apply `CAST(MEDIAN(...) AS BIGINT)`.

These bugs were subtle, took hours to diagnose, and will happen again as the codebase evolves — unless we systematically prevent drift. This document catalogues every enforcement technique available, from lightweight documentation to automated CI guardrails, and evaluates each on cost, coverage, and reliability.

---

## Shared Algorithm Specification

For reference, here is the algorithm both paths must implement identically:

**Kernel:** Tricube — `w(d) = (1 - |d/h|³)³` where `d = |year - target_year|` and `h = ⌈yearsBack / 2⌉`

**Regression:** Weighted OLS in log-space on yearly medians

```
y = ln(median_value)
b = (Σw·x·y − Σw·x · Σw·y / Σw) / (Σw·x² − (Σw·x)² / Σw)
a = (Σw·y − b · Σw·x) / Σw
fitted(year) = exp(a + b · year)
```

**Data:** All available yearly medians for the cell (no year range filter). Bandwidth-based kernel weight naturally decays distant years to zero.

**Median type:** `CAST(MEDIAN(price_expr) AS BIGINT)` — both paths must apply this cast before fitting.

**Growth:** `CAGR = (fitted_end / fitted_start) ^ (1 / yearsBack) − 1`

---

## Technique Catalogue

### 1. Canonical Algorithm Recipe

**What:** A standalone, code-free, plain-English specification of the LOESS algorithm — kernel formula, bandwidth rule, regression equations, data filters, type casts, quality gates. A single source of truth that both implementations reference.

**Location:** Could live in `docs/research/` or as a dedicated `specs/` document.

**Cost:** Low — one-time authoring effort, ~1 page.

**Coverage:** All algorithmic parameters: kernel, bandwidth, regression, data range, type casts, quality gates.

**Strengths:**
- Human-readable. New developers (and AI agents) can understand the algorithm without reading SQL or TypeScript.
- Serves as a review checklist when either implementation changes.
- Language-agnostic — useful if a third implementation appears (e.g. Python validation script).

**Weaknesses:**
- Passive — nobody is forced to read it before changing code.
- Can drift from the actual code if not maintained alongside changes.
- No automated enforcement.

**Verdict:** Essential foundation. Every other technique builds on having a clear spec. Do this first.

---

### 2. Cross-Referencing Comments

**What:** Inline comments in both code paths pointing to each other and to the canonical spec. When a developer opens either file, they immediately see that a paired implementation exists and must stay in sync.

**Example — ETL (`h3-precompute.ts`):**
```typescript
// ══════════════════════════════════════════════════════════════════
// LOESS Algorithm — MUST match client-side implementation in:
//   webapp/src/lib/heatmap-stats.ts:loessAt()
// Spec: docs/research/heatmap-consistency-enforcement.md
//
// Kernel:    Tricube  w = (1 - |d/h|^3)^3
// Bandwidth: h = ceil(yearsBack / 2)
// Regression: Weighted OLS in log-space
// Data range: All available yearly medians (no year filter)
// Median type: CAST(MEDIAN(...) AS BIGINT)
// ══════════════════════════════════════════════════════════════════
```

**Example — Client (`heatmap-stats.ts`):**
```typescript
/**
 * LOESS local regression at a single point.
 *
 * MUST match ETL precompute in:
 *   scripts/src/heatmap/h3-precompute.ts (LOESS CTE chain)
 * Spec: docs/research/heatmap-consistency-enforcement.md
 *
 * Kernel:    Tricube  w = (1 - |d/h|^3)^3
 * Bandwidth: h = ceil(yearsBack / 2)
 * Regression: Weighted OLS in log-space
 */
```

**Cost:** Minimal — a few minutes per file. Update when the algorithm changes.

**Coverage:** Alerts developers (and AI agents) that paired code exists. Summarizes key parameters inline.

**Strengths:**
- Zero infrastructure. Works immediately.
- AI agents that read files before editing will see the cross-reference and can be instructed (via CLAUDE.md) to check the paired file.
- Acts as a "STOP — think before changing" signal.

**Weaknesses:**
- Still passive — a developer can ignore the comment.
- Comments can become stale if not updated.
- Doesn't prevent the drift, only warns about the risk.

**Verdict:** High value-to-cost ratio. Implement immediately alongside the spec.

---

### 3. CLAUDE.md Directives

**What:** Add explicit instructions to the project's `CLAUDE.md` file telling AI agents about the paired implementations and requiring them to verify consistency when editing either file.

**Example directive:**
```markdown
### Heatmap LOESS Consistency

The LOESS algorithm is implemented in TWO places that MUST stay in sync:
1. ETL precompute: `scripts/src/heatmap/h3-precompute.ts` (SQL-based)
2. Client-side: `webapp/src/lib/heatmap-stats.ts:loessAt()` (TypeScript)

When modifying either implementation:
- Read both files before making changes
- Verify: same kernel (tricube), same bandwidth (ceil(yearsBack/2)), same regression (weighted OLS in log-space), same data range (all years), same type cast (BIGINT)
- Run golden-value tests: `pnpm test -- heatmap`
- See spec: `docs/research/heatmap-consistency-enforcement.md`
```

**Cost:** Minimal — a few lines in CLAUDE.md.

**Coverage:** All AI-assisted development sessions that touch heatmap code.

**Strengths:**
- Directly addresses the "Memento problem" for AI agents — every new session reads CLAUDE.md.
- Prescriptive: tells the agent exactly what to check and in what order.
- Maintained alongside the codebase (version-controlled).

**Weaknesses:**
- Only effective for AI agents that read CLAUDE.md (Claude Code does; other tools may not).
- Human developers may not read CLAUDE.md.
- Adds to CLAUDE.md length — keep it concise to avoid dilution.

**Verdict:** High value for AI-assisted workflows. Essential complement to comments.

---

### 4. Skills File (`docs/notes/heatmap-loess.md`)

**What:** A dedicated skills file capturing the LOESS implementation pattern, common pitfalls, debugging history, and cross-reference map. AI agents consult skills files before writing code in relevant areas.

**Contents would include:**
- Algorithm specification (kernel, bandwidth, regression)
- File locations and cross-references
- Historical bugs and their root causes (year range, BIGINT cast)
- Testing strategy (golden values, cross-validation)
- "Before you change LOESS" checklist

**Cost:** Low — ~30 minutes to author. Updated when new pitfalls are discovered.

**Coverage:** AI agent sessions. Also useful as a human reference.

**Strengths:**
- More detailed than CLAUDE.md directives — can include full debugging history and rationale.
- Skills files are explicitly referenced in the project's engineering standards.
- Can include worked examples and anti-patterns.

**Weaknesses:**
- Same limitation as CLAUDE.md — only useful if the agent/developer reads it.
- Could duplicate the canonical spec if not carefully scoped.

**Verdict:** Good complement. Scope it to pitfalls, debugging history, and checklists — not algorithm specification (that belongs in the canonical spec).

---

### 5. Shared Types Package

**What:** Create a monorepo `packages/shared` package containing TypeScript types, constants, and pure functions used by both `scripts/` and `webapp/`. Both packages import from `@realvision/shared` instead of defining their own versions.

**What it would contain:**
```typescript
// packages/shared/src/heatmap.ts
export type H3Resolution = 7 | 8 | 9
export type GrowthMetric = 'median-price' | 'price-per-sqm'
export type StrataFilterValue = 'all' | 'freehold' | 'strata'
export type YearsBack = 5 | 10 | 15 | 20 | 25

export function loessBandwidth(yearsBack: YearsBack): number {
  return Math.ceil(yearsBack / 2)
}

export function tricubeWeight(distance: number, bandwidth: number): number {
  if (distance > bandwidth) return 0
  const u = distance / bandwidth
  return (1 - u ** 3) ** 3
}

export const MIN_SALES_THRESHOLD: Record<H3Resolution, number> = {
  7: 7, 8: 4, 9: 2,
}
```

**Cost:** Medium — requires monorepo workspace setup (`pnpm-workspace.yaml`), build pipeline for the shared package, import path updates in both `scripts/` and `webapp/`.

**Coverage:** Types, constants, and pure functions. Does NOT cover SQL fragments (ETL uses SQL, client uses TypeScript).

**Strengths:**
- **Compile-time enforcement**: If a type changes in `shared`, both consumers must update or fail to build.
- Single source of truth for constants like `MIN_SALES_THRESHOLD`, `loessBandwidth()`.
- The `tricubeWeight()` function can be directly used by the client-side `loessAt()` and tested independently.

**Weaknesses:**
- Doesn't enforce the SQL-side implementation (ETL LOESS is pure SQL in a CTE chain).
- Monorepo setup overhead — build ordering, version management, IDE resolution.
- Risk of over-sharing: not everything should be shared. Only genuinely dual-use code belongs here.

**Verdict:** High value if the monorepo is already planned. The bandwidth function, kernel function, and type definitions are clear candidates. Don't force SQL fragments into TypeScript just for sharing.

---

### 6. Shared SQL Fragments

**What:** Extract the WHERE clause conditions, price expressions, and strata filters into a shared module that generates SQL strings. Both ETL and webapp server queries import from the same module.

**Example:**
```typescript
// packages/shared/src/sql-fragments.ts
export function priceExpression(metric: GrowthMetric, prefix: string): string {
  if (metric === 'median-price') return `${prefix}.purchase_price`
  return `${prefix}.purchase_price / (CASE WHEN ${prefix}.area_type = 'H' THEN ${prefix}.area * 10000 ELSE ${prefix}.area END)`
}

export function strataCondition(strata: StrataFilterValue, prefix: string): string {
  switch (strata) {
    case 'freehold': return `AND ${prefix}.strata IS NULL`
    case 'strata': return `AND ${prefix}.strata IS NOT NULL`
    case 'all': return ''
  }
}

export const BASE_SALE_CONDITIONS = (prefix: string) => [
  `${prefix}.purchase_price > 0`,
  `${prefix}.contract_date IS NOT NULL`,
  `${prefix}.is_bulk_sale = FALSE`,
  `${prefix}.is_price_outlier = FALSE`,
]
```

**Cost:** Low if shared types package exists. Medium standalone (needs cross-project imports).

**Coverage:** WHERE clauses, price expressions, strata conditions. These are the exact fragments that diverged in the past.

**Strengths:**
- Eliminates copy-paste divergence for SQL building logic.
- `priceExpression()` and `strataCondition()` are already near-identical between ETL and webapp — easy to extract.
- Changes propagate to both consumers automatically.

**Weaknesses:**
- Only covers SQL-building TypeScript, not the SQL itself (the LOESS CTE chain in ETL is pure SQL).
- Adds a dependency from `scripts/` and `webapp/` to the shared module.
- SQL fragment composition can become hard to debug if over-abstracted.

**Verdict:** High value for the specific fragments that have caused bugs. `priceExpression()` and `strataCondition()` are obvious extractions. Don't try to share entire CTE chains.

---

### 7. Shared Configuration Constants

**What:** Extract all numeric parameters that must match into a single configuration object.

```typescript
// packages/shared/src/loess-config.ts
export const LOESS_CONFIG = {
  bandwidthFormula: (yearsBack: number) => Math.ceil(yearsBack / 2),
  minWeightedPoints: 3,           // Minimum weighted points for valid fit
  logSpaceMax: 30,                // Guard: ln(price) > 30 ≈ $10 trillion
  logSpaceMin: 0,                 // Guard: ln(price) < 0 ≈ < $1
  requiredEndpoints: 2,           // Must have valid fits at both start and end
  medianCast: 'BIGINT' as const,  // Both paths must cast median to this type
} as const
```

**Cost:** Low.

**Coverage:** All magic numbers and threshold values.

**Strengths:**
- A developer changing `minWeightedPoints` in one place changes it everywhere.
- Self-documenting: all tuneable parameters are visible in one object.
- Easy to test: verify that both implementations use these exact values.

**Weaknesses:**
- The ETL path uses these values inside SQL strings — the constant must be interpolated, not directly referenced at runtime.
- Some "constants" are implicit in the SQL (e.g., the `BETWEEN 0 AND 30` guard) and can't be trivially extracted.

**Verdict:** Good hygiene. Extract what's clean to extract. Don't contort SQL to reference a TypeScript constant if it reduces readability.

---

### 8. Golden-Value Tests

**What:** Unit tests that run both the TypeScript `loessAt()` function and a standalone SQL query (or a TypeScript reimplementation of the SQL logic) against the same known inputs, asserting they produce the same output.

**Structure:**
```typescript
// tests/lib/loess-golden.test.ts
const GOLDEN_CASES = [
  {
    name: 'Simple 5-year uptrend',
    yearlyMedians: [
      { year: 2019, median: 500_000 },
      { year: 2020, median: 520_000 },
      { year: 2021, median: 560_000 },
      { year: 2022, median: 600_000 },
      { year: 2023, median: 650_000 },
    ],
    yearsBack: 5,
    targetYear: 2023,
    expectedLoessValue: 648_732,  // Pre-computed reference value
    tolerance: 1,                 // $1 tolerance for BIGINT rounding
  },
  // ... more cases covering edge conditions
]

for (const tc of GOLDEN_CASES) {
  test(`loessAt matches golden value: ${tc.name}`, () => {
    const bandwidth = Math.ceil(tc.yearsBack / 2)
    const data = tc.yearlyMedians.map(m => ({
      x: m.year,
      y: Math.log(m.median),
    }))
    const result = Math.exp(loessAt(data, tc.targetYear, bandwidth))
    expect(result).toBeCloseTo(tc.expectedLoessValue, 0)
  })
}
```

**Cost:** Medium — requires computing golden values carefully (run both paths on a test dataset, verify they agree, then lock down the values).

**Coverage:** Algorithm correctness at the function level. Catches regressions in the TypeScript implementation.

**Strengths:**
- **Deterministic and fast** — pure unit tests, no database required.
- Catches any change to the algorithm (kernel, bandwidth, regression) immediately.
- Golden values serve as executable documentation.

**Weaknesses:**
- Only tests the TypeScript `loessAt()` function. Does NOT test the SQL implementation in the ETL.
- If both implementations are wrong in the same way, golden values won't catch it (but cross-validation will — see #9).
- Need to maintain golden values when the algorithm intentionally changes.

**Verdict:** High value. Fast, cheap, catches most regressions. Essential complement to cross-validation.

---

### 9. Cross-Validation Integration Test

**What:** An integration test that runs both the ETL precompute and the client-side LOESS on the same real data, then compares the results cell-by-cell.

**Structure:**
```typescript
// tests/integration/loess-cross-validation.test.ts
test('ETL LOESS matches client-side LOESS for sampled cells', async () => {
  const conn = await getTestConnection()

  // Pick N random cells from agg_h3_growth where loess_growth IS NOT NULL
  const cells = await conn.query(`
    SELECT h3_cell, resolution, years_back, metric, strata_filter,
           loess_growth, loess_start, loess_end
    FROM agg_h3_growth
    WHERE loess_growth IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 50
  `)

  for (const cell of cells) {
    // Fetch the same yearly medians the client would see
    const yearlyMedians = await queryHexYearlyMedians(conn, {
      h3Index: cell.h3_cell.toString(),
      resolution: cell.resolution,
      metric: cell.metric,
      strataFilter: cell.strata_filter,
    })

    // Run client-side LOESS
    const bandwidth = Math.ceil(cell.years_back / 2)
    const startYear = CURRENT_YEAR - cell.years_back
    const endYear = CURRENT_YEAR
    const data = yearlyMedians.map(m => ({
      x: m.year,
      y: Math.log(m.medianPrice),
    }))

    const clientStart = Math.round(Math.exp(loessAt(data, startYear, bandwidth)))
    const clientEnd = Math.round(Math.exp(loessAt(data, endYear, bandwidth)))

    // Compare — tolerance of $1 for rounding
    expect(clientStart).toBeCloseTo(cell.loess_start, 0)
    expect(clientEnd).toBeCloseTo(cell.loess_end, 0)
  }
})
```

**Cost:** High — requires a populated test database (either a subset fixture or the full database). Slow to run (~seconds to minutes depending on sample size).

**Coverage:** **End-to-end correctness** across the full pipeline: SQL query → yearly medians → LOESS fit → growth calculation.

**Strengths:**
- **The definitive consistency check.** If this passes, the two implementations agree on real data.
- Catches divergences that golden-value tests miss (e.g., differences in the SQL query that fetches yearly medians, not just the LOESS fit).
- Can be sampled for speed (50 random cells) or exhaustive for release validation.

**Weaknesses:**
- Requires a database with real or realistic data — harder to set up in CI.
- Slow compared to unit tests.
- Flaky if the database changes between ETL run and test execution (but the test database should be a snapshot).

**Verdict:** The strongest enforcement technique. Should run before every release and ideally in CI with a fixture database. Worth the setup cost.

---

### 10. Schema-as-Contract

**What:** Treat the `agg_h3_growth` table DDL as a contract document. The column names, types, and comments encode the algorithm: `loess_start BIGINT` documents the type cast, `loess_growth DOUBLE` documents the output format, and SQL comments describe the computation.

**Enhanced DDL example:**
```sql
CREATE TABLE agg_h3_growth (
  ...
  -- LOESS: CAGR from local regression
  -- Formula: (loess_end / loess_start) ^ (1 / years_back) - 1
  -- Kernel: Tricube, bandwidth = ceil(years_back / 2)
  -- Data: All yearly medians, no year range filter
  -- See: docs/research/heatmap-consistency-enforcement.md
  loess_growth DOUBLE,
  loess_start BIGINT,    -- LOESS-fitted price at start year (BIGINT cast)
  loess_end BIGINT,      -- LOESS-fitted price at end year (BIGINT cast)
  ...
);
```

**Cost:** Minimal — add comments to existing DDL.

**Coverage:** Documents the contract between ETL (writer) and webapp (reader). The BIGINT type on `loess_start`/`loess_end` is itself an enforcement mechanism — if the ETL tries to write a float, DuckDB will cast it.

**Strengths:**
- The schema is always read when writing queries against the table.
- DuckDB enforces types at write time — a float value written to a BIGINT column is automatically truncated.
- Comments in DDL are visible via `DESCRIBE` and schema tools.

**Weaknesses:**
- Only enforces types, not algorithm correctness.
- Comments can go stale.
- Doesn't enforce that the client-side code uses the same types.

**Verdict:** Low-cost complement. The BIGINT column type already provides partial enforcement. Add comments to make the contract explicit.

---

### 11. Naming Conventions

**What:** Use consistent, distinctive names across both codebases so that a developer (or `grep`) can find all related code instantly.

**Convention:**
- Function names: `loessAt()` (client), `loess_*` CTE names in ETL
- Column names: `loess_growth`, `loess_start`, `loess_end` (table and query results)
- Config: `loessBandwidth()`, `LOESS_CONFIG`
- Test files: `loess-golden.test.ts`, `loess-cross-validation.test.ts`
- Skill file: `docs/notes/heatmap-loess.md`

**Grep-ability test:** `grep -r "loess" --include="*.ts"` should return every file in both codebases that touches the LOESS algorithm.

**Cost:** Zero incremental cost if adopted from the start. Low cost to rename existing code.

**Coverage:** Discoverability — makes it easy to find all related code.

**Strengths:**
- A developer searching for "loess" finds everything.
- AI agents can be instructed: "Before changing any file matching `loess`, read all files matching `loess`."
- Reduces the chance of accidental divergence by making the paired nature obvious.

**Weaknesses:**
- Doesn't prevent divergence, only makes it discoverable.
- Requires discipline to maintain the convention.

**Verdict:** Zero-cost, high-discoverability technique. Already partially in place — formalize it.

---

### 12. CI Guardrails

**What:** Automated checks in CI that detect potential drift between the two implementations.

**Tier 1 — Static analysis (cheap, fast):**
```yaml
# .github/workflows/loess-guard.yml
- name: Check LOESS sync markers
  run: |
    # Verify both files contain the sync marker comment
    grep -q "MUST match.*heatmap-stats.ts" scripts/src/heatmap/h3-precompute.ts
    grep -q "MUST match.*h3-precompute.ts" webapp/src/lib/heatmap-stats.ts

    # If either LOESS file changed, require the other was also reviewed
    CHANGED=$(git diff --name-only ${{ github.event.before }}..${{ github.sha }})
    ETL_CHANGED=$(echo "$CHANGED" | grep -c "h3-precompute.ts" || true)
    CLIENT_CHANGED=$(echo "$CHANGED" | grep -c "heatmap-stats.ts" || true)
    if [ "$ETL_CHANGED" -gt 0 ] && [ "$CLIENT_CHANGED" -eq 0 ]; then
      echo "::warning::ETL LOESS changed but client-side loessAt() was not updated. Verify consistency."
    fi
    if [ "$CLIENT_CHANGED" -gt 0 ] && [ "$ETL_CHANGED" -eq 0 ]; then
      echo "::warning::Client LOESS changed but ETL precompute was not updated. Verify consistency."
    fi
```

**Tier 2 — Golden-value tests (medium cost):**
```yaml
- name: Run LOESS golden-value tests
  run: pnpm test -- --grep "loess-golden"
```

**Tier 3 — Cross-validation (high cost, release gate):**
```yaml
- name: Run LOESS cross-validation
  run: pnpm test:integration -- --grep "loess-cross-validation"
  # Only on release branches or manual trigger
  if: github.ref == 'refs/heads/release' || github.event_name == 'workflow_dispatch'
```

**Cost:** Tier 1 is trivial. Tier 2 requires golden-value tests (see #8). Tier 3 requires a fixture database in CI (see #9).

**Coverage:**
- Tier 1: Detects when only one file was changed (potential oversight).
- Tier 2: Catches algorithm regressions in the TypeScript implementation.
- Tier 3: Catches end-to-end divergence including SQL and data pipeline changes.

**Strengths:**
- **Automated enforcement** — the only technique that doesn't rely on human discipline.
- Tier 1 is nearly free and catches the most common failure mode (editing one file, forgetting the other).
- Tiers can be adopted incrementally.

**Weaknesses:**
- Tier 1 can produce false positives (e.g., editing a comment in one file).
- Tier 3 requires CI infrastructure for DuckDB with test data.
- CI checks slow down the development loop if not tiered appropriately.

**Verdict:** The strongest automated enforcement. Implement Tier 1 immediately, Tier 2 when golden tests exist, Tier 3 when CI infrastructure supports it.

---

## Recommendation: Layered Defense

No single technique is sufficient. The techniques form a layered defense — each catches failures the others miss:

| Layer | Technique | Catches | Cost | Priority |
|-------|-----------|---------|------|----------|
| **Documentation** | Canonical spec (#1) | Misunderstanding | Low | **Now** |
| **Documentation** | Cross-referencing comments (#2) | Unawareness of paired code | Low | **Now** |
| **Documentation** | CLAUDE.md directives (#3) | AI agent drift | Low | **Now** |
| **Documentation** | Skills file (#4) | Repeated debugging | Low | **Now** |
| **Documentation** | Schema-as-contract (#10) | Type mismatches | Low | **Now** |
| **Convention** | Naming conventions (#11) | Undiscoverable code | Zero | **Now** |
| **Shared code** | Configuration constants (#7) | Magic number divergence | Low | **Soon** |
| **Shared code** | SQL fragments (#6) | WHERE clause divergence | Medium | **Soon** |
| **Shared code** | Types package (#5) | Type definition drift | Medium | **When monorepo planned** |
| **Testing** | Golden-value tests (#8) | Algorithm regression | Medium | **Soon** |
| **Testing** | Cross-validation (#9) | End-to-end divergence | High | **Before release** |
| **Automation** | CI guardrails (#12) | Oversight, regression | Incremental | **Tier 1 now, rest incremental** |

### Implementation Order

**Phase 1 — Immediate (documentation + convention):**
Techniques 1, 2, 3, 4, 10, 11. All low-cost, no infrastructure needed. Addresses the Memento problem directly.

**Phase 2 — Near-term (shared code + unit tests):**
Techniques 7, 6, 8, 12 (Tier 1–2). Requires some refactoring but no new infrastructure. Provides automated regression detection.

**Phase 3 — Release readiness (integration + CI):**
Techniques 5, 9, 12 (Tier 3). Requires monorepo setup and CI database fixtures. Provides the strongest guarantees.

---

## Appendix: Current Implementation Locations

| Concern | ETL Location | Client Location |
|---------|-------------|-----------------|
| LOESS kernel & regression | `scripts/src/heatmap/h3-precompute.ts` lines 329–376 | `webapp/src/lib/heatmap-stats.ts:loessAt()` lines 151–174 |
| Bandwidth formula | `h3-precompute.ts` line 298 | `heatmap-stats.ts` (caller computes `ceil(yearsBack/2)`) |
| Price expression | `h3-precompute.ts` lines 54–60 | `webapp/src/lib/heatmap-queries.ts:priceExpr()` |
| Strata condition | `h3-precompute.ts` lines 41–47 | `webapp/src/lib/heatmap-queries.ts` (via `buildWhereClause`) |
| Yearly medians query | `h3-precompute.ts` lines 300–319 | `webapp/src/lib/heatmap-queries.ts:queryHexYearlyMedians()` |
| Quality gates | `h3-precompute.ts` lines 352, 373, 376, 386 | `heatmap-stats.ts` lines 164, 166 (`sw === 0`, `denom === 0`) |
| Growth calculation | `h3-precompute.ts` line 393 | `webapp/src/features/dashboard/widgets/growth-heatmap/GrowthHeatmap.tsx` (inline) |
| Type definitions | `scripts/src/heatmap/types.ts` | `webapp/src/features/dashboard/widgets/growth-heatmap/types.ts` |
| Table schema | `scripts/src/heatmap/schema.ts` | N/A (consumed via queries) |
| Min sales thresholds | `scripts/src/heatmap/types.ts` lines 63–67 | N/A (ETL-only, but affects which cells have data) |

## Appendix: Historical Bugs

| Bug | Root Cause | Detection Method | Would Have Been Caught By |
|-----|-----------|-----------------|--------------------------|
| Year range filtering | ETL bounded yearly_medians to `[start, end]`; client returned all years | Manual comparison of tooltip vs heatmap values | Cross-validation (#9), shared SQL fragments (#6) |
| BIGINT cast on $/sqm | ETL kept float median; client cast to BIGINT. Sub-$1 medians → 0 | Manual debugging after incorrect growth values | Golden-value tests (#8), shared config (#7), schema-as-contract (#10) |
