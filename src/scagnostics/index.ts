/**
 * Scagnostics: nine graph-theoretic shape measures of a 2-D scatterplot.
 *
 * Computed from the projection alone -- unlike the other families here, the
 * high-dimensional data never enters.
 *
 * @see Wilkinson, Anand & Grossman, "Graph-Theoretic Scagnostics", InfoVis 2005
 *   {@link https://doi.org/10.1109/INFVIS.2005.1532142}
 * @see Wilkinson & Wills, "Scagnostics Distributions", JCGS 2008
 *   {@link https://doi.org/10.1198/106186008X320465}
 *
 * The pipeline and measure definitions follow **ScagnosticsJS** by Tommy Dang and
 * Vung Pham ({@link https://github.com/iDataVisualizationLab/Scagnostics2018}),
 * reimplemented here on typed arrays and integer vertex indices. See
 * `NOTES.md` in this directory for the deviations, which are deliberate and
 * few.
 *
 * None of the nine decomposes per point: each is a property of the whole cloud
 * (a hull area, an MST edge-length distribution), so every result declares
 * `localKind: "none"` rather than inventing a per-point number that would be
 * wrong when averaged.
 */

import { Delaunay } from "d3-delaunay";
import type { MetricResult } from "../core/result.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";
import { type Bins, countUnique, leaderBin, normalize, uniquePoints } from "./binning.ts";
import { isCollinear } from "./geometry.ts";
import { type Tree, buildAdjacency, buildGraph, minimumSpanningTree } from "./graph.ts";
import * as m from "./measures.ts";

/**
 * The nine scagnostic names, in their canonical order.
 *
 * @example
 * ```ts
 * import { scagnostics, SCAGNOSTIC_NAMES } from "@saehrimnir/sickle";
 *
 * SCAGNOSTIC_NAMES;
 * // ["outlying", "skewed", "clumpy", "sparse", "striated",
 * //  "convex", "skinny", "stringy", "monotonic"]
 *
 * const s = scagnostics(projection);
 * for (const name of SCAGNOSTIC_NAMES) console.log(name, s[name]);
 * ```
 *
 * @category Scagnostics
 * @group Scagnostics
 */
export const SCAGNOSTIC_NAMES = [
    "outlying", "skewed", "clumpy", "sparse", "striated",
    "convex", "skinny", "stringy", "monotonic",
] as const;

/** * @category Scagnostics * @group Scagnostics */
export type ScagnosticName = (typeof SCAGNOSTIC_NAMES)[number];
/** * @category Scagnostics * @group Scagnostics */
export type Scagnostics = Readonly<Record<ScagnosticName, number>>;

/** * @category Scagnostics * @group Scagnostics */
export interface ScagnosticsOptions {
    /** Grid resolution the binning search starts from. Default 40. */
    startBinGridSize?: number;
    /** Lower end of the target bin-count window. Default 50. */
    minBins?: number;
    /** Upper end of the target bin-count window. Default 500. */
    maxBins?: number;
    /** Skip normalisation, if the data is already on [0,1]. */
    isNormalized?: boolean;
    /** Skip binning and treat the input points as the sites. */
    isBinned?: boolean;
    /** Override the long-edge threshold used for outlier removal and the alpha hull. */
    outlyingUpperBound?: number;
}

/**
 * Intermediate products, exposed for visualisation and debugging.
 *
 * @category Scagnostics
 * @group Scagnostics
 */
export interface ScagnosticsDetail extends Scagnostics {
    readonly sites: { xs: Float64Array; ys: Float64Array };
    readonly binRadius: number;
    readonly tree: Tree;
    readonly prunedTree: Tree;
    readonly outlyingUpperBound: number;
    readonly hulls: m.Hulls;
}

