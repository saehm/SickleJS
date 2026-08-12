/**
 * Population quantile, matching the definition used by `simple-statistics` v6.
 *
 * This is reimplemented rather than depended on for a specific reason:
 * `simple-statistics` changed its quantile interpolation in v7, which silently
 * shifts two of the nine scagnostics (`skewed` and `sparse`). Pinning a
 * dependency to an old major to preserve a numeric definition is fragile; making
 * the definition explicit here is not.
 *
 * The rule, for a sorted sample `x` of length `n` and `idx = n * p`:
 *
 *   p === 1        -> last element
 *   p === 0        -> first element
 *   idx fractional -> x[ceil(idx) - 1]
 *   n even         -> mean of x[idx - 1] and x[idx]
 *   otherwise      -> x[idx]
 *
 * (`simple-statistics` uses quickselect to avoid a full sort; sorting yields the
 * same value, and these arrays are small -- MST edge counts, not N^2.)
 */

export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
    const n = sorted.length;
    if (n === 0) throw new Error("quantile requires at least one data point");
    if (p < 0 || p > 1) throw new RangeError("quantile p must be between 0 and 1");

    const idx = n * p;
    if (p === 1) return sorted[n - 1];
    if (p === 0) return sorted[0];
    if (idx % 1 !== 0) return sorted[Math.ceil(idx) - 1];
    if (n % 2 === 0) return (sorted[idx - 1] + sorted[idx]) / 2;
    return sorted[idx];
}

export function quantile(values: ArrayLike<number>, p: number): number {
    const copy = Float64Array.from(values);
    copy.sort();
    return quantileSorted(copy, p);
}

/** Several quantiles of one sample, sorting once. */
export function quantiles(values: ArrayLike<number>, ps: readonly number[]): number[] {
    const copy = Float64Array.from(values);
    copy.sort();
    return ps.map((p) => quantileSorted(copy, p));
}
