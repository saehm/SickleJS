/**
 * The co-ranking pass: the shared spine of every rank-based quality metric.
 *
 * ## What it is
 *
 * The co-ranking matrix Q[r][s] counts ordered pairs (i,j) whose rank from i is
 * `r` in the high-dimensional space and `s` in the projection. Trustworthiness,
 * continuity, LCMC, Q_NX, R_NX, AUC(log R_NX) and MRRE are all read-outs of Q.
 *
 * ## Why this implementation is fast
 *
 * Q is (N-1)x(N-1) -- 400 MB at N=10000 -- so it is never materialised. Every
 * quantity needed is a *range update over k*, which folds into difference
 * arrays resolved by a single prefix-sum pass at the end:
 *
 *   - Q_NX corner sum C(k) = #{pairs : max(r,s) <= k}   -> a histogram of max(r,s)
 *   - trustworthiness penalises a pair for s <= k < r, contributing (r - k)
 *   - continuity     penalises a pair for r <= k < s, contributing (s - k)
 *
 * The result: **the complete curve over every k**, in O(N^2 log N) time and
 * O(N) memory. The naive approach re-slices neighbourhoods per k and is O(N^3).
 *
 * ## Why it parallelises trivially
 *
 * All accumulators are pure sums over pairs partitioned by row `i`, so a partial
 * pass over a row range is a monoid: partials reduce by elementwise addition and
 * the prefix sum is taken once, after reduction. Splitting rows across workers
 * yields a bit-identical result with no locks and no ordering constraints.
 */

import { type PointsInput, type Vectors, toVectors } from "../core/vectors.ts";
import { fusedPartial } from "./fused.ts";

/** * @category Passes * @group Passes */
export interface CoRankingOptions {
    /** k values for which per-point contributions are accumulated. */
    localK?: readonly number[];
    /** First row (inclusive). Defaults to 0. */
    rowStart?: number;
    /** Last row (exclusive). Defaults to n. */
    rowEnd?: number;
    /** Invoked every `progressInterval` rows with a fraction in [0,1]. */
    onProgress?: (fraction: number) => void;
    progressInterval?: number;
    /** Cooperative cancellation, checked at row-block boundaries. */
    signal?: AbortSignal;
}

/**
 * Un-reduced accumulators for one row range. Additive; see module docs.
 *
 * @internal
 */
export interface CoRankingPartial {
    readonly n: number;
    readonly rowStart: number;
    readonly rowEnd: number;
    readonly t1: Float64Array;
    readonly t2: Float64Array;
    readonly c1: Float64Array;
    readonly c2: Float64Array;
    readonly hist: Float64Array;
    readonly mrreFalse: Float64Array;
    readonly mrreMissing: Float64Array;
    readonly localMrreFalse: Float64Array[];
    readonly localMrreMissing: Float64Array[];
    readonly localK: readonly number[];
    readonly localT: Float64Array[];
    readonly localC: Float64Array[];
}

/**
 * Prefix-summed, ready for read-out.
 *
 * @category Passes
 * @group Passes
 */
export interface CoRanking {
    readonly n: number;
    /** Trustworthiness penalty numerator, indexed by k. */
    readonly tPenalty: Float64Array;
    /** Continuity penalty numerator, indexed by k. */
    readonly cPenalty: Float64Array;
    /** C(k) = #{pairs : max(r,s) <= k}. */
    readonly corner: Float64Array;
    /** Cumulative MRRE numerators, indexed by k. */
    readonly mrreFalse: Float64Array;
    readonly mrreMissing: Float64Array;
    readonly localMrreFalse: Float64Array[];
    readonly localMrreMissing: Float64Array[];
    readonly localK: readonly number[];
    readonly localT: Float64Array[];
    readonly localC: Float64Array[];
}

/**
 * Run the pass over a row range. Visits each ordered pair in the range once.
 * Time O((rowEnd-rowStart) * N log N), memory O(N).
 *
 * Delegates to the shared row loop in `fused.ts` with the distance accumulators
 * switched off, so there is exactly one implementation of the sweep.
 *
 * @internal
 */
