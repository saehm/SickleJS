/**
 * Topological measures: does the projection have the same shape as the data?
 *
 * `topologicalH0` compares how the points merge into connected pieces as a
 * distance threshold grows — cheap, since that diagram is the minimum spanning
 * tree. `topologicalH1` compares loops, which is far more expensive but the only
 * way to see a hole.
 *
 * Implementation notes and verification are in `NOTES-topology.md`.
 */

import type { MetricResult } from "../core/result.ts";
import { Accumulator } from "../core/sum.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";
import { type Diagram, type RipsOptions, ripsH1 } from "../passes/rips.ts";

/** * @category Topology * @group Topology */
export interface PersistenceH0 {
    /** Death times, ascending. Length `n - 1`. */
    readonly deaths: Float64Array;
    /** Endpoints of the MST edge each death came from, aligned with `deaths`. */
    readonly source: Int32Array;
    readonly target: Int32Array;
    /** Largest pairwise distance, the natural scale of the diagram. */
    readonly diameter: number;
}

/**
 * The degree-0 persistence diagram: the scales at which connected pieces merge.
 *
 * Equivalently the edge lengths of the euclidean minimum spanning tree. Returned
 * sorted, with the endpoints each merge came from.
 *
 * @category Topology
 * @group Topology
 *
 * @example
 * ```ts
 * import { persistenceH0 } from "@saehrimnir/sickle";
 *
 * // H0 persistence is the minimum spanning tree: every component is born at 0
 * // and dies when an edge joins it, so only the deaths carry information.
 * const d = persistenceH0(data);
 *
 * d.deaths.length;  // 199 — n - 1 MST edges
 * d.deaths[0];      // 0.8461 — deaths come sorted ascending
 * d.source[0];      // the two endpoints of the edge that closed this component
 * d.diameter;       // 30.0472 — the largest pairwise distance
 * ```
 */
export function persistenceH0(vIn: PointsInput): PersistenceH0 {
    const v = toVectors(vIn);
    const { n, d, data } = v;
    if (n < 2) throw new Error(`persistenceH0 needs at least 2 points, got ${n}`);

    const inTree = new Uint8Array(n);
    const best = new Float64Array(n).fill(Infinity);
    const bestFrom = new Int32Array(n).fill(-1);
    const edgeWeight = new Float64Array(n - 1);
    const edgeFrom = new Int32Array(n - 1);
    const edgeTo = new Int32Array(n - 1);
    let diameter = 0;

    const distance = (a: number, b: number): number => {
        let s = 0;
        for (let c = 0; c < d; ++c) { const t = data[a * d + c] - data[b * d + c]; s += t * t; }
        return Math.sqrt(s);
    };

    inTree[0] = 1;
    for (let j = 1; j < n; ++j) {
        const w = distance(0, j);
        best[j] = w; bestFrom[j] = 0;
        if (w > diameter) diameter = w;
    }

    for (let step = 0; step < n - 1; ++step) {
        let pick = -1, pickWeight = Infinity;
        for (let j = 0; j < n; ++j) {
            if (!inTree[j] && best[j] < pickWeight) { pickWeight = best[j]; pick = j; }
        }
        inTree[pick] = 1;
        edgeWeight[step] = pickWeight;
        edgeFrom[step] = bestFrom[pick];
        edgeTo[step] = pick;

        for (let j = 0; j < n; ++j) {
            if (inTree[j]) continue;
            const w = distance(pick, j);
            if (w > diameter) diameter = w;
            if (w < best[j]) { best[j] = w; bestFrom[j] = pick; }
        }
    }

    // Sort by death time; the endpoints travel with it.
    const order = Array.from({ length: n - 1 }, (_, i) => i)
        .sort((a, b) => edgeWeight[a] - edgeWeight[b] || a - b);
    const deaths = new Float64Array(n - 1);
    const source = new Int32Array(n - 1);
    const target = new Int32Array(n - 1);
    for (let i = 0; i < n - 1; ++i) {
        deaths[i] = edgeWeight[order[i]];
        source[i] = edgeFrom[order[i]];
        target[i] = edgeTo[order[i]];
    }
    return { deaths, source, target, diameter };
}

