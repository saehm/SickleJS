/**
 * Neighbourhood measures: is the local structure of the data still there?
 *
 * All are read-outs of one shared pass, so computing several costs no more than
 * computing one. Each is available at a single k, as a curve over every k, and
 * (where it decomposes) per point.
 */

import type { CoRanking } from "../passes/coranking.ts";

/**
 * Largest neighbourhood size trustworthiness and continuity are defined for.
 *
 * `floor(n / 2)`, and the bound is exact rather than cautious.
 *
 * The Venna-Kaski normaliser is the reciprocal of the worst penalty a
 * projection can incur, so that the worst case scores exactly 0. At k = n/2 a
 * maximally wrong projection fills all k neighbour slots with points from the
 * other half, and the two counts meet exactly. Past that there are only
 * n - 1 - k points outside the neighbourhood — fewer than k — so the worst case
 * is bounded by how many wrong points exist rather than by how many slots there
 * are, and the constant no longer normalises it:
 *
 *     n · [ k(n − k) − k(k + 1)/2 ]      k ≤ n/2, what the constant assumes
 *     n · (n − 1 − k)(n − k)/2           above it, the real bound
 *
 * The two agree at `floor(n / 2)` and diverge above it, so the score drifts
 * below 0 — reaching -6.6 on a random projection at n = 200, k = 132.
 *
 * An earlier version allowed `floor((2n − 2)/3)`, which only keeps the
 * denominator `2n − 3k − 1` positive. That is a weaker condition and it admits
 * the whole degenerate range.
 *
 * @example
 * ```ts
 * import { maxKTrustworthiness, maxKQnx, maxKRnx } from "@saehrimnir/sickle";
 *
 * // These take the point count, not a co-ranking matrix.
 * maxKTrustworthiness(200);  // 100 — also the limit for `continuity`
 * maxKQnx(200);              // 199 — also the limit for `lcmc`
 * maxKRnx(200);              // 198
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const maxKTrustworthiness = (n: number): number => Math.floor(n / 2);
/**
 * Largest neighbourhood size `qnx` and `lcmc` are defined for: `n - 1`.
 *
 * @example
 * ```ts
 * import { maxKQnx } from "@saehrimnir/sickle";
 *
 * maxKQnx(200);  // 199 — takes the point count, not a co-ranking matrix
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const maxKQnx = (n: number): number => n - 1;
/**
 * Largest neighbourhood size `rnx` is defined for: `n - 2`, one below
 * {@link maxKQnx} because the rescaling divides by `n - 1 - k`.
 *
 * @example
 * ```ts
 * import { maxKRnx } from "@saehrimnir/sickle";
 *
 * maxKRnx(200);  // 198
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const maxKRnx = (n: number): number => n - 2;

function checkK(k: number, max: number, name: string): void {
    if (!Number.isInteger(k) || k < 1 || k > max) {
        throw new RangeError(`${name}: k must be an integer in [1, ${max}], got ${k}`);
    }
}

/**
 * Venna-Kaski normaliser: 1 / (largest penalty achievable at this k), so a
 * worst-case projection scores exactly 0. Only valid for k <= n/2, which is
 * what `maxKTrustworthiness` enforces -- see the note there.
 */
const tcNorm = (n: number, k: number) => 2 / (n * k * (2 * n - 3 * k - 1));

// --- scalars ---------------------------------------------------------------

