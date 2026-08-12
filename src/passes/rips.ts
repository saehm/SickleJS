/**
 * Vietoris-Rips persistent homology in degree 1 — the loops in a point cloud.
 *
 * Used by `topologicalH1`. Expensive: it enumerates triangles, so `maxPoints`
 * defaults to 200. See `../metrics/NOTES-topology.md` for costs and alternatives.
 */

import { type PointsInput, type Vectors, toVectors } from "../core/vectors.ts";

/**
 * A persistence diagram: `[birth, death]` pairs. `death` may be Infinity.
 *
 * @category Topology
 * @group Topology
 */
export type Diagram = Array<[number, number]>;

/** * @category Passes * @group Passes */
export interface RipsOptions {
    /**
     * Discard simplices above this filtration value. Defaults to the enclosing
     * radius, which is lossless for H1.
     */
    threshold?: number;
    /** Refuse above this many points. Default 200; see the cost table. */
    maxPoints?: number;
    /** Drop features whose persistence is at or below this. Default 0. */
    minPersistence?: number;
    signal?: AbortSignal;
}

/**
 * The smallest radius at which some point covers all others.
 *
 * Beyond it the Rips complex is a cone, so all homology above degree 0 vanishes
 * and nothing is lost by truncating there.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { enclosingRadius, ripsH1 } from "@saehrimnir/sickle";
 *
 * // The default threshold `ripsH1` builds its complex up to.
 * enclosingRadius(projection);  // 21.3697
 * ripsH1(projection, { threshold: enclosingRadius(projection) / 2 });
 * ```
 */
export function enclosingRadius(vIn: PointsInput): number {
    const v = toVectors(vIn);
    const { n, d, data } = v;
    let best = Infinity;
    for (let i = 0; i < n; ++i) {
        let farthest = 0;
        for (let j = 0; j < n; ++j) {
            if (j === i) continue;
            let s = 0;
            for (let c = 0; c < d; ++c) { const t = data[i * d + c] - data[j * d + c]; s += t * t; }
            if (s > farthest) farthest = s;
        }
        const radius = Math.sqrt(farthest);
        if (radius < best) best = radius;
    }
    return best;
}

/** Symmetric difference of two ascending index lists, over Z/2. */
function addColumns(a: Int32Array<ArrayBuffer>, b: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
    const scratch = new Int32Array(a.length + b.length);
    let i = 0, j = 0, k = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i += 1; j += 1; }           // 1 + 1 = 0
        else if (a[i] < b[j]) scratch[k++] = a[i++];
        else scratch[k++] = b[j++];
    }
    while (i < a.length) scratch[k++] = a[i++];
    while (j < b.length) scratch[k++] = b[j++];
    const out = new Int32Array(k);
    out.set(scratch.subarray(0, k));
    return out;
}

/**
 * The degree-1 persistence diagram of the Vietoris-Rips filtration.
 *
 * Births are edge lengths, deaths are triangle filtration values (the longest of
 * the triangle's three edges).
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { ripsH1 } from "@saehrimnir/sickle";
 *
 * // One-dimensional holes: an array of [birth, death] pairs, longest first.
 * ripsH1(circlePoints);  // [[0.1256, 1.7526]] — a circle has one loop
 * ripsH1(arcPoints);     // [] — an open arc has none
 *
 * // Refuses above `maxPoints` (default 200) rather than subsampling.
 * ripsH1(bigProjection, { maxPoints: 400 });
 * ```
 */