/**
 * Bottleneck distance between two degree-0 diagrams — the single worst mismatch.
 *
 * Takes multisets of death times, as {@link persistenceH0} returns.
 *
 * @category Topology
 * @group Topology
 *
 * @example
 * ```ts
 * import { persistenceH0, bottleneckH0 } from "@saehrimnir/sickle";
 *
 * // Takes two arrays of *deaths*, not point sets.
 * const a = persistenceH0(data), b = persistenceH0(projection);
 * bottleneckH0(a.deaths, b.deaths);  // 1.5859, in the data's units
 *
 * // Normalise by each diagram's diameter to compare across scales — which is
 * // exactly what `topologicalH0` does for you.
 * ```
 */
export function bottleneckH0(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const m = Math.max(a.length, b.length);
    if (m === 0) return 0;
    // Pad the shorter diagram with zeros: absent points sit on the diagonal.
    const av = new Float64Array(m), bv = new Float64Array(m);
    for (let i = 0; i < a.length; ++i) av[m - a.length + i] = a[i];
    for (let i = 0; i < b.length; ++i) bv[m - b.length + i] = b[i];

    let worst = 0;
    for (let i = 0; i < m; ++i) {
        const pair = Math.abs(av[i] - bv[i]);
        const diagonal = Math.max(av[i], bv[i]) / 2;
        const cost = Math.min(pair, diagonal);
        if (cost > worst) worst = cost;
    }
    return worst;
}

/**
 * Wasserstein-p distance between two degree-0 diagrams — total mismatch rather
 * than the worst one, so it responds to many small differences where the
 * bottleneck distance does not.
 *
 * @category Topology
 * @group Topology
 *
 * @example
 * ```ts
 * import { persistenceH0, wassersteinH0 } from "@saehrimnir/sickle";
 *
 * const a = persistenceH0(data), b = persistenceH0(projection);
 *
 * wassersteinH0(a.deaths, b.deaths, 1);  // 234.7026 — sums every discrepancy
 * wassersteinH0(a.deaths, b.deaths, 2);  // 15.4333
 * // Unlike the bottleneck distance, this notices many small differences.
 * ```
 */
export function wassersteinH0(a: ArrayLike<number>, b: ArrayLike<number>, p = 1): number {
    if (p < 1) throw new RangeError(`p must be at least 1, got ${p}`);
    const m = a.length, n = b.length;
    if (m === 0 && n === 0) return 0;

    const cost = (x: number) => (x / 2) ** p;
    let previous = new Float64Array(n + 1);
    for (let j = 1; j <= n; ++j) previous[j] = previous[j - 1] + cost(b[j - 1]);

    let current = new Float64Array(n + 1);
    for (let i = 1; i <= m; ++i) {
        current[0] = previous[0] + cost(a[i - 1]);
        for (let j = 1; j <= n; ++j) {
            const matched = previous[j - 1] + Math.abs(a[i - 1] - b[j - 1]) ** p;
            const dropA = previous[j] + cost(a[i - 1]);
            const dropB = current[j - 1] + cost(b[j - 1]);
            current[j] = Math.min(matched, dropA, dropB);
        }
        const swap = previous; previous = current; current = swap;
    }
    return previous[n] ** (1 / p);
}

/** * @category Topology * @group Topology */
export interface TopologyOptions {
    /** `"bottleneck"` (default) or `"wasserstein"`. */
    distance?: "bottleneck" | "wasserstein";
    /** Order for the Wasserstein distance. Default 1. */
    p?: number;
    /**
     * How to make the two diagrams comparable. `"diameter"` (default) divides
     * each by its own space's largest pairwise distance, which makes the measure
     * invariant to the arbitrary scale of a projection -- t-SNE and UMAP output
     * has no meaningful units. `"none"` compares raw values.
     */
    scale?: "diameter" | "none";
}

