/**
 * Explainer content registry for statistical methods used in widgets.
 *
 * Each method that appears as a toggle in widget settings has a corresponding
 * entry here. The content is written in plain English for non-technical
 * property investors. New methods are added to this registry as they're
 * implemented (one entry per tier in the implementation roadmap).
 *
 * The {@link MethodExplainer} component reads from this registry to render
 * info dialogs when the user clicks the ⓘ icon next to a method toggle.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Unique identifier for a statistical method used in widgets.
 * Extend this union as new methods are implemented in later tiers.
 */
export type MethodId =
  | 'loess'
  | 'moving-average'
  | 'trend-fit'
  | 'repeat-sales'
  | 'empirical-bayes'
  | 'neighbor-fill'

/**
 * Content for a statistical method explainer dialog.
 * Written in plain English for non-technical property investors.
 */
export interface MethodExplainerContent {
  /** Display title shown at the top of the explainer dialog. */
  title: string

  /**
   * 2-3 sentence plain-English summary of what the method does.
   * Should answer: "What am I looking at when this is turned on?"
   */
  summary: string

  /** Bullet points explaining why this method helps the user. */
  benefits: Array<string>

  /**
   * Plain-English description of each configurable parameter.
   * Only present for methods with user-adjustable settings.
   */
  parameters?: Array<{ name: string; description: string }>

