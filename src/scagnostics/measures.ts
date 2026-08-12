/**
 * The nine scagnostic measures, computed from the MST and hulls of the binned
 * point set.
 *
 * Wilkinson, Anand & Grossman, "Graph-Theoretic Scagnostics", InfoVis 2005.
 * Definitions follow ScagnosticsJS (https://github.com/iDataVisualizationLab/Scagnostics2018),
 * reimplemented here on typed arrays and integer vertex indices.
 */

import {
    type Point, alphaBoundary, distance, edgeComponents, flattenRing,
    isCollinear, polygonArea, polygonLength, sortRing,
} from "./geometry.ts";
import { type Adjacency, type Tree, buildAdjacency, makeTree } from "./graph.ts";
import { quantile, quantiles } from "./quantile.ts";

// --- outlying --------------------------------------------------------------

export interface OutlyingResult {
    readonly score: number;
    readonly upperBound: number;
    readonly outlying: Int32Array;
    /** Tree with outlying vertices and their edges removed. */
    readonly tree: Tree;
    /** Vertices that survived pruning, as site indices. */
    readonly survivors: Int32Array;
    /**
     * True when an outlying vertex had degree >= 2 in the original tree.
     * Removing such a vertex disconnects the tree into subtrees, so the caller
     * must retriangulate the survivors and rebuild the spanning tree -- otherwise
     * every downstream measure sees a forest where it expects a tree.
     */
    readonly needsRebuild: boolean;
}

/**
 * Fraction of total MST edge length attributable to outlying vertices.
 *
 * A vertex is outlying when every edge incident to it is "long", i.e. longer
 * than `q3 + 1.5 * IQR` of the edge-length distribution.
 */
export function outlying(tree: Tree, vertexCount: number, upperBoundOverride?: number): OutlyingResult {
    const [q1, q3] = quantiles(tree.weight, [0.25, 0.75]);
    const upperBound = upperBoundOverride ?? q3 + 1.5 * (q3 - q1);

    // A vertex survives if it has at least one short edge.
    const hasShortEdge = new Uint8Array(vertexCount);
    for (let i = 0; i < tree.edgeCount; ++i) {
        if (!(tree.weight[i] > upperBound)) {
            hasShortEdge[tree.source[i]] = 1;
            hasShortEdge[tree.target[i]] = 1;
        }
    }

    const outlyingList: number[] = [];
    for (const v of tree.vertices) if (!hasShortEdge[v]) outlyingList.push(v);
    const isOutlying = new Uint8Array(vertexCount);
    for (const v of outlyingList) isOutlying[v] = 1;

    let total = 0, outlyingTotal = 0;
    for (let i = 0; i < tree.edgeCount; ++i) {
        const w = tree.weight[i];
        total += w;
        const long = w > upperBound;
        if (long && (isOutlying[tree.source[i]] || isOutlying[tree.target[i]])) outlyingTotal += w;
    }

    // Keep the edges that are not outlying.
    const src: number[] = [], dst: number[] = [], wt: number[] = [];
    for (let i = 0; i < tree.edgeCount; ++i) {
        const long = tree.weight[i] > upperBound;
        if (long && (isOutlying[tree.source[i]] || isOutlying[tree.target[i]])) continue;
        src.push(tree.source[i]); dst.push(tree.target[i]); wt.push(tree.weight[i]);
    }

    const survivors: number[] = [];
    for (const v of tree.vertices) if (hasShortEdge[v]) survivors.push(v);

    // Did any removed vertex have degree >= 2 in the original tree?
    let needsRebuild = false;
    for (const v of outlyingList) if (tree.degree[v] >= 2) { needsRebuild = true; break; }

    return {
        score: total === 0 ? 0 : outlyingTotal / total,
        upperBound,
        outlying: Int32Array.from(outlyingList),
        tree: makeTree(tree.xs, tree.ys, src, dst, wt),
        survivors: Int32Array.from(survivors),
        needsRebuild,
    };
}

// --- edge-length distribution ---------------------------------------------

/** Relative difference between the 90th and 50th percentile edge lengths. */
export function skewed(tree: Tree): number {
    if (tree.edgeCount === 0) return 0;
    const [q10, q50, q90] = quantiles(tree.weight, [0.1, 0.5, 0.9]);
    return q90 === q10 ? 0 : (q90 - q50) / (q90 - q10);
}