/**
 * Do the data and the projection merge into connected pieces at the same scales?
 *
 * Sweeps a distance threshold from 0 upwards and compares when clusters join in
 * each space. Unlike measures fixed at one k or one clustering, this covers every
 * scale at once — it catches a projection that fuses two branches of a manifold
 * too early, or keeps them apart too long.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, ∞), **lower is better**; 0 means identical merge structure. With
 *   the default `scale: "diameter"` a uniform rescaling scores 0, and values are
 *   in [0, 1].
 * - Cost: O(N²·D).
 *
 * Sees merging, not holes — for those use {@link topologicalH1}. Per-point values
 * give each point's share of the discrepancy.
 *
 * @see Rieck & Leitte, Computer Graphics Forum 34 (2015)
 *   {@link https://doi.org/10.1111/cgf.12655}
 *
 * @category Topology
 * @group Topology
 *
 * @example
 * ```ts
 * import { topologicalH0 } from "@saehrimnir/sickle";
 *
 * const t = topologicalH0(data, projection);
 *
 * t.value;      // 0.0528 — bottleneck distance, normalised by diameter
 * t.localKind;  // "share" — each rank gap split across the MST edge endpoints
 * t.local[0];   // 0.0025
 *
 * // Raw units instead of diameter-normalised, and Wasserstein instead:
 * topologicalH0(data, projection, { scale: "none" }).value;              // 1.5859
 * topologicalH0(data, projection, { distance: "wasserstein", p: 1 });
 * ```
 */
export function topologicalH0(
    hdIn: PointsInput, ldIn: PointsInput, opts: TopologyOptions = {},
): MetricResult & { readonly hdDiagram: PersistenceH0; readonly ldDiagram: PersistenceH0 } {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const scale = opts.scale ?? "diameter";
    const useWasserstein = opts.distance === "wasserstein";
    const p = opts.p ?? 1;

    const hdDiagram = persistenceH0(hd);
    const ldDiagram = persistenceH0(ld);

    const rescale = (dg: PersistenceH0): Float64Array => {
        if (scale === "none" || dg.diameter === 0) return dg.deaths;
        const out = new Float64Array(dg.deaths.length);
        for (let i = 0; i < out.length; ++i) out[i] = dg.deaths[i] / dg.diameter;
        return out;
    };
    const hdDeaths = rescale(hdDiagram);
    const ldDeaths = rescale(ldDiagram);

    const value = useWasserstein
        ? wassersteinH0(hdDeaths, ldDeaths, p)
        : bottleneckH0(hdDeaths, ldDeaths);

    // Attribute the per-rank discrepancy to the four endpoints involved.
    const n = hd.n;
    const local = new Float64Array(n);
    const total = new Accumulator();
    for (let i = 0; i < hdDeaths.length; ++i) {
        const gap = Math.abs(hdDeaths[i] - ldDeaths[i]);
        total.add(gap);
        const quarter = gap / 4;
        local[hdDiagram.source[i]] += quarter;
        local[hdDiagram.target[i]] += quarter;
        local[ldDiagram.source[i]] += quarter;
        local[ldDiagram.target[i]] += quarter;
    }
    const sum = total.value;
    if (sum > 0) for (let i = 0; i < n; ++i) local[i] /= sum;

    return { value, local, localKind: "share", hdDiagram, ldDiagram };
}

// --- H1 --------------------------------------------------------------------

/**
 * Bottleneck distance between two general persistence diagrams of `[birth, death]`
 * pairs. Use {@link bottleneckH0} for degree-0 diagrams, which is far faster.
 *
 * @category Topology
 * @group Topology
 *
 * @example
 * ```ts
 * import { ripsH1, bottleneckDistance } from "@saehrimnir/sickle";
 *
 * // Compares two H1 diagrams — arrays of [birth, death] pairs.
 * const circle = ripsH1(circlePoints);  // [[0.1256, 1.7526]] — one loop
 * const arc = ripsH1(arcPoints);        // [] — none
 *
 * bottleneckDistance(circle, arc);  // 0.8135
 * ```
 */
