/**
 * The single sweep over all pairs.
 *
 * Rank-based and distance-based metrics both need, for every row `i`, the
 * distance from `i` to every other point. That is the expensive part -- O(N^2 D)
 * -- and running two passes computed it twice. This module computes it once and
 * feeds both accumulator sets.
 *
 * The two families want the distance in different forms, which is why the naive
 * fusion is not obviously possible:
 *
 *   - ranking only needs the *order*, so squared distances suffice (sqrt is
 *     monotone) and the sqrt can be skipped entirely
 *   - stress and correlation need actual euclidean distances
 *
 * So the loop computes squared distances once, ranks on those directly, and
 * takes the square root only when the distance accumulators are requested.
 * Asking for rank metrics alone therefore still pays no sqrt cost.
 *
 * Everything here remains additive over row ranges, so the parallel reduction
 * described in `coranking.ts` applies unchanged to both families.
 */

import { type RadixScratch, makeRadixScratch, radixArgsort } from "../core/sort.ts";
import { type Vectors, assertSamePoints } from "../core/vectors.ts";

/** @internal */
export interface FusedOptions {
    /** k values for which per-point rank contributions are accumulated. */
    localK?: readonly number[];
    /** Accumulate rank statistics. Default true. */
    ranks?: boolean;
    /** Accumulate distance moments. Default true. */
    distances?: boolean;
    /**
     * Neighbourhood width for the Curvilinear Component Analysis weighting.
     * Omit to skip the CCA accumulators. See `metrics/embedding.ts`.
     */
    ccaLambda?: number;
    /** CCA weighting kernel. Default "exponential". */
    ccaKernel?: "exponential" | "step";
    /**
     * Neighbourhood size for the local-radius estimate behind
     * `densityPreservation`. Omit to skip it.
     */
    densityK?: number;
    /**
     * Count rank inversions per row, for `tripletAccuracy`. Costs an extra
     * O(N log N) per row. Default false.
     */
    triplets?: boolean;
    rowStart?: number;
    rowEnd?: number;
    onProgress?: (fraction: number) => void;
    progressInterval?: number;
    signal?: AbortSignal;
}

/** @internal */
export interface FusedPartial {
    readonly n: number;
    readonly rowStart: number;
    readonly rowEnd: number;
    readonly hasRanks: boolean;
    readonly hasDistances: boolean;

    // rank accumulators (difference arrays; see coranking.ts)
    readonly t1: Float64Array;
    readonly t2: Float64Array;
    readonly c1: Float64Array;
    readonly c2: Float64Array;
    readonly hist: Float64Array;
    /**
     * MRRE difference arrays. A pair contributes |r-s|/s to `mrreFalse` for every
     * k at or above its projected rank, and |r-s|/r to `mrreMissing` for every k
     * at or above its original rank -- the same range-update trick the
     * trustworthiness penalty uses, so the whole MRRE curve is free.
     */
    readonly mrreFalse: Float64Array;
    readonly mrreMissing: Float64Array;
    readonly localMrreFalse: Float64Array[];
    readonly localMrreMissing: Float64Array[];
    readonly localK: readonly number[];
    readonly localT: Float64Array[];
    readonly localC: Float64Array[];

    /**
     * Distance accumulators, kept **per row** rather than summed here.
     *
     * Floating-point addition is not associative, so summing inside each worker
     * and then adding the partials gives a different result than one sequential
     * pass -- and a different result for every worker count. Keeping the row
     * values and summing them once, in row order, in `reduceFused` reproduces
     * the single-threaded addition sequence exactly. That is what makes the
     * parallel path bit-identical rather than merely close.
     *
     * The rank accumulators above need no such care: they are integer counts
     * held exactly in a double, so their sums are associative.
     */
    readonly rowH: Float64Array;
    readonly rowL: Float64Array;
    readonly rowHH: Float64Array;
    readonly rowLL: Float64Array;
    readonly rowHL: Float64Array;
    readonly rowDiff2: Float64Array;
    /** Sammon: per-row sum of (dH - dL)^2 / dH, over pairs with dH > 0. */
    readonly rowSammonNum: Float64Array;
    /** Sammon: per-row sum of dH over the same pairs. */
    readonly rowSammonDen: Float64Array;
    /** CCA: per-row sum of (dH - dL)^2 * F(dL). Zero without a lambda. */
    readonly rowCcaNum: Float64Array;
    /** CCA: per-row sum of dH^2 * F(dL). */
    readonly rowCcaDen: Float64Array;
    /** False when no `ccaLambda` was supplied, so CCA read-outs can refuse. */
    readonly hasCca: boolean;

    /**
     * Mean distance from each point to its `densityK` nearest neighbours — a
     * local radius, small where the point sits in a dense region. Zero when
     * `densityK` was not supplied.
     */
    readonly rowRadiusH: Float64Array;
    readonly rowRadiusL: Float64Array;
    readonly hasDensity: boolean;