export function coRankingPartial(
    hd: Vectors, ld: Vectors, opts: CoRankingOptions = {},
): CoRankingPartial {
    return fusedPartial(hd, ld, { ...opts, ranks: true, distances: false });
}

/**
 * Elementwise-add partials, then prefix-sum into read-out form.
 *
 * @internal
 */
export function reduceCoRanking(partials: readonly CoRankingPartial[]): CoRanking {
    if (partials.length === 0) throw new Error("reduceCoRanking: no partials");
    const first = partials[0];
    const n = first.n;
    const localK = first.localK;

    const t1 = new Float64Array(n + 2), t2 = new Float64Array(n + 2);
    const c1 = new Float64Array(n + 2), c2 = new Float64Array(n + 2);
    const hist = new Float64Array(n + 2);
    const mf = new Float64Array(n + 2), mm = new Float64Array(n + 2);
    const localT = localK.map(() => new Float64Array(n));
    const localC = localK.map(() => new Float64Array(n));
    const localMrreFalse = localK.map(() => new Float64Array(n));
    const localMrreMissing = localK.map(() => new Float64Array(n));

    for (const p of partials) {
        if (p.n !== n) throw new Error("reduceCoRanking: partials disagree on n");
        if (p.localK.length !== localK.length || p.localK.some((k, i) => k !== localK[i])) {
            throw new Error("reduceCoRanking: partials disagree on localK");
        }
        for (let i = 0; i <= n + 1; ++i) {
            t1[i] += p.t1[i]; t2[i] += p.t2[i];
            c1[i] += p.c1[i]; c2[i] += p.c2[i];
            hist[i] += p.hist[i];
            mf[i] += p.mrreFalse[i]; mm[i] += p.mrreMissing[i];
        }
        for (let a = 0; a < localK.length; ++a) {
            const st = localT[a], sc = localC[a], pt = p.localT[a], pc = p.localC[a];
            const sf = localMrreFalse[a], sm = localMrreMissing[a];
            const pf = p.localMrreFalse[a], pm = p.localMrreMissing[a];
            for (let i = 0; i < n; ++i) {
                st[i] += pt[i]; sc[i] += pc[i]; sf[i] += pf[i]; sm[i] += pm[i];
            }
        }
    }

    const tPenalty = new Float64Array(n + 1);
    const cPenalty = new Float64Array(n + 1);
    const corner = new Float64Array(n + 1);
    const mrreFalse = new Float64Array(n + 1);
    const mrreMissing = new Float64Array(n + 1);
    let p1 = 0, p2 = 0, q1 = 0, q2 = 0, cum = 0, cf = 0, cm = 0;
    for (let k = 0; k <= n; ++k) {
        p1 += t1[k]; p2 += t2[k];
        q1 += c1[k]; q2 += c2[k];
        cum += hist[k];
        cf += mf[k]; cm += mm[k];
        tPenalty[k] = p1 - k * p2;
        cPenalty[k] = q1 - k * q2;
        corner[k] = cum;
        mrreFalse[k] = cf;
        mrreMissing[k] = cm;
    }

    return {
        n, tPenalty, cPenalty, corner,
        mrreFalse, mrreMissing, localMrreFalse, localMrreMissing,
        localK, localT, localC,
    };
}

/**
 * Convenience: full single-threaded pass.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { coRanking, trustworthiness, aucLogRnx } from "@saehrimnir/sickle";
 *
 * // The rank half of `analyze`, when you do not need the distance moments.
 * const cr = coRanking(data, projection, { localK: [20] });
 *
 * trustworthiness(cr, 20);  // 0.9659
 * aucLogRnx(cr);            // 0.4658
 * ```
 */
export function coRanking(hdIn: PointsInput, ldIn: PointsInput, opts: CoRankingOptions = {}): CoRanking {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    return reduceCoRanking([coRankingPartial(hd, ld, opts)]);
}

/**
 * Split `n` rows into `parts` contiguous, near-equal ranges.
 *
 * @internal
 */
export function rowRanges(n: number, parts: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const per = Math.ceil(n / parts);
    for (let s = 0; s < n; s += per) out.push([s, Math.min(s + per, n)]);
    return out;
}
