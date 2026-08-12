/**
 * Kruskal's non-metric stress: distance preservation judged only up to ordering.
 *
 * Needs O(N²) memory, since the pairs must be sorted.
 */

import type { MetricResult } from "../core/result.ts";
import { makeRadixScratch, radixArgsort } from "../core/sort.ts";
import { Accumulator } from "../core/sum.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";

/**
 * Recover the pair `(i, j)` from its position in the `i < j` enumeration.
 *
 * Storing the endpoints alongside every pair costs 8 bytes each; inverting the
 * enumeration costs a square root. At tens of millions of pairs that trade is
 * worth making.
 *
 * Row `i` starts at `offset(i) = i(n-1) - i(i-1)/2`, so `i` is the root of
 * `i^2 - i(2n-1) + 2p = 0`. The result is corrected for floating-point drift.
 */
function pairEndpoints(p: number, n: number, out: [number, number]): void {
    const b = 2 * n - 1;
    let i = Math.floor((b - Math.sqrt(b * b - 8 * p)) / 2);
    const offset = (r: number) => r * (n - 1) - (r * (r - 1)) / 2;
    while (i > 0 && offset(i) > p) --i;
    while (offset(i + 1) <= p) ++i;
    out[0] = i;
    out[1] = i + 1 + (p - offset(i));
}

/** * @category Distance * @group Distance */
export interface NonMetricStressOptions {
    /**
     * Refuse to run beyond this many pairs, rather than attempting the
     * allocation. Counts `n(n-1)/2`, so the default 60e6 admits N up to about
     * 11 000. Budget roughly 44 bytes per pair: the distances, the sort order,
     * the sorted copies and the fitted disparities all have to coexist.
     */
    maxPairs?: number;
    signal?: AbortSignal;
}

/**
 * Pool-adjacent-violators: the best non-decreasing fit to `y` in weighted least
 * squares. Exposed for building Shepard diagrams; most callers want
 * {@link nonMetricStress}.
 *
 * @internal
 */
export function pava(y: Float64Array, weight: Float64Array): Float64Array {
    const n = y.length;
    if (n === 0) return y;
    const value = new Float64Array(n);
    const mass = new Float64Array(n);
    const size = new Int32Array(n);
    let blocks = 0;

    for (let i = 0; i < n; ++i) {
        value[blocks] = y[i];
        mass[blocks] = weight[i];
        size[blocks] = 1;
        blocks += 1;
        // Merge backwards while the sequence decreases.
        while (blocks > 1 && value[blocks - 2] > value[blocks - 1]) {
            const w = mass[blocks - 2] + mass[blocks - 1];
            value[blocks - 2] = w === 0
                ? (value[blocks - 2] + value[blocks - 1]) / 2
                : (value[blocks - 2] * mass[blocks - 2] + value[blocks - 1] * mass[blocks - 1]) / w;
            mass[blocks - 2] = w;
            size[blocks - 2] += size[blocks - 1];
            blocks -= 1;
        }
    }

    const out = new Float64Array(n);
    let at = 0;
    for (let b = 0; b < blocks; ++b) {
        for (let k = 0; k < size[b]; ++k) out[at++] = value[b];
    }
    return out;
}

/** * @category Distance * @group Distance */
export interface NonMetricStressResult extends MetricResult {
    /** Disparities: the fitted monotone curve, in ascending order of dH. */
    readonly disparities: Float64Array;
    /** Pair distances in the same order, for a Shepard diagram. */
    readonly sortedHigh: Float64Array;
    readonly sortedLow: Float64Array;
}

/**
 * Stress measured against the best monotone fit rather than the raw distances.
 *
 * Forgives any distortion that preserves the *ordering* of distances, penalising
 * only departures from monotonicity. The most permissive member of the stress
 * family: use it when only the ranking of distances is meant to be meaningful.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], **lower is better**; 0 means the projected distances are a
 *   monotone function of the originals. The bound holds because the all-zero curve
 *   is a feasible monotone fit scoring exactly 1, so the best fit cannot do worse.
 * - Cost: O(N² log N) time and **O(N²) memory** — the pairs must be sorted, so
 *   unlike most measures here they are materialised. `maxPairs` guards the
 *   allocation.
 *
 * `disparities`, `sortedHigh` and `sortedLow` give the fitted curve and the points
 * it was fitted to, which plot directly as a Shepard diagram.
 *
 * @see Kruskal, Psychometrika 29 (1964) {@link https://doi.org/10.1007/BF02289565}
 *
 * @category Distance
 * @group Distance
 *
 * @example
 * ```ts
 * import { nonMetricStress } from "@saehrimnir/sickle";
 *
 * const s = nonMetricStress(data, projection);
 * s.value;  // 0.0311 — only departures from monotonicity are charged
 *
 * // The fitted curve and the pairs it was fitted to plot as a Shepard diagram.
 * s.sortedHigh.length;  // 19900 — n(n-1)/2 pairs
 * s.disparities[0];     // the monotone fit at the smallest original distance
 * ```
 */
