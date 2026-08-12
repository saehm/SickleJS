/**
 * Measures built on the Gabriel graph of the projection — which points a viewer
 * reads as adjacent.
 */

import { Delaunay } from "d3-delaunay";
import type { MetricResult } from "../core/result.ts";
import { makeRadixScratch, radixArgsort } from "../core/sort.ts";
import { Accumulator } from "../core/sum.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";

function delaunayOf(ld: Vectors) {
    const n = ld.n;
    return Delaunay.from(
        { length: n } as never,
        (_: unknown, i: number) => ld.data[i * 2],
        (_: unknown, i: number) => ld.data[i * 2 + 1],
    );
}

const distance = (v: Vectors, i: number, j: number): number => {
    let s = 0;
    for (let c = 0; c < v.d; ++c) {
        const t = v.data[i * v.d + c] - v.data[j * v.d + c];
        s += t * t;
    }
    return Math.sqrt(s);
};

/** * @category Class separability * @group Class separability */
export type GabrielStrategy = "auto" | "fast" | "exact";

/** True when two points share coordinates exactly. */
function hasCoincidentPoints(ld: Vectors): boolean {
    const seen = new Set<string>();
    for (let i = 0; i < ld.n; ++i) {
        const key = `${ld.data[i * 2]},${ld.data[i * 2 + 1]}`;
        if (seen.has(key)) return true;
        seen.add(key);
    }
    return false;
}

/** Is the angle at `r` subtended by `p` and `q` obtuse? Equivalently: is `r`
 *  strictly inside the disc having `pq` as diameter (Thales)? */
function subtendsObtuse(D: Float64Array, p: number, q: number, r: number): boolean {
    const px = D[p * 2] - D[r * 2], py = D[p * 2 + 1] - D[r * 2 + 1];
    const qx = D[q * 2] - D[r * 2], qy = D[q * 2 + 1] - D[r * 2 + 1];
    return px * qx + py * qy < 0;
}

/**
 * Gabriel graph in O(N log N), dominated by the triangulation.
 *
 * A Gabriel edge is a Delaunay edge whose diameter disc is empty, and for a
 * Delaunay edge only the apexes of its two adjacent triangles can lie in that
 * disc: the half-disc on one side is contained in that side's circumcircle,
 * which Delaunay guarantees is empty of everything but its own three vertices.
 * So the empty-disc test reduces to two dot products.
 *
 * This relies on the Delaunay triangulation being well defined, which coincident
 * points break — hence the guard in {@link gabrielEdges}.
 */
function gabrielEdgesFast(ld: Vectors): Array<[number, number]> {
    const n = ld.n, D = ld.data;
    const delaunay = delaunayOf(ld);
    const tri = delaunay.triangles, half = delaunay.halfedges;
    const next = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);
    const prev = (e: number) => (e % 3 === 0 ? e + 2 : e - 1);

    const out: Array<[number, number]> = [];
    for (let e = 0; e < tri.length; ++e) {
        const opposite = half[e];
        // Canonicalise by halfedge index, not vertex order: hull edges have no
        // opposite halfedge, and a vertex-order test would drop half of them.
        if (opposite >= 0 && opposite < e) continue;
        const p = tri[e], q = tri[next(e)];
        if (subtendsObtuse(D, p, q, tri[prev(e)])) continue;
        if (opposite >= 0 && subtendsObtuse(D, p, q, tri[prev(opposite)])) continue;
        out.push(p < q ? [p, q] : [q, p]);
    }
    return out;
}