/**
 * Are the neighbours you see in the projection real?
 *
 * Penalises points that appear close together but were far apart in the data —
 * the errors that make a viewer believe in a group that does not exist.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], higher is better. A random projection scores about 0.5, so
 *   read that as the practical floor rather than 0.
 * - Cost: O(1), from an O(N² log N) pass.
 *
 * `k` may not exceed `maxKTrustworthiness(n)` = `floor(n / 2)`, which is where
 * the normalisation stops being defined rather than an arbitrary limit.
 *
 * @see Venna & Kaski, Neural Networks 19 (2006)
 *   {@link https://doi.org/10.1016/j.neunet.2006.05.014}
 *
 * @example
 * ```ts
 * import { analyze, trustworthiness } from "@saehrimnir/sickle";
 *
 * // `data` and `projection` are number[][]: 200 points, 8 columns and 2.
 * const a = analyze(data, projection);  // one O(N²·D) sweep
 * trustworthiness(a.coRanking, 20);     // 0.9659
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export function trustworthiness(cr: CoRanking, k: number): number {
    checkK(k, maxKTrustworthiness(cr.n), "trustworthiness");
    return 1 - tcNorm(cr.n, k) * cr.tPenalty[k];
}

/**
 * Are the data's neighbours still together in the projection?
 *
 * The mirror of trustworthiness: it penalises points that were close in the data
 * but got pushed apart — structure the projection hides rather than invents.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], higher is better; about 0.5 for a random projection.
 * - Cost: O(1), from an O(N² log N) pass.
 *
 * `k` may not exceed `maxKTrustworthiness(n)` = `floor(n / 2)`, as for
 * trustworthiness — the two share a normaliser.
 *
 * @see Venna & Kaski, Neural Networks 19 (2006)
 *   {@link https://doi.org/10.1016/j.neunet.2006.05.014}
 *
 * @example
 * ```ts
 * import { analyze, trustworthiness, continuity } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 *
 * // Read both: they catch opposite failures and share one sweep.
 * trustworthiness(a.coRanking, 20);  // 0.9659 — invented neighbours
 * continuity(a.coRanking, 20);       // 0.9709 — hidden neighbours
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export function continuity(cr: CoRanking, k: number): number {
    checkK(k, maxKTrustworthiness(cr.n), "continuity");
    return 1 - tcNorm(cr.n, k) * cr.cPenalty[k];
}

/**
 * Fraction of each point's k nearest neighbours that survive the projection.
 *
 * The rawest neighbourhood measure: no correction, no weighting.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], higher is better. Note the floor rises with k — a random
 *   projection scores about k/(N-1), so values are only comparable at equal k
 *   and N. Use `rnx` to remove that dependence.
 * - Cost: O(1), from an O(N² log N) pass.
 *
 * @example
 * ```ts
 * import { analyze, qnx, rnx } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 *
 * qnx(a.coRanking, 20);  // 0.5657 — but a random projection already scores
 * rnx(a.coRanking, 20);  // 0.5172 — the same quantity, chance subtracted
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export function qnx(cr: CoRanking, k: number): number {
    checkK(k, maxKQnx(cr.n), "qnx");
    return cr.corner[k] / (k * cr.n);
}

/**
 * Neighbourhood overlap with the chance level subtracted.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: (-1, 1], higher is better. 0 means no better than random.
 * - Cost: O(1), from an O(N² log N) pass.
 *
 * @see Chen & Buja, JASA 104 (2009) {@link https://doi.org/10.1198/jasa.2009.0111}
 *
 * @example
 * ```ts
 * import { analyze, lcmc } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * lcmc(a.coRanking, 20);  // 0.4652
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export function lcmc(cr: CoRanking, k: number): number {
    checkK(k, maxKQnx(cr.n), "lcmc");
    return qnx(cr, k) - k / (cr.n - 1);
}

/**
 * Neighbourhood preservation rescaled so chance is 0 and perfect is 1.
 *
 * Preferred over `qnx` when comparing across different k or dataset sizes, since
 * those cancel out.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1] in practice, higher is better; 0 is a random projection.
 * - Cost: O(1), from an O(N² log N) pass.
 *
 * @see Lee & Verleysen, Neurocomputing 72 (2009)
 *   {@link https://doi.org/10.1016/j.neucom.2008.12.017}
 *
 * @example
 * ```ts
 * import { analyze, rnx } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * rnx(a.coRanking, 20);  // 0.5172 on a PCA projection
 * // the same call on a random projection of the same points: 0.0042
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export function rnx(cr: CoRanking, k: number): number {
    checkK(k, maxKRnx(cr.n), "rnx");
    return ((cr.n - 1) * qnx(cr, k) - k) / (cr.n - 1 - k);
}

/**
 * One number summarising neighbourhood preservation at every scale.
 *
 * Averages `rnx` over all k on a logarithmic scale, so small neighbourhoods count
 * for more than large ones. Use it when you do not want to commit to a k.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], higher is better; 0 is a random projection.
 * - Cost: O(N), from an O(N² log N) pass.
 *
 * @see Lee et al., Neurocomputing 169 (2015)
 *   {@link https://doi.org/10.1016/j.neucom.2014.12.095}
 *
 * @example
 * ```ts
 * import { analyze, aucLogRnx } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * aucLogRnx(a.coRanking);  // 0.4658 — no k to choose
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export function aucLogRnx(cr: CoRanking): number {
    const kMax = maxKRnx(cr.n);
    let num = 0, den = 0;
    for (let k = 1; k <= kMax; ++k) { num += rnx(cr, k) / k; den += 1 / k; }
    return num / den;
}

// --- curves ----------------------------------------------------------------

/**
 * A measure evaluated at every neighbourhood size.
 *
 * `values[k]` holds the score at k; entries outside `[kMin, kMax]` are NaN, since
 * each measure has a range of k where its normalisation is defined.
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export interface Curve {
    readonly values: Float64Array;
    readonly kMin: number;
    readonly kMax: number;
}

function buildCurve(n: number, kMax: number, f: (k: number) => number): Curve {
    const values = new Float64Array(n + 1).fill(NaN);
    for (let k = 1; k <= kMax; ++k) values[k] = f(k);
    return { values, kMin: 1, kMax };
}

/**
 * `trustworthiness` at every k at once.
 *
 * Reading the curve is usually more informative than any single k: a projection
 * faithful up close but wrong at range falls away to the right, and one that only
 * captures coarse structure rises to the right.
 *
 * Index the `values` array by k; entries outside `[kMin, kMax]` are NaN.
 *
 * @example
 * ```ts
 * import { analyze, trustworthinessCurve } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * const curve = trustworthinessCurve(a.coRanking);
 *
 * curve.kMin;         // 1
 * curve.kMax;         // 100 — floor(n / 2) for this measure
 * curve.values[20];   // 0.9659 — index by k itself, not by position
 * curve.values[0];    // NaN — k = 0 is outside [kMin, kMax]
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const trustworthinessCurve = (cr: CoRanking): Curve =>
    buildCurve(cr.n, maxKTrustworthiness(cr.n), (k) => 1 - tcNorm(cr.n, k) * cr.tPenalty[k]);

/**
 * `continuity` at every k at once. See {@link trustworthinessCurve}.
 *
 * @example
 * ```ts
 * import { analyze, continuityCurve } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * continuityCurve(a.coRanking).values[20];  // 0.9709
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const continuityCurve = (cr: CoRanking): Curve =>
    buildCurve(cr.n, maxKTrustworthiness(cr.n), (k) => 1 - tcNorm(cr.n, k) * cr.cPenalty[k]);

/**
 * `qnx` at every k at once. See {@link trustworthinessCurve}.
 *
 * @example
 * ```ts
 * import { analyze, qnxCurve } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * const curve = qnxCurve(a.coRanking);
 * curve.kMax;        // 199 — n - 1, wider than the trustworthiness curve
 * curve.values[20];  // 0.5657
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const qnxCurve = (cr: CoRanking): Curve =>
    buildCurve(cr.n, maxKQnx(cr.n), (k) => cr.corner[k] / (k * cr.n));

/**
 * `lcmc` at every k at once. See {@link trustworthinessCurve}.
 *
 * @example
 * ```ts
 * import { analyze, lcmcCurve } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * lcmcCurve(a.coRanking).values[20];  // 0.4652
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const lcmcCurve = (cr: CoRanking): Curve =>
    buildCurve(cr.n, maxKQnx(cr.n), (k) => cr.corner[k] / (k * cr.n) - k / (cr.n - 1));

/**
 * `rnx` at every k at once — the standard curve for reporting a projection.
 *
 * See {@link trustworthinessCurve}.
 *
 * @example
 * ```ts
 * import { analyze, rnxCurve } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * const curve = rnxCurve(a.coRanking);
 * curve.kMax;        // 198 — n - 2
 * curve.values[20];  // 0.5172
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const rnxCurve = (cr: CoRanking): Curve =>
    buildCurve(cr.n, maxKRnx(cr.n), (k) =>
        ((cr.n - 1) * (cr.corner[k] / (k * cr.n)) - k) / (cr.n - 1 - k));

// --- per-point contributions ----------------------------------------------

function localFor(
    cr: CoRanking, k: number, store: Float64Array[], name: string,
): Float64Array {
    checkK(k, maxKTrustworthiness(cr.n), name);
    const a = cr.localK.indexOf(k);
    if (a < 0) {
        throw new Error(
            `${name}: k=${k} was not requested. Pass { localK: [${k}] } to the co-ranking pass.`,
        );
    }
    // Note the missing 1/N compared with the global normaliser: the mean over
    // points supplies it, which is exactly what makes mean(local) === global.
    const f = 2 / (k * (2 * cr.n - 3 * k - 1));
    const out = new Float64Array(cr.n);
    const src = store[a];
    for (let i = 0; i < cr.n; ++i) out[i] = 1 - f * src[i];
    return out;
}

/**
 * Per-point trustworthiness — which points the projection misplaces.
 *
 * Averages to {@link trustworthiness}, so it is directly comparable with it, and
 * suitable for colouring a scatterplot.
 *
 * Requires `k` to have been listed in the pass's `localK`.
 *
 * @category Neighbourhood
 * @group Neighbourhood
 *
 * @example
 * ```ts
 * import { analyze, trustworthiness, localTrustworthiness } from "@saehrimnir/sickle";
 *
 * // The pass must be told which k you want per-point values for.
 * const a = analyze(data, projection, { localK: [20] });
 *
 * const local = localTrustworthiness(a.coRanking, 20);
 * local.length;                      // 200 — a bare Float64Array, one per point
 * local[0];                          // 0.9528
 * // These average to the scalar:
 * trustworthiness(a.coRanking, 20);  // 0.9659
 * ```
 */