  /** Honest limitations the user should know about. */
  caveats: Array<string>
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Explainer content for every registered statistical method.
 *
 * Keyed by {@link MethodId}. Every method ID in the union MUST have
 * a corresponding entry here — enforced by the type and by unit tests.
 */
export const METHOD_EXPLAINERS: Record<MethodId, MethodExplainerContent> = {
  loess: {
    title: 'LOESS Smoothing',
    summary:
      'LOESS (Locally Weighted Scatterplot Smoothing) fits a flexible curve through your data by averaging nearby points. Unlike a straight trend line, it can follow periods of growth, flat markets, and declines without forcing a single shape.',
    benefits: [
      'Reveals the underlying trend hidden behind noisy quarter-to-quarter or year-to-year swings.',
      'Adapts to changing market conditions — it shows growth phases, plateaus, and downturns as they happen.',
      "Comparing LOESS curves between areas is fair as long as the same smoothness setting is used (which it is — it's a per-widget setting).",
    ],
    parameters: [
      {
        name: 'Smoothness',
        description:
          'Controls how much detail the curve shows. Low values (0.10–0.20) follow short-term movements closely. Medium values (0.30–0.40) give a balanced view — recommended for most use cases. High values (0.50+) show only the broad long-term trend.',
      },
    ],
    caveats: [
      'LOESS smooths both real movements and noise — a genuine sharp spike will be partially muted.',
      'The curve at the very start and end of the time range has fewer neighbours to average, so it may be slightly less reliable there.',
    ],
  },

  'moving-average': {
    title: 'Moving Average',
    summary:
      'A moving average replaces each data point with the average of the most recent few periods. This smooths out short-term fluctuations, making longer-term trends easier to see.',
    benefits: [
      'Simple and intuitive — easy to understand what the number means.',
      'Good for spotting whether a market is trending up or down over recent years.',
    ],
    parameters: [
      {
        name: 'Window',
        description:
          'How many periods to average together. A 3-period window (e.g., 3 years) provides moderate smoothing. A 5 or 7-period window produces a smoother line but reacts more slowly to real changes.',
      },
    ],
    caveats: [
      "Moving averages lag behind real changes — a sudden market shift won't show up until several periods later.",
      'A genuine 20% spike in one year gets diluted to roughly 7% with a 3-year average.',
      "All periods in the window are weighted equally, so a 3-year-old observation has the same influence as last year's.",
    ],
  },

  'trend-fit': {
    title: 'Trend-Fit Regression',
    summary:
      "Instead of comparing just two endpoints (start vs end year), trend-fit draws a best-fit line through ALL yearly medians in the time window. This uses every data point to estimate the growth rate, so one unusual year can't dominate the result.",
    benefits: [
      "More stable growth estimates — a single outlier year at the start or end of the window won't distort the rate.",
      'Uses all available data in the time window, not just two snapshots.',
      'Particularly useful in volatile or noisy markets where endpoint comparison can give misleading results.',
    ],
    caveats: [
      'Assumes growth is roughly exponential over the window — a genuine market regime change (e.g., rapid growth then sudden plateau) mid-window will be averaged out.',
      'Areas with very few years of data fall back to endpoint comparison automatically.',
    ],
  },

  'empirical-bayes': {
    title: 'Bayesian Estimate for Sparse Data',
    summary:
      'When an area has very few sales in a period, the raw median can jump around dramatically. The Bayesian estimate blends the local data with the broader trend from all areas on the chart, weighted by how many sales actually occurred. More sales means the local data dominates; fewer sales means the estimate leans toward the broader trend.',
    benefits: [
      'Produces stable price estimates even for streets or small areas with only 1-5 sales per period.',
      'Automatically adjusts — areas with plenty of sales show almost no blending, while sparse areas get stabilized.',
      'The dashed line shows the estimate alongside your raw data, so you can see both perspectives.',
    ],
    parameters: [
      {
        name: 'Shrinkage Strength (k)',
        description:
          'Controls how quickly the estimate trusts local data. With the default of 15, an area needs about 15 sales in a period before local data carries 50% of the weight. With fewer sales, the estimate leans more toward the broader trend.',
      },
    ],
    caveats: [
      'The "broader trend" is computed from all series currently on the chart. Adding or removing suburbs changes the reference.',
      "When only one series is on the chart, the reference is that series' own smoothed trend — the estimate simply smooths out volatile periods.",
      'The dashed estimate line can mask genuine local price movements in areas with few sales.',
    ],
  },

  'neighbor-fill': {
    title: 'Neighbor Fill for Sparse Areas',
    summary:
      "When hex cells on the heatmap have too few sales to compute growth directly, this feature estimates values by averaging the growth rates of nearby cells that do have data. The estimate is weighted by each neighbor's sale count, so well-sampled areas have more influence.",
    benefits: [
      'Fills visual gaps in the heatmap where data is sparse, giving a more complete picture of regional growth patterns.',
      'Clearly distinguished from real data — estimated cells are shown as semi-transparent hexagonal overlays, not part of the smooth gradient.',
      'Only fills cells with at least two observed neighbors, preventing unreliable single-point extrapolation.',
    ],
    caveats: [
      'Estimated values are weighted averages of neighbors — they smooth out local variation and should not be interpreted as precise growth rates.',
      'Areas with only one neighboring data cell are left empty to avoid misleading estimates.',
      'Assumes growth transitions gradually between adjacent areas, which may not hold across sharp boundaries like rivers, highways, or zoning changes.',
    ],
  },

  'repeat-sales': {
    title: 'Repeat Sales Only',
    summary:
      "Restricts the analysis to properties that have sold at least twice. By tracking the same set of properties over time, changes in what's being sold can't distort the trend — you're comparing like with like.",
    benefits: [
      "Eliminates composition bias — a flood of new apartments or a single luxury sale won't skew the median.",
      'More reliable trend indicator because the underlying basket of properties is consistent.',
      'Particularly valuable in areas where the mix of property types changes significantly year to year.',
    ],
    caveats: [
      'Reduces the sample size, sometimes significantly. Areas with few repeat sales may show noisier results.',
      'Excludes brand-new developments (first sale only) — this can understate activity in high-growth new-build areas.',
      'Properties that have sold multiple times may not be representative of the entire market (e.g., more investment properties, fewer owner-occupiers).',
    ],
  },
}

/**
 * Look up explainer content for a method.
 *
 * @param methodId - The method to look up.
 * @returns The explainer content, or undefined if the method ID is not registered.
 */
export function getMethodExplainer(
  methodId: string,
): MethodExplainerContent | undefined {
  return METHOD_EXPLAINERS[methodId as MethodId]
}
