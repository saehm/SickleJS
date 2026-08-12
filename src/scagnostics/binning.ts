/**
 * Normalisation and leader binning.
 *
 * Scagnostics are computed on a binned point set, not the raw points: the
 * measures are defined over an MST whose size must not grow with N. Binning
 * reduces any input to a few hundred representative sites.
 *
 * The leader algorithm assigns each point to the nearest existing "leader"
 * within a radius, creating a new leader when none is near enough. Upstream
 * scans every leader for every point, which is O(P * L). Here a uniform grid of
 * cell size `radius` bounds the search to the nine surrounding cells, which is
 * O(P) expected and returns the identical assignment: a leader within `radius`
 * cannot lie outside that neighbourhood, and ties still resolve to the
 * earliest-created leader.
 */

import { distance } from "./geometry.ts";

export interface Normalized {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly n: number;
}

/** Scale each axis independently onto [0, 1]. A constant axis maps to 0. */
export function normalize(data: Float64Array, n: number): Normalized {
    const xs = new Float64Array(n), ys = new Float64Array(n);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; ++i) {
        const x = data[i * 2], y = data[i * 2 + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const rangeX = maxX !== minX ? maxX - minX : 1;
    const rangeY = maxY !== minY ? maxY - minY : 1;
    for (let i = 0; i < n; ++i) {
        xs[i] = (data[i * 2] - minX) / rangeX;
        ys[i] = (data[i * 2 + 1] - minY) / rangeY;
    }
    return { xs, ys, n };
}

export interface Bins {
    /** Leader coordinates. */
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly count: number;
    /** How many input points fell into each leader. */
    readonly weight: Int32Array;
}

/** Leader binning with a uniform grid index. */
export function leaderBin(p: Normalized, radius: number): Bins {
    const cell = Math.max(radius, 1e-12);
    const gridSize = Math.max(1, Math.ceil(1 / cell) + 1);
    const grid = new Map<number, number[]>();
    const lx: number[] = [], ly: number[] = [];

    const cellIndex = (x: number, y: number) =>
        Math.min(gridSize - 1, Math.max(0, Math.floor(x / cell))) * gridSize +
        Math.min(gridSize - 1, Math.max(0, Math.floor(y / cell)));

    const nearestLeader = (x: number, y: number): number => {
        const cx = Math.min(gridSize - 1, Math.max(0, Math.floor(x / cell)));
        const cy = Math.min(gridSize - 1, Math.max(0, Math.floor(y / cell)));
        let best = -1;
        let bestDist = Infinity;
        for (let ax = cx - 1; ax <= cx + 1; ++ax) {
            if (ax < 0 || ax >= gridSize) continue;
            for (let ay = cy - 1; ay <= cy + 1; ++ay) {
                if (ay < 0 || ay >= gridSize) continue;
                const bucket = grid.get(ax * gridSize + ay);
                if (!bucket) continue;
                for (const li of bucket) {
                    const d = distance(lx[li], ly[li], x, y);
                    // Strictly-less keeps the earliest leader on a tie, matching a
                    // linear scan in creation order.
                    if (d < radius && d < bestDist) { bestDist = d; best = li; }
                }
            }
        }
        return best;
    };

    // Pass 1: create leaders.
    for (let i = 0; i < p.n; ++i) {
        if (nearestLeader(p.xs[i], p.ys[i]) === -1) {
            const li = lx.length;
            lx.push(p.xs[i]); ly.push(p.ys[i]);
            const key = cellIndex(p.xs[i], p.ys[i]);
            const bucket = grid.get(key);
            if (bucket) bucket.push(li); else grid.set(key, [li]);
        }
    }

    // Pass 2: assign every point to its nearest leader, as upstream does.
    const weight = new Int32Array(lx.length);
    for (let i = 0; i < p.n; ++i) {
        const li = nearestLeader(p.xs[i], p.ys[i]);
        if (li >= 0) weight[li] += 1;
    }

    return { xs: Float64Array.from(lx), ys: Float64Array.from(ly), count: lx.length, weight };
}

/** Distinct points, used when the input has too few unique values to bin. */
export function uniquePoints(p: Normalized): Bins {
    const seen = new Map<string, number>();
    const lx: number[] = [], ly: number[] = [];
    const counts: number[] = [];
    for (let i = 0; i < p.n; ++i) {
        const key = `${p.xs[i]},${p.ys[i]}`;
        const at = seen.get(key);
        if (at === undefined) {
            seen.set(key, lx.length);
            lx.push(p.xs[i]); ly.push(p.ys[i]); counts.push(1);
        } else counts[at] += 1;
    }
    return {
        xs: Float64Array.from(lx), ys: Float64Array.from(ly),
        count: lx.length, weight: Int32Array.from(counts),
    };
}

export function countUnique(p: Normalized): number {
    const seen = new Set<string>();
    for (let i = 0; i < p.n; ++i) seen.add(`${p.xs[i]},${p.ys[i]}`);
    return seen.size;
}