export const localTrustworthiness = (cr: CoRanking, k: number): Float64Array =>
    localFor(cr, k, cr.localT, "localTrustworthiness");

/**
 * Per-point continuity. Averages to {@link continuity}.
 *
 * Requires `k` to have been listed in the pass's `localK`.
 *
 * @category Neighbourhood
 * @group Neighbourhood
 *
 * @example
 * ```ts
 * import { analyze, localContinuity } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection, { localK: [20] });
 * localContinuity(a.coRanking, 20)[0];  // 0.9608
 * ```
 */
export const localContinuity = (cr: CoRanking, k: number): Float64Array =>
    localFor(cr, k, cr.localC, "localContinuity");

// --- mean relative rank error ---------------------------------------------

/**
 * Normalisation constant for MRRE at neighbourhood size `k`:
 * `C_k = sum_{l=1..k} |N - 2l + 1| / l`.
 */
function mrreNorm(n: number, k: number): number {
    let c = 0;
    for (let l = 1; l <= k; ++l) c += Math.abs(n - 2 * l + 1) / l;
    return c;
}

/**
 * Rank error among the neighbours the projection shows.
 *
 * Like trustworthiness, but graded: a neighbour displaced by one rank costs far
 * less than one displaced by a hundred, rather than both simply counting as wrong.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], higher is better.
 * - Cost: O(k), from an O(N² log N) pass.
 *
 * @see Lee & Verleysen, Neurocomputing 72 (2009)
 *   {@link https://doi.org/10.1016/j.neucom.2008.12.017}
 *
 * @category Neighbourhood
 * @group Neighbourhood
 *
 * @example
 * ```ts
 * import { analyze, mrreFalse, mrreMissing } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);
 *
 * // Rank-weighted siblings of trustworthiness and continuity.
 * mrreFalse(a.coRanking, 20);    // 0.9232 — neighbours the projection invented
 * mrreMissing(a.coRanking, 20);  // 0.9400 — neighbours it lost
 * ```
 */
