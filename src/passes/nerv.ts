/**
 * Neighbor Retrieval Visualizer (NeRV).
 *
 * @see Venna, Peltonen, Nybo, Aidos & Kaski, "Information Retrieval Perspective
 *   to Nonlinear Dimensionality Reduction for Data Visualization", JMLR 11 (2010)
 *   {@link https://www.jmlr.org/papers/v11/venna10a.html}
 *
 * NeRV treats visualisation as information retrieval. Each point induces a
 * neighbourhood distribution in the high-dimensional space,
 *
 *     p(j|i) = exp(-d(x_i,x_j)^2 / (2 sigma_i^2)) / sum_{k!=i} exp(...)
 *
 * and one in the projection, `q(j|i)`, built with **the same sigma_i**. The cost
 * trades off the two directions of Kullback-Leibler divergence:
 *
 *     NeRV = lambda * mean_i KL(p_i || q_i) + (1 - lambda) * mean_i KL(q_i || p_i)
 *
 * `KL(p||q)` penalises missed neighbours (recall), `KL(q||p)` penalises false
 * neighbours (precision). `lambda = 1` is pure recall, `lambda = 0` pure
 * precision. Lower is better.
 *
 * ## Notes on this implementation
 *
 * `sigma_i` is fitted once per point in the **high-dimensional** space by binary
 * search on the entropy, so that each neighbourhood has the requested
 * perplexity, then reused for `q`. That is the paper's formulation. (Fitting
 * separate sigmas for the projection, as some implementations do, makes the two
 * distributions incomparable and the divergence meaningless.)
 *
 * The pass is row-local -- the fit and both divergences for point `i` need only
 * row `i` -- so it is a single O(N^2) sweep and reduces additively over rows.
 */

import { Accumulator } from "../core/sum.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";

/** * @category Passes * @group Passes */
export interface NervOptions {
    /** Trade-off between recall (1) and precision (0). Default 0.5. */
    lambda?: number;
    /** Effective number of neighbours. Default 30. */
    perplexity?: number;
    /** Entropy tolerance for the sigma search. Default 1e-5. */
    tolerance?: number;
    /** Bisection steps before giving up. Default 50. */
    maxIterations?: number;
    rowStart?: number;
    rowEnd?: number;
    onProgress?: (fraction: number) => void;
    progressInterval?: number;
    signal?: AbortSignal;
}

/** @internal */
export interface NervPartial {
    readonly n: number;
    readonly rowStart: number;
    readonly rowEnd: number;
    readonly lambda: number;
    /**
     * Per-point KL(p_i || q_i). Summed in `reduceNerv` rather than here, so the
     * addition sequence matches the single-threaded pass exactly however the
     * rows were split. See the note in `passes/fused.ts`.
     */
    readonly rowRecall: Float64Array;
    /** Per-point KL(q_i || p_i). */
    readonly rowPrecision: Float64Array;
    /** Per-point lambda-weighted divergence; zero outside the row range. */
    readonly local: Float64Array;
    /** Fitted sigma per point; zero outside the row range. */
    readonly sigma: Float64Array;
}

/** Guards log(0) without materially shifting the divergence. */
const EPS = 1e-12;

function squaredRow(v: Vectors, i: number, out: Float64Array): void {
    const { data, n, d } = v;
    const base = i * d;
    for (let j = 0; j < n; ++j) {
        if (j === i) { out[j] = 0; continue; }
        const jb = j * d;
        let s = 0;
        for (let c = 0; c < d; ++c) {
            const diff = data[base + c] - data[jb + c];
            s += diff * diff;
        }
        out[j] = s;
    }
}

/**
 * Fit `beta = 1 / (2 sigma^2)` so the conditional distribution over row `i` has
 * the target Shannon entropy, then write the normalised distribution to `out`.
 *
 * Bisection on beta; the entropy is monotone decreasing in beta.
 */
function fitConditional(
    d2: Float64Array, i: number, n: number, targetEntropy: number,
    tolerance: number, maxIterations: number, out: Float64Array,
): number {
    let beta = 1;
    let lo = -Infinity, hi = Infinity;
    let entropy = 0;

    for (let iteration = 0; iteration < maxIterations; ++iteration) {
        let sumP = 0, sumDP = 0;
        for (let j = 0; j < n; ++j) {
            if (j === i) { out[j] = 0; continue; }
            const p = Math.exp(-d2[j] * beta);
            out[j] = p;
            sumP += p;
            sumDP += d2[j] * p;
        }
        if (sumP <= 0) break;
        // H = log(sumP) + beta * <d^2>_p
        entropy = Math.log(sumP) + (beta * sumDP) / sumP;

        const diff = entropy - targetEntropy;
        if (Math.abs(diff) <= tolerance) break;
        if (diff > 0) {                      // too much entropy -> narrow the kernel
            lo = beta;
            beta = hi === Infinity ? beta * 2 : (beta + hi) / 2;
        } else {                             // too little -> widen it
            hi = beta;
            beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2;
        }
    }

    // Normalise, guarding against an all-zero row.
    let sumP = 0;
    for (let j = 0; j < n; ++j) sumP += out[j];
    if (sumP > 0) for (let j = 0; j < n; ++j) out[j] /= sumP;
    return beta;
}

