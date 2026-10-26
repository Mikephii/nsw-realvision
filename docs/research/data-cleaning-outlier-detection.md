# Data Cleaning & Outlier Detection — Research & Recommendations

## 1. Current Pipeline Audit

### 1.1 End-to-End Data Flow

```
NSWVGData/*.DAT
    ↓
[Parse]  scripts/src/parser/         — Structural parsing, all fields as raw strings
    ↓
[Combine] parser/record-combiner.ts  — Group B/C/D records into sale units
    ↓
[Clean]  scripts/src/cleaner/        — Dates, prices, areas, localities, zones
    ↓
[Load]   scripts/src/db/loader.ts    — Bulk append via staging table, PK dedup
    ↓
[Flag]   scripts/src/db/data-quality.ts — is_bulk_sale, is_price_outlier
    ↓
[Heatmap] scripts/src/heatmap/       — LOESS curves, H3 aggregates
```

### 1.2 What Each Step Does

**Parse** (`scripts/src/parser/`): Reads semicolon-delimited `.DAT` files line by line. All fields are extracted as raw strings. No data validation — failed lines are collected as `ParseWarning` objects and skipped; the file continues parsing. Supports both current format (2001+) and archived format (1990–2001).

**Clean** (`scripts/src/cleaner/`): Transforms raw strings into typed values. Permissive design — preserves raw values in `*_raw` columns when parsing fails on non-empty input:

- `price.ts`: `parsePrice()` — non-numeric or empty → null; accepts $0
- `dates.ts`: `parseCCYYMMDD()` — validates month/day rollover; empty → null
- `locality.ts`: Title-case normalization
- `zones.ts`: Validates against known zone codes; unknown codes preserved
- No outlier detection, no price bounds, no domain-specific filtering

**Load** (`scripts/src/db/loader.ts`): Bulk append via DuckDB Appender API to staging table, then `INSERT OR REPLACE` to `fact_property_sale`. Primary key `(district_code, property_id, dealing_number)` prevents true duplicates.

**Data quality flags** (`scripts/src/db/data-quality.ts`): Two post-load SQL UPDATEs that flag records in-place. Raw data is never deleted:

- `is_bulk_sale`: 385,868 records flagged (6.3% of valid sales). Detection: 2+ properties with identical `(purchase_price, contract_date, district_code)`.
- `is_price_outlier`: 145,991 records flagged (2.2%). Detection: price beyond 3× IQR per `(locality, decade)`, requiring ≥10 sales per group.

### 1.3 Strengths

- **Non-destructive**: Flags, never deletes. Raw data always available for audit.
- **Raw value preservation**: When cleaning fails, the original string is stored in `*_raw` columns for debugging.
- **Conservative thresholds**: 3× IQR catches only extreme values, minimising false positives.

### 1.4 Weaknesses Identified

| Issue                                     | Severity | Detail                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flags not applied to all widgets**      | Critical | Only heatmap queries (`heatmap-queries.ts` lines 418–419) filter by `is_bulk_sale = FALSE AND is_price_outlier = FALSE`. All other widgets (median price line, growth rate, price-per-sqm, property map, relative performance) use `buildWhereClause()` in `queries.ts` which does NOT check these flags. Bulk sales and outliers are silently included in every non-heatmap chart. |
| **No strata misclassification detection** | High     | Community-title apartments classified as freehold distort analysis (see §2).                                                                                                                                                                                                                                                                                                        |
| **Coarse temporal bins**                  | Medium   | Decade boundaries create threshold discontinuities (see §3.1).                                                                                                                                                                                                                                                                                                                      |
| **No spatial context**                    | Medium   | Locality-level IQR doesn't reflect actual price neighborhoods (see §3.1).                                                                                                                                                                                                                                                                                                           |
| **No strata/freehold segmentation**       | Medium   | Combined IQR across houses and apartments inflates acceptable range.                                                                                                                                                                                                                                                                                                                |
| **Non-market contamination**              | Medium   | $1 nominal transfers and partial-interest sales drag Q1 down, widening IQR (see §5).                                                                                                                                                                                                                                                                                                |

---

## 2. Strata Misclassification

### 2.1 The Observation

Properties appearing to sell 3+ times on the same day at similar prices, classified as freehold, with suspiciously small lot areas. Investigation revealed these are **community-title and company-title apartments** misclassified as freehold.

### 2.2 Root Cause

The NSW Valuer General populates the `strata` field only for properties registered under a formal **Strata Plan (SP)**. Properties on:

- **Community title** (registered under Deposited Plan / DP)
- **Company title**
- **Leasehold** arrangements

are functionally apartments/units but have `strata = NULL` because they lack a formal strata plan registration. Their legal descriptions use `Lot/DP` format (e.g. `11/271182`) rather than `SP` references.

### 2.3 Scale of the Problem

| Signal                                                  | Count  | Notes                                                                 |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `strata IS NULL AND unit_number IS NOT NULL`            | 22,623 | High confidence — unit number is a strong indicator of multi-dwelling |
| `strata IS NULL AND area < 150 sqm AND area_type = 'M'` | 44,113 | Broader signal — includes some legitimate small terraces              |
| Of which `nature_of_property = 'R'`                     | 35,885 | Residential, ruling out small commercial lots                         |

The pattern is consistent across all source years (2001–2025) — approximately 800–1,200 freehold-with-unit records per year. This is not an archived format issue.

Cross-referencing: only 863 freehold records contain "SP" in the legal description, and even 89% of correctly-classified strata records lack "SP" in their legal description — the `strata` field is populated from a separate registration system, not by parsing legal description text.