export function mrreFalse(cr: CoRanking, k: number): number {
    checkK(k, maxKQnx(cr.n), "mrreFalse");
    return 1 - cr.mrreFalse[k] / (cr.n * mrreNorm(cr.n, k));
}

/**
 * Rank error among the neighbours the data actually has.
 *
 * The mirror of `mrreFalse`, graded the same way.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], higher is better.
 * - Cost: O(k), from an O(N² log N) pass.
 *
 * @category Neighbourhood
 * @group Neighbourhood
 *
 * @example
 * ```ts
 * import { analyze, mrreMissing } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);
 * mrreMissing(a.coRanking, 20);  // 0.94
 * ```
 */
export function mrreMissing(cr: CoRanking, k: number): number {
    checkK(k, maxKQnx(cr.n), "mrreMissing");
    return 1 - cr.mrreMissing[k] / (cr.n * mrreNorm(cr.n, k));
}

/**
 * `mrreFalse` at every k at once. See {@link trustworthinessCurve}.
 *
 * @example
 * ```ts
 * import { analyze, mrreFalseCurve } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * mrreFalseCurve(a.coRanking).values[20];  // 0.9232
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const mrreFalseCurve = (cr: CoRanking): Curve =>
    buildCurve(cr.n, maxKQnx(cr.n), (k) => 1 - cr.mrreFalse[k] / (cr.n * mrreNorm(cr.n, k)));

/**
 * `mrreMissing` at every k at once. See {@link trustworthinessCurve}.
 *
 * @example
 * ```ts
 * import { analyze, mrreMissingCurve } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);   // number[][] straight in
 * mrreMissingCurve(a.coRanking).values[20];  // 0.94
 * ```
 *
 * @category Neighbourhood
 * @group Neighbourhood
 */