/** The 90th percentile edge length: large when points occupy little of the frame. */
export function sparse(tree: Tree): number {
    if (tree.edgeCount === 0) return 0;
    return quantile(tree.weight, 0.9);
}

// --- vertex-degree measures ------------------------------------------------

interface DegreeCounts {
    v1: number;
    /** Vertices of degree exactly two, with their two neighbours. */
    corners: Array<[number, number, number]>;
    vertexCount: number;
}

function degreeCounts(tree: Tree, adj: Adjacency): DegreeCounts {
    let v1 = 0;
    const corners: Array<[number, number, number]> = [];
    for (const v of tree.vertices) {
        const deg = adj.offset[v + 1] - adj.offset[v];
        if (deg === 1) v1 += 1;
        else if (deg === 2) {
            corners.push([v, adj.neighbor[adj.offset[v]], adj.neighbor[adj.offset[v] + 1]]);
        }
    }
    return { v1, corners, vertexCount: tree.vertices.length };
}

/** Proportion of degree-2 vertices: high for a single thread of points. */
export function stringy(tree: Tree, adj: Adjacency): number {
    const { v1, corners, vertexCount } = degreeCounts(tree, adj);
    const denom = vertexCount - v1;
    return denom <= 0 ? 0 : corners.length / denom;
}

/** Proportion of degree-2 vertices whose corner is close to straight. */
export function striated(tree: Tree, adj: Adjacency): number {
    const { v1, corners, vertexCount } = degreeCounts(tree, adj);
    const { xs, ys } = tree;
    let obtuse = 0;
    for (const [v, a, b] of corners) {
        const p12 = distance(xs[v], ys[v], xs[a], ys[a]);
        const p13 = distance(xs[v], ys[v], xs[b], ys[b]);
        const p23 = distance(xs[a], ys[a], xs[b], ys[b]);
        const cos = (p12 * p12 + p13 * p13 - p23 * p23) / (2 * p12 * p13);
        if (cos <= -0.75) obtuse += 1;
    }
    const denom = vertexCount - v1;
    return denom <= 0 ? 0 : obtuse / denom;
}

// --- clumpy ----------------------------------------------------------------

/**
 * Runt-graph clumpiness.
 *
 * For each MST edge `e`, delete it and every edge at least as long, then take
 * the smaller of the two resulting components (the "runt"). The measure is
 * `max(1 - maxRuntEdge / weight(e))`.
 *
 * Upstream rebuilds an adjacency map and runs a fresh traversal per edge, at
 * O(E^2) with string keys throughout. This keeps a CSR adjacency and bounds each
 * traversal by the smaller side, which is what makes the definition affordable.
 */
export function clumpy(tree: Tree, adj: Adjacency, vertexCount: number): number {
    if (tree.edgeCount === 0) return 0;

    const visited = new Int32Array(vertexCount).fill(-1);
    const stack = new Int32Array(vertexCount);
    let best = 0;
    let found = false;
    let mark = 0;

    /** Edges reachable from `start` using only edges shorter than `w`, excluding `e`. */
    const explore = (start: number, e: number, w: number): { edges: number; max: number } => {
        const tag = ++mark;
        let top = 0;
        stack[top++] = start;
        visited[start] = tag;
        let edges = 0;
        let max = 0;
        while (top > 0) {
            const v = stack[--top];
            for (let a = adj.offset[v]; a < adj.offset[v + 1]; ++a) {
                const ei = adj.edge[a];
                if (ei === e) continue;
                if (!(tree.weight[ei] < w)) continue;
                // Upstream counts each incident edge once per endpoint visited, so
                // both sides are double-counted and the comparison is unaffected.
                edges += 1;
                if (tree.weight[ei] > max) max = tree.weight[ei];
                const u = adj.neighbor[a];
                if (visited[u] !== tag) { visited[u] = tag; stack[top++] = u; }
            }
        }
        return { edges, max };
    };

    for (let e = 0; e < tree.edgeCount; ++e) {
        const w = tree.weight[e];
        const a = explore(tree.source[e], e, w);
        const b = explore(tree.target[e], e, w);
        // The runt is the component with fewer edges; its longest edge is the
        // one compared against the deleted edge.
        const runt = a.edges < b.edges ? a : b;
        if (runt.edges === 0) continue;
        found = true;
        const ratio = 1 - runt.max / w;
        if (ratio > best) best = ratio;
    }
    return found ? best : 0;
}

