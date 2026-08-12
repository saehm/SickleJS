/**
 * Class measures based on the projection's nearest neighbours, plus two
 * cluster-validity indexes.
 *
 * `neighborhoodHit` and `classificationError` share their neighbour computation:
 * pass `knnIndices` to both.
 */

import type { MetricResult } from "../core/result.ts";
import { Accumulator } from "../core/sum.ts";
import { makeRadixScratch, radixArgsort } from "../core/sort.ts";
import { type PointsInput, type Vectors, toVectors } from "../core/vectors.ts";
import type { Clusters } from "./separability.ts";

/**
 * The k nearest neighbours of every point in the projection, self excluded.
 *
 * Shared setup for {@link neighborhoodHit} and {@link classificationError}; pass
 * the result to both to avoid computing it twice.
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { knnIndices, neighborhoodHit, classificationError } from "@saehrimnir/sickle";
 *
 * // Flat Int32Array of n*k neighbour indices, row-major.
 * const knn = knnIndices(projection, 20);
 * knn.length;  // 4000 for n = 200, k = 20
 *
 * // Pass it to both measures so the neighbour search happens once.
 * neighborhoodHit(projection, labels, 20, knn).value;      // 1
 * classificationError(projection, labels, 20, knn).value;  // 0
 * ```
 */
