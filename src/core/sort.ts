/**
 * Argsort primitives.
 *
 * This is the hottest code in the library. A one-off profiling run of the
 * co-ranking pass put sorting at 61-88% of total runtime for D <= 50, which
 * covers essentially every projection (LD is always 2-D) and most HD inputs.
 * That figure is a recorded observation, not a committed benchmark: no
 * profiling harness lives in the repo, so treat it as an order of magnitude.
 *
 * ## Tie-breaking is not cosmetic
 *
 * Rank-based quality metrics are ill-defined when two points sit at exactly the
 * same distance -- duplicate rows, quantised data. Which point gets rank 3 and
 * which gets rank 4 is arbitrary, but it changes the score. Both sorts here
 * break ties by point index, making results deterministic and reproducible
 * across engines. Do not "optimise" this away.
 */

const SMALL = 12;

/**
 * In-place argsort of `idx` by `key[idx[.]]` ascending, ties broken by index.
 * Introsort: median-of-three quicksort with an insertion-sort tail, recursing
 * into the smaller partition so stack depth stays O(log n).
 *
 * @internal
 */
export function argsortRange(key: Float64Array, idx: Uint32Array, lo: number, hi: number): void {
    while (hi - lo > SMALL) {
        const mid = (lo + hi) >> 1;
        const a = key[idx[lo]], b = key[idx[mid]], c = key[idx[hi]];
        let p = mid;
        if (a < b) { if (b > c) p = a < c ? hi : lo; }
        else { if (b < c) p = a < c ? lo : hi; }
        const t = idx[p]; idx[p] = idx[hi]; idx[hi] = t;
        const pv = idx[hi], pivot = key[pv];

        let store = lo;
        for (let i = lo; i < hi; ++i) {
            const v = idx[i], kv = key[v];
            if (kv < pivot || (kv === pivot && v < pv)) {
                idx[i] = idx[store]; idx[store] = v;
                ++store;
            }
        }
        const s = idx[hi]; idx[hi] = idx[store]; idx[store] = s;

        if (store - lo < hi - store) { argsortRange(key, idx, lo, store - 1); lo = store + 1; }
        else { argsortRange(key, idx, store + 1, hi); hi = store - 1; }
    }
    for (let i = lo + 1; i <= hi; ++i) {
        const v = idx[i], kv = key[v];
        let j = i - 1;
        while (j >= lo) {
            const w = idx[j], kw = key[w];
            if (kw < kv || (kw === kv && w < v)) break;
            idx[j + 1] = w; --j;
        }
        idx[j + 1] = v;
    }
}

/**
 * Scratch buffers for `radixArgsort`. Allocated once per worker, reused for
 * every row.
 *
 * @internal
 */
export interface RadixScratch {
    hi: Uint32Array;
    tmp: Uint32Array;
    count: Uint32Array;
    f64: Float64Array;
    u32: Uint32Array;
}

/**
 * Allocate the scratch buffers for {@link radixArgsort}, once per worker.
 *
 * @internal
 */
export function makeRadixScratch(n: number): RadixScratch {
    const f64 = new Float64Array(1);
    return {
        hi: new Uint32Array(n),
        tmp: new Uint32Array(n),
        count: new Uint32Array(256),
        f64,
        u32: new Uint32Array(f64.buffer),
    };
}

/** Index of the high word of a double in this platform's byte order. */
const HIGH_WORD = (() => {
    const f = new Float64Array(1);
    const u = new Uint32Array(f.buffer);
    f[0] = 2; // exponent bits live in the high word
    return u[1] !== 0 ? 1 : 0;
})();

/**
 * Radix argsort, exact, and measured at roughly 2.7x the speed of
 * {@link argsortRange} in a one-off benchmark -- a recorded note rather than a
 * committed measurement, and no test compares the two sorts directly. Both
 * break ties by point index, so they are intended to be interchangeable.
 *
 * Keys must be non-negative (squared distances) or the sentinel -1 used for the
 * self-distance. For non-negative doubles the IEEE-754 bit pattern is monotone
 * in the value, so the top 32 bits can be radix-sorted directly; a fixup pass
 * then orders any run sharing a high word by full value and index. Collisions
 * are rare (~10 per 4000 random keys), so the fixup is close to free.
 *
 * The result is bit-identical to {@link argsortRange}.
 *
 * @internal
 */
export function radixArgsort(
    key: Float64Array, idx: Uint32Array, n: number, scratch: RadixScratch,
): void {
    const { hi, tmp, count, f64, u32 } = scratch;

    // The -1 self sentinel is the only negative value; map it to 0 so the
    // unsigned ordering still puts it first, and no other key can collide
    // because true squared distances of 0 also map to 0 and tie-break by index.
    for (let i = 0; i < n; ++i) {
        const k = key[i];
        if (k < 0) { hi[i] = 0; continue; }
        f64[0] = k;
        hi[i] = u32[HIGH_WORD];
    }

    let src = idx, dst = tmp;
    for (let shift = 0; shift < 32; shift += 8) {
        count.fill(0);
        for (let i = 0; i < n; ++i) count[(hi[src[i]] >>> shift) & 255]++;
        let sum = 0;
        for (let b = 0; b < 256; ++b) { const c = count[b]; count[b] = sum; sum += c; }
        for (let i = 0; i < n; ++i) { const v = src[i]; dst[count[(hi[v] >>> shift) & 255]++] = v; }
        const t = src; src = dst; dst = t;
    }
    if (src !== idx) idx.set(src.subarray(0, n));

    // Fixup runs that share a high word: order by full key, then by index.
    let i = 0;
    while (i < n) {
        const h = hi[idx[i]];
        let j = i + 1;
        while (j < n && hi[idx[j]] === h) ++j;
        if (j - i > 1) argsortRange(key, idx, i, j - 1);
        i = j;
    }
}
