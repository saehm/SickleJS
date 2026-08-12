/**
 * Steadiness & Cohesiveness: does the projection show the right groups?
 *
 * The only stochastic measure in the library — see `snc` for what that means for
 * reading the result. Implementation notes are in `NOTES-snc.md`.
 */

import { KMeans, Randomizer } from "@saehrimnir/druidjs";
import { makeRadixScratch, radixArgsort } from "../core/sort.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";

/** * @category Cluster reliability * @group Cluster reliability */
export interface SncOptions {
    /** Random-walk rounds per measure. More narrows the spread. Default 150. */
    iterations?: number;
    /** Walk length as a fraction of N. Default 0.3. */
    walkRatio?: number;
    /** Smoothing in `1 / (similarity + alpha)`. Default 0.1. */
    alpha?: number;
    /** Neighbours for the k-NN and SNN graphs. Default `floor(sqrt(N))`. */
    k?: number;
    /** Seed, so a run is reproducible. Default 1212 (DruidJS's convention). */
    seed?: number;
    /** Accumulate per-point contributions. Costs memory; off by default. */
    local?: boolean;
    /** Refuse above this many points: the SNN matrices are N x N. Default 6000. */
    maxPoints?: number;
    signal?: AbortSignal;
}

/** * @category Cluster reliability * @group Cluster reliability */
export interface Snc {
    readonly n: number;
    readonly steadiness: number;
    readonly cohesiveness: number;
    /** Per-point contributions, when `local` was requested. */
    readonly localSteadiness?: Float64Array;
    readonly localCohesiveness?: Float64Array;
}

/** k nearest neighbours of every point, self excluded. */
function knnOf(v: Vectors, k: number): Int32Array {
    const { n, d, data } = v;
    const out = new Int32Array(n * k);
    const dist = new Float64Array(n);
    const order = new Uint32Array(n);
    const scratch = makeRadixScratch(n);
    for (let i = 0; i < n; ++i) {
        for (let j = 0; j < n; ++j) {
            if (j === i) { dist[j] = -1; continue; }
            let s = 0;
            for (let c = 0; c < d; ++c) { const t = data[i * d + c] - data[j * d + c]; s += t * t; }
            dist[j] = s;
        }
        for (let j = 0; j < n; ++j) order[j] = j;
        radixArgsort(dist, order, n, scratch);
        for (let t = 0; t < k; ++t) out[i * k + t] = order[t + 1];
    }
    return out;
}

/**
 * Weighted shared-nearest-neighbour similarity, `S = W Wᵀ`, normalised by its
 * maximum. `W[i, knn[i][t]] = k + 1 - t`, so nearer neighbours count for more.
 *
 * Computed through an inverted index rather than as a dense product: only points
 * that share a neighbour contribute, which is O(N·k²) instead of O(N²·k).
 */
function sharedNeighborSimilarity(knn: Int32Array, n: number, k: number): Float64Array {
    const holders: number[][] = Array.from({ length: n }, () => []);
    const weights: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; ++i) {
        for (let t = 0; t < k; ++t) {
            const m = knn[i * k + t];
            holders[m].push(i);
            weights[m].push(k + 1 - t);
        }
    }

    const snn = new Float64Array(n * n);
    for (let m = 0; m < n; ++m) {
        const hs = holders[m], ws = weights[m];
        for (let a = 0; a < hs.length; ++a) {
            const i = hs[a], wi = ws[a];
            for (let b = 0; b < hs.length; ++b) snn[i * n + hs[b]] += wi * ws[b];
        }
    }

    let max = 0;
    for (let t = 0; t < snn.length; ++t) if (snn[t] > max) max = snn[t];
    if (max > 0) for (let t = 0; t < snn.length; ++t) snn[t] /= max;
    return snn;
}

