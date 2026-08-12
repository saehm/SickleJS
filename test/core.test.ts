/*
 * The primitives everything else is built on.
 *
 * These are small and boring, which is exactly why they were the least tested
 * part of the library: the metrics have parity fixtures, the passes have
 * contracts, and the accumulator underneath them had nothing. A silent defect
 * here is invisible in a metric's value and wrong in the last digits of all of
 * them at once.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
    Accumulator,
    argsortRange,
    assertSamePoints,
    checkContract,
    makeRadixScratch,
    mean,
    radixArgsort,
    row,
    sum,
    toVectors,
    type MetricResult,
} from "../src/index.ts";
import { lcg } from "./fixtures.ts";

describe("compensated summation", () => {
    /*
     * The case the accumulator exists for. Naive left-to-right summation loses
     * the small terms entirely when a huge one passes through; Neumaier keeps
     * them in the compensation and restores them at the end.
     */
    it("recovers terms that naive summation destroys", () => {
        const terms = [1, 1e100, 1, -1e100];

        let naive = 0;
        for (const t of terms) naive += t;
        assert.equal(naive, 0); // the two 1s are gone

        assert.equal(sum(terms), 2);
    });

    it("keeps its error near eps over many terms", () => {
        // 0.1 is not representable, so a naive sum of 10^6 of them drifts.
        const n = 1e6;
        const terms = new Float64Array(n).fill(0.1);

        let naive = 0;
        for (let i = 0; i < n; ++i) naive += terms[i];

        const exact = 0.1 * n;
        const compensated = sum(terms);
        assert.ok(Math.abs(compensated - exact) < Math.abs(naive - exact));
        assert.ok(Math.abs(compensated - exact) < 1e-9);
    });

    it("adds in either magnitude order", () => {
        // Both branches of the compensation: |sum| >= |x| and the reverse.
        const big = new Accumulator();
        big.add(1e16);
        big.add(1);
        const small = new Accumulator();
        small.add(1);
        small.add(1e16);
        assert.equal(big.value, small.value);
        assert.equal(big.value, 1e16 + 1);
    });

    it("resets to a clean zero", () => {
        const acc = new Accumulator();
        acc.add(1e100);
        acc.add(1);
        acc.reset();
        assert.equal(acc.value, 0);
        acc.add(3);
        assert.equal(acc.value, 3);
    });

    it("merges partial accumulators, which is how the parallel reducers fold", () => {
        const whole = new Accumulator();
        const a = new Accumulator(), b = new Accumulator();
        for (let i = 1; i <= 100; ++i) {
            whole.add(i / 7);
            (i <= 50 ? a : b).add(i / 7);
        }
        a.merge(b);
        assert.ok(Math.abs(a.value - whole.value) < 1e-12);
    });

    it("reports NaN for the mean of nothing", () => {
        assert.equal(Number.isNaN(mean([])), true);
        assert.equal(sum([]), 0);
        assert.ok(Math.abs(mean([2, 4, 9]) - 5) < 1e-12);
    });
});

describe("radix argsort", () => {
    /*
     * The pass replaced an introsort with a radix sort on the IEEE-754 bit
     * patterns. `performance.md` claims the two are interchangeable; until now
     * nothing compared them, so the claim rested on the metric parity fixtures
     * noticing a difference indirectly.
     */
    const permutationOf = (key: Float64Array) => {
        const n = key.length;
        const byRadix = new Uint32Array(n);
        const byCompare = new Uint32Array(n);
        for (let i = 0; i < n; ++i) byRadix[i] = byCompare[i] = i;
        radixArgsort(key, byRadix, n, makeRadixScratch(n));
        argsortRange(key, byCompare, 0, n - 1);
        return { byRadix, byCompare };
    };

    it("gives the same permutation as the comparison sort", () => {
        const rnd = lcg(7);
        const key = new Float64Array(5000);
        for (let i = 0; i < key.length; ++i) key[i] = rnd() * 1e6;
        const { byRadix, byCompare } = permutationOf(key);
        assert.deepEqual(Array.from(byRadix), Array.from(byCompare));
    });

    it("agrees on heavy ties, where the tie-break is the whole question", () => {
        const rnd = lcg(11);
        const key = new Float64Array(4000);
        // Few distinct values: almost every comparison is a tie.
        for (let i = 0; i < key.length; ++i) key[i] = Math.floor(rnd() * 5);
        const { byRadix, byCompare } = permutationOf(key);
        assert.deepEqual(Array.from(byRadix), Array.from(byCompare));

        // Ties must break by index, which is what makes the pass reproducible.
        for (let i = 1; i < key.length; ++i) {
            if (key[byRadix[i]] === key[byRadix[i - 1]]) {
                assert.ok(byRadix[i] > byRadix[i - 1]);
            }
        }
    });

    it("sorts ascending, and puts the -1 self sentinel first", () => {
        // -1 marks a point's distance to itself; it must lead the row.
        const key = Float64Array.from([4, -1, 0, 9, 2]);
        const idx = Uint32Array.from([0, 1, 2, 3, 4]);
        radixArgsort(key, idx, key.length, makeRadixScratch(key.length));
        assert.equal(idx[0], 1);
        const sorted = Array.from(idx, (i) => key[i]);
        assert.deepEqual(sorted, [-1, 0, 2, 4, 9]);
    });

    it("handles the degenerate sizes", () => {
        for (const n of [0, 1, 2]) {
            const key = new Float64Array(n).map((_, i) => n - i);
            const idx = new Uint32Array(n).map((_, i) => i);
            radixArgsort(key, idx, n, makeRadixScratch(Math.max(1, n)));
            for (let i = 1; i < n; ++i) assert.ok(key[idx[i]] >= key[idx[i - 1]]);
        }
    });
});

