/**
 * Graph and minimum-spanning-tree machinery for scagnostics.
 *
 * This is where the upstream implementation spends nearly all of its time, and
 * the rewrite is mostly about removing accidental quadratics:
 *
 * | upstream                                          | here                        |
 * |---------------------------------------------------|-----------------------------|
 * | nodes and edges keyed by `[x,y].join(",")` strings | integer vertex indices      |
 * | `linkExists` linear-scans every edge -> O(E^2)     | hash set on a packed key    |
 * | `idExists` linear-scans every node -> O(V*E)       | coordinate map              |
 * | `DisjointSet.size()` rebuilds a key set per loop   | live set counter            |
 * | union-by-rank broken (`rank` vs `rank_`)           | union by rank + compression |
 * | `JSON.parse(JSON.stringify(tree))` per measure     | shared immutable structure  |
 *
 * Edge weights use the 10-decimal rounding from `geometry.distance`, which the
 * measures rely on for equality comparisons.
 */

import { minimum_spanning_tree } from "@saehrimnir/druidjs";
import { distance } from "./geometry.ts";

export interface Graph {
    /** Vertex coordinates, interleaved [x0,y0,x1,y1,...]. */
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly vertexCount: number;
    /** Edge endpoints. */
    readonly source: Int32Array;
    readonly target: Int32Array;
    readonly weight: Float64Array;
    readonly edgeCount: number;
}

/** Union-find with path compression and union by rank, tracking live set count. */
export class DisjointSet {
    #parent: Int32Array;
    #rank: Int32Array;
    #sets: number;

    constructor(n: number) {
        this.#parent = new Int32Array(n);
        this.#rank = new Int32Array(n);
        for (let i = 0; i < n; ++i) this.#parent[i] = i;
        this.#sets = n;
    }

    find(x: number): number {
        const p = this.#parent;
        let root = x;
        while (p[root] !== root) root = p[root];
        while (p[x] !== root) { const next = p[x]; p[x] = root; x = next; }
        return root;
    }

    union(a: number, b: number): boolean {
        const ra = this.find(a), rb = this.find(b);
        if (ra === rb) return false;
        const rank = this.#rank;
        if (rank[ra] < rank[rb]) this.#parent[ra] = rb;
        else if (rank[rb] < rank[ra]) this.#parent[rb] = ra;
        else { this.#parent[rb] = ra; rank[ra] += 1; }
        this.#sets -= 1;
        return true;
    }

    get sets(): number {
        return this.#sets;
    }
}

/**
 * Build the graph of Delaunay edges over `sites`.
 *
 * @param triangles flat triple-indices into the site arrays
 */
export function buildGraph(
    xs: Float64Array, ys: Float64Array, triangles: ArrayLike<number>,
): Graph {
    const vertexCount = xs.length;
    const seen = new Set<number>();
    const src: number[] = [], dst: number[] = [], w: number[] = [];

    for (let t = 0; t < triangles.length; t += 3) {
        for (let e = 0; e < 3; ++e) {
            const a = triangles[t + e];
            const b = triangles[t + ((e + 1) % 3)];
            if (a === b) continue;
            const lo = a < b ? a : b;
            const hi = a < b ? b : a;
            const key = lo * 0x100000000 + hi;
            if (seen.has(key)) continue;
            seen.add(key);
            src.push(lo); dst.push(hi);
            w.push(distance(xs[lo], ys[lo], xs[hi], ys[hi]));
        }
    }

    return {
        xs, ys, vertexCount,
        source: Int32Array.from(src),
        target: Int32Array.from(dst),
        weight: Float64Array.from(w),
        edgeCount: src.length,
    };
}

export interface Tree {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    /** Vertices actually present in the tree, as site indices. */
    readonly vertices: Int32Array;
    readonly source: Int32Array;
    readonly target: Int32Array;
    readonly weight: Float64Array;
    readonly edgeCount: number;
    /** degree[v] for v in site-index space; 0 for absent vertices. */
    readonly degree: Int32Array;
}

/**
 * Minimum spanning tree (forest, if the graph is disconnected).
 *
 * Delegates to DruidJS's `minimum_spanning_tree`, which takes exactly this
 * shape -- a weighted edge list over vertex indices `0..N-1` -- and runs
 * Kruskal's algorithm. Reusing it keeps one implementation of the algorithm
 * across the two libraries.
 *
 * Note the graph passed in holds only Delaunay edges, not all N^2 pairs. That is
 * not an approximation: the Euclidean minimum spanning tree is always a subgraph
 * of the Delaunay triangulation.
 */
export function minimumSpanningTree(g: Graph): Tree {
    const edges: Array<[number, number, number]> = new Array(g.edgeCount);
    for (let i = 0; i < g.edgeCount; ++i) edges[i] = [g.source[i], g.target[i], g.weight[i]];

    const selected = minimum_spanning_tree(edges, g.vertexCount);

    const src = new Int32Array(selected.length);
    const dst = new Int32Array(selected.length);
    const w = new Float64Array(selected.length);
    for (let i = 0; i < selected.length; ++i) {
        src[i] = selected[i][0]; dst[i] = selected[i][1]; w[i] = selected[i][2];
    }
    return makeTree(g.xs, g.ys, src, dst, w);
}

export function makeTree(
    xs: Float64Array, ys: Float64Array,
    src: ArrayLike<number>, dst: ArrayLike<number>, w: ArrayLike<number>,
): Tree {
    const degree = new Int32Array(xs.length);
    const present = new Set<number>();
    for (let i = 0; i < src.length; ++i) {
        degree[src[i]] += 1; degree[dst[i]] += 1;
        present.add(src[i]); present.add(dst[i]);
    }
    return {
        xs, ys,
        vertices: Int32Array.from([...present].sort((a, b) => a - b)),
        source: Int32Array.from(src),
        target: Int32Array.from(dst),
        weight: Float64Array.from(w),
        edgeCount: src.length,
        degree,
    };
}

/** Compressed adjacency (CSR) over the tree's edges, for linear-time traversal. */
export interface Adjacency {
    readonly offset: Int32Array;
    readonly neighbor: Int32Array;
    readonly edge: Int32Array;
}

export function buildAdjacency(t: Tree, vertexCount: number): Adjacency {
    const offset = new Int32Array(vertexCount + 1);
    for (let i = 0; i < t.edgeCount; ++i) { offset[t.source[i] + 1] += 1; offset[t.target[i] + 1] += 1; }
    for (let v = 0; v < vertexCount; ++v) offset[v + 1] += offset[v];

    const cursor = Int32Array.from(offset.subarray(0, vertexCount));
    const neighbor = new Int32Array(t.edgeCount * 2);
    const edge = new Int32Array(t.edgeCount * 2);
    for (let i = 0; i < t.edgeCount; ++i) {
        const a = t.source[i], b = t.target[i];
        neighbor[cursor[a]] = b; edge[cursor[a]] = i; cursor[a] += 1;
        neighbor[cursor[b]] = a; edge[cursor[b]] = i; cursor[b] += 1;
    }
    return { offset, neighbor, edge };
}
