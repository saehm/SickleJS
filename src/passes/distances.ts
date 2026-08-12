/**
 * Streaming pass over pairwise distances.
 *
 * Accumulates every moment the distance-based metrics need in one sweep, in
 * O(N^2) time and O(N) memory -- the N x N matrices are never materialised.
 * All accumulators are compensated (see `core/sum.ts`): at N=10000 this sums
 * 10^8 terms, where naive float64 addition would cost eight digits.
 *
 * ## Convention: the full matrix, including the zero diagonal
 *
 * zadu flattens the complete N x N distance matrix (`pearson_r.py` calls
 * `.flatten()`; `stress.py` sums over the whole matrix), so the N zeros on the
 * diagonal are included. That matters: for Pearson correlation the diagonal
 * shifts both means and changes the result substantially -- on one test fixture
 * it is the difference between 0.0518 and 0.0118. This pass follows zadu so the
 * numbers are directly comparable; `pairs` records the count actually used.
 */

import { type PointsInput, type Vectors, toVectors } from "../core/vectors.ts";
import { reduceFused } from "./analyze.ts";
import { fusedPartial } from "./fused.ts";

/** * @category Passes * @group Passes */
export interface DistanceMoments {
    readonly n: number;
    /** Number of terms accumulated: N^2, including the zero diagonal. */
    readonly pairs: number;
    readonly sumH: number;
    readonly sumL: number;
    readonly sumHH: number;
    readonly sumLL: number;
    readonly sumHL: number;
    /** sum of (dH - dL)^2 */
    readonly sumDiff2: number;
    /** Per-point sum of (dH - dL)^2 over that point's row. Sums to `sumDiff2`. */
    readonly rowDiff2: Float64Array;
    /** Per-point sum of dH^2 over that point's row. */
    readonly rowHH: Float64Array;
}

/** * @category Passes * @group Passes */
export interface DistancePassOptions {
    onProgress?: (fraction: number) => void;
    progressInterval?: number;
    signal?: AbortSignal;
}

/**
 * Delegates to the shared row loop in `fused.ts` with the rank accumulators
 * switched off, so there is exactly one implementation of the sweep.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { distanceMoments, stress, pearsonR } from "@saehrimnir/sickle";
 *
 * // The distance half of `analyze`, when you do not need the ranks — much
 * // cheaper, since nothing has to be sorted.
 * const m = distanceMoments(data, projection);
 *
 * stress(m).value;    // 0.0807
 * pearsonR(m).value;  // 0.9967
 * ```
 */
export function distanceMoments(
    hdIn: PointsInput, ldIn: PointsInput, opts: DistancePassOptions = {},
): DistanceMoments {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    return reduceFused([fusedPartial(hd, ld, { ...opts, ranks: false, distances: true })]).moments;
}