// --- hull-based measures ---------------------------------------------------

export interface Hulls {
    readonly convex: Point[];
    readonly concave: Point[][];
    readonly convexArea: number;
    readonly concaveArea: number;
    readonly concaveLength: number;
}

function ringsFromBoundary(
    xs: Float64Array, ys: Float64Array, boundary: Array<[number, number]>,
): Point[][] {
    return edgeComponents(boundary)
        .map((component) => sortRing(component.map((i) => [xs[i], ys[i]] as Point)))
        .filter((ring) => ring.length >= 3);
}

/**
 * Convex and concave (alpha) hulls of the tree's vertices.
 *
 * `alpha = 0` gives the convex hull; `alpha = 1 / upperBound` gives the alpha
 * shape at the same length scale used to detect outlying edges.
 */
export function hulls(
    tree: Tree, triangles: ArrayLike<number>, upperBound: number,
): Hulls {
    const { xs, ys } = tree;
    const n = xs.length;

    if (isCollinear(xs, ys, n)) {
        const ring = Array.from({ length: n }, (_, i) => [xs[i], ys[i]] as Point);
        return { convex: ring, concave: [ring], convexArea: 0, concaveArea: 0, concaveLength: 0 };
    }

    const convexBoundary = alphaBoundary(xs, ys, triangles, 0);
    const convexRings = ringsFromBoundary(xs, ys, convexBoundary);
    const convex = convexRings[0] ?? [];

    const alpha = upperBound === 0 ? Infinity : 1 / upperBound;
    const concaveBoundary = alphaBoundary(xs, ys, triangles, alpha);
    let concave = ringsFromBoundary(xs, ys, concaveBoundary);
    if (concave.length === 0) concave = convexRings;

    const convexArea = Math.abs(polygonArea(flattenRing(convex)));
    let concaveArea = 0, concaveLength = 0;
    for (const ring of concave) {
        const flat = flattenRing(ring);
        concaveArea += Math.abs(polygonArea(flat));
        concaveLength += polygonLength(flat);
    }
    return { convex, concave, convexArea, concaveArea, concaveLength };
}

/** Ratio of alpha-hull area to convex-hull area: low when the shape is non-convex. */
export function convex(h: Hulls): number {
    return h.convexArea === 0 ? 0 : h.concaveArea / h.convexArea;
}

/** Isoperimetric deficiency of the alpha hull: 0 for a circle, near 1 for a sliver. */
export function skinny(h: Hulls): number {
    if (h.concaveLength === 0) return 0;
    return 1 - Math.sqrt(4 * Math.PI * h.concaveArea) / h.concaveLength;
}

// --- monotonic -------------------------------------------------------------

/**
 * Squared Spearman rank correlation of the (binned, outlier-free) points.
 *
 * Ranks use the average rank for ties, and the correlation is computed directly
 * from the ranks rather than through the `d^2` shortcut. The shortcut is only
 * valid without ties, and applying it with a tie correction is what lets the
 * upstream implementation return values outside [0, 1].
 */
export function monotonic(tree: Tree): number {
    const vs = tree.vertices;
    const n = vs.length;
    if (n < 2) return 0;

    const xs = new Float64Array(n), ys = new Float64Array(n);
    for (let i = 0; i < n; ++i) { xs[i] = tree.xs[vs[i]]; ys[i] = tree.ys[vs[i]]; }

    const rx = averageRanks(xs), ry = averageRanks(ys);
    const r = pearson(rx, ry);
    return Number.isFinite(r) ? r * r : 0;
}

function averageRanks(values: Float64Array): Float64Array {
    const n = values.length;
    const order = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => values[a] - values[b] || a - b);
    const ranks = new Float64Array(n);
    let i = 0;
    while (i < n) {
        let j = i + 1;
        while (j < n && values[order[j]] === values[order[i]]) j += 1;
        const avg = (i + j - 1) / 2 + 1; // 1-based average rank of the tied block
        for (let k = i; k < j; ++k) ranks[order[k]] = avg;
        i = j;
    }
    return ranks;
}

function pearson(a: Float64Array, b: Float64Array): number {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; ++i) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; ++i) {
        const u = a[i] - ma, v = b[i] - mb;
        num += u * v; da += u * u; db += v * v;
    }
    const denom = Math.sqrt(da * db);
    return denom === 0 ? 0 : num / denom;
}

export { buildAdjacency };