export const mrreMissingCurve = (cr: CoRanking): Curve =>
    buildCurve(cr.n, maxKQnx(cr.n), (k) => 1 - cr.mrreMissing[k] / (cr.n * mrreNorm(cr.n, k)));

function localMrre(
    cr: CoRanking, k: number, store: Float64Array[], name: string,
): Float64Array {
    checkK(k, maxKQnx(cr.n), name);
    const a = cr.localK.indexOf(k);
    if (a < 0) {
        throw new Error(`${name}: k=${k} was not requested. Pass { localK: [${k}] } to the pass.`);
    }
    const c = mrreNorm(cr.n, k);
    const out = new Float64Array(cr.n);
    for (let i = 0; i < cr.n; ++i) out[i] = 1 - store[a][i] / c;
    return out;
}

/**
 * Per-point {@link mrreFalse}. Averages to it.
 *
 * Requires `k` to have been listed in the pass's `localK`.
 *
 * @category Neighbourhood
 * @group Neighbourhood
 *
 * @example
 * ```ts
 * import { analyze, localMrreFalse } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection, { localK: [20] });
 * localMrreFalse(a.coRanking, 20)[0];  // 0.9377
 * ```
 */
export const localMrreFalse = (cr: CoRanking, k: number): Float64Array =>
    localMrre(cr, k, cr.localMrreFalse, "localMrreFalse");

/**
 * Per-point {@link mrreMissing}. Averages to it.
 *
 * Requires `k` to have been listed in the pass's `localK`.
 *
 * @category Neighbourhood
 * @group Neighbourhood
 *
 * @example
 * ```ts
 * import { analyze, localMrreMissing } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection, { localK: [20] });
 * localMrreMissing(a.coRanking, 20)[0];  // 0.9241
 * ```
 */
export const localMrreMissing = (cr: CoRanking, k: number): Float64Array =>
    localMrre(cr, k, cr.localMrreMissing, "localMrreMissing");