function triangulate(xs: Float64Array, ys: Float64Array): Int32Array {
    const n = xs.length;
    if (isCollinear(xs, ys, n)) {
        // Delaunay is undefined for collinear points. Chain consecutive points
        // along the line so the MST is the sequence itself.
        const order = Array.from({ length: n }, (_, i) => i)
            .sort((a, b) => xs[a] - xs[b] || ys[a] - ys[b]);
        const tri: number[] = [];
        for (let i = 0; i + 1 < n; ++i) tri.push(order[i], order[i + 1], order[i + 1]);
        return Int32Array.from(tri);
    }
    const points = new Float64Array(n * 2);
    for (let i = 0; i < n; ++i) { points[i * 2] = xs[i]; points[i * 2 + 1] = ys[i]; }
    return Int32Array.from(Delaunay.from(
        { length: n } as never,
        (_: unknown, i: number) => points[i * 2],
        (_: unknown, i: number) => points[i * 2 + 1],
    ).triangles);
}

function chooseBins(p: ReturnType<typeof normalize>, opts: ScagnosticsOptions): { bins: Bins; radius: number } {
    const minBins = opts.minBins ?? 50;
    const maxBins = opts.maxBins ?? 500;

    if (countUnique(p) < minBins) {
        return { bins: uniquePoints(p), radius: 0 };
    }

    let gridSize = opts.startBinGridSize ?? 40;
    let bins: Bins | null = null;
    let radius = 0;
    // Halve the grid when there are too many occupied cells, grow it when too few.
    for (let guard = 0; guard < 64; ++guard) {
        radius = 1 / (gridSize * 2);
        bins = leaderBin(p, radius);
        if (bins.count > maxBins) gridSize = gridSize / 2;
        else if (bins.count < minBins) gridSize = gridSize + 5;
        else break;
    }
    return { bins: bins!, radius };
}

/**
 * {@link scagnostics} plus the intermediate structures — binned sites, spanning
 * tree and hulls — for drawing or debugging.
 *
 * @category Scagnostics
 * @group Scagnostics
 */
export function scagnosticsDetail(ld: Vectors, opts: ScagnosticsOptions = {}): ScagnosticsDetail {
    if (ld.d !== 2) throw new Error(`scagnostics requires 2-dimensional data, got d=${ld.d}`);
    if (ld.n < 3) throw new Error(`scagnostics requires at least 3 points, got ${ld.n}`);

    const normalized = opts.isNormalized
        ? { xs: Float64Array.from({ length: ld.n }, (_, i) => ld.data[i * 2]),
            ys: Float64Array.from({ length: ld.n }, (_, i) => ld.data[i * 2 + 1]), n: ld.n }
        : normalize(ld.data as Float64Array, ld.n);

    const { bins, radius } = opts.isBinned
        ? { bins: { xs: normalized.xs, ys: normalized.ys, count: normalized.n, weight: new Int32Array(normalized.n).fill(1) }, radius: 0 }
        : chooseBins(normalized, opts);

    const xs = bins.xs, ys = bins.ys;
    const siteCount = bins.count;
    const triangles = triangulate(xs, ys);

    const graph = buildGraph(xs, ys, triangles);
    const tree = minimumSpanningTree(graph);

    const out = m.outlying(tree, siteCount, opts.outlyingUpperBound);

    // Removing a vertex of degree >= 2 splits the tree, so the survivors have to
    // be retriangulated and their spanning tree rebuilt.
    let pruned = out.tree;
    let prunedTriangles: ArrayLike<number> = triangles;
    if (out.needsRebuild && out.survivors.length >= 3) {
        const sx = Float64Array.from(out.survivors, (v) => xs[v]);
        const sy = Float64Array.from(out.survivors, (v) => ys[v]);
        const localTriangles = triangulate(sx, sy);
        // Map local indices back to the global site index space.
        const global = Int32Array.from(localTriangles, (i) => out.survivors[i]);
        const rebuiltGraph = buildGraph(xs, ys, global);
        pruned = minimumSpanningTree(rebuiltGraph);
        prunedTriangles = global;
    }

    const adj = buildAdjacency(pruned, siteCount);
    const h = m.hulls(pruned, prunedTriangles, out.upperBound);

    return {
        outlying: out.score,
        skewed: m.skewed(pruned),
        clumpy: m.clumpy(pruned, adj, siteCount),
        sparse: m.sparse(pruned),
        striated: m.striated(pruned, adj),
        convex: m.convex(h),
        skinny: m.skinny(h),
        stringy: m.stringy(pruned, adj),
        monotonic: m.monotonic(pruned),
        sites: { xs, ys },
        binRadius: radius,
        tree,
        prunedTree: pruned,
        outlyingUpperBound: out.upperBound,
        hulls: h,
    };
}