/** Gabriel graph by the definition: test every point against every candidate edge. */
function gabrielEdgesExact(ld: Vectors): Array<[number, number]> {
    const n = ld.n;
    const delaunay = delaunayOf(ld);
    const xs = (i: number) => ld.data[i * 2];
    const ys = (i: number) => ld.data[i * 2 + 1];

    const edges: Array<[number, number]> = [];
    for (let i = 0; i < n; ++i) {
        for (const j of delaunay.neighbors(i)) {
            if (j < i) continue;
            const mx = (xs(i) + xs(j)) / 2, my = (ys(i) + ys(j)) / 2;
            const r = Math.hypot(xs(i) - xs(j), ys(i) - ys(j)) / 2;
            let empty = true;
            for (let k = 0; k < n; ++k) {
                if (k === i || k === j) continue;
                if (Math.hypot(xs(k) - mx, ys(k) - my) < r) { empty = false; break; }
            }
            if (empty) edges.push([i, j]);
        }
    }
    return edges;
}

/**
 * The Gabriel graph of the projection: which points a viewer reads as adjacent.
 *
 * `"auto"` (the default) picks an O(N log N) algorithm, falling back to the
 * O(N²) definition when coincident points make the triangulation degenerate.
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { gabrielEdges } from "@saehrimnir/sickle";
 *
 * // 2-D only — throws otherwise.
 * const edges = gabrielEdges(projection);
 * edges.length;  // 351 for these 200 points
 * edges[0];      // [101, 145] — a pair of point indices
 * ```
 */
export function gabrielEdges(
    ldIn: PointsInput, strategy: GabrielStrategy = "auto",
): Array<[number, number]> {
    const ld = toVectors(ldIn);
    if (ld.d !== 2) throw new Error(`Gabriel graph requires 2-dimensional data, got d=${ld.d}`);
    const useExact = strategy === "exact" || (strategy === "auto" && hasCoincidentPoints(ld));
    return useExact ? gabrielEdgesExact(ld) : gabrielEdgesFast(ld);
}

/**
 * Harmonic decay weights.
 *
 * For a point with `kj` Gabriel neighbours, in a graph whose busiest point has
 * `n` of them, the weight of the t-th nearest neighbour falls off harmonically,
 * flattening once `t` passes `kj - 1`. So a class mismatch with a *near*
 * high-dimensional neighbour costs more than one with a distant neighbour, and a
 * point with few neighbours weighs each of them more heavily.
 *
 * Undefined for `kj = 1`: the divisor `kj - 1` is zero. See
 * {@link gabrielClassificationError} for how such points are handled.
 */
function harmonicDecay(kj: number, n: number): Float64Array {
    const limit = kj - 1;
    const suffix = new Float64Array(n);
    let running = 0;
    for (let t = n - 1; t >= 0; --t) {
        running += 1 / Math.min(t + 1, limit);
        suffix[t] = running;
    }
    // The first weight is repeated, shifting the rest down by one.
    const out = new Float64Array(n);
    out[0] = suffix[0];
    for (let t = 1; t < n; ++t) out[t] = suffix[t - 1];
    return out;
}

/** * @category Class separability * @group Class separability */
export interface GceResult extends MetricResult {
    /** Points that contributed to the mean; see the note on leaves. */
    readonly counted: number;
    /** Indices excluded because they are leaves of the Gabriel graph. */
    readonly excluded: Int32Array;
}