### 2.4 Impact on Analysis

1. **Freehold price-per-sqm distortion**: Apartment internal areas (30–150 sqm) mixed with house lot areas (300–800 sqm) produce misleading $/sqm statistics for the freehold segment.
2. **Artificial clustering**: Multiple units at the same address appear as repeated "house" sales, creating artificial price concentration that skews LOESS curves.
3. **Median distortion**: In suburbs with community-title buildings, the freehold median is pulled toward apartment prices.

### 2.5 Recommended Detection

Two heuristics, ordered by confidence:

**Heuristic A — Unit number present** (high confidence):

```sql
strata IS NULL AND unit_number IS NOT NULL AND unit_number != ''
```

Captures 22,623 records. False positive risk is low — legitimate freehold duplexes with unit numbers are rare and don't systematically distort analysis.

**Heuristic B — Small residential area** (medium confidence):

```sql
strata IS NULL
  AND area > 0 AND area < 150 AND area_type = 'M'
  AND nature_of_property = 'R'
  AND unit_number IS NULL  -- not already caught by Heuristic A
```

Captures additional misclassified records but includes legitimate small inner-city terraces (e.g. Paddington, Surry Hills). These terraces are still residential freehold despite small lot sizes.

**Recommended approach**: New boolean column `is_likely_strata` on `fact_property_sale`. Set to TRUE for records matching Heuristic A. Do not reclassify the source `strata` field (that's source data). Downstream strata/freehold splits use:

```sql
CASE WHEN strata IS NOT NULL OR is_likely_strata THEN 'strata' ELSE 'freehold' END
```

Heuristic B should be investigated further before implementing — running it against known suburbs with community-title buildings and checking false positive rates.

---

## 3. Price Outlier Detection

### 3.1 Why the Current Approach Is Insufficient

The current method computes IQR per `(locality, decade)` using a 3× multiplier. Five problems:

**Problem A — Decade boundary discontinuities**

A sale in December 2009 is compared against 2000–2009 peers, while a sale in January 2010 is compared against 2010–2019 peers. In suburbs where prices doubled between decades, a normal late-decade price can be flagged as an outlier against its decade's lower quartiles, while the identical price in the adjacent decade wouldn't be flagged.

Example: In Manly, the median house price in 2000 was ~$700K and by 2009 was ~$1.4M. A legitimate $1.5M sale in 2009 is compared against a decade where Q3 might be $1.2M — potentially flagged. The same sale in 2010 joins a decade starting at $1.4M — not flagged.

**Problem B — No strata/freehold segmentation**

Houses and apartments in the same suburb have fundamentally different price distributions. In Manly: houses $3M+, units $800K–$1.2M. The combined IQR spans this entire range, making it nearly impossible to detect outliers in either segment. A $5M strata apartment (likely an error) wouldn't be flagged because it falls within the combined house+unit IQR.

This is compounded by the strata misclassification issue (§2) — community-title apartments in the freehold segment further inflate the freehold IQR.

**Problem C — No spatial context**

Administrative suburb boundaries don't reflect actual price neighborhoods. Properties at suburb edges are often more comparable to sales across the boundary than to sales at the suburb's opposite end. Examples:

- Point Piper (median $10M+) borders Rose Bay (median $4M) — a $5M Point Piper sale isn't an outlier, but a locality-only IQR might flag it
- Large suburbs like Penrith contain both established and new-development areas with very different price profiles

Spatial outlier detection using K-nearest neighbors within a geographic radius captures the actual local market better than administrative boundaries.

**Problem D — Non-market contamination**

The IQR computation includes records that distort the baseline:

- **Nominal transfers** ($1 price): 265 records. These drag Q1 toward zero, widening the acceptable range and reducing sensitivity.
- **Partial interest sales** (35,456 records): A 50% interest sale at $400K represents an $800K property. Against $800K neighbors, the $400K price pulls Q1 down.
- **Non-arm's-length sale codes**: Certain undocumented sale codes have extremely low median prices (RV: $98K, RVP: $21K, AVP: $22K), suggesting related-party transfers that aren't market transactions.

All of these should be excluded from the IQR baseline before computing outlier thresholds.

**Problem E — Flags only applied to heatmap**

Even after detection, only heatmap queries filter by `is_price_outlier`. All other widgets include flagged outliers in their aggregations, nullifying the detection work.

### 3.2 Approach A — Improved IQR (Enhance Current)

Replace the current `(locality, decade)` grouping with rolling temporal windows and strata segmentation.

**Changes:**

1. **Rolling 5-year window** instead of decade buckets: For each sale, compute IQR from sales in the same locality within ±2.5 years (5-year centered window, aligning with the LOESS bandwidth). This eliminates decade boundary discontinuities.
2. **Strata/freehold segmentation**: Compute separate IQR for strata and freehold within each locality-window group. Use the corrected strata classification (incorporating `is_likely_strata`).
3. **Pre-filter non-market sales**: Exclude records already flagged as nominal transfers, bulk sales, or partial interest before computing IQR baselines.
4. **Keep 3× multiplier**: Conservative threshold to minimise false positives.
5. **Price-per-sqm IQR** (optional, freehold only): For freehold records with area data (96.3% coverage), compute a second IQR on $/sqm. Flag records that fail either the raw price IQR or the $/sqm IQR. This catches cases where a small lot sells at a normal total price but implies an unrealistic $/sqm.

**Pros:**

- Direct enhancement to existing implementation
- No new data dependencies (locality, date, strata already available)
- Rolling window eliminates the most impactful flaw (decade boundaries)

**Cons:**

- Still limited by administrative suburb boundaries (Problem C)
- Rolling window is more expensive computationally than decade grouping (but dataset is <5M records — still fast)
- Requires minimum sample size per window-locality-strata group (retain ≥10 threshold)

**Estimated impact:** Should reduce false positives from decade boundary effects while catching more true outliers through strata segmentation. Expected to flag a similar total count (~2%) but with better precision.

### 3.3 Approach B — Spatial Outlier Detection (New)

Use geocoded coordinates (97.9% coverage) to define local price neighborhoods independent of suburb boundaries.

**Method — Adaptive Radius with Cascading Fallback:**

The core challenge is density variation: Sydney CBD has thousands of sales per km², while rural NSW might have 3 sales per decade in a 50km radius. A fixed radius would be too large for cities (losing local sensitivity) or too small for rural areas (insufficient neighbors). The solution is an adaptive radius that expands until a minimum neighbor count is reached.

**Pure KNN — no hardcoded radii:**

Rather than stepping through arbitrary radius thresholds (2km, 5km, 10km...), use true K-nearest-neighbor search. The "radius" is implicitly determined by where the Kth nearest neighbor happens to be — it adapts naturally to local density.

For each sale:

1. Find the **K=20 nearest** sales matching the same strata/freehold segment within ±3 years, ordered by geographic distance
2. Check the **distance to the 20th neighbor** — this is the implicit radius
3. If that distance exceeds **5km** → the neighborhood is too sparse for a meaningful local comparison. Mark as `outlier_status = 'insufficient_context'` and do not flag.
4. Otherwise → compute IQR from those 20 neighbors and flag if price is beyond 3× IQR

**For ungeocodable records** (2.1%): fall back to locality-level IQR with rolling 5-year window, same segment. If the locality also has fewer than 20 same-segment sales in the window, mark as insufficient context.

**How this adapts to density:**

| Context              | 20th neighbor distance | Outcome                                                |
| -------------------- | ---------------------- | ------------------------------------------------------ |
| Sydney CBD apartment | ~100m                  | Very tight local IQR — catches errors precisely        |
| Suburban house       | ~1–2km                 | Neighborhood-level IQR — captures local market         |
| Regional town        | ~3–4km                 | Town-level IQR — still a coherent market               |
| Remote rural         | ~15km+                 | Exceeds 5km cutoff → insufficient context, not flagged |

This means rural and remote sales are mostly left unvalidated — but this is the correct outcome. A $200K farm and a $500K house in the nearest town 15km away are legitimately in different markets. Comparing them would create false positives. If we can't find 20 comparable sales nearby, we don't have enough context to call anything an outlier.

**Why K=20 (not 10):** With fewer than ~20 data points, Q1 and Q3 are unstable — a single unusual sale shifts the quartile, producing false positives.

**Why 5km max distance:** This is not a search radius — it's a sanity check that the K neighbors found are actually in the same market. 5km is roughly "same suburb or immediately adjacent suburb" in urban/suburban NSW. Beyond that, price levels can differ structurally (different school catchments, proximity to transport, etc.) and comparisons become unreliable.

**Why ±3 year temporal window:** Provides enough sales for stable quartiles without comparing boom prices to bust prices. Too narrow (±1 year) means too few neighbors; too wide (±10 years) mixes different market conditions.

**Implementation — H3 spatial pre-filtering:**

Naive KNN is O(n²) — 4.78M × 4.78M = 22.8 trillion distance calculations, infeasible. The key optimization is using H3 cells to limit the spatial self-join:

1. **Pre-compute H3 res 7 cell** for each geocoded sale (~2.5km across per hex)
2. **Self-join** against sales in the same cell + `k_ring(1)` (7 cells, covering ~5km from center) — this is our spatial pre-filter
3. Apply **temporal** (±3 years) and **segment** (same strata/freehold) filters in the join condition
4. Compute **Haversine distance** on surviving pairs only
5. `ROW_NUMBER() OVER (PARTITION BY sale ORDER BY distance) <= 20` to select K nearest
6. Compute **IQR** from the 20 neighbors, check max distance ≤ 5km

**Candidate pair estimate:**

| Filter                       | Reduction | Candidates per record |
| ---------------------------- | --------- | --------------------- |
| Full dataset                 | —         | 4,780,000             |
| H3 res 7 k-ring(1) — 7 cells | ~99.9%    | ~500                  |
| ±3 year temporal window      | ~83%      | ~85                   |
| Same strata/freehold segment | ~50%      | ~45                   |
| **Total pairs**              |           | **4.78M × 45 ≈ 215M** |

**Estimated compute time:**

| Step                                          | Operation              | Est. Time        |
| --------------------------------------------- | ---------------------- | ---------------- |
| Pre-compute H3 res 7 cell per sale            | Simple hash            | ~2s              |
| Self-join with H3 + temporal + segment filter | ~215M candidate pairs  | ~10–15s          |
| Haversine distance on each pair               | Vectorized math        | ~5–10s           |
| `ROW_NUMBER()` window function                | Sort ~45 per partition | ~15–30s          |
| IQR computation + flag                        | Aggregate on top 20    | ~5s              |
| **Total**                                     |                        | **~40s – 1 min** |

Compare to current `flagPriceOutliers()` (simple GROUP BY locality, decade): ~5–10 seconds. KNN is **5–10× slower** but still well within "run once during ETL" territory.

**Memory:** 215M pairs × ~24 bytes ≈ 5 GB. Fits in RAM on a 16 GB machine. DuckDB spills to disk efficiently if needed.

**Sketch SQL:**

```sql
WITH candidates AS (
  SELECT
    s1.id, s1.purchase_price,
    s2.purchase_price AS neighbor_price,
    haversine(s1.lat, s1.lng, s2.lat, s2.lng) AS dist_km,
    ROW_NUMBER() OVER (
      PARTITION BY s1.id
      ORDER BY haversine(s1.lat, s1.lng, s2.lat, s2.lng)
    ) AS rn
  FROM sales s1
  JOIN sales s2
    ON s2.h3_res7 IN (SELECT h FROM h3_k_ring(s1.h3_res7, 1))
    AND s2.segment = s1.segment
    AND ABS(s2.sale_year - s1.sale_year) <= 3
    AND s2.id != s1.id
)
SELECT id,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY neighbor_price) AS q1,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY neighbor_price) AS q3,
  MAX(dist_km) AS max_neighbor_dist
FROM candidates
WHERE rn <= 20
GROUP BY id
HAVING MAX(dist_km) <= 5.0  -- 20th neighbor must be within 5km
```

**Distance formula (pure SQL, no extensions):**

```sql
2 * 6371 * ASIN(SQRT(
  POWER(SIN((lat2 - lat1) * PI() / 360), 2) +
  COS(lat1 * PI() / 180) * COS(lat2 * PI() / 180) *
  POWER(SIN((lng2 - lng1) * PI() / 360), 2)
))
```

**Catches that locality IQR misses:**

- Luxury teardowns in modest suburbs (a $5M sale in a $800K-median suburb might be a genuine mansion, but spatial neighbors would confirm or deny)
- Data entry errors with extra/missing digits (a $80K sale in a $800K area — all nearby sales confirm this is wrong)
- Suburb-boundary anomalies (property at the edge is more comparable to neighbors across the line)

**Pros:**

- Single method handles urban and suburban contexts via adaptive radius
- Naturally handles temporal context (±3 year window) and spatial context (radius replaces suburb boundaries)
- Segment-aware where data is dense enough
- Captures actual local market dynamics, not administrative boundaries
- Excellent geocoding coverage (97.9%) makes this feasible
- Honest about limitations — records without enough context are left alone, not compared against distant markets

**Cons:**

- More complex to implement than simple GROUP BY IQR
- ~40s–1 min compute time vs ~5–10s for current approach — acceptable for ETL, not real-time
- Three parameters: K=20, max distance=5km, temporal window=±3 years
- Rural and remote sales will mostly be unvalidated (insufficient context) — but this is the correct outcome, not a flaw
- Still needs locality IQR fallback for ungeocodable records (2.1%)

**As a single primary method:** The adaptive KNN approach replaces Approach A entirely. It handles the same concerns (temporal context, strata segmentation) plus adds spatial context. The locality fallback step covers cases where spatial data is sparse, and records that can't be validated are honestly marked as such. This is simpler than layering two separate outlier detection systems.

**Recommendation:** Implement spatial KNN with adaptive radius as the single primary outlier detection method. The locality fallback means Approach A isn't needed as a separate system — it's just step 3 of the cascade. Records without sufficient context are left unflagged — this is preferable to comparing against incomparable markets.

### 3.4 Approach C — Repeat-Sale Consistency (New)

For properties with multiple sales in the dataset, check if the implied price trajectory is plausible.

**Method:**

1. For each property with 2+ sales, compute the annual compound growth rate between consecutive sales
2. Flag individual sales where the implied CAGR exceeds ±50% per year
3. The flagged sale is the one that breaks the trajectory — determined by majority vote (if a property sold 5 times and one sale is inconsistent with the other 4, flag that one)

**Catches:**

- Price entry errors (extra/missing digit): $800K → $80K → $850K — the $80K is clearly wrong
- Nominal transfers not properly recorded: $800K → $1 → $850K — the $1 is a non-market transfer
- Suspicious appreciation: $200K → $2M in 1 year (possible but worth flagging for review)

**Pros:**

- Uses the property's own history as a reference — immune to neighbourhood composition effects
- Can detect errors invisible to cross-sectional methods (a $80K sale in a $80K suburb is "normal" by IQR but wrong for a property that sold for $800K last year)
- Common in 35-year dataset (many properties have multiple sales)

**Cons:**

- Only applicable to repeat sales (not one-time sales)
- 50% threshold needs tuning — genuine market corrections can exceed this during downturns or rapid appreciation
- Doesn't detect the first sale if it's the outlier (no prior history to compare against)

**Recommendation:** Implement as a third-pass check, running after IQR and spatial detection. Low priority — the other approaches catch most errors first.

---

## 4. Same-Day Duplicate Sales

### 4.1 Initial Hypothesis

The user observed properties appearing to sell 3+ times on the same day at similar prices and suggested a dedup rule limiting to one sale per day per property.

### 4.2 All-Sales Investigation (Strata + Freehold Combined)

Querying all same-property same-day groups across the full dataset:

| Category                      | Groups | Total Records |
| ----------------------------- | ------ | ------------- |
| All different dealing numbers | 77,902 | 223,892       |
| Same dealing number           | 1,193  | 2,386         |
| Mixed                         | 196    | 1,013         |

98.2% of same-day groups have all-different dealing numbers — these are genuinely distinct transactions (different strata units, different land parcels). A broad "one sale per day per property" rule would delete 223,892+ legitimate multi-unit sales.

### 4.3 Freehold-Specific Investigation

Narrowing to **freehold records without unit numbers** (the population where duplicates should not exist):

| Category                         | Groups | Total Records | Exact Same Price | Within 5% |
| -------------------------------- | ------ | ------------- | ---------------- | --------- |
| No units (potential true dupes)  | 8,834  | 19,131        | 4,457            | 4,677     |
| Has units (misclassified strata) | 88     | 210           | 17               | 28        |

The 8,834 freehold no-unit groups are **multi-dealing registrations** for the same physical property. They share the same property_id, address, area, and legal description, with sequential dealing numbers (e.g. AG522076/AG522077). The NSW Land Registry creates separate dealing numbers for each lot/portion in a multi-lot transfer.

**50.4% have the exact same price** — the total purchase was split evenly across dealing registrations. These are not different properties; they are the same sale recorded multiple times.

**Scope:** 8,630 unique properties across 2,363 localities — statewide, not localised.

**Only 468 groups (936 records)** share the same dealing_number — true file-level ingestion duplicates.

### 4.4 Impact on LOESS

These duplicates materially affect analysis:

1. **Sale-count weighting inflation**: With sale-count weighted LOESS (Cleveland 1979), each record contributes to the yearly median's `sale_count`, which multiplies the tricube kernel weight. A property appearing 3 times gets 3× the LOESS influence it should have. This is a systematic bias, not noise — it over-weights properties involved in multi-dealing registrations.

2. **Median distortion**: While exact-price duplicates don't shift the median, they inflate the sale count for that price level. In small cells with few sales, adding 2–3 duplicates can change the median from one property's price to another's.

3. **Statewide scope**: 2,363 localities affected means this isn't isolated — every suburb with multi-lot transactions has inflated sale counts.

### 4.5 Recommendation

**Flag freehold multi-dealing duplicates for deduplication.**

For freehold records without unit numbers, when multiple records share `(property_id, contract_date)`:

- **Exact same price**: Keep one record, flag the rest as `is_multi_dealing_dup = TRUE`. Which one to keep doesn't matter — they're identical except for dealing_number.
- **Different prices**: These may represent genuine lot splits with different valuations per lot. More investigation needed before flagging — for now, leave them alone.

This removes ~8,900 duplicate records (the extras from 4,457 exact-price groups) from analysis while preserving all legitimate distinct sales.

**Do NOT implement a broad "one sale per day per property" rule** — this would delete legitimate strata multi-unit sales (77,902 groups / 223,892 records).

---

## 5. Additional Cleaning Opportunities

### 5.1 Partial Interest Sales

**Scale:** 35,456 records (0.7% of valid sales).

| Interest Bucket | Count     |
| --------------- | --------- |
| 100% (full)     | 4,847,255 |
| 50–99%          | 20,352    |
| 25–49%          | 7,365     |
| <25%            | 7,739     |

**Problem:** A 50% interest sale at $400K represents an $800K property. Without adjustment, the $400K price enters median calculations and IQR baselines as-is, dragging values down.

**Options:**

1. **Scale to 100%**: `adjusted_price = purchase_price * 100 / percent_interest`. Simple but assumes linear scaling (ignores control premiums/discounts).
2. **Flag and exclude**: New flag `is_partial_interest`. Safest approach — partial interest sales are non-standard transactions.

**Recommendation:** Flag and exclude (option 2). Partial interest sales are unusual by definition and scaling them introduces its own distortions. The 0.7% loss of data is negligible.

### 5.2 Nominal Transfers

**Scale:** 265 records at $1, 42,650 at $0.

The $0 records are already excluded by the universal `WHERE purchase_price > 0` filter. However, $1 nominal transfers pass through all filters and contaminate IQR baselines.

Beyond $1, there's a continuum: 3,656 records at $100–$1K, and 30,375 at $1K–$10K. Some of these are legitimate (e.g. $5K for a remote rural lot), so a fixed threshold risks false positives.

**Recommendation:** New flag `is_nominal_transfer` for records with `purchase_price < 1000`. This captures $1 transfers and sub-$1K transactions that are almost certainly non-market. The $1K–$10K range should be left alone — legitimate small-value transactions exist in that range, especially for vacant rural land.

### 5.3 Sale Code Analysis

The NSW VG data includes a `sale_code` field with 236 distinct values. The official documentation (`Current_Property_Sales_Data_File_Format_2001_to_Current.pdf`) marks it as **"Internal use only"** — no glossary, no descriptions, no examples. The `Property_Sales_Data_File_-_Data_Elements_V3.pdf` (which describes every other field in detail) conspicuously omits it entirely. Same for `component_code`.

**Distribution:** 96.4% of records have NULL (standard market sales). The remaining 3.6% show patterns:

| Code | Count  | Median Price | Interpretation (speculative) |
| ---- | ------ | ------------ | ---------------------------- |
| AC   | 80,387 | $285K        | Auction?                     |
| XA   | 40,534 | $490K        | Exchange of contracts?       |
| AV   | 16,814 | $118K        | Assessed value? Vacant?      |
| RR   | 8,694  | —            | Related party? Resumption?   |
| RV   | 5,548  | $98K         | Related/vacant — very low    |
| RG   | 2,721  | —            | Government?                  |
| ACI  | 2,396  | —            | Auction with improvements?   |
| RVP  | —      | $21K         | Likely partial/related       |
| AVP  | —      | $22K         | Likely partial/related       |
| MC   | —      | $3.7M        | Multi-component commercial   |
| RTO  | —      | $37.4M       | Large institutional          |

Codes with very low median prices (RV, RVP, AVP, PR) are likely non-market transfers that should be excluded from residential analysis. Codes with very high medians (RTO, MC, IF) are likely large commercial transactions.

**Recommendation:** Do not act on sale codes yet. The "internal use only" designation and complete lack of documentation makes any interpretation speculative. As a future priority:

1. Contact the NSW Valuer General (1800 110 038 / valuationenquiry@property.nsw.gov.au) to request a code glossary.
2. If no response, empirically characterise each code by analysing its price distribution, property types, and temporal patterns to build our own classification.

If codes like RV/RVP do mean "related party", this would provide a clean, source-data-based way to exclude non-market transactions — far more reliable than price-threshold heuristics.

### 5.4 Corrupt Dates

The data contains contract dates with years like 201, 222, and 1024 — parsing errors where digits were misread or truncated. The current date cleaner validates month/day rollover but does not check year range. Since the NSW VG dataset starts in 1990, any date before that is definitively invalid.

**Recommendation:** Add year validation in `parseCCYYMMDD()`: reject dates with `year < 1990` or `year > currentYear + 1`. This is a parsing fix, not a data quality flag — these records should have their `contract_date` set to NULL with the raw value preserved in `contract_date_raw`.

### 5.5 Data Quality Flags in All Widgets

**Critical gap:** `buildWhereClause()` in `webapp/src/lib/queries.ts` generates WHERE clauses for all non-heatmap widgets. It currently does not include `is_bulk_sale = FALSE` or `is_price_outlier = FALSE`.

**Recommendation:** Add these two conditions to `buildWhereClause()` so that all widgets benefit from data quality flagging. This is the highest-impact, lowest-effort improvement — it's a two-line change that immediately removes bulk sales and price outliers from every chart.

---

## 6. Order of Operations

### 6.1 Current Order

```
Parse → Clean → Load → Flag bulk sales → Flag price outliers → Rebuild heatmap
```

### 6.2 Dependencies

The order of data quality steps matters because each step's output affects subsequent steps:

1. **Nominal transfers must be flagged before IQR computation.** $1 sales drag Q1 toward zero, widening the IQR and making the outlier detector less sensitive. If a suburb has 100 sales and 3 are at $1, Q1 drops significantly. Excluding these first tightens the quartiles.

2. **Partial interest must be handled before IQR computation.** A 50% interest sale at $400K in an $800K suburb looks like an outlier by IQR. But it's not an error — it's a correct price for a half-share. Flagging it as partial interest prevents it from being double-flagged as a price outlier.

3. **Strata misclassification must be resolved before strata-segmented IQR.** If community-title apartments remain in the freehold segment, the freehold IQR is contaminated by apartment prices. The misclassification flag must run first so that the subsequent IQR computation uses correct segments.

4. **Bulk sale detection should run before price outlier detection.** Developer acquisitions at $110M would be flagged as both bulk AND outlier, which is redundant. Excluding bulk sales first prevents double-counting and keeps the outlier flag focused on statistical anomalies.

5. **Each step should exclude previously-flagged records from its own computation.** For example, outlier detection should ignore records already flagged as nominal transfers, bulk sales, or partial interest. Otherwise, flagged records contaminate the IQR baselines.

### 6.3 Recommended Pipeline

```
1. Parse → Clean → Load                    (unchanged, but add year >= 1990 validation in date parser)
2. Flag nominal transfers                   (purchase_price < $1,000)
3. Flag strata misclassification            (is_likely_strata)
4. Flag freehold multi-dealing duplicates   (is_multi_dealing_dup — same property_id + date + price, freehold only)
5. Flag bulk sales                          (unchanged logic, but exclude steps 2-4 flags)
6. Flag partial interest                    (percent_interest IS NOT NULL)
7. Flag price outliers                      (spatial KNN or improved IQR; exclude steps 2-6 from baseline)
8. Rebuild heatmap aggregates + LOESS curves
```

Each flagging step is idempotent (reset flags first, then recompute). The whole chain can be re-run safely via `pnpm etl data-quality`.

### 6.4 Schema Implications

New columns on `fact_property_sale`:

| Column                 | Type    | Default | Purpose                                                                           |
| ---------------------- | ------- | ------- | --------------------------------------------------------------------------------- |
| `is_likely_strata`     | BOOLEAN | FALSE   | Community/company title apartments detected as freehold                           |
| `is_nominal_transfer`  | BOOLEAN | FALSE   | Purchase price < $1,000                                                           |
| `is_partial_interest`  | BOOLEAN | FALSE   | percent_interest IS NOT NULL                                                      |
| `is_multi_dealing_dup` | BOOLEAN | FALSE   | Freehold same-property same-day same-price duplicate (multi-dealing registration) |

The existing `is_bulk_sale` and `is_price_outlier` columns remain unchanged.

Downstream query filters (`buildWhereClause` and heatmap base WHERE) would add:

```sql
AND fps.is_nominal_transfer = FALSE
AND fps.is_partial_interest = FALSE
AND fps.is_multi_dealing_dup = FALSE
```

The strata split logic would change from:

```sql
-- Current
CASE WHEN strata IS NOT NULL THEN 'strata' ELSE 'freehold' END

-- New
CASE WHEN strata IS NOT NULL OR is_likely_strata THEN 'strata' ELSE 'freehold' END
```

---

## 7. Recommendations Summary

### Priority 1 — Implement Now

| Change                                                                                  | Impact                                                                 | Effort                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| Add `is_bulk_sale = FALSE AND is_price_outlier = FALSE` to `buildWhereClause()`         | All widgets immediately benefit from existing data quality flags       | 2-line change                 |
| Add `is_likely_strata` flag (Heuristic A: `strata IS NULL AND unit_number IS NOT NULL`) | Corrects strata/freehold segmentation for 22,623 records               | New column + SQL UPDATE       |
| Add `is_nominal_transfer` flag (price < $1,000)                                         | Removes non-market $1 transfers from analysis                          | New column + SQL UPDATE       |
| Add `is_multi_dealing_dup` flag (freehold same-property same-day same-price)            | Removes ~8,900 duplicate records that inflate LOESS sale-count weights | New column + SQL UPDATE       |
| Improve outlier detection: spatial KNN or rolling 5-year IQR + strata segmentation      | Eliminates decade boundary effects, adds spatial/temporal context      | Rewrite `flagPriceOutliers()` |
| Fix date parser: reject `year < 1990`                                                   | Removes corrupt dates (year 201, 222, 1024, etc.)                      | Parser change                 |

### Priority 2 — Implement Soon

| Change                                 | Impact                                        | Effort                      |
| -------------------------------------- | --------------------------------------------- | --------------------------- |
| Add `is_partial_interest` flag         | Removes 35,456 distorted prices from analysis | New column + SQL UPDATE     |
| Reorder data quality pipeline per §6.3 | Ensures each step operates on clean baselines | Refactor `runDataQuality()` |

### Priority 3 — Investigate Further

| Change                                             | Impact                                          | Effort                               |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Repeat-sale consistency (Approach C)               | Catches individual price entry errors           | Self-join on property_id             |
| Sale code investigation (contact NSW VG)           | May identify additional non-market transactions | NSW VG inquiry or empirical analysis |
| Strata misclassification Heuristic B (small area)  | Catches additional community-title apartments   | False positive analysis needed       |
| Freehold multi-dealing dupes with different prices | May represent legitimate lot splits or errors   | Further investigation                |

---

## 8. Data Profile Summary

Key statistics from the investigation (4,882,711 valid sales with `purchase_price > 0 AND contract_date IS NOT NULL`):

| Metric                                     | Value                                               |
| ------------------------------------------ | --------------------------------------------------- |
| Total valid sales                          | 4,882,711                                           |
| Unique properties                          | 2,027,440                                           |
| Year range                                 | 1990–2025 (with corrupt dates as early as year 201) |
| Geocoding coverage                         | 97.9%                                               |
| Area data coverage (all)                   | 72.2%                                               |
| Area data coverage (freehold)              | 96.3%                                               |
| Area data coverage (strata)                | 19.6%                                               |
| Flagged bulk sales                         | 385,868 (6.3%)                                      |
| Flagged price outliers                     | 145,991 (2.2%)                                      |
| Zero-price records                         | 42,650 (already excluded by `> 0` filter)           |
| Partial interest sales                     | 35,456 (0.7%)                                       |
| Freehold with unit_number                  | 22,623 (likely strata misclassification)            |
| Freehold multi-dealing dupes (exact price) | ~8,900 extra records across 4,457 groups            |
| Sub-$100 sales                             | 265 (nominal transfers)                             |
| $100M+ sales                               | 1,415 (commercial/institutional)                    |

### Area Types

| Code | Meaning       | Records   | Median Area |
| ---- | ------------- | --------- | ----------- |
| `M`  | Square metres | 4,410,991 | 653 sqm     |
| `H`  | Hectares      | 521,062   | 9.5 ha      |

Price-per-sqm queries convert hectares: `CASE WHEN area_type = 'H' THEN area * 10000 ELSE area END`.

### Price Distribution

| Bucket        | Count     | %      |
| ------------- | --------- | ------ |
| < $100        | 265       | 0.01%  |
| $100 – $1K    | 3,656     | 0.07%  |
| $1K – $10K    | 30,375    | 0.62%  |
| $10K – $100K  | 213,200   | 4.37%  |
| $100K – $500K | 2,256,868 | 46.23% |
| $500K – $1M   | 1,523,014 | 31.19% |
| $1M – $5M     | 802,089   | 16.43% |
| $5M – $10M    | 33,260    | 0.68%  |
| $10M – $50M   | 16,508    | 0.34%  |
| $50M – $100M  | 2,061     | 0.04%  |
| > $100M       | 1,415     | 0.03%  |

Core residential range ($100K – $5M) accounts for 93.8% of all sales.

### Price Per Square Metre Distribution

| Bucket           | Count     |
| ---------------- | --------- |
| < $100/sqm       | 544,264   |
| $100 – $1K/sqm   | 1,608,849 |
| $1K – $5K/sqm    | 1,039,723 |
| $5K – $10K/sqm   | 229,099   |
| $10K – $50K/sqm  | 100,108   |
| $50K – $100K/sqm | 2,140     |
| > $100K/sqm      | 1,749     |

The <$100/sqm bucket (544K records) primarily represents large rural/agricultural properties. The >$100K/sqm bucket (1,749 records) likely contains data errors — incorrectly recorded areas or strata lots measured in lot entitlement rather than square metres.

---

## 9. Implementation Plan

The following changes will be implemented to address the data quality issues identified in this research. They are listed in execution order — each step depends on the previous steps having run first.

### Step 1: Fix date parser — reject year < 1990

**File:** `scripts/src/cleaner/dates.ts`

Add year range validation to `parseCCYYMMDD()`. Dates with `year < 1990` or `year > currentYear + 1` are rejected (set to NULL), with the raw value preserved in `contract_date_raw`. This removes corrupt dates like year 201, 222, 1024 at the source.

### Step 2: Add data quality flags to all widgets

**File:** `webapp/src/lib/queries.ts` — `buildWhereClause()`

Add `is_bulk_sale = FALSE` and `is_price_outlier = FALSE` to the WHERE clause builder so every widget (median price, growth rate, property map, etc.) filters by data quality flags — not just the heatmap. This is the highest-impact, lowest-effort fix: a two-line change that immediately removes bulk sales and outliers from all charts.

### Step 3: Add `is_likely_strata` flag

**Files:** `scripts/src/db/schema.ts`, `scripts/src/db/data-quality.ts`

New boolean column on `fact_property_sale`. Detection: `strata IS NULL AND unit_number IS NOT NULL AND unit_number != ''`. Flags 22,623 community-title/company-title apartments currently misclassified as freehold.

Update downstream strata/freehold split logic across all queries:

```sql
CASE WHEN strata IS NOT NULL OR is_likely_strata THEN 'strata' ELSE 'freehold' END
```

### Step 4: Add `is_nominal_transfer` flag

**Files:** `scripts/src/db/schema.ts`, `scripts/src/db/data-quality.ts`

New boolean column. Detection: `purchase_price > 0 AND purchase_price < 1000`. Flags $1 nominal transfers and sub-$1K non-market sales that contaminate IQR baselines and median calculations.

### Step 5: Add `is_multi_dealing_dup` flag

**Files:** `scripts/src/db/schema.ts`, `scripts/src/db/data-quality.ts`

New boolean column. Detection: freehold records (after `is_likely_strata` correction) sharing `(property_id, contract_date, purchase_price)` with 2+ records and no unit number — keep one, flag the rest. Removes ~8,900 duplicate records that inflate LOESS sale-count weights statewide.

### Step 6: Add `is_partial_interest` flag

**Files:** `scripts/src/db/schema.ts`, `scripts/src/db/data-quality.ts`

New boolean column. Detection: `percent_interest IS NOT NULL` (meaning interest < 100%). Flags 35,456 partial-interest sales whose recorded price represents a fraction of the property's market value and distorts medians.

### Step 7: Replace price outlier detection with spatial KNN

**File:** `scripts/src/db/data-quality.ts` — replace `flagPriceOutliers()`

Replace the current locality × decade IQR approach with spatial KNN:

1. Pre-compute H3 res 7 cell for each geocoded sale
2. For each sale, find the 20 nearest same-segment sales within ±3 years using H3 `k_ring(1)` spatial pre-filter
3. If the 20th neighbor is > 5km away → mark as `insufficient_context`, do not flag
4. Otherwise → compute IQR from those 20 neighbors, flag if price is beyond 3× IQR
5. Fallback for ungeocodable records (2.1%): locality-level IQR with rolling 5-year window

Estimated compute time: ~40s–1 min (vs ~5–10s for current approach). Acceptable for ETL.

The new method must exclude records already flagged in Steps 3–6 from the neighbor pool, so IQR baselines are not contaminated by nominal transfers, partial interest sales, or duplicates.

### Step 8: Update downstream query filters

**Files:** `webapp/src/lib/queries.ts`, `webapp/src/lib/heatmap-queries.ts`, `scripts/src/heatmap/h3-precompute.ts`, `scripts/src/heatmap/loess-curve-precompute.ts`

Add the new flags to all WHERE clause builders:

```sql
AND fps.is_nominal_transfer = FALSE
AND fps.is_partial_interest = FALSE
AND fps.is_multi_dealing_dup = FALSE
```

Update strata/freehold split logic everywhere to use `is_likely_strata`.

### Step 9: Reorder and rebuild data quality pipeline

**File:** `scripts/src/db/data-quality.ts` — refactor `runDataQuality()`

Execute flags in dependency order:

```
1. Reset all flags
2. Flag nominal transfers        (no dependencies)
3. Flag strata misclassification  (no dependencies)
4. Flag multi-dealing duplicates  (depends on strata fix)
5. Flag bulk sales                (excludes steps 2–4)
6. Flag partial interest          (no dependencies)
7. Flag price outliers — KNN      (excludes steps 2–6)
```

Each step excludes previously-flagged records from its own computation to prevent baseline contamination.

### Step 10: Recompute heatmap and LOESS

```bash
cd scripts && pnpm etl data-quality && pnpm etl recompute-heatmap && pnpm etl recompute-loess
```

### Verification

1. All scripts and webapp tests pass
2. Data quality stats printed after each flag step (record counts match expectations from §8)
3. Spot-check known problem hexes in the heatmap (e.g. `89be0e22807ffff`)
4. Compare LOESS curves before/after in hex detail dialog for suburbs with known community-title buildings
5. Verify non-heatmap widgets (median price line, growth rate) now exclude flagged records

---

## References

- Cleveland, W.S. (1979). "Robust Locally Weighted Regression and Smoothing Scatterplots." _JASA_, 74(368), 829–836.
- IMF Working Paper WP/16/213: "How to Better Measure Hedonic Residential Property Price Indexes"
- IAAO Standard on Automated Valuation Models (2018)
- ABS Data Quality Framework (seven dimensions)
- NSW Valuer General Property Sales Data File documentation (format schemas, data elements, district codes, zone codes)
- CoreLogic Australia: two-stage outlier detection at SA2/SA3 level

All these flags and concepts need to be incredibly well documented on why they exist, how their derived and what theyre used for and more.