export function bottleneckDistance(a: Diagram, b: Diagram): number {
    const m = a.length, k = b.length;
    if (m === 0 && k === 0) return 0;

    // L-infinity distance between two diagram points.
    const pointCost = (p: readonly [number, number], q: readonly [number, number]) =>
        Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
    const diagonalCost = (p: readonly [number, number]) => (p[1] - p[0]) / 2;

    // Square cost matrix of size (m + k): real points plus diagonal slots.
    const size = m + k;
    const cost = new Float64Array(size * size);
    for (let i = 0; i < size; ++i) {
        for (let j = 0; j < size; ++j) {
            let c: number;
            if (i < m && j < k) c = pointCost(a[i], b[j]);
            else if (i < m) c = j - k === i ? diagonalCost(a[i]) : Infinity;
            else if (j < k) c = i - m === j ? diagonalCost(b[j]) : Infinity;
            else c = 0;                       // diagonal to diagonal
            cost[i * size + j] = c;
        }
    }

    const candidates = Array.from(new Set(Array.from(cost).filter(Number.isFinite)))
        .sort((x, y) => x - y);

    /** Is there a perfect matching using only edges of cost <= limit? */
    const feasible = (limit: number): boolean => {
        const matchOfRight = new Int32Array(size).fill(-1);
        const seen = new Uint8Array(size);
        const augment = (i: number): boolean => {
            for (let j = 0; j < size; ++j) {
                if (seen[j] || cost[i * size + j] > limit) continue;
                seen[j] = 1;
                if (matchOfRight[j] === -1 || augment(matchOfRight[j])) {
                    matchOfRight[j] = i;
                    return true;
                }
            }
            return false;
        };
        for (let i = 0; i < size; ++i) {
            seen.fill(0);
            if (!augment(i)) return false;
        }
        return true;
    };

    let lo = 0, hi = candidates.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (feasible(candidates[mid])) hi = mid; else lo = mid + 1;
    }
    return candidates[lo];
}

/** * @category Topology * @group Topology */
export interface TopologyH1Options extends RipsOptions {
    /** Rescale each diagram by its space's diameter. Default true. */
    normalize?: boolean;
}

/**
 * Do the projection's **loops** match the data's?
 *
 * The only measure here that sees a hole. Unrolling a circular manifold into an
 * arc preserves every neighbourhood, every distance rank and every cluster — so
 * trustworthiness, stress and Steadiness & Cohesiveness all stay high — while the
 * loop it was built around is gone. This notices.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, ∞), **lower is better**; 0 means the same loops at the same scales.
 *   With the default normalisation, values are in [0, 1].
 * - Cost: **expensive** — it enumerates triangles, so roughly O(N³) and steeper in
 *   practice. `maxPoints` defaults to 200 and refuses beyond it; subsample both
 *   spaces on the same indices for larger data.
 *
 * @see Rieck & Leitte, Computer Graphics Forum 34 (2015)
 *   {@link https://doi.org/10.1111/cgf.12655}
 *
 * @category Topology
 * @group Topology
 *
 * @example
 * ```ts
 * import { topologicalH1 } from "@saehrimnir/sickle";
 *
 * // O(N³)-ish: `maxPoints` (default 200) is a guard that throws rather than
 * // subsamples, so subsample yourself for larger inputs.
 * const t = topologicalH1(circlePoints, arcPoints);
 *
 * t.value;      // 0.4068 — a loop present in the data but not in the drawing
 * t.localKind;  // "none" — H1 does not decompose per point
 * t.hdDiagram;  // [[0.1256, 1.7526]] — the loop that was lost
 *
 * topologicalH1(circlePoints, arcPoints, { normalize: false });  // raw units
 * ```
 */
export function topologicalH1(
    hdIn: PointsInput, ldIn: PointsInput, opts: TopologyH1Options = {},
): MetricResult & { readonly hdDiagram: Diagram; readonly ldDiagram: Diagram } {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const normalize = opts.normalize !== false;

    const scaleOf = (v: Vectors): number => {
        if (!normalize) return 1;
        // Diameter: the natural unit of a Rips filtration.
        let max = 0;
        for (let i = 0; i < v.n; ++i) {
            for (let j = i + 1; j < v.n; ++j) {
                let s = 0;
                for (let c = 0; c < v.d; ++c) {
                    const t = v.data[i * v.d + c] - v.data[j * v.d + c];
                    s += t * t;
                }
                if (s > max) max = s;
            }
        }
        return Math.sqrt(max) || 1;
    };

    const rescale = (dgm: Diagram, by: number): Diagram =>
        by === 1 ? dgm : dgm.map(([b, d]) => [b / by, d / by] as [number, number]);

    const hdDiagram = rescale(ripsH1(hd, opts), scaleOf(hd));
    const ldDiagram = rescale(ripsH1(ld, opts), scaleOf(ld));

    return {
        value: bottleneckDistance(hdDiagram, ldDiagram),
        localKind: "none",
        hdDiagram,
        ldDiagram,
    };
}
