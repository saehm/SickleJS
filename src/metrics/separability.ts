/**
 * Class-separability measures, computed on the projection alone.
 *
 * They report whether the classes *look* separated. None can tell whether that
 * separation reflects the data — for that see `gabrielClassificationError`, the
 * only labelled measure here that also reads the high-dimensional side.
 */

import type { MetricResult } from "../core/result.ts";
import { Accumulator } from "../core/sum.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";

/**
 * Cluster bookkeeping shared by every metric here. Computed once.
 *
 * @category Class separability
 * @group Class separability
 */
export interface Clusters {
    readonly n: number;
    readonly labels: readonly unknown[];
    /** Distinct labels, in first-appearance order. */
    readonly keys: readonly unknown[];
    /** `assignment[i]` indexes into `keys`. */
    readonly assignment: Uint32Array;
    readonly sizes: Uint32Array;
    /** Cluster centroids, `keys.length * d`, row-major. */
    readonly centroids: Float64Array;
    readonly d: number;
}

/**
 * Group points by label and compute the centroids the label-based measures need.
 *
 * Build this once and pass it to each of them; it is the shared setup, not a
 * measure itself.
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, silhouette, daviesBouldin } from "@saehrimnir/sickle";
 *
 * // `projection` is number[][], 200 x 2; one label per point, 4 classes.
 * const cl = clusters(projection, labels);  // build once, pass to every measure
 *
 * cl.keys.length;               // 4
 * cl.sizes;                     // Uint32Array [50, 50, 50, 50]
 * silhouette(projection, cl).value;     // 0.8838
 * daviesBouldin(projection, cl).value;  // 0.1603
 * ```
 */
export function clusters(ldIn: PointsInput, labels: readonly unknown[]): Clusters {
    const ld = toVectors(ldIn);
    const { n, d, data } = ld;
    if (labels.length !== n) {
        throw new Error(`labels has length ${labels.length}, expected ${n}`);
    }
    const index = new Map<unknown, number>();
    const assignment = new Uint32Array(n);
    for (let i = 0; i < n; ++i) {
        const l = labels[i];
        let k = index.get(l);
        if (k === undefined) { k = index.size; index.set(l, k); }
        assignment[i] = k;
    }
    const keys = [...index.keys()];
    const k = keys.length;
    if (k < 2) throw new Error(`at least 2 distinct labels are required, got ${k}`);

    const sizes = new Uint32Array(k);
    const centroids = new Float64Array(k * d);
    for (let i = 0; i < n; ++i) {
        const c = assignment[i];
        sizes[c] += 1;
        for (let j = 0; j < d; ++j) centroids[c * d + j] += data[i * d + j];
    }
    for (let c = 0; c < k; ++c) {
        for (let j = 0; j < d; ++j) centroids[c * d + j] /= sizes[c];
    }
    return { n, labels, keys, assignment, sizes, centroids, d };
}

function distanceRow(v: Vectors, i: number, out: Float64Array): void {
    const { data, n, d } = v;
    const base = i * d;
    for (let j = 0; j < n; ++j) {
        const jb = j * d;
        let s = 0;
        for (let c = 0; c < d; ++c) {
            const diff = data[base + c] - data[jb + c];
            s += diff * diff;
        }
        out[j] = Math.sqrt(s);
    }
}

/**
 * How much closer each point is to its own class than to the nearest other class.
 *
 * The standard cluster-quality measure. Reads the picture only, so it says whether
 * the classes *look* separated — not whether that separation is real. A projection
 * that invents clean clusters scores well here.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [-1, 1], higher is better. Above ~0.5 is well separated; near 0 means
 *   classes overlap; negative means points sit closer to another class than their
 *   own.
 * - Cost: O(N²·D).
 *
 * Per-point values are the classic silhouette scores and average to the total.
 *
 * @see Rousseeuw, J. Comput. Appl. Math. 20 (1987)
 *   {@link https://doi.org/10.1016/0377-0427(87)90125-7}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, silhouette } from "@saehrimnir/sickle";
 *
 * const cl = clusters(projection, labels);  // takes a Clusters, not raw labels
 *
 * silhouette(projection, cl).value;  // 0.8838 — PCA of 4 gaussian blobs
 * // the same labels on a random projection: -0.049, i.e. classes overlap
 * ```
 */
