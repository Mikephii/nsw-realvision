/**
 * Type declarations for the `loess` npm package (v1.3.x).
 *
 * @see https://github.com/yongjun21/loess
 *
 * The package exports a Loess class that fits locally weighted regression
 * models. It has no built-in TypeScript types.
 */
declare module 'loess' {
  /** Input data for the LOESS model. */
  interface LoessData {
    /** Response variable (y-values). */
    y: Array<number>
    /** Primary predictor variable (x-values). */
    x: Array<number>
    /** Optional second predictor for bivariate LOESS. */
    x2?: Array<number>
    /** Optional observation weights. */
    w?: Array<number>
  }

  /** Configuration options for the LOESS model. */
  interface LoessOptions {
    /**
     * Bandwidth (span) parameter. Controls what fraction of the data
     * influences each local fit. Range: 0 to Infinity. Default: 0.75.
     */
    span?: number
    /**
     * Confidence band width. 0 = no band, 1 = full band. Default: 0.
     */
    band?: number
    /**
     * Degree of local polynomial.
     * - 0 or 'constant': locally constant (Nadaraya-Watson).
     * - 1 or 'linear': locally linear.
     * - 2 or 'quadratic': locally quadratic (default).
     */
    degree?: 0 | 1 | 2 | 'constant' | 'linear' | 'quadratic'
    /**
     * Whether to normalize predictors before computing distances.
     * Default: true for degree > 1.
     */
    normalize?: boolean
    /**
     * Enable iterative robust fitting to downweight outliers.
     * Default: false.
     */
    robust?: boolean
    /**
     * Number of robustness iterations. Default: 4 if robust, else 1.
     */
    iterations?: number
  }

  /** Result of a LOESS prediction. */
  interface LoessPrediction {
    /** Fitted (smoothed) y-values at the prediction points. */
    fitted: Array<number>
    /** Half-width of the confidence interval at each point. */
    halfwidth: Array<number>
  }

  /**
   * LOESS regression model.
   *
   * Construct with training data and options, then call `.predict()`
   * to get fitted values.
   */
  class Loess {
    constructor(data: LoessData, options?: LoessOptions)
    /**
     * Compute fitted values. If `data` is provided, predicts at those
     * new x-positions; otherwise predicts at the training x-positions.
     */
    predict(data?: Partial<LoessData>): LoessPrediction
    /**
     * Generate a grid of equally-spaced prediction points.
     * @param cuts - Number of grid points along each axis.
     */
    grid(cuts: Array<number>): LoessPrediction
  }

  export default Loess
}