export function knnIndices(ldIn: PointsInput, k: number): Int32Array {
    const ld = toVectors(ldIn);
    const { n, d, data } = ld;
    if (!Number.isInteger(k) || k < 1 || k >= n) {
        throw new RangeError(`k must be an integer in [1, ${n - 1}], got ${k}`);
    }
    const out = new Int32Array(n * k);
    const dist = new Float64Array(n);
    const order = new Uint32Array(n);
    const scratch = makeRadixScratch(n);

    for (let i = 0; i < n; ++i) {
        for (let j = 0; j < n; ++j) {
            if (j === i) { dist[j] = -1; continue; } // self sorts first
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
 * Share of each point's visual neighbours that carry its own label.
 *
 * Answers "if I look at a point and the ones drawn around it, do they agree?" —
 * close to how a viewer actually reads a coloured scatterplot.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [0, 1], higher is better. The chance level is the largest class's share
 *   of the data, not 0.
 * - Cost: O(N²·D).
 *
 * @see Paulovich et al., IEEE TVCG 14 (2008)
 *   {@link https://doi.org/10.1109/TVCG.2007.70443}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { neighborhoodHit } from "@saehrimnir/sickle";
 *
 * // Takes raw labels, not a Clusters object.
 * neighborhoodHit(projection, labels, 20).value;  // 1 — every neighbour shares a class
 * // Chance here is the largest class's share, not 0.
 * ```
 */
export function neighborhoodHit(
    ldIn: PointsInput, labels: readonly unknown[], k = 20, knn?: Int32Array,
): MetricResult {
    const ld = toVectors(ldIn);
    const n = ld.n;
    if (labels.length !== n) throw new Error(`labels has length ${labels.length}, expected ${n}`);
    const nn = knn ?? knnIndices(ld, k);
    const local = new Float64Array(n);
    const acc = new Accumulator();
    for (let i = 0; i < n; ++i) {
        let same = 0;
        for (let t = 0; t < k; ++t) if (labels[nn[i * k + t]] === labels[i]) same += 1;
        local[i] = same / k;
        acc.add(local[i]);
    }
    return { value: acc.value / n, local, localKind: "mean" };
}

/**
 * Share of points whose label is *not* the majority among their visual neighbours.
 *
 * The decision-rule counterpart of {@link neighborhoodHit}: it asks whether a
 * viewer reading the plot would guess right, rather than how mixed the
 * neighbourhood is.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [0, 1], **lower is better**.
 * - Cost: O(N²·D).
 *
 * `k` defaults to 20. Ties count as correct — a tie means the picture is
 * genuinely ambiguous there — so the rule reads slightly optimistically.
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { classificationError } from "@saehrimnir/sickle";
 *
 * // k-NN misclassification rate, k = 20 by default. Ties count as correct, so
 * // this reads slightly optimistically.
 * classificationError(projection, labels).value;  // 0 — lower is better
 * ```
 */
export function classificationError(
    ldIn: PointsInput, labels: readonly unknown[], k = 20, knn?: Int32Array,
): MetricResult {
    const ld = toVectors(ldIn);
    const n = ld.n;
    if (labels.length !== n) throw new Error(`labels has length ${labels.length}, expected ${n}`);
    const nn = knn ?? knnIndices(ld, k);
    const local = new Float64Array(n);
    let wrong = 0;
    const votes = new Map<unknown, number>();

    for (let i = 0; i < n; ++i) {
        votes.clear();
        for (let t = 0; t < k; ++t) {
            const l = labels[nn[i * k + t]];
            votes.set(l, (votes.get(l) ?? 0) + 1);
        }
        let best = -1;
        for (const count of votes.values()) if (count > best) best = count;
        // Optimistic: if the point's own label is among the winners, it counts as
        // correctly classified.
        const correct = (votes.get(labels[i]) ?? 0) === best;
        local[i] = correct ? 0 : 1;
        if (!correct) wrong += 1;
    }
    return { value: wrong / n, local, localKind: "mean" };
}

// --- cluster validity ------------------------------------------------------

function centroidDistance(cl: Clusters, a: number, b: number): number {
    let s = 0;
    for (let j = 0; j < cl.d; ++j) {
        const t = cl.centroids[a * cl.d + j] - cl.centroids[b * cl.d + j];
        s += t * t;
    }
    return Math.sqrt(s);
}

/**
 * Smallest centroid-to-centroid gap divided by the widest class.
 *
 * **Not the textbook Dunn index.** The classic definition uses the minimum
 * distance between any two points of different classes; this uses the distance
 * between class *centroids*, which is far more robust to a single stray point.
 * The denominator is the classic one: the largest within-class point-pair
 * distance, so the measure is still volatile from below.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [0, ∞), higher is better. Above 1 means classes are further apart than
 *   they are wide.
 * - Cost: O(N²·D).
 *
 * @see Dunn, J. Cybernetics 3 (1973)
 *   {@link https://doi.org/10.1080/01969727308546046}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, dunnIndex } from "@saehrimnir/sickle";
 *
 * const cl = clusters(projection, labels);
 * dunnIndex(projection, cl).value;  // 2.6938 — unbounded, higher is better
 * ```
 */
export function dunnIndex(ldIn: PointsInput, cl: Clusters): MetricResult {
    const ld = toVectors(ldIn);
    const { n, d, data } = ld;
    const k = cl.keys.length;

    let minSeparation = Infinity;
    for (let a = 0; a < k; ++a) {
        for (let b = a + 1; b < k; ++b) {
            const dist = centroidDistance(cl, a, b);
            if (dist < minSeparation) minSeparation = dist;
        }
    }

    let maxDiameter = 0;
    for (let i = 0; i < n; ++i) {
        for (let j = i + 1; j < n; ++j) {
            if (cl.assignment[i] !== cl.assignment[j]) continue;
            let s = 0;
            for (let c = 0; c < d; ++c) { const t = data[i * d + c] - data[j * d + c]; s += t * t; }
            if (s > maxDiameter) maxDiameter = s;
        }
    }
    maxDiameter = Math.sqrt(maxDiameter);

    return {
        value: maxDiameter === 0 ? Infinity : minSeparation / maxDiameter,
        localKind: "none",
    };
}

/**
 * Average worst-case overlap between each class and its closest rival.
 *
 * - Needs: projection only. **Labels required.**
 * - Range: [0, ∞), **lower is better** — the opposite direction to most measures
 *   here. Below ~1 means classes are compact relative to their separation.
 * - Cost: O(N·D + k²) for k classes.
 *
 * @see Davies & Bouldin, IEEE TPAMI 1 (1979)
 *   {@link https://doi.org/10.1109/TPAMI.1979.4766909}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { clusters, daviesBouldin } from "@saehrimnir/sickle";
 *
 * const cl = clusters(projection, labels);
 * daviesBouldin(projection, cl).value;  // 0.1603 — unbounded, lower is better
 * ```
 */
export function daviesBouldin(ldIn: PointsInput, cl: Clusters): MetricResult {
    const ld = toVectors(ldIn);
    const { n, d, data } = ld;
    const k = cl.keys.length;

    // Mean distance from each point to its own centroid.
    const spread = new Float64Array(k);
    for (let i = 0; i < n; ++i) {
        const c = cl.assignment[i];
        let s = 0;
        for (let j = 0; j < d; ++j) {
            const t = data[i * d + j] - cl.centroids[c * d + j];
            s += t * t;
        }
        spread[c] += Math.sqrt(s);
    }
    for (let c = 0; c < k; ++c) spread[c] /= cl.sizes[c];

    const acc = new Accumulator();
    for (let a = 0; a < k; ++a) {
        let worst = 0;
        for (let b = 0; b < k; ++b) {
            if (a === b) continue;
            const separation = centroidDistance(cl, a, b);
            if (separation === 0) continue;
            const ratio = (spread[a] + spread[b]) / separation;
            if (ratio > worst) worst = ratio;
        }
        acc.add(worst);
    }
    return { value: acc.value / k, localKind: "none" };
}