/**
 * Class disagreements between visually adjacent points, weighted by how close they
 * really are.
 *
 * The only measure here that uses the data *and* the labels. Every other
 * label-based measure sees the projection alone, so a layout that invents clean
 * clusters fools them; this one asks whether points drawn side by side are
 * genuinely related, and charges most for the pairs that are not.
 *
 * Each point's Gabriel neighbours are ordered by their **high-dimensional**
 * distance and weighted by a harmonically decaying sequence, so the weight is
 * largest for the neighbour that is genuinely nearest. A cross-class edge to a
 * point the data says is close therefore costs the most; one to a point that was
 * always far away costs least. The adjacency itself comes from the projection, so
 * a layout that draws the classes apart has few cross-class edges to charge for
 * at all.
 *
 * - Needs: high-dimensional data and projection. **Labels required.**
 * - Range: [0, ∞), **lower is better**; 0 means no adjacent pair crosses a class
 *   boundary. **Not normalised** — it grows with neighbourhood size, so compare
 *   only within a dataset.
 * - Needs a **2-dimensional** projection: it builds a Gabriel graph, which
 *   {@link gabrielEdges} defines only for `d === 2`.
 * - Cost: O(N log N) for the Delaunay triangulation the Gabriel graph is filtered
 *   from, plus O(N·D + Σ k log k) for the weighting — the graph is planar, so the
 *   edge count is linear in N. The `exact` strategy, used as a fallback when
 *   points coincide, is the O(N²) path.
 *
 * Gabriel leaves have no defined weighting — the harmonic sequence divides by
 * `kj - 1` — and isolated points have no neighbours at all; both are left out of
 * the average. `counted` is how many points contributed, and `excluded` is an
 * `Int32Array` of the indices that did not. Their per-point entries are `NaN`,
 * which is what `localKind: "partial-mean"` announces.
 *
 * @see Thrun, Märte & Stier, Mach. Learn. Knowl. Extr. 5 (2023)
 *   {@link https://doi.org/10.3390/make5030056}
 *
 * @category Class separability
 * @group Class separability
 *
 * @example
 * ```ts
 * import { gabrielClassificationError } from "@saehrimnir/sickle";
 *
 * // The only label measure that also reads the high-dimensional data; the
 * // projection must be 2-D.
 * const g = gabrielClassificationError(data, projection, labels);
 *
 * g.value;             // 0.2147 — unbounded, lower is better
 * g.counted;           // 196 — points that contributed
 * g.excluded.length;   // 4 — indices of Gabriel leaves and isolated points
 * g.localKind;         // "partial-mean": excluded points hold NaN, not 0
 * ```
 */
export function gabrielClassificationError(
    hdIn: PointsInput, ldIn: PointsInput, labels: readonly unknown[],
): GceResult {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const n = ld.n;
    if (labels.length !== n) throw new Error(`labels has length ${labels.length}, expected ${n}`);

    const adjacency: number[][] = Array.from({ length: n }, () => []);
    for (const [i, j] of gabrielEdges(ld)) { adjacency[i].push(j); adjacency[j].push(i); }

    // Weight vectors are sized by the busiest point in the graph.
    let widest = 0;
    for (let i = 0; i < n; ++i) if (adjacency[i].length > widest) widest = adjacency[i].length;
    if (widest === 0) {
        return {
            value: 0, local: new Float64Array(n), localKind: "partial-mean",
            counted: 0, excluded: Int32Array.from({ length: n }, (_, i) => i),
        };
    }

    const local = new Float64Array(n).fill(NaN);
    const excluded: number[] = [];
    const acc = new Accumulator();
    const weightCache = new Map<number, Float64Array>();
    let counted = 0;

    for (let i = 0; i < n; ++i) {
        const neighbors = adjacency[i];
        const count = neighbors.length;
        // A leaf (or an isolated point) has no defined weighting; see above.
        if (count <= 1 && count < widest) { excluded.push(i); continue; }
        if (count === 0) { excluded.push(i); continue; }

        // Order this point's Gabriel neighbours by high-dimensional distance.
        const sorted = neighbors
            .map((j) => ({ j, d: distance(hd, i, j) }))
            .sort((a, b) => a.d - b.d || a.j - b.j);

        let weights = weightCache.get(count);
        if (!weights) { weights = harmonicDecay(count, widest); weightCache.set(count, weights); }

        let total = 0;
        for (let t = 0; t < count; ++t) {
            if (labels[sorted[t].j] !== labels[i]) total += weights[t];
        }
        local[i] = total;
        acc.add(total);
        counted += 1;
    }

    return {
        value: counted === 0 ? 0 : acc.value / counted,
        local,
        localKind: "partial-mean",
        counted,
        excluded: Int32Array.from(excluded),
    };
}