/** A cluster drawn by a similarity-weighted random walk over the k-NN graph. */
function extractCluster(
    knn: Int32Array, snn: Float64Array, n: number, k: number,
    walkLength: number, random: () => number,
): number[] {
    const seed = Math.min(n - 1, Math.floor(random() * n));
    const member = new Uint8Array(n);
    member[seed] = 1;
    const members: number[] = [seed];
    const queue: number[] = [seed];
    let head = 0;
    let visits = 0;

    while (visits < walkLength) {
        if (head >= queue.length) break;
        const i = queue[head++];
        for (let t = 0; t < k; ++t) {
            const j = knn[i * k + t];
            // Accept with probability equal to the similarity.
            if (random() > 1 - snn[i * n + j]) {
                queue.push(j);
                if (!member[j]) { member[j] = 1; members.push(j); }
                visits += 1;
            }
        }
    }
    return members;
}

/** Mean SNN similarity between two clusters, mapped to a distance. */
function clusterDistance(
    snn: Float64Array, n: number, a: readonly number[], b: readonly number[], alpha: number,
): number {
    let sum = 0;
    for (const i of a) for (const j of b) sum += snn[i * n + j];
    return 1 / (sum / (a.length * b.length) + alpha);
}

/**
 * Does the projection show the right *groups*?
 *
 * Judges clusters rather than points, which is where scatterplots actually
 * mislead: one that splits a real group in two, or fuses two into one, can still
 * score well on trustworthiness because no single neighbourhood is badly wrong.
 *
 * - **Steadiness** — are the groups you see real? Low means the projection shows
 *   groups that are not in the data.
 * - **Cohesiveness** — are the data's groups still together? Low means the
 *   projection hides groups that are there.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: both [0, 1], higher is better.
 * - Cost: O(N²) time and **O(N²) memory**; `maxPoints` defaults to 6000.
 *
 * **Stochastic**: clusters are drawn by random walks, so the result is an estimate.
 * `seed` makes a run reproducible and more `iterations` narrows the spread (about
 * ±0.005 at the default 150). Treat small differences as noise.
 *
 * @see Jeon, Ko, Jo, Yi & Seo, IEEE TVCG 28 (2022)
 *   {@link https://doi.org/10.1109/TVCG.2021.3114833}
 *
 * @category Cluster reliability
 * @group Cluster reliability
 *
 * @example
 * ```ts
 * import { snc } from "@saehrimnir/sickle";
 *
 * // Stochastic: it draws clusters by a random walk, so fix `seed` to reproduce.
 * const s = snc(data, projection, { iterations: 150, seed: 1212 });
 *
 * s.steadiness;     // 0.9216 — are drawn groups real?
 * s.cohesiveness;   // are real groups drawn together?
 *
 * // Per-point contributions are opt-in:
 * const withLocal = snc(data, projection, { local: true });
 * withLocal.localSteadiness?.[0];
 * ```
 */
