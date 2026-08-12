/**
 * Planar geometry for scagnostics: polygon measures, alpha shapes and hulls.
 *
 * Replaces the `d3-polygon` and `alpha-shape` dependencies. The alpha shape is
 * built on the Delaunay triangulation we already compute, rather than on
 * `alpha-shape` -> `alpha-complex` -> `delaunay-triangulate`, which pulled in a
 * *second*, different triangulator alongside `d3-delaunay`.
 *
 * The definition is preserved exactly: `alpha-complex` keeps every Delaunay
 * triangle whose `circumradius * alpha < 1`, and `simplicial-complex-boundary`
 * then keeps the edges belonging to exactly one surviving triangle. With
 * `alpha = 0` every triangle survives and the boundary is the convex hull, which
 * is how the upstream code obtains convex hulls too.
 */

export type Point = readonly [number, number];

/**
 * Euclidean distance, rounded to 10 decimal places.
 *
 * The rounding is load-bearing, not cosmetic: scagnostics compares edge lengths
 * for equality (MST tie-breaking, runt-graph construction), and two geometrically
 * identical edges can otherwise differ in the last bits. Upstream does the same.
 */
export function distance(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.round(Math.sqrt(dx * dx + dy * dy) * 1e10) / 1e10;
}

/** Signed area of a polygon given as a flat [x0,y0,x1,y1,...] ring. */
export function polygonArea(ring: ArrayLike<number>): number {
    const n = ring.length >> 1;
    if (n < 3) return 0;
    let area = 0;
    let jx = ring[(n - 1) * 2], jy = ring[(n - 1) * 2 + 1];
    for (let i = 0; i < n; ++i) {
        const ix = ring[i * 2], iy = ring[i * 2 + 1];
        area += jx * iy - ix * jy;
        jx = ix; jy = iy;
    }
    return area / 2;
}

/** Perimeter of a closed polygon given as a flat ring. */
export function polygonLength(ring: ArrayLike<number>): number {
    const n = ring.length >> 1;
    if (n < 2) return 0;
    let total = 0;
    let jx = ring[(n - 1) * 2], jy = ring[(n - 1) * 2 + 1];
    for (let i = 0; i < n; ++i) {
        const ix = ring[i * 2], iy = ring[i * 2 + 1];
        const dx = ix - jx, dy = iy - jy;
        total += Math.sqrt(dx * dx + dy * dy);
        jx = ix; jy = iy;
    }
    return total;
}

/** Circumradius of a triangle. Infinite for degenerate (collinear) triangles. */
export function circumradius(
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number {
    const a = Math.hypot(bx - cx, by - cy);
    const b = Math.hypot(ax - cx, ay - cy);
    const c = Math.hypot(ax - bx, ay - by);
    // 2 * signed area
    const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (cross === 0) return Infinity;
    return (a * b * c) / (2 * cross);
}

/** True when every point lies on one straight line. */
export function isCollinear(xs: Float64Array, ys: Float64Array, n: number): boolean {
    if (n < 3) return true;
    const x1 = xs[0], y1 = ys[0], x2 = xs[1], y2 = ys[1];
    for (let i = 2; i < n; ++i) {
        if ((x2 - x1) * (ys[i] - y1) - (y2 - y1) * (xs[i] - x1) !== 0) return false;
    }
    return true;
}

/**
 * Order a set of points into a simple ring by angle about their centroid.
 *
 * Upstream rounds the angular difference to whole degrees before comparing,
 * which makes near-equal angles compare as ties. That behaviour is reproduced
 * here, with the point index as a tie-break so the ordering is deterministic
 * rather than dependent on the sort implementation.
 */
export function sortRing(points: Array<Point>): Array<Point> {
    const n = points.length;
    if (n < 3) return points;
    let cx = 0, cy = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; }
    cx /= n; cy /= n;

    const withAngle = points.map((p, i) => ({
        p,
        i,
        a: ((Math.atan2(p[0] - cx, p[1] - cy) * (180 / Math.PI)) + 360) % 360,
    }));
    withAngle.sort((u, v) => Math.round(u.a - v.a) || u.i - v.i);
    return withAngle.map((d) => d.p);
}

/** Flatten a ring of points into [x0,y0,x1,y1,...]. */
export function flattenRing(ring: readonly Point[]): Float64Array {
    const out = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; ++i) { out[i * 2] = ring[i][0]; out[i * 2 + 1] = ring[i][1]; }
    return out;
}

/**
 * Boundary edges of the alpha complex.
 *
 * Keeps Delaunay triangles with `circumradius * alpha < 1`, then returns the
 * edges incident to exactly one kept triangle. `alpha = 0` keeps everything and
 * therefore yields the convex-hull boundary.
 *
 * @param triangles flat triple-indices from the Delaunay triangulation
 */
export function alphaBoundary(
    xs: Float64Array, ys: Float64Array, triangles: ArrayLike<number>, alpha: number,
): Array<[number, number]> {
    // Count how many kept triangles each undirected edge belongs to.
    const counts = new Map<number, number>();
    const key = (a: number, b: number) => (a < b ? a * 0x100000000 + b : b * 0x100000000 + a);
    const edges = new Map<number, [number, number]>();

    for (let t = 0; t < triangles.length; t += 3) {
        const i = triangles[t], j = triangles[t + 1], k = triangles[t + 2];
        const r = circumradius(xs[i], ys[i], xs[j], ys[j], xs[k], ys[k]);
        if (!(r * alpha < 1)) continue; // NaN/Infinity-safe: excluded unless strictly less
        for (const [a, b] of [[i, j], [j, k], [k, i]] as const) {
            const kk = key(a, b);
            counts.set(kk, (counts.get(kk) ?? 0) + 1);
            if (!edges.has(kk)) edges.set(kk, a < b ? [a, b] : [b, a]);
        }
    }

    const boundary: Array<[number, number]> = [];
    for (const [kk, c] of counts) if (c === 1) boundary.push(edges.get(kk)!);
    return boundary;
}

/**
 * Group boundary edges into connected components, each a set of vertex indices.
 *
 * Upstream does this with a recursive scan that is quadratic in the edge count
 * and can overflow the stack on larger inputs; this is a linear union-find pass
 * producing the same grouping.
 */
export function edgeComponents(edges: ReadonlyArray<readonly [number, number]>): number[][] {
    const parent = new Map<number, number>();
    const find = (x: number): number => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r)!;
        while (parent.get(x) !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; }
        return r;
    };
    for (const [a, b] of edges) {
        if (!parent.has(a)) parent.set(a, a);
        if (!parent.has(b)) parent.set(b, b);
    }
    for (const [a, b] of edges) {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    }
    const groups = new Map<number, number[]>();
    for (const v of parent.keys()) {
        const r = find(v);
        const g = groups.get(r);
        if (g) g.push(v); else groups.set(r, [v]);
    }
    return [...groups.values()];
}