/**
 * Nine measures of what the scatterplot *looks* like.
 *
 * Shape descriptors, not quality measures: they say whether the plot is stringy,
 * clumpy, outlier-ridden and so on, without reference to the data behind it. Use
 * them to characterise a projection, or to compare projections' visual character —
 * not to decide which is faithful.
 *
 * `outlying`, `skewed`, `sparse`, `clumpy`, `striated`, `convex`, `skinny`,
 * `stringy`, `monotonic`.
 *
 * - Needs: projection only, and it must be 2-dimensional. No labels.
 * - Range: each in [0, 1].
 * - Cost: O(N log N) — binning caps the work, so it is cheap even for large N.
 *
 * @see Wilkinson, Anand & Grossman, IEEE InfoVis 2005
 *   {@link https://doi.org/10.1109/INFVIS.2005.1532142}
 * @see Wilkinson & Wills, J. Comput. Graph. Statistics 17 (2008)
 *   {@link https://doi.org/10.1198/106186008X320465}
 *
 * @category Scagnostics
 * @group Scagnostics
 *
 * @example
 * ```ts
 * import { scagnostics } from "@saehrimnir/sickle";
 *
 * // 2-D only, and it never looks at the high-dimensional data — these describe
 * // the shape of the scatterplot itself.
 * const s = scagnostics(projection);
 *
 * s.clumpy;    // 0.9219 — clearly separated blobs
 * s.outlying;  // 0.1736
 * s.skinny;    // 0.5775
 * ```
 */
export function scagnostics(ldIn: PointsInput, opts: ScagnosticsOptions = {}): Scagnostics {
    const ld = toVectors(ldIn);
    const d = scagnosticsDetail(ld, opts);
    return {
        outlying: d.outlying, skewed: d.skewed, clumpy: d.clumpy, sparse: d.sparse,
        striated: d.striated, convex: d.convex, skinny: d.skinny,
        stringy: d.stringy, monotonic: d.monotonic,
    };
}

/**
 * A single scagnostic, in the shared result shape.
 *
 * @category Scagnostics
 * @group Scagnostics
 *
 * @example
 * ```ts
 * import { scagnostic } from "@saehrimnir/sickle";
 *
 * // One measure, as a MetricResult. Computes all nine internally, so prefer
 * // `scagnostics` when you want more than one.
 * scagnostic(projection, "outlying").value;  // 0.1736
 * ```
 */
export function scagnostic(ldIn: PointsInput, name: ScagnosticName, opts?: ScagnosticsOptions): MetricResult {
    const ld = toVectors(ldIn);
    return { value: scagnostics(ld, opts)[name], localKind: "none" };
}

/**
 * {@link scagnostics}, with a check that the projection matches the data it came
 * from. Scagnostics ignore the high-dimensional side.
 *
 * @category Scagnostics
 * @group Scagnostics
 *
 * @example
 * ```ts
 * import { scagnosticsFor } from "@saehrimnir/sickle";
 *
 * // Same as `scagnostics(projection)`, plus a check that the projection really
 * // describes the same points as the data it came from.
 * scagnosticsFor(data, projection).clumpy;  // 0.9219
 * ```
 */
export function scagnosticsFor(hdIn: PointsInput, ldIn: PointsInput, opts?: ScagnosticsOptions): Scagnostics {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    return scagnostics(ld, opts);
}
