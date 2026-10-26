# Property Price Smoothing & Index Methods Research

> How the industry computes property price indices, why raw medians are volatile, and which trend-fitting methods best reveal underlying price movements in our NSW Valuer General data.

---

## Table of Contents

1. [Why Raw Medians Are Volatile](#1-why-raw-medians-are-volatile)
2. [Industry Methodologies](#2-industry-methodologies)
3. [Trend-Fitting & Smoothing Methods](#3-trend-fitting--smoothing-methods)
4. [Practical Recommendations by Data Frequency](#4-practical-recommendations-by-data-frequency)
5. [Data Quality Improvements for Our Dataset](#5-data-quality-improvements-for-our-dataset)
6. [JavaScript/TypeScript Libraries](#6-javascripttypescript-libraries)
7. [Small-Area & Sparse-Data Methods](#7-small-area--sparse-data-methods)
8. [Summary Comparison Tables](#8-summary-comparison-tables)
9. [Sources](#9-sources)

---

## 1. Why Raw Medians Are Volatile

Raw median sale prices are the simplest measure of property prices, but they suffer from several sources of noise that can make quarter-to-quarter or even year-to-year movements misleading.

### 1.1 Composition Bias (The Dominant Factor)

The biggest source of volatility is **composition drift** — changes in the mix of properties that happen to sell in a given period.

Research from the RBA found that approximately **60% of quarterly median price variation** in Sydney and Melbourne can be explained purely by compositional shifts in which suburbs and property types transact. In other Australian cities, 20–40% of quarterly price movements are attributable to composition effects.

**Example:** If an unusually high proportion of prestige harbour-front homes sell in Q1 but mostly modest suburban houses sell in Q2, the median drops — not because any individual property lost value, but because the sample changed.

### 1.2 Sample Size Effects

Smaller areas (individual suburbs) have fewer transactions per period. With only 10–30 sales in a quarter, a single outlier transaction (a knock-down rebuild sold at land value, or a prestige home) can swing the median by 10–20%. This is statistical noise, not a real price signal.

### 1.3 Seasonal Effects

Transaction composition has strong seasonality:
- **Peak seasons** (spring/autumn): Higher proportion of premium, well-presented homes sell, pushing medians up.
- **Off-seasons** (winter, late December): More unmaintained or distressed properties transact, pulling medians down.
- Sydney: seasonality explains roughly 1/3 of quarterly price variation.
- Melbourne: seasonality explains roughly 1/2.

### 1.4 The Practical Impact

These effects combine to produce apparent 10–20% swings in annual suburban medians that don't reflect real price changes for comparable homes. This makes it hard to:
- Compare growth rates between suburbs (noise dominates the signal)
- Identify genuine trend inflection points (growth → flat → decline transitions)
- Trust recent movements (is last year's 15% jump real or compositional noise?)

---

## 2. Industry Methodologies

### 2.1 CoreLogic / Cotality — Hedonic Home Value Index (Australia)

CoreLogic (now Cotality) produces Australia's most widely cited property index using **hedonic regression**.

**How it works:**
- For every property, estimate its current value based on the observed sale prices and characteristics of recently-sold comparable properties.
- The model uses attributes like location, size, type, age, number of bedrooms/bathrooms, land area, etc.
- By holding attributes constant, the index measures pure price appreciation, filtering out composition effects.

**Key advantages:**
- Incorporates all transactions (not just repeat sales)
- Controls for composition bias explicitly
- Very timely — avoids the typical 6–8 week reporting lag of other indices
- Leverages Australia's most comprehensive property attribute database

**Why we can't replicate it:** CoreLogic has property attributes (bedrooms, bathrooms, land area, building age, etc.) that we don't have in the NSW VG data. Our data only has: price, date, locality, lot area (sqm), strata flag, zone code, and nature of property.

### 2.2 S&P/Case-Shiller — Repeat-Sales Method (US)

The Case-Shiller index tracks the same property across multiple sales, measuring the actual price change between transactions.

**How it works:**
- Identify properties that sold more than once during the observation period.
- For each sale pair, compute the price change ratio.
- Aggregate these ratios using weighted regression to produce the index.
- Base period: January 2000 = 100.

**Key features:**
- Completely eliminates composition bias (comparing identical properties).
- Excludes new construction, major renovations, and non-arm's-length transfers.
- Weighted by time interval between sales (recent pairs get more weight).

**Limitations:**
- Cannot include properties that only sold once (excludes ~50–70% of transactions).
- Requires large sample sizes — problematic in small suburbs or during downturns.
- Doesn't account for renovations/improvements between sales (partially addressed by filtering extreme price changes).

**Relevance to our data:** We have `property_id` in the NSW VG data, so we *can* build a repeat-sales index. See Section 5.3.

### 2.3 Zillow Home Value Index — Neural Hedonic (US)

**How it works:**
- Zillow maintains automated valuations ("Zestimates") for every US property using neural network models.
- The ZHVI tracks monthly changes in these Zestimates, not just properties that actually sold.
- Uses an aggressively trimmed mean (middle third) of Zestimates.
- Applies 3-month moving average smoothing.
- Available in both smoothed/seasonally-adjusted and raw forms.

**Key innovation:** By valuing every property monthly (not just those that sold), Zillow avoids composition bias entirely. The smoothing and trimming handle remaining noise.

### 2.4 ABS — Stratified Median (Australia)

The Australian Bureau of Statistics produces the official Residential Property Price Index using **stratification**.

**How it works:**
- Split all transactions into strata defined by: dwelling type, long-term median price band, and SEIFA socioeconomic score.
- Compute the median within each stratum for each quarter.
- Combine strata medians using weights based on the total value of the housing stock.
- Update weights approximately every 5 years (aligned with Census).

**Key features:**
- Controls for major composition shifts (type, price tier, location quality).
- Uses mean-adjusted median prices from Valuers General data (our same source).
- Imputes missing strata from similar "donor" strata when transaction counts fall below thresholds.

**Relevance:** This is the most directly replicable approach for our data. We can stratify by strata (unit vs house), size bands, and suburb price tier.

### 2.5 UK Land Registry — Hedonic Regression

Uses a hedonic regression model on comprehensive transaction data capturing: sale price, property type (detached, semi-detached, terraced, flat), new-build status, and financed vs. cash transactions. Monthly publication.

### 2.6 OECD Residential Property Price Indicators

The OECD publishes standardized RPPIs across member countries. Methodologies vary by country, but all are seasonally adjusted (using X12-ARIMA). The OECD also computes derived indicators: price-to-income ratio and price-to-rent ratio.

---

## 3. Trend-Fitting & Smoothing Methods

This section evaluates methods for extracting the underlying trend from volatile raw median time series.

### 3.1 LOESS/LOWESS (Locally Weighted Scatterplot Smoothing)

**RECOMMENDED** as the primary smoothing method for our use case.

**How it works:**
For each point on the time axis:
1. Select the nearest k% of data points (controlled by the **span** parameter).
2. Weight these points by distance (closer = more weight), typically using a tricube kernel.
3. Fit a local polynomial regression (usually degree 1 or 2) using weighted least squares.
4. The predicted value at that point becomes the smoothed value.
5. Repeat for every point in the series.

**The span parameter:**
- span = 0.1 (10% of data): Very responsive, may over-fit noise.
- span = 0.3–0.4: Good balance — captures regime changes while smoothing noise.
- span = 0.5: Moderate smoothing.
- span = 0.8+: Heavy smoothing, may miss important features.

**Strengths:**
- **Non-parametric:** Makes no assumption about the underlying functional form. Naturally captures growth phases, plateaus, and declines within a single curve.
- **Adaptively local:** Each point's smoothed value is influenced primarily by nearby data, so it responds to regime changes.
- **Robust variant:** Iterative re-weighting can downweight outliers automatically.
- **Good edge behavior:** Unlike polynomial fits, LOESS doesn't oscillate at the boundaries of the time range.
- **STL decomposition:** Can be extended to separate trend from seasonality (Seasonal-Trend decomposition using LOESS).

**Weaknesses:**
- **O(n²) computation:** Fits a regression for every point. For 30–360 data points per suburb, this is trivially fast. For computing across hundreds of suburbs simultaneously, consider caching.
- **Span selection:** Requires choosing the span parameter. Can be automated with GCV (generalized cross-validation) or AICc, but adds complexity.

**Why LOESS solves the user's concerns:**
- Unlike polynomial fits, it doesn't oscillate wildly.
- Unlike moving averages, it doesn't systematically lag or dilute recent spikes.
- It naturally shows regime characteristics: years of growth, periods of flat/decline, explosive phases — exactly what the user wants to see.
- A 20% annual spike is partially smoothed but still visible as a rapid upward inflection, rather than being diluted to 7% (as with a 3-year moving average).

### 3.2 Moving Averages

**How it works:**
The smoothed value at time t is the average of the k data points centered on (or trailing) t.

**Responsiveness problem (the user's core concern):**
- **3-year MA:** A 20% price spike in one year is diluted to ~7% (20/3). A sudden reversal from +20% to -5% would be reported as +5%.
- **5-year MA:** Even more dilution — the 20% spike becomes ~4%.
- **Lag:** The smoothed value at time t actually represents the trend centered at t - (window/2). A 3-year trailing MA lags by 1.5 years.

**Strengths:**
- Trivially fast to compute.
- Easy to explain to non-technical users.
- Works well for data with strong, consistent linear trends.

**Weaknesses:**
- **Lags real movements:** Recent regime changes (growth → decline) are reported late.
- **Dilutes genuine spikes:** Real market shocks are under-reported.
- **Poor at regime changes:** Takes many periods to "catch up" to an inflection.
- **Equal weighting:** A 3-year-old observation has the same influence as last year's — inappropriate for fast-moving markets.

**Verdict:** Useful as a secondary reference line. Not the primary smoothing method when regime detection matters. Best reserved for a simple "3-year MA" reference overlay, not the main trend line.

### 3.3 Exponential Smoothing / Holt-Winters

**How it works:**
Single exponential smoothing: `S_t = α × y_t + (1 - α) × S_{t-1}`

Holt-Winters extends this with separate equations for level, trend, and optionally seasonality.

**Strengths:**
- Fast and simple.
- Recent observations weighted more than old ones (unlike equal-weight moving average).
- Good for forecasting when trends are linear and stable.

**Weaknesses:**
- **Assumes linear trends:** Cannot adapt to the multi-regime patterns in property prices (growth → flat → explosive → decline).
- **Single parameter set:** One α/β can't work across different market phases.
- **Better for forecasting than visualization:** Designed to predict next values, not to reveal historical trend shape.

**Verdict:** Not ideal for our use case. Property price trends are non-linear with multiple regimes.

### 3.4 Polynomial Regression

**The user's intuition is correct — polynomial fits oscillate wildly.**

**Runge's phenomenon:** High-degree polynomial interpolation produces oscillations that grow worse at the boundaries. Fitting a degree-10 polynomial to 30 years of data would swing dramatically in the first and last few years.

Even low-degree polynomials (degree 3–4) struggle: a cubic fits one "S-curve" well but can't capture multiple growth-flat-growth cycles.

**Verdict:** Avoid for property price trend fitting. Use LOESS instead.

### 3.5 Smoothing Splines

**How it works:**
Piecewise-cubic polynomials joined smoothly at "knot" points, with a roughness penalty to prevent overfitting:

`Minimize: Σ(residuals²) + λ × ∫(f''(x))² dx`

Where λ controls the smoothness/fit trade-off.

**Strengths:**
- Faster than LOESS: O(n) or O(n log n) vs O(n²).
- Automatic smoothing parameter selection via generalized cross-validation.
- Well-suited for large datasets.

**Weaknesses:**
- Knot placement requires decisions (or auto-selection).
- Less intuitive to parameterize than LOESS (span is more interpretable than λ + knot positions).
- Can miss sharp transitions if λ is too large.

**Verdict:** A good alternative to LOESS for computational performance. At our data sizes (30–360 points per suburb), LOESS is fast enough, so splines offer no practical advantage. Consider if we scale to computing thousands of suburb series simultaneously.

### 3.6 Savitzky-Golay Filter

**How it works:**
A signal-processing filter that fits local low-degree polynomials to overlapping windows, evaluating at the center of each window.

**Strengths:**
- Better at preserving peaks and edges than moving averages.
- No temporal lag (central evaluation).

**Weaknesses:**
- Poor boundary behavior (artifacts at the start/end of the series — exactly where users care most about recent trends).
- Less common in economic/real estate contexts.
- Still constrained by polynomial fits locally.

**Verdict:** Not recommended over LOESS for our use case. The edge artifacts at recent dates would be problematic.

### 3.7 Kernel Regression (Nadaraya-Watson)

**How it works:**
Each smoothed value is a kernel-weighted average of nearby observations. Like LOESS but fits a constant (not a polynomial) locally.

**How it relates to LOESS:**
- Nadaraya-Watson = locally constant fit (weighted average).
- LOESS = locally polynomial fit (weighted regression).

LOESS is strictly more capable because the polynomial captures local trend direction within each window.

**Verdict:** LOESS subsumes kernel regression. No reason to use Nadaraya-Watson instead.

---

## 4. Practical Recommendations by Data Frequency

### 4.1 Annual Data (~30 points per suburb, spanning 1990–2025)

| Method | Span/Window | Notes |
|--------|-------------|-------|
| **LOESS (recommended)** | span = 0.4–0.5 | Fits on 12–15 years at each point. Captures decade-long cycles. |
| Moving average (secondary) | 3-year window | Acceptable as a simple reference overlay. Lags by 1.5 years. |
| Smoothing spline | Auto-λ via GCV | Alternative to LOESS if needed. |

### 4.2 Quarterly Data (~120 points)

| Method | Span/Window | Notes |
|--------|-------------|-------|
| **LOESS (recommended)** | span = 0.2–0.3 | ~30 quarters (7–8 years) in each local fit. |
| Moving average (secondary) | 4–8 quarters (1–2 years) | Simple, intuitive. |

### 4.3 Monthly Data (~360 points)

| Method | Span/Window | Notes |
|--------|-------------|-------|
| **LOESS (recommended)** | span = 0.1–0.2 | ~36–72 months in each local fit. |
| Moving average (secondary) | 12 months | Captures annual seasonality. |
| Smoothing spline | Auto-λ | Consider if LOESS is too slow for batch computation. |

### 4.4 Comparing Two Suburbs' Trends

- **Use the same LOESS span for both series** so the smoothing is comparable.
- Overlay LOESS curves on scatter/line plots of raw data (raw as semi-transparent, trend as solid).
- An interactive span slider (0.1–0.9) lets users explore sensitivity.

---

## 5. Data Quality Improvements for Our Dataset

These approaches address volatility at the data level (before smoothing) by reducing composition bias. Listed from easiest to most complex.

### 5.1 Stratified Median (High Impact, Low Effort)

**What:** Split data into meaningful sub-groups before computing medians.

**Stratification dimensions available in our data:**
- **Property type:** strata (units/apartments) vs non-strata (houses/land) — we already support this via `strataFilter`.
- **Size bands:** Group by area_sqm quartiles (e.g., 0–300, 300–600, 600+ sqm).
- **Suburb price tier:** Group suburbs by their long-term median into tiers.

**Expected impact:** The ABS reports that stratification controls for "a significant proportion of compositional change." Expect 30–50% reduction in quarter-to-quarter noise.

**Implementation:** Compute medians per stratum per period. Combine strata medians using transaction-count weights. Flag strata with <25 transactions.

### 5.2 Price per Square Metre (Medium Impact, Low Effort)

**What:** Normalize all prices to $/sqm before computing indices.

**Advantages:**
- Reduces volatility from mix shifts in lot size.
- More stable for within-type comparisons (e.g., "units in Chatswood $/sqm").
- We already have this as a widget option.

**Limitations:**
- Land value vs building value: smaller lots in premium locations may have higher $/sqm without being "better" investments.
- Diminishing returns on size: a 20% larger property isn't 20% more expensive per sqm.
- Best used *within* stratified groups (e.g., "$/sqm for houses in Chatswood").

### 5.3 Repeat-Sales Index (Very High Impact, Medium Effort)

**What:** Identify properties that sold more than once (same `property_id`) and track only the price changes between these matched sales.

**Why we can build this:** We have `property_id` in the NSW VG data, so we can identify repeat sales.

**Implementation steps:**
1. Rank sales by `property_id` and `contract_date`.
2. Match each sale to its previous sale (if any) for the same property.
3. Filter: exclude pairs with holding period <12 months (flips), and exclude extreme annual price changes (>50% gain or >40% loss per year) as likely data errors or non-arm's-length.
4. Compute price change ratios per pair per period.
5. Aggregate using the Case-Shiller weighted regression approach, or simpler: median of log price change ratios.

**Expected impact:** This is the gold standard — completely eliminates composition bias. The trade-off is that it uses fewer transactions (only repeat-sales pairs), so it works better at broader geographic levels (council area, region) than individual suburbs.

### 5.4 Simple Hedonic Adjustment (Medium Impact, Medium Effort)

**What:** Build a regression model: `log(price) ~ area_sqm + strata + zone_code + locality + time`

**With our available features:**
- Property type (strata vs non-strata)
- Size (area_sqm)
- Location (locality, zone_code)
- Nature of property (V=Vacant, R=Residence, 3=Other)

**Limitation:** Without structural attributes (bedrooms, bathrooms, building age, renovations), the model explains ~40–60% of price variance at best. Still useful as a secondary quality-adjustment layer on top of stratification.

### 5.5 Sample Size Flagging (Quick Win)

**Minimum sample size thresholds from research:**

| Sample Size | Reliability |
|------------|-------------|
| <6 sales | Not reliable — combine with adjacent strata or exclude |
| 6–24 sales | Unstable — flag with a warning indicator |
| 25–99 sales | Acceptable for analysis |
| 100+ sales | Solid |

**Implementation:** Display transaction count alongside each median data point. Visually differentiate low-confidence periods (e.g., dashed line segments, lower opacity, or confidence bands).

### 5.6 Trimmed Mean / Interquartile Mean

**What:** Remove extreme tails before computing the mean.
- Trimmed mean (10%): removes top and bottom 10%.
- Interquartile mean: averages only the middle 50% (Q1 to Q3).

**Verdict:** For property prices, the median already handles this well. Stratification + median is preferred over trimmed mean. These methods are more useful for inflation indices (where the RBA uses trimmed mean CPI). Skip for our use case.

---

## 6. JavaScript/TypeScript Libraries

For client-side LOESS computation (computing the smoothed trend in the browser before rendering in ECharts):

### 6.1 `loess` npm package

- **URL:** https://www.npmjs.com/package/loess
- **GitHub:** https://github.com/yongjun21/loess
- Pure JavaScript, implements the original Cleveland et al. LOESS algorithm.
- Input: `{ x: number[], y: number[], bandwidth?: number }` (bandwidth = span parameter)
- Configurable: degree (linear, quadratic, constant), robustness iterations.
- Lightweight, no dependencies.

### 6.2 `@stdlib/stats-lowess`

- **URL:** https://www.npmjs.com/package/@stdlib/stats-lowess
- Part of the stdlib scientific computing library.
- Well-tested, comprehensive documentation.
- Slightly heavier dependency (imports from stdlib ecosystem).

### 6.3 `commons-math-interpolation`

- **URL:** https://github.com/chdh/commons-math-interpolation
- TypeScript port of Apache Commons Math.
- Includes both LOESS/LOWESS and cubic spline interpolation.
- Good option if we also want spline smoothing.

### 6.4 Custom Implementation

LOESS is conceptually simple enough to implement in ~100 lines of TypeScript if we want to avoid external dependencies. The core algorithm is:
1. For each point, select the k nearest neighbors.
2. Compute tricube weights based on distance.
3. Fit weighted least-squares polynomial.
4. Return the predicted value.

For 30–360 points per suburb, performance is not a concern.

---

## 7. Small-Area & Sparse-Data Methods

The methods in Sections 3–5 assume reasonable sample sizes (25+ transactions per period per area). At street or block level — where you might see 1–5 sales per year or fewer — different approaches are needed.

### 7.1 The Core Problem

At micro-geographic scales, raw statistics are dominated by noise:
- A single outlier sale (knock-down rebuild, deceased estate, prestige property) can swing the "median" by 30%+ when n = 3.
- Many periods will have zero transactions, creating gaps.
- Stratification is moot — you can't split 3 sales into sub-groups.
- Repeat-sales pairs are extremely rare on a single street (a property might sell twice in 30 years).

The fundamental insight: **you need to borrow information from nearby areas to produce meaningful estimates for sparse micro-areas.**

### 7.2 Addressing the Stratification Bias Concern

Stratification does **not** pre-judge which areas are "good" or "bad." It groups properties by *observable characteristics* (house vs unit, size band, zone code) so the median within each group is more comparable over time. It's controlling for the *type* of property that happens to sell, not making value judgments.

However, stratification is irrelevant at street level because there aren't enough observations to stratify meaningfully. The methods below are designed specifically for this sparse-data scenario.

### 7.3 Hierarchical Bayesian Shrinkage (Primary Recommendation)

**How it works:**

The model assumes that each micro-area's true price trend is drawn from a broader distribution (the suburb or region). When local data is sparse, the estimate is "shrunk" toward the suburb-level average. When local data is plentiful, the local data dominates.

**Mathematically (simplified):**
```
street_estimate = w × street_raw_median + (1 - w) × suburb_median
```
Where `w` is proportional to the local sample size. With 1–2 sales, w is near 0 (heavy shrinkage, estimate ≈ suburb trend). With 20+ sales, w approaches 1 (minimal shrinkage, estimate ≈ local data).

**Why this is statistically sound:**
- The James-Stein estimator (1961) proved mathematically that shrinkage estimators *always* have lower mean squared error than raw estimates when estimating 3+ parameters simultaneously — even when the shrinkage target is "wrong."
- The Fay-Herriot model is the standard workhorse for small-area estimation in official statistics (used by national census agencies worldwide).
- Empirical Bayes shrinkage is the same principle used in sports analytics (batting averages for rookies with few at-bats), insurance pricing (setting premiums for small groups), and clinical trials (estimating treatment effects for rare conditions).

**Key advantage:** Provides calibrated uncertainty — the posterior distribution is wide when data is sparse and narrow when plentiful, so confidence bands naturally reflect what we know.

**Our available auxiliary data for the prior:**
- Suburb/locality median (geographic hierarchy)
- Strata flag (property type)
- Area sqm (size)
- Zone code (land use)
- Custom spatial polygon boundaries (user-defined areas)

**Implementation paths:**
- **Simple (no external deps):** Weighted average of street median and suburb LOESS trend, where weight = `n_street / (n_street + k)` with k ≈ 10–20 as a tuning parameter. This is an empirical Bayes approximation.
- **Full Bayesian:** Use Stan, PyMC, or a similar framework on the server side. More principled but heavier infrastructure.

### 7.4 Geographically Weighted Regression (GWR)

**How it works:**

For a target location, weight all nearby sales by distance (using a Gaussian or tricube kernel). Fit a regression of price on property characteristics using these distance-weighted observations. The result is a local price estimate that blends nearby data smoothly.

**Key parameters:**
- **Kernel function:** Gaussian, tricube, or bi-square. Choice matters less than bandwidth.
- **Bandwidth:** The critical parameter. Narrow = very local (noisy), wide = regional (smooth). Adaptive bandwidth (narrower where data is dense, wider where sparse) is preferred.

**Time series extension — GTWR:**

Geographically and Temporally Weighted Regression adds temporal distance weighting: a sale from 6 months ago near your target is weighted more than a sale from 5 years ago nearby. This produces spatio-temporal price surfaces.

**Advantages for micro-areas:**
- Spatially continuous — can estimate price at any location, not just where sales occurred.
- No minimum sample size at any single point (borrows from neighbors).
- Naturally adapts: in data-dense areas it's hyper-local; in sparse areas it widens.

**Limitations:**
- Computational cost is O(n × m) where n = total sales and m = prediction points.
- Bandwidth selection has "substantially more impact on results than choice of kernel function" — needs careful tuning.
- Doesn't directly produce a clean time series line; produces a price surface that must be queried at specific locations and times.

### 7.5 Spatio-Temporal Kriging

**How it works:**

Kriging is a geostatistical interpolation method that:
1. Models spatial autocorrelation via a **variogram** (how price similarity decays with distance).
2. Produces predictions at unsampled locations as a weighted average of observed sales.
3. Provides both a point estimate AND an uncertainty estimate at every location.

Spatio-temporal kriging extends this to model correlation across both space and time.

**Key advantage:** The kriging variance (uncertainty) is highest in areas with sparse data, naturally reflecting estimation confidence. This makes it ideal for producing uncertainty bands.

**Limitation for street-level use:** The variogram requires ~50–100+ observations across the spatial domain to estimate reliably. At individual street level, you'd need to estimate the variogram from the broader suburb and apply it locally — feasible but adds complexity.

**Best use:** Computing uncertainty bands around trend estimates, rather than as the primary trend method. Pair with hierarchical shrinkage for the point estimate and kriging for the confidence envelope.

### 7.6 Why Repeat-Sales Fails at Micro Scale

Repeat-sales requires the *same property* to sell multiple times. On a single street:
- A typical residential property turns over every 10–15 years.
- A street with 20 properties might see 1–2 repeat-sale pairs per decade.
- The Weighted Repeat Sales (WRS) index becomes biased and unstable when transaction volume is low.

**When it does work:** At suburb or LGA level, repeat-sales is excellent. Consider a two-tier approach: repeat-sales index for the suburb, with individual property sale dots overlaid for the street.

### 7.7 Automated Valuation Model (AVM) Patterns

Industry leaders (CoreLogic, Zillow) solve micro-area estimation using **comparable sales analysis** augmented with machine learning:

**Core approach:**
1. For a target property, find the most similar recently-sold properties within a geographic radius.
2. Adjust each comparable's price for differences (size, type, condition, location).
3. Compute a weighted estimate from the adjusted comparables.

**Zillow Zestimate:** Uses a neural network trained on hundreds of features per property. Median error: 3.2% for on-market homes, 7.5% for off-market. Updates multiple times per week.

**CoreLogic Total Home ValueX:** Leverages 50+ years of property records covering 99.9%+ of US properties. Outputs confidence scores indicating estimated accuracy — lower confidence in thin markets.

**Key takeaway for us:** Even industry leaders output **confidence scores** alongside estimates. When data is sparse, the honest thing is to show wider uncertainty bands, not to pretend confidence we don't have.

### 7.8 Uncertainty Visualization

At micro-area scale, visualizing uncertainty is as important as the estimate itself.

**Confidence intervals on small-sample medians:**

For non-parametric confidence intervals on a median with small n, order statistics define exact coverage:
- n = 5 sales: the 1st and 5th values bracket the true median with ~94% confidence.
- n = 10 sales: the 3rd and 8th values give ~89% confidence.
- n = 20 sales: the 7th and 14th values give ~99% confidence.

No normality assumption required — this is distribution-free.

**Bootstrap confidence intervals:**

Resample the sparse sales with replacement (1000+ iterations), compute the median of each resample, then take the 2.5th and 97.5th percentiles. Works for any sample size, makes no distributional assumptions.

**Visualization approaches:**
- **Confidence bands:** Shaded region around the trend line, widening where data is sparse.
- **Fan charts:** Concentric bands showing increasing uncertainty ranges (50%, 80%, 95%).
- **Opacity/color coding:** Darker line segments where more data supports the estimate, lighter/dashed where sparse.
- **Individual sale dots:** Plot each actual sale as a dot overlaid on the trend, so users see both the raw data and the smoothed estimate.

**Research finding:** "Medium" uncertainty visualization (visible but not overwhelming bands) best supports user decision-making. Overly tight bands seem overconfident; overly wide bands seem useless.

### 7.9 Practical Recommendations for Micro-Area Analysis

**Tier 1 — Simplest (high value, low effort):**

Show the **suburb-level LOESS trend** as the baseline, with **individual sale dots** for the target street/block overlaid. This immediately tells the user: "here's the neighborhood trend, and here's where specific properties on your street sold relative to it." No statistical modeling needed — just query filtering and visualization.

**Tier 2 — Empirical Bayes shrinkage (moderate effort):**

Compute a **blended estimate** at each time period:
```
estimate = w × local_median + (1 - w) × suburb_loess
w = n_local / (n_local + k)     // k ≈ 10-20
```

With 1 sale in a period, w ≈ 0.05–0.1 → estimate is ~90–95% the suburb trend.
With 10 sales, w ≈ 0.5 → estimate is a 50/50 blend.
With 50+ sales, w ≈ 0.8+ → estimate is mostly the local data.

Show confidence bands: narrow when n is large, wide when n is small.

**Tier 3 — Full spatio-temporal model (high effort):**

GWR or kriging-based approach that produces a continuous price surface. Computationally expensive, requires server-side processing, but produces the most nuanced micro-area estimates.

**Tier 4 — Repeat-sales at property level:**

For a specific street, find properties that sold multiple times. Show their individual price trajectories (Property A: $800k in 2010 → $1.2M in 2022). Even 3–5 repeat-sale pairs on one street tells a compelling story about real appreciation, free from composition bias.

### 7.10 Summary: Small-Area Methods

| Method | Data Requirement | Effort | Statistical Rigor | Best For |
|--------|-----------------|--------|-------------------|----------|
| **Individual dots on suburb LOESS** | Any n (even 1 sale) | Very low | N/A (visual only) | **Start here** |
| **Empirical Bayes shrinkage** | Any n + suburb data | Low–medium | High | **Primary micro-area trend** |
| **GWR/GTWR** | 50+ nearby sales | Medium | High | Spatial heterogeneity analysis |
| **Spatio-temporal kriging** | 50–100+ in spatial domain | High | Very high | Uncertainty quantification |
| **Repeat-sales (property-level)** | 2+ sales per property | Low | Very high | Individual property appreciation |
| **AVM-style comparables** | Many nearby sales + attributes | High | Moderate | Individual property valuation |

---

## 8. Summary Comparison Tables

### Smoothing Methods

| Method | Speed | Non-Linear Adaptivity | Captures Recent Spikes? | Edge Behavior | Best For |
|--------|-------|----------------------|------------------------|---------------|----------|
| **LOESS** | Fast enough (O(n²) but n<400) | Excellent | Yes (with moderate span) | Good | **Primary trend line** |
| Moving Average | Very fast | Poor | No (dilutes by 1/k) | Lags | Simple secondary reference |
| Exponential | Very fast | Poor (assumes linear) | Better than MA | No lag | Forecasting, not visualization |
| Polynomial | Fast | Very poor (oscillates) | No | Very poor (Runge's) | Avoid |
| Smoothing Spline | Fast | Good | Yes | Good | Large-scale batch computation |
| Savitzky-Golay | Very fast | Moderate | Moderate | Poor at edges | Signal processing (avoid) |
| Kernel Regression | Moderate | Moderate (< LOESS) | Moderate | Good | Use LOESS instead |

### Data Quality Methods (for our NSW VG dataset)

| Method | Required Fields | Effort | Noise Reduction | Recommendation |
|--------|----------------|--------|-----------------|----------------|
| **Stratified median** | strata, area, zone, locality | Low | 30–50% | **Implement first** |
| **$/sqm normalization** | area, price | Low | Medium | **Already available** |
| **Repeat-sales index** | property_id, price, date | Medium | Very high (gold standard) | **Medium-term project** |
| Simple hedonic | area, strata, zone, locality | Medium | Moderate (40–60% R²) | Secondary refinement |
| Sample size flagging | transaction counts | Low | N/A (transparency) | **Quick win** |
| Trimmed mean / IQM | price | Low | Low | Skip (median suffices) |

---

## 9. Sources

### Industry Methodologies
- [CoreLogic Hedonic Home Value Index](https://www.corelogic.com.au/our-data/corelogic-indices/type-of-indices)
- [Cotality Indices](https://www.cotality.com/au/our-data/indices)
- [S&P CoreLogic Case-Shiller Methodology](https://www.spglobal.com/spdji/en/methodology/article/sp-corelogic-case-shiller-home-price-indices-methodology/)
- [Case-Shiller Index (Wikipedia)](https://en.wikipedia.org/wiki/Case%E2%80%93Shiller_index)
- [Repeat Sales House Price Index Methodology (Wharton)](https://realestate.wharton.upenn.edu/wp-content/uploads/2017/03/724.pdf)
- [Zillow Home Value Index Methodology 2023](https://www.zillow.com/research/methodology-neural-zhvi-32128/)
- [UK House Price Index](https://landregistry.data.gov.uk/app/ukhpi/)
- [ABS Residential Property Price Indexes Methodology](https://www.abs.gov.au/methodologies/residential-property-price-indexes-eight-capital-cities-methodology/mar-2021)
- [OECD Residential Property Price Indices FAQ](https://www.oecd.org/en/data/insights/data-explainers/2024/07/Residential-Property-Price-Indices-and-related-housing-indicators-Frequently-Asked-Questions.html)
- [OECD Handbook on Residential Property Price Indices](https://www.oecd.org/en/publications/handbook-on-residential-property-price-indices_9789264197183-en.html)

### Composition Bias & Volatility
- [Impact of Compositional Change on Median Price Measures (RBA, 2006)](https://www.rba.gov.au/publications/rdp/2006/2006-04/impact-of-compositional-change-on-median-price-measures.html)
- [Using Stratification to Improve Median-based Measures (RBA PDF)](https://www.rba.gov.au/publications/rdp/2006/pdf/rdp2006-04.pdf)
- [A rapidly updating stratified mix-adjusted median property price index model (IEEE/arXiv)](https://arxiv.org/abs/2009.10532)
- [IMF: How to Better Measure Hedonic Residential Property Price Indexes](https://www.imf.org/external/pubs/ft/wp/2016/wp16213.pdf)
- [St. Louis Fed: A Closer Look at House Price Indexes](https://www.stlouisfed.org/publications/regional-economist/july-2011/a-closer-look-at-house-price-indexes)

### Smoothing Methods
- [LOESS (NIST Engineering Statistics Handbook)](https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd144.htm)
- [Local Regression (Wikipedia)](https://en.wikipedia.org/wiki/Local_regression)
- [Fundamentals of Data Visualization — Visualizing Trends (Claus Wilke)](https://clauswilke.com/dataviz/visualizing-trends.html)
- [Runge's Phenomenon (Wikipedia)](https://en.wikipedia.org/wiki/Runge's_phenomenon)
- [Exponential Smoothing (Wikipedia)](https://en.wikipedia.org/wiki/Exponential_smoothing)
- [STL Decomposition (Forecasting: Principles and Practice)](https://otexts.com/fpp2/stl.html)

### Hedonic Methods
- [Hedonic versus repeat-sales housing price indexes (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S105113771000015X)
- [IMF Handbook on Residential Property Prices — Hedonic Regression Chapter](https://www.elibrary.imf.org/display/book/9789279259845/ch005.xml)

### JavaScript Libraries
- [loess npm package](https://www.npmjs.com/package/loess) — [GitHub](https://github.com/yongjun21/loess)
- [@stdlib/stats-lowess](https://www.npmjs.com/package/@stdlib/stats-lowess)
- [commons-math-interpolation (TypeScript)](https://github.com/chdh/commons-math-interpolation)

### Small-Area Estimation & Spatial Methods
- [Bayesian Hierarchical Spatial Models for Small Area Estimation (US Census)](https://www.census.gov/library/working-papers/2020/adrm/RRS2020-07.html)
- [James-Stein Estimator (Wikipedia)](https://en.wikipedia.org/wiki/James%E2%80%93Stein_estimator)
- [Small Area Estimation (Wikipedia)](https://en.wikipedia.org/wiki/Small_area_estimation)
- [Shrinkage and Empirical Bayes to Improve Inference](https://kiwidamien.github.io/shrinkage-and-empirical-bayes-to-improve-inference.html)
- [Spatial Analysis of Housing Prices with GWR (MDPI)](https://www.mdpi.com/2220-9964/9/6/380)
- [How GWR Works — ArcGIS Pro](https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-statistics/how-geographicallyweightedregression-works.htm)
- [Kriging House Prices (UT Austin)](https://www.jsg.utexas.edu/helper/files/EstradaS2014.pdf)
- [Estimation of Housing Price Variations Using Spatio-Temporal Data (MDPI)](https://www.mdpi.com/2071-1050/11/6/1551)
- [Spatio-Temporal Gaussian Process Regression for Real Estate (ACM)](https://dl.acm.org/doi/10.1145/2996913.2996960)
- [Repeat Sales Index for Thin Markets (Springer)](https://link.springer.com/article/10.1007/s11146-009-9203-1)
- [What is a Zestimate? (Zillow)](https://www.zillow.com/zestimate/)
- [CoreLogic Automated Valuation Model](https://www.businesswire.com/news/home/20201021005311/en/Unmatched-Accuracy-Confidence-and-Reliability-CoreLogic-Launches-New-Automated-Valuation-Model)
- [Automated Valuation Model (Wikipedia)](https://en.wikipedia.org/wiki/Automated_valuation_model)
- [Visualizing Uncertainty in Time Series Forecasts (Wiley)](https://onlinelibrary.wiley.com/doi/full/10.1002/for.3222)
- [Fundamentals of Data Visualization — Uncertainty (Claus Wilke)](https://clauswilke.com/dataviz/visualizing-uncertainty.html)
- [Confidence Interval on a Median (PNNL)](https://vsp.pnnl.gov/help/vsample/Design_CI_Median.htm)