    /**
     * Per-row count of discordant pairs between the two distance orderings.
     * A pair (j,k) is discordant from anchor i exactly when the triplet
     * (i,j,k) flips, so this is the exhaustive triplet statistic.
     */
    readonly rowInversions: Float64Array;
    readonly hasTriplets: boolean;
}

/**
 * Count inversions in `sequence` — pairs out of order — in O(n log n).
 *
 * `scratch` is a Fenwick tree over rank values, reused across rows.
 */
function countInversions(
    sequence: Uint32Array, length: number, scratch: Int32Array,
): number {
    const size = scratch.length - 1;
    scratch.fill(0);
    let inversions = 0;
    // Walk from the end; for each element count how many already-seen values are
    // strictly smaller, which is the number of pairs it inverts with.
    for (let t = length - 1; t >= 0; --t) {
        for (let at = sequence[t]; at > 0; at -= at & -at) inversions += scratch[at];
        for (let at = sequence[t] + 1; at <= size; at += at & -at) scratch[at] += 1;
    }
    return inversions;
}

/** Squared euclidean distances from `i` to every point; self set to -1 so it ranks first. */
function squaredRow(v: Vectors, i: number, out: Float64Array): void {
    const { data, n, d } = v;
    const base = i * d;
    if (d === 2) {
        const x = data[base], y = data[base + 1];
        for (let j = 0; j < n; ++j) {
            const jb = j << 1;
            const dx = x - data[jb], dy = y - data[jb + 1];
            out[j] = dx * dx + dy * dy;
        }
    } else {
        for (let j = 0; j < n; ++j) {
            const jb = j * d;
            let s = 0;
            for (let c = 0; c < d; ++c) {
                const diff = data[base + c] - data[jb + c];
                s += diff * diff;
            }
            out[j] = s;
        }
    }
    out[i] = -1;
}

/**
 * Run the fused sweep over a range of rows. The result is a monoid element:
 * see `reduceFused`.
 *
 * @internal
 */