export function snc(hdIn: PointsInput, ldIn: PointsInput, opts: SncOptions = {}): Snc {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const n = hd.n;
    const maxPoints = opts.maxPoints ?? 6000;
    if (n > maxPoints) {
        throw new RangeError(
            `snc holds two ${n}x${n} similarity matrices (~${Math.round(2 * n * n * 8 / 1e6)} MB); ` +
            `n=${n} exceeds maxPoints=${maxPoints}. Raise maxPoints to override.`,
        );
    }

    const iterations = opts.iterations ?? 150;
    const alpha = opts.alpha ?? 0.1;
    const walkLength = Math.max(1, Math.floor(n * (opts.walkRatio ?? 0.3)));
    const k = opts.k ?? Math.floor(Math.sqrt(n));
    if (k < 1 || k >= n) throw new RangeError(`k must satisfy 1 <= k < ${n}, got ${k}`);

    const randomizer = new Randomizer(opts.seed ?? 1212);
    const random = () => randomizer.random;

    const hdKnn = knnOf(hd, k);
    const ldKnn = knnOf(ld, k);
    const hdSnn = sharedNeighborSimilarity(hdKnn, n, k);
    const ldSnn = sharedNeighborSimilarity(ldKnn, n, k);

    // The dissimilarity range sets the scale distortions are measured against.
    let maxDissim = -Infinity, minDissim = Infinity;
    for (let t = 0; t < hdSnn.length; ++t) {
        const dissim = 1 / (hdSnn[t] + alpha) - 1 / (ldSnn[t] + alpha);
        if (dissim > maxDissim) maxDissim = dissim;
        if (dissim < minDissim) minDissim = dissim;
    }
    const maxCompress = maxDissim > 0 ? maxDissim : 0;
    const minCompress = minDissim > 0 ? minDissim : 0;
    const maxStretch = minDissim < 0 ? -minDissim : 0;
    const minStretch = maxDissim < 0 ? -maxDissim : 0;

    const localSteadiness = opts.local ? new Float64Array(n) : undefined;
    const localCohesiveness = opts.local ? new Float64Array(n) : undefined;

    /** One direction of the measure. */
    const measure = (
        steadinessMode: boolean, maxVal: number, minVal: number, log?: Float64Array,
    ): number => {
        const scale = maxVal - minVal;
        if (scale <= 0) return 1;

        // Steadiness draws its clusters from the projection and scores them in
        // the original space; cohesiveness does the reverse.
        const walkKnn = steadinessMode ? ldKnn : hdKnn;
        const walkSnn = steadinessMode ? ldSnn : hdSnn;
        const points = steadinessMode ? hd : ld;

        let distortionSum = 0, weightSum = 0;
        for (let iter = 0; iter < iterations; ++iter) {
            if ((iter & 15) === 0) opts.signal?.throwIfAborted();

            let indices = extractCluster(walkKnn, walkSnn, n, k, walkLength, random);
            let guard = 0;
            while (indices.length <= 1 && guard++ < 32) {
                indices = extractCluster(walkKnn, walkSnn, n, k, walkLength, random);
            }
            if (indices.length <= 1) continue;

            // Partition the drawn cluster in the *other* space.
            const sub = indices.map((i) =>
                Array.from({ length: points.d }, (_, c) => points.data[i * points.d + c]));
            const kk = Math.min(Math.max(2, Math.floor(Math.sqrt(indices.length))), indices.length);
            const groups = new KMeans(sub, { K: kk, seed: randomizer.random_int })
                .get_clusters()
                .filter((g) => g.length > 0)
                .map((g) => g.map((localIdx) => indices[localIdx]));

            for (let a = 0; a < groups.length; ++a) {
                for (let b = 0; b < a; ++b) {
                    const hdDist = clusterDistance(hdSnn, n, groups[a], groups[b], alpha);
                    const ldDist = clusterDistance(ldSnn, n, groups[a], groups[b], alpha);
                    const distance = steadinessMode ? hdDist - ldDist : ldDist - hdDist;
                    if (distance <= 0) continue;

                    const distortion = (distance - minVal) / scale;
                    const weight = groups[a].length * groups[b].length;
                    distortionSum += distortion * weight;
                    weightSum += weight;

                    if (log) {
                        const contribution = distortion * weight;
                        for (const i of groups[a]) log[i] += contribution;
                        for (const j of groups[b]) log[j] += contribution;
                    }
                }
            }
        }
        return weightSum === 0 ? 1 : 1 - distortionSum / weightSum;
    };

    const steadiness = measure(true, maxCompress, minCompress, localSteadiness);
    const cohesiveness = measure(false, maxStretch, minStretch, localCohesiveness);

    // Per-point contributions are normalised to [0,1] and inverted, so a high
    // value means the point took part in little distortion.
    const finish = (log?: Float64Array) => {
        if (!log) return undefined;
        let max = 0;
        for (const v of log) if (v > max) max = v;
        for (let i = 0; i < log.length; ++i) log[i] = 1 - (max > 0 ? log[i] / max : 0);
        return log;
    };

    return {
        n,
        steadiness,
        cohesiveness,
        ...(localSteadiness ? { localSteadiness: finish(localSteadiness)! } : {}),
        ...(localCohesiveness ? { localCohesiveness: finish(localCohesiveness)! } : {}),
    };
}
