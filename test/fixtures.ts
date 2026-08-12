/** Deterministic test data. No RNG dependency, no snapshot drift. */

export function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

export interface Fixture {
    X: number[][];
    Y: number[][];
    labels: number[];
}

/** `clusters` well-separated blobs in HD; the projection is deliberately poor. */
export function makeFixture(n: number, dHi: number, seed = 42, clusters = 4): Fixture {
    const rnd = lcg(seed);
    const X: number[][] = [], Y: number[][] = [], labels: number[] = [];
    for (let i = 0; i < n; ++i) {
        const c = i % clusters;
        X.push(Array.from({ length: dHi }, (_, d) => (d === 0 ? c * 3 : 0) + rnd()));
        Y.push([rnd() * 5, rnd() * 5]);
        labels.push(c);
    }
    return { X, Y, labels };
}

/** A faithful projection: HD blobs, LD preserves the cluster structure. */
export function makeGoodFixture(n: number, dHi: number, seed = 7, clusters = 4): Fixture {
    const rnd = lcg(seed);
    const X: number[][] = [], Y: number[][] = [], labels: number[] = [];
    for (let i = 0; i < n; ++i) {
        const c = i % clusters;
        const jx = rnd(), jy = rnd();
        X.push(Array.from({ length: dHi }, (_, d) => (d === 0 ? c * 6 : d === 1 ? jx : 0) + jy * 0.1));
        Y.push([c * 6 + jy * 0.1, jx]);
        labels.push(c);
    }
    return { X, Y, labels };
}

/** Adds exact duplicate points, which make ranks ambiguous without a tie-break. */
export function withDuplicates(f: Fixture, count: number): Fixture {
    const X = f.X.map((r) => r.slice());
    const Y = f.Y.map((r) => r.slice());
    for (let i = 0; i < count; ++i) {
        const src = i + count;
        X[i] = X[src].slice();
        Y[i] = Y[src].slice();
    }
    return { X, Y, labels: f.labels.slice() };
}

export const mean = (a: Float64Array | number[]): number => {
    let s = 0;
    for (let i = 0; i < a.length; ++i) s += a[i];
    return s / a.length;
};