export function silhouette(ldIn: PointsInput, cl: Clusters): MetricResult {
    const ld = toVectors(ldIn);
    const n = cl.n;
    const k = cl.keys.length;
    const local = new Float64Array(n);
    const row = new Float64Array(n);
    const perCluster = new Float64Array(k);

    for (let i = 0; i < n; ++i) {
        distanceRow(ld, i, row);
        perCluster.fill(0);
        for (let j = 0; j < n; ++j) {
            if (j === i) continue;
            perCluster[cl.assignment[j]] += row[j];
        }
        const own = cl.assignment[i];
        if (cl.sizes[own] <= 1) { local[i] = 0; continue; }

        const a = perCluster[own] / (cl.sizes[own] - 1);
        let b = Infinity;
        for (let c = 0; c < k; ++c) {
            if (c === own) continue;
            const mean = perCluster[c] / cl.sizes[c];
            if (mean < b) b = mean;
        }
        const denom = Math.max(a, b);
        local[i] = denom === 0 ? 0 : (b - a) / denom;
    }

    const acc = new Accumulator();
    for (let i = 0; i < n; ++i) acc.add(local[i]);
    return { value: acc.value / n, local, localKind: "mean" };
}

/**
 * Ratio of between-class to within-class scatter.
 *
 * Rewards classes that are tight and far apart. Unbounded above, so it is only
 * meaningful when comparing projections of the *same* labelled dataset — the
 * magnitude carries no absolute meaning.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [0, ∞), higher is better.
 * - Cost: O(N·D).
 *
 * @see Caliński & Harabasz, Comm. Statistics 3 (1974)
 *   {@link https://doi.org/10.1080/03610927408827101}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, calinskiHarabasz } from "@saehrimnir/sickle";
 *
 * const cl = clusters(projection, labels);
 * calinskiHarabasz(projection, cl).value;  // 4686.8502
 * // Unbounded: meaningless on its own, only comparable between projections of
 * // the same points.
 * ```
 */
export function calinskiHarabasz(ldIn: PointsInput, cl: Clusters): MetricResult {
    const ld = toVectors(ldIn);
    const { n, d, data } = ld;
    const k = cl.keys.length;

    const grand = new Float64Array(d);
    for (let i = 0; i < n; ++i) for (let j = 0; j < d; ++j) grand[j] += data[i * d + j];
    for (let j = 0; j < d; ++j) grand[j] /= n;

    const between = new Accumulator();
    for (let c = 0; c < k; ++c) {
        let s = 0;
        for (let j = 0; j < d; ++j) {
            const diff = cl.centroids[c * d + j] - grand[j];
            s += diff * diff;
        }
        between.add(cl.sizes[c] * s);
    }

    const within = new Accumulator();
    for (let i = 0; i < n; ++i) {
        const c = cl.assignment[i];
        let s = 0;
        for (let j = 0; j < d; ++j) {
            const diff = data[i * d + j] - cl.centroids[c * d + j];
            s += diff * diff;
        }
        within.add(s);
    }

    const w = within.value;
    const value = w === 0 ? Infinity : (between.value / (k - 1)) / (w / (n - k));
    return { value, localKind: "none" };
}

/**
 * Fraction of points lying nearest their own class centroid.
 *
 * A blunt but very readable measure: "what share of the plot is on the right side
 * of the boundaries". Being centroid-based, it is blind to class shape — two
 * interleaved crescents with the same centre score badly even if perfectly drawn.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [0, 1], higher is better. The chance level is roughly 1/number of
 *   classes.
 * - Cost: O(N·k·D) for k classes.
 *
 * @see Sips, Neubert, Lewis & Hanrahan, Computer Graphics Forum 28 (2009)
 *   {@link https://doi.org/10.1111/j.1467-8659.2009.01467.x}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, distanceConsistency } from "@saehrimnir/sickle";
 *
 * const cl = clusters(projection, labels);
 * distanceConsistency(projection, cl).value;  // 1 — every point nearest its own centroid
 * // Chance is about 1 / number of classes, so 0.25 here, not 0.
 * ```
 */