export function nonMetricStress(
    hdIn: PointsInput, ldIn: PointsInput, opts: NonMetricStressOptions = {},
): NonMetricStressResult {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const n = hd.n;
    const pairs = (n * (n - 1)) / 2;
    const maxPairs = opts.maxPairs ?? 60e6;
    if (pairs > maxPairs) {
        throw new RangeError(
            `nonMetricStress needs to materialise ${pairs} pairs (~${Math.round(pairs * 44 / 1e6)} MB); ` +
            `n=${n} exceeds maxPairs=${maxPairs}. Raise maxPairs to override.`,
        );
    }

    const dh = new Float64Array(pairs);
    const dl = new Float64Array(pairs);

    const hdData = hd.data, ldData = ld.data, dH = hd.d, dL = ld.d;
    let at = 0;
    for (let i = 0; i < n; ++i) {
        if ((i & 63) === 0) opts.signal?.throwIfAborted();
        for (let j = i + 1; j < n; ++j) {
            let a = 0;
            for (let c = 0; c < dH; ++c) { const t = hdData[i * dH + c] - hdData[j * dH + c]; a += t * t; }
            let b = 0;
            for (let c = 0; c < dL; ++c) { const t = ldData[i * dL + c] - ldData[j * dL + c]; b += t * t; }
            dh[at] = Math.sqrt(a);
            dl[at] = Math.sqrt(b);
            at += 1;
        }
    }

    // Sort pairs by original distance, with the radix sort from `core/sort.ts`
    // rather than a comparator over a boxed array: at tens of millions of pairs
    // the callback alone dominates, and the boxed array costs as much as the
    // distances it indexes.
    //
    // The reference breaks ties by projected distance before falling back to the
    // index. That ordering is unobservable here: pairs sharing an original
    // distance are pooled and averaged before the fit, so their internal order
    // cannot change the disparities or the residual sum. Ties therefore break by
    // index alone, which the radix sort already guarantees.
    const order = new Uint32Array(pairs);
    for (let i = 0; i < pairs; ++i) order[i] = i;
    {
        const scratch = makeRadixScratch(pairs);
        radixArgsort(dh, order, pairs, scratch);
    } // scratch is released here, before the disparities are allocated

    const sortedHigh = new Float64Array(pairs);
    const sortedLow = new Float64Array(pairs);
    for (let i = 0; i < pairs; ++i) { sortedHigh[i] = dh[order[i]]; sortedLow[i] = dl[order[i]]; }

    // Pool exact ties in dH before the fit: scikit-learn's IsotonicRegression
    // averages y within tied x and weights the resulting knot by the tie count.
    // Skipping this changes the fit whenever distances repeat.
    const knotY: number[] = [], knotW: number[] = [], knotStart: number[] = [];
    let i = 0;
    while (i < pairs) {
        let j = i + 1;
        while (j < pairs && sortedHigh[j] === sortedHigh[i]) j += 1;
        let sum = 0;
        for (let k = i; k < j; ++k) sum += sortedLow[k];
        knotY.push(sum / (j - i));
        knotW.push(j - i);
        knotStart.push(i);
        i = j;
    }

    const fitted = pava(Float64Array.from(knotY), Float64Array.from(knotW));

    // Expand knot values back to pairs, then accumulate the stress.
    const disparities = new Float64Array(pairs);
    for (let b = 0; b < fitted.length; ++b) {
        const from = knotStart[b];
        const to = b + 1 < knotStart.length ? knotStart[b + 1] : pairs;
        for (let k = from; k < to; ++k) disparities[k] = fitted[b];
    }

    const accNum = new Accumulator(), accDen = new Accumulator();
    const local = new Float64Array(n);
    const endpoints: [number, number] = [0, 0];
    for (let k = 0; k < pairs; ++k) {
        const resid = sortedLow[k] - disparities[k];
        const sq = resid * resid;
        accNum.add(sq);
        accDen.add(sortedLow[k] * sortedLow[k]);
        // Split each pair's residual between its two endpoints.
        pairEndpoints(order[k], n, endpoints);
        local[endpoints[0]] += sq / 2;
        local[endpoints[1]] += sq / 2;
    }

    const num = accNum.value, den = accDen.value;
    const value = den === 0 ? 0 : Math.sqrt(num / den);
    if (num > 0) for (let k = 0; k < n; ++k) local[k] /= num;

    return { value, local, localKind: "share", disparities, sortedHigh, sortedLow };
}