describe("input adapters", () => {
    it("hands out a copy of a row, never a view", () => {
        // A view would let a caller corrupt the pass's own buffer.
        const v = toVectors([[1, 2], [3, 4], [5, 6]]);
        const r = row(v, 1);
        assert.deepEqual(Array.from(r), [3, 4]);
        r[0] = 999;
        assert.equal(v.data[2], 3);
    });

    it("adopts a Vectors unchanged, so conversion is free on the hot path", () => {
        const v = toVectors([[1, 2], [3, 4], [5, 6]]);
        assert.equal(toVectors(v), v);
    });

    it("adopts a Matrix's buffer without copying", () => {
        const values = Float64Array.from([1, 2, 3, 4, 5, 6]);
        const v = toVectors({ values, shape: [3, 2] });
        assert.equal(v.data, values);
        assert.deepEqual([v.n, v.d], [3, 2]);
    });

    it("needs a dimension for a bare Float64Array, and says so", () => {
        const flat = Float64Array.from([1, 2, 3, 4, 5, 6]);
        assert.throws(() => toVectors(flat), /`d` is required/);
        assert.throws(() => toVectors(flat, 4), /not a multiple/);
        assert.equal(toVectors(flat, 2).n, 3);
    });

    it("rejects ragged and empty input rather than reading past a row", () => {
        assert.throws(() => toVectors([[1, 2], [3]]), /row 1 has length 1/);
        assert.throws(() => toVectors([]), /empty input/);
        assert.throws(() => toVectors([[], []]), /zero-dimensional/);
        assert.throws(() => toVectors(42 as never), /unsupported input/);
    });

    it("refuses mismatched or too-small point sets", () => {
        const a = toVectors([[0, 0], [1, 1], [2, 2]]);
        const b = toVectors([[0, 0], [1, 1]]);
        assert.throws(() => assertSamePoints(a, b), /point count mismatch/);
        assert.throws(() => assertSamePoints(b, b), /at least 3 points/);
        assert.doesNotThrow(() => assertSamePoints(a, a));
    });
});

describe("the per-point contract checker", () => {
    const result = (over: Partial<MetricResult>): MetricResult =>
        ({ value: 0, localKind: "none", ...over }) as MetricResult;

    /** The checker returns null on success, so a failure has to be asserted as one. */
    const failsWith = (r: MetricResult, re: RegExp) => {
        const message = checkContract(r);
        assert.ok(message !== null, "expected a contract failure, got none");
        assert.match(message, re);
    };

    it("accepts each kind when it holds", () => {
        assert.equal(checkContract(result({ value: 2, localKind: "mean", local: Float64Array.from([1, 3]) })), null);
        assert.equal(checkContract(result({ value: 4, localKind: "sum", local: Float64Array.from([1, 3]) })), null);
        assert.equal(checkContract(result({ value: 9, localKind: "share", local: Float64Array.from([0.25, 0.75]) })), null);
        assert.equal(checkContract(result({ value: 2, localKind: "partial-mean", local: Float64Array.from([1, NaN, 3]) })), null);
        assert.equal(checkContract(result({ localKind: "none" })), null);
    });

    it("catches each kind when it does not", () => {
        failsWith(result({ value: 5, localKind: "mean", local: Float64Array.from([1, 3]) }), /mean\(local\)/);
        failsWith(result({ value: 5, localKind: "sum", local: Float64Array.from([1, 3]) }), /sum\(local\)/);
        failsWith(result({ value: 1, localKind: "share", local: Float64Array.from([0.25, 0.25]) }), /!== 1/);
        failsWith(result({ value: 9, localKind: "partial-mean", local: Float64Array.from([1, NaN, 3]) }), /finite local/);
    });

    it("insists a decomposing measure actually decomposes", () => {
        failsWith(result({ localKind: "mean" }), /no local array/);
        failsWith(result({ localKind: "none", local: Float64Array.from([1]) }), /'none' but a local array/);
    });

    it("is vacuously satisfied when every point is excluded", () => {
        // `partial-mean` with nothing finite has no mean to disagree with.
        assert.equal(checkContract(result({ value: 7, localKind: "partial-mean", local: Float64Array.from([NaN, NaN]) })), null);
    });

    /*
     * No shipped measure returns `weighted-mean`; the branch exists for custom
     * metrics built on the same contract, and is otherwise unreachable.
     */
    it("checks the weighted kind reserved for custom metrics", () => {
        const local = Float64Array.from([1, 3]);
        assert.equal(checkContract(result({ value: 2.5, localKind: "weighted-mean", local, weights: Float64Array.from([1, 3]) })), null);
        failsWith(result({ value: 2, localKind: "weighted-mean", local, weights: Float64Array.from([1, 3]) }), /weighted mean/);
        failsWith(result({ value: 2, localKind: "weighted-mean", local }), /no weights/);
        failsWith(result({ value: 2, localKind: "weighted-mean", local, weights: Float64Array.from([1]) }), /different lengths/);
    });
});