/** Normalise `exp(-d2 * beta)` over the row, excluding the self term. */
function conditionalAt(
    d2: Float64Array, i: number, n: number, beta: number, out: Float64Array,
): void {
    let sumP = 0;
    for (let j = 0; j < n; ++j) {
        if (j === i) { out[j] = 0; continue; }
        const p = Math.exp(-d2[j] * beta);
        out[j] = p;
        sumP += p;
    }
    if (sumP > 0) for (let j = 0; j < n; ++j) out[j] /= sumP;
}

/**
 * Run NeRV over a range of rows. The result is a monoid element: see
 * `reduceNerv`.
 *
 * @internal
 */
export function nervPartial(hd: Vectors, ld: Vectors, opts: NervOptions = {}): NervPartial {
    assertSamePoints(hd, ld);
    const n = hd.n;
    const lambda = opts.lambda ?? 0.5;
    if (!(lambda >= 0 && lambda <= 1)) throw new RangeError(`lambda must be in [0,1], got ${lambda}`);
    const perplexity = opts.perplexity ?? 30;
    if (!(perplexity > 1 && perplexity < n)) {
        throw new RangeError(`perplexity must be in (1, ${n}), got ${perplexity}`);
    }
    const tolerance = opts.tolerance ?? 1e-5;
    const maxIterations = opts.maxIterations ?? 50;
    const rowStart = opts.rowStart ?? 0;
    const rowEnd = opts.rowEnd ?? n;

    const targetEntropy = Math.log(perplexity);
    const dh = new Float64Array(n), dl = new Float64Array(n);
    const p = new Float64Array(n), q = new Float64Array(n);
    const local = new Float64Array(n);
    const sigma = new Float64Array(n);
    const rowRecall = new Float64Array(n), rowPrecision = new Float64Array(n);

    const interval = opts.progressInterval ?? 64;
    const total = rowEnd - rowStart || 1;

    for (let i = rowStart; i < rowEnd; ++i) {
        if ((i - rowStart) % interval === 0) {
            opts.signal?.throwIfAborted();
            opts.onProgress?.((i - rowStart) / total);
        }
        squaredRow(hd, i, dh);
        squaredRow(ld, i, dl);

        const beta = fitConditional(dh, i, n, targetEntropy, tolerance, maxIterations, p);
        sigma[i] = Math.sqrt(1 / (2 * beta));
        // The same beta defines the projection's neighbourhood, so p and q are
        // comparable distributions over the same index set.
        conditionalAt(dl, i, n, beta, q);

        let klPQ = 0, klQP = 0;
        for (let j = 0; j < n; ++j) {
            if (j === i) continue;
            const pj = Math.max(p[j], EPS);
            const qj = Math.max(q[j], EPS);
            klPQ += pj * Math.log(pj / qj);
            klQP += qj * Math.log(qj / pj);
        }
        rowRecall[i] = klPQ;
        rowPrecision[i] = klQP;
        local[i] = lambda * klPQ + (1 - lambda) * klQP;
    }
    opts.onProgress?.(1);

    return {
        n, rowStart, rowEnd, lambda,
        rowRecall, rowPrecision, local, sigma,
    };
}

/** * @category Passes * @group Passes */
export interface Nerv {
    readonly n: number;
    readonly lambda: number;
    readonly recall: number;
    readonly precision: number;
    readonly local: Float64Array;
    readonly sigma: Float64Array;
}

/**
 * Sum partials from disjoint row ranges.
 *
 * @internal
 */
export function reduceNerv(partials: readonly NervPartial[]): Nerv {
    if (partials.length === 0) throw new Error("reduceNerv: no partials");
    const n = partials[0].n;
    const lambda = partials[0].lambda;
    const local = new Float64Array(n);
    const sigma = new Float64Array(n);
    const rowRecall = new Float64Array(n), rowPrecision = new Float64Array(n);
    for (const p of partials) {
        for (let i = p.rowStart; i < p.rowEnd; ++i) {
            local[i] = p.local[i];
            sigma[i] = p.sigma[i];
            rowRecall[i] = p.rowRecall[i];
            rowPrecision[i] = p.rowPrecision[i];
        }
    }
    // Sum once, in row order: the same additions the single-threaded pass makes.
    const accRecall = new Accumulator(), accPrecision = new Accumulator();
    for (let i = 0; i < n; ++i) {
        accRecall.add(rowRecall[i]);
        accPrecision.add(rowPrecision[i]);
    }
    return { n, lambda, recall: accRecall.value, precision: accPrecision.value, local, sigma };
}

/**
 * NeRV in one call, single-threaded. See {@link nerv} for the metric itself.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { nervPass, nerv } from "@saehrimnir/sickle";
 *
 * // Fits a per-point sigma in the data by bisection, then reuses it for the
 * // projection. Defaults: lambda 0.5, perplexity 30.
 * const p = nervPass(data, projection, { lambda: 0.5, perplexity: 30 });
 *
 * nerv(p).value;  // 0.4611
 * p.recall;       // 77.6049 — a scalar, as is p.precision
 * p.local[0];     // per-point contributions, localKind "mean"
 * p.sigma[0];     // the bandwidth fitted for point 0
 * ```
 */
export function nervPass(hdIn: PointsInput, ldIn: PointsInput, opts: NervOptions = {}): Nerv {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    return reduceNerv([nervPartial(hd, ld, opts)]);
}