export function fusedPartial(hd: Vectors, ld: Vectors, opts: FusedOptions = {}): FusedPartial {
    assertSamePoints(hd, ld);
    const n = hd.n;
    const rowStart = opts.rowStart ?? 0;
    const rowEnd = opts.rowEnd ?? n;
    if (rowStart < 0 || rowEnd > n || rowStart > rowEnd) {
        throw new RangeError(`invalid row range [${rowStart}, ${rowEnd}) for n=${n}`);
    }
    const wantRanks = opts.ranks !== false;
    const wantDistances = opts.distances !== false;

    const localK = wantRanks ? (opts.localK ?? []) : [];
    for (const k of localK) {
        if (!Number.isInteger(k) || k < 1 || k >= n) {
            throw new RangeError(`localK entry ${k} must be an integer in [1, ${n - 1}]`);
        }
    }
    const nk = localK.length;
    const localT = localK.map(() => new Float64Array(n));
    const localC = localK.map(() => new Float64Array(n));
    const localMrreFalse = localK.map(() => new Float64Array(n));
    const localMrreMissing = localK.map(() => new Float64Array(n));

    const t1 = new Float64Array(n + 2), t2 = new Float64Array(n + 2);
    const c1 = new Float64Array(n + 2), c2 = new Float64Array(n + 2);
    const hist = new Float64Array(n + 2);
    const mrreFalse = new Float64Array(n + 2), mrreMissing = new Float64Array(n + 2);

    const rowH = new Float64Array(n), rowL = new Float64Array(n);
    const rowHH = new Float64Array(n), rowLL = new Float64Array(n);
    const rowHL = new Float64Array(n), rowDiff2 = new Float64Array(n);
    const rowSammonNum = new Float64Array(n), rowSammonDen = new Float64Array(n);
    const rowCcaNum = new Float64Array(n), rowCcaDen = new Float64Array(n);
    const rowRadiusH = new Float64Array(n), rowRadiusL = new Float64Array(n);
    const rowInversions = new Float64Array(n);
    const densityK = opts.densityK;
    const wantDensity = densityK !== undefined && densityK >= 1 && densityK < n;
    if (densityK !== undefined && !wantDensity) {
        throw new RangeError(`densityK must be an integer in [1, ${n - 1}], got ${densityK}`);
    }
    const wantTriplets = opts.triplets === true;
    if ((wantDensity || wantTriplets) && !wantRanks) {
        throw new Error("densityK and triplets both need the rank pass; do not disable `ranks`");
    }
    const inversionScratch = wantTriplets ? new Int32Array(n + 1) : null;
    const ldRankByHdRank = wantTriplets ? new Uint32Array(n) : null;
    const ccaLambda = opts.ccaLambda;
    const wantCca = ccaLambda !== undefined && ccaLambda > 0;
    const ccaStep = opts.ccaKernel === "step";

    const dh = new Float64Array(n), dl = new Float64Array(n);
    let ih: Uint32Array | null = null, il: Uint32Array | null = null;
    let rankH: Uint32Array | null = null, rankL: Uint32Array | null = null;
    let scratchH: RadixScratch | null = null, scratchL: RadixScratch | null = null;
    if (wantRanks) {
        ih = new Uint32Array(n); il = new Uint32Array(n);
        rankH = new Uint32Array(n); rankL = new Uint32Array(n);
        scratchH = makeRadixScratch(n); scratchL = makeRadixScratch(n);
    }

    const interval = opts.progressInterval ?? 64;
    const total = rowEnd - rowStart || 1;

    for (let i = rowStart; i < rowEnd; ++i) {
        if ((i - rowStart) % interval === 0) {
            opts.signal?.throwIfAborted();
            opts.onProgress?.((i - rowStart) / total);
        }

        squaredRow(hd, i, dh);
        squaredRow(ld, i, dl);

        if (wantRanks) {
            for (let j = 0; j < n; ++j) { ih![j] = j; il![j] = j; }
            radixArgsort(dh, ih!, n, scratchH!);
            radixArgsort(dl, il!, n, scratchL!);
            for (let p = 0; p < n; ++p) { rankH![ih![p]] = p; rankL![il![p]] = p; }

            if (wantDensity) {
                // ih/il are sorted ascending with self first, so entries 1..k are
                // the k nearest. Distances are squared here; take the root.
                let sumH = 0, sumL = 0;
                for (let t = 1; t <= densityK!; ++t) {
                    sumH += Math.sqrt(dh[ih![t]]);
                    sumL += Math.sqrt(dl[il![t]]);
                }
                rowRadiusH[i] = sumH / densityK!;
                rowRadiusL[i] = sumL / densityK!;
            }

            if (wantTriplets) {
                // List the other points in high-dimensional rank order and read
                // off their projected ranks; inversions in that sequence are
                // exactly the triplets that flipped.
                for (let t = 1; t < n; ++t) ldRankByHdRank![t - 1] = rankL![ih![t]];
                rowInversions[i] = countInversions(ldRankByHdRank!, n - 1, inversionScratch!);
            }

            for (let j = 0; j < n; ++j) {
                if (j === i) continue;
                const r = rankH![j];
                const s = rankL![j];
                hist[r > s ? r : s] += 1;
                if (s < r) { t1[s] += r; t1[r] -= r; t2[s] += 1; t2[r] -= 1; }
                else if (r < s) { c1[r] += s; c1[s] -= s; c2[r] += 1; c2[s] -= 1; }

                // MRRE: the pair is inside the projected k-neighbourhood for every
                // k >= s, and inside the original one for every k >= r.
                const gap = r > s ? r - s : s - r;
                if (gap !== 0) { mrreFalse[s] += gap / s; mrreMissing[r] += gap / r; }

                for (let a = 0; a < nk; ++a) {
                    const k = localK[a];
                    if (s <= k && r > k) localT[a][i] += r - k;
                    else if (r <= k && s > k) localC[a][i] += s - k;
                    if (s <= k) localMrreFalse[a][i] += gap / s;
                    if (r <= k) localMrreMissing[a][i] += gap / r;
                }
            }
        }

        if (wantDistances) {
            // The self entry was set to -1 for ranking; it is a true distance of 0
            // and must be counted as such (zadu includes the diagonal).
            let rd2 = 0, rhh = 0, rh = 0, rl = 0, rll = 0, rhl = 0;
            let rsNum = 0, rsDen = 0, rcNum = 0, rcDen = 0;
            for (let j = 0; j < n; ++j) {
                const a = j === i ? 0 : Math.sqrt(dh[j]);
                const b = j === i ? 0 : Math.sqrt(dl[j]);
                const diff = a - b;
                const sq = diff * diff;
                rd2 += sq;
                rhh += a * a;
                rll += b * b;
                rhl += a * b;
                rh += a;
                rl += b;
                if (j !== i && a > 0) {
                    // Sammon weights each pair by 1/dH, emphasising short distances.
                    rsNum += sq / a;
                    rsDen += a;
                }
                if (wantCca && j !== i) {
                    const f = ccaStep
                        ? (b <= ccaLambda ? 1 : 0)
                        : Math.exp(-b / ccaLambda);
                    rcNum += sq * f;
                    rcDen += a * a * f;
                }
            }
            rowH[i] = rh; rowL[i] = rl;
            rowHH[i] = rhh; rowLL[i] = rll; rowHL[i] = rhl;
            rowDiff2[i] = rd2;
            rowSammonNum[i] = rsNum; rowSammonDen[i] = rsDen;
            rowCcaNum[i] = rcNum; rowCcaDen[i] = rcDen;
        }
    }
    opts.onProgress?.(1);

    return {
        n, rowStart, rowEnd,
        hasRanks: wantRanks, hasDistances: wantDistances,
        t1, t2, c1, c2, hist, localK, localT, localC,
        mrreFalse, mrreMissing, localMrreFalse, localMrreMissing,
        rowH, rowL, rowHH, rowLL, rowHL, rowDiff2,
        rowSammonNum, rowSammonDen, rowCcaNum, rowCcaDen,
        hasCca: wantCca,
        rowRadiusH, rowRadiusL, hasDensity: wantDensity,
        rowInversions, hasTriplets: wantTriplets,
    };
}