export function distanceConsistency(ldIn: PointsInput, cl: Clusters): MetricResult {
    const ld = toVectors(ldIn);
    const { n, d, data } = ld;
    const k = cl.keys.length;
    const local = new Float64Array(n);
    let consistent = 0;

    for (let i = 0; i < n; ++i) {
        let best = -1;
        let bestDist = Infinity;
        for (let c = 0; c < k; ++c) {
            let s = 0;
            for (let j = 0; j < d; ++j) {
                const diff = data[i * d + j] - cl.centroids[c * d + j];
                s += diff * diff;
            }
            // Strict `<` keeps the lowest-indexed centroid on an exact tie,
            // matching zadu's scan order.
            if (s < bestDist) { bestDist = s; best = c; }
        }
        const ok = best === cl.assignment[i];
        local[i] = ok ? 1 : 0;
        if (ok) ++consistent;
    }
    return { value: consistent / n, local, localKind: "mean" };
}

/**
 * Mean distance between classes divided by mean distance within them.
 *
 * The simplest possible separation ratio.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [0, ∞), higher is better. 1 means between- and within-class distances
 *   are alike, i.e. no separation.
 * - Cost: O(N²·D).
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, averageBetweenWithin } from "@saehrimnir/sickle";
 *
 * const cl = clusters(projection, labels);
 * averageBetweenWithin(projection, cl).value;  // 10.7873
 * // 1 means between- and within-class distances are alike, i.e. no separation.
 * ```
 */
export function averageBetweenWithin(ldIn: PointsInput, cl: Clusters): MetricResult {
    const ld = toVectors(ldIn);
    const n = cl.n;
    const row = new Float64Array(n);
    const between = new Accumulator(), within = new Accumulator();
    let betweenCount = 0, withinCount = 0;

    for (let i = 0; i < n; ++i) {
        distanceRow(ld, i, row);
        let b = 0, w = 0;
        for (let j = i + 1; j < n; ++j) {
            if (cl.assignment[i] === cl.assignment[j]) { w += row[j]; ++withinCount; }
            else { b += row[j]; ++betweenCount; }
        }
        between.add(b);
        within.add(w);
    }
    if (withinCount === 0) return { value: Infinity, localKind: "none" };
    return {
        value: (between.value / betweenCount) / (within.value / withinCount),
        localKind: "none",
    };
}

/**
 * Average gap between each point's nearest same-class and nearest other-class
 * neighbour.
 *
 * Unlike centroid measures this is purely local, so it copes with classes of any
 * shape. Its units are those of the projection, so compare only within a dataset.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: (-∞, ∞), higher is better. Negative means the typical point is closer
 *   to another class than to its own.
 * - Cost: O(N²·D).
 *
 * Points whose class has no other member are skipped. When that happens the whole
 * `local` array is rescaled by `(value * n) / sum(local)` so that it still averages
 * to the score, as `localKind: "mean"` promises — which means an individual entry
 * is no longer exactly that point's miss-minus-hit margin. With every class
 * populated, no rescaling occurs and the entries are the raw margins.
 *
 * Per-point values average to
 * the score.
 *
 * @see Gilad-Bachrach, Navot & Tishby, ICML 2004
 *   {@link https://doi.org/10.1145/1015330.1015352}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, hypothesisMargin } from "@saehrimnir/sickle";
 *
 * const cl = clusters(projection, labels);
 * hypothesisMargin(projection, cl).value;  // 12.494 — unbounded in both directions
 * ```
 */
export function hypothesisMargin(ldIn: PointsInput, cl: Clusters): MetricResult {
    const ld = toVectors(ldIn);
    const n = cl.n;
    const row = new Float64Array(n);
    const local = new Float64Array(n);
    const acc = new Accumulator();
    let counted = 0;

    for (let i = 0; i < n; ++i) {
        distanceRow(ld, i, row);
        let hit = Infinity, miss = Infinity;
        for (let j = 0; j < n; ++j) {
            if (j === i) continue;
            const dj = row[j];
            // `Infinity` as the sentinel, not a falsy index: point 0 is a valid
            // neighbour and `!0` would silently discard it.
            if (cl.assignment[j] === cl.assignment[i]) { if (dj < hit) hit = dj; }
            else if (dj < miss) miss = dj;
        }
        if (!Number.isFinite(hit) || !Number.isFinite(miss)) continue;
        const m = miss - hit;
        local[i] = m;
        acc.add(m);
        ++counted;
    }
    if (counted === 0) return { value: NaN, localKind: "none" };
    // Rescale so the contract mean(local) === value holds over all n entries.
    const value = acc.value / counted;
    if (counted !== n) {
        const scale = (value * n) / acc.value || 0;
        for (let i = 0; i < n; ++i) local[i] *= scale;
    }
    return { value, local, localKind: "mean" };
}