export function ripsH1(vIn: PointsInput, opts: RipsOptions = {}): Diagram {
    const v = toVectors(vIn);
    const { n, d, data } = v;
    const maxPoints = opts.maxPoints ?? 200;
    if (n > maxPoints) {
        throw new RangeError(
            `ripsH1 enumerates up to C(${n},3) = ${Math.round((n * (n - 1) * (n - 2)) / 6)} triangles; ` +
            `n=${n} exceeds maxPoints=${maxPoints}. Subsample, or raise maxPoints.`,
        );
    }
    if (n < 3) return [];

    const threshold = opts.threshold ?? enclosingRadius(v);
    const minPersistence = opts.minPersistence ?? 0;

    // --- edges, indexed by a lookup table so triangles can find them fast ----
    const distance = (a: number, b: number): number => {
        let s = 0;
        for (let c = 0; c < d; ++c) { const t = data[a * d + c] - data[b * d + c]; s += t * t; }
        return Math.sqrt(s);
    };

    const edgeI: number[] = [], edgeJ: number[] = [], edgeLength: number[] = [];
    for (let i = 0; i < n; ++i) {
        for (let j = i + 1; j < n; ++j) {
            const w = distance(i, j);
            if (w <= threshold) { edgeI.push(i); edgeJ.push(j); edgeLength.push(w); }
        }
    }
    const edgeCount = edgeI.length;
    if (edgeCount === 0) return [];

    // Filtration order: by length, then lexicographically, so it is total and
    // reproducible.
    const edgeOrder = Array.from({ length: edgeCount }, (_, e) => e).sort(
        (a, b) => edgeLength[a] - edgeLength[b] || edgeI[a] - edgeI[b] || edgeJ[a] - edgeJ[b],
    );
    const edgeRank = new Int32Array(edgeCount);
    for (let r = 0; r < edgeCount; ++r) edgeRank[edgeOrder[r]] = r;

    // Dense n x n lookup from a vertex pair to its filtration rank; -1 if the
    // edge is above the threshold and therefore absent.
    const pairRank = new Int32Array(n * n).fill(-1);
    for (let e = 0; e < edgeCount; ++e) {
        pairRank[edgeI[e] * n + edgeJ[e]] = edgeRank[e];
        pairRank[edgeJ[e] * n + edgeI[e]] = edgeRank[e];
    }
    const rankLength = new Float64Array(edgeCount);
    for (let e = 0; e < edgeCount; ++e) rankLength[edgeRank[e]] = edgeLength[e];

    // --- triangles ----------------------------------------------------------
    // A triangle exists only if all three edges do, and its filtration value is
    // the largest of them.
    const triTop: number[] = [];   // rank of the triangle's longest edge
    const triA: number[] = [], triB: number[] = [], triC: number[] = [];
    for (let i = 0; i < n; ++i) {
        opts.signal?.throwIfAborted();
        for (let j = i + 1; j < n; ++j) {
            const ij = pairRank[i * n + j];
            if (ij < 0) continue;
            for (let k = j + 1; k < n; ++k) {
                const ik = pairRank[i * n + k];
                if (ik < 0) continue;
                const jk = pairRank[j * n + k];
                if (jk < 0) continue;
                const top = Math.max(ij, ik, jk);
                triTop.push(top); triA.push(ij); triB.push(ik); triC.push(jk);
            }
        }
    }
    const triangleCount = triTop.length;

    const triOrder = Array.from({ length: triangleCount }, (_, t) => t).sort(
        (a, b) => triTop[a] - triTop[b] || a - b,
    );

    // --- reduce the boundary matrix from triangles to edges ------------------
    // Column j holds the edge ranks of triangle j's faces. Reducing left to
    // right, a column's lowest surviving entry pairs it with that edge.
    const lowToColumn = new Int32Array(edgeCount).fill(-1);
    const reduced = new Map<number, Int32Array<ArrayBuffer>>();
    const diagram: Diagram = [];

    for (let index = 0; index < triangleCount; ++index) {
        if ((index & 1023) === 0) opts.signal?.throwIfAborted();
        const t = triOrder[index];

        let column = Int32Array.from([triA[t], triB[t], triC[t]].sort((a, b) => a - b));
        let low = column.length > 0 ? column[column.length - 1] : -1;

        while (low >= 0 && lowToColumn[low] >= 0) {
            column = addColumns(column, reduced.get(lowToColumn[low])!);
            low = column.length > 0 ? column[column.length - 1] : -1;
        }

        if (low >= 0) {
            lowToColumn[low] = index;
            reduced.set(index, column);
            const birth = rankLength[low];
            const death = rankLength[triTop[t]];
            if (death - birth > minPersistence) diagram.push([birth, death]);
        }
    }

    diagram.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return diagram;
}
