import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import { makeFixture, mean, withDuplicates } from "./fixtures.ts";
import { referenceLCMC, referenceQNX, referenceTC } from "./reference.ts";

const close = (got: number, want: number, tol = 1e-10, msg = "") =>
    assert.ok(
        Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)),
        `${msg}\n  got  ${got}\n  want ${want}\n  diff ${Math.abs(got - want)}`,
    );

const KS = [5, 10, 25, 50];

describe("co-ranking pass vs naive reference", () => {
    const { X, Y } = makeFixture(200, 6);
    const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), { localK: KS });

    for (const k of KS) {
        it(`matches reference trustworthiness/continuity at k=${k}`, () => {
            const r = referenceTC(X, Y, k);
            close(sickle.trustworthiness(cr, k), r.trust, 1e-10, `trustworthiness k=${k}`);
            close(sickle.continuity(cr, k), r.cont, 1e-10, `continuity k=${k}`);
        });
        it(`matches reference LCMC and Q_NX at k=${k}`, () => {
            close(sickle.lcmc(cr, k), referenceLCMC(X, Y, k), 1e-10, `lcmc k=${k}`);
            close(sickle.qnx(cr, k), referenceQNX(X, Y, k), 1e-10, `qnx k=${k}`);
        });
    }
});

describe("per-point contributions", () => {
    const { X, Y } = makeFixture(200, 6);
    const k = 10;
    const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), { localK: [k] });
    const ref = referenceTC(X, Y, k);

    it("matches the reference point by point", () => {
        const lt = sickle.localTrustworthiness(cr, k);
        const lc = sickle.localContinuity(cr, k);
        for (let i = 0; i < X.length; ++i) {
            close(lt[i], ref.localTrust[i], 1e-12, `localTrustworthiness[${i}]`);
            close(lc[i], ref.localCont[i], 1e-12, `localContinuity[${i}]`);
        }
    });

    // The contract that makes "local" meaningful. See metrics/neighborhood.ts.
    it("satisfies mean(local) === global", () => {
        close(mean(sickle.localTrustworthiness(cr, k)), sickle.trustworthiness(cr, k), 1e-12);
        close(mean(sickle.localContinuity(cr, k)), sickle.continuity(cr, k), 1e-12);
    });

    it("reports a clear error for an unrequested k", () => {
        assert.throws(() => sickle.localTrustworthiness(cr, 11), /was not requested/);
    });
});

describe("identity projection invariants", () => {
    const { X } = makeFixture(150, 5);
    const v = sickle.toVectors(X);
    const cr = sickle.coRanking(v, v, { localK: [10] });

    it("is perfect on every measure", () => {
        close(sickle.trustworthiness(cr, 10), 1, 1e-12, "trustworthiness");
        close(sickle.continuity(cr, 10), 1, 1e-12, "continuity");
        close(sickle.qnx(cr, 10), 1, 1e-12, "qnx");
        close(sickle.rnx(cr, 25), 1, 1e-12, "rnx");
        close(sickle.aucLogRnx(cr), 1, 1e-12, "aucLogRnx");
        close(sickle.lcmc(cr, 10), 1 - 10 / 149, 1e-12, "lcmc");
    });

    it("has every per-point value equal to 1", () => {
        for (const v of sickle.localTrustworthiness(cr, 10)) close(v, 1, 1e-12);
    });
});

describe("determinism", () => {
    it("is invariant under row permutation", () => {
        const { X, Y } = makeFixture(180, 5, 99);
        const perm = [...X.keys()].reverse();
        const a = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y));
        const b = sickle.coRanking(
            sickle.toVectors(perm.map((i) => X[i])),
            sickle.toVectors(perm.map((i) => Y[i])),
        );
        close(sickle.trustworthiness(b, 15), sickle.trustworthiness(a, 15));
        close(sickle.aucLogRnx(b), sickle.aucLogRnx(a));
    });

    // Ties make ranks ambiguous; the index tie-break is what keeps this stable.
    it("handles exact duplicate points reproducibly", () => {
        const { X, Y } = withDuplicates(makeFixture(120, 4, 3), 20);
        const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), { localK: [8] });
        const ref = referenceTC(X, Y, 8);
        close(sickle.trustworthiness(cr, 8), ref.trust, 1e-9, "trustworthiness with duplicates");
        close(sickle.continuity(cr, 8), ref.cont, 1e-9, "continuity with duplicates");
    });

    it("gives identical results on repeated calls", () => {
        const { X, Y } = makeFixture(120, 4, 5);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        assert.equal(
            sickle.trustworthiness(sickle.coRanking(hd, ld), 12),
            sickle.trustworthiness(sickle.coRanking(hd, ld), 12),
        );
    });

    it("does not mutate its inputs", () => {
        const { X, Y } = makeFixture(80, 4, 11);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const hdCopy = hd.data.slice(), ldCopy = ld.data.slice();
        sickle.coRanking(hd, ld, { localK: [5] });
        assert.deepEqual(hd.data, hdCopy, "high-dimensional data was mutated");
        assert.deepEqual(ld.data, ldCopy, "projection data was mutated");
    });
});

describe("row-range partitioning", () => {
    // The property that makes worker parallelism safe: partials are additive.
    it("reduces to the same result as a single pass", () => {
        const { X, Y } = makeFixture(160, 5, 77);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const whole = sickle.coRanking(hd, ld, { localK: [10] });

        for (const parts of [2, 3, 7]) {
            const partials = sickle.rowRanges(hd.n, parts).map(([rowStart, rowEnd]) =>
                sickle.coRankingPartial(hd, ld, { localK: [10], rowStart, rowEnd }),
            );
            const split = sickle.reduceCoRanking(partials);
            for (const k of [5, 10, 30]) {
                assert.equal(
                    sickle.trustworthiness(split, k),
                    sickle.trustworthiness(whole, k),
                    `trustworthiness k=${k} differs with ${parts} partitions`,
                );
                assert.equal(sickle.qnx(split, k), sickle.qnx(whole, k));
            }
            assert.deepEqual(
                sickle.localTrustworthiness(split, 10),
                sickle.localTrustworthiness(whole, 10),
            );
        }
    });
});

describe("curves", () => {
    const { X, Y } = makeFixture(140, 5, 21);
    const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y));

    it("agree with the scalar read-outs at every k", () => {
        const t = sickle.trustworthinessCurve(cr);
        for (let k = t.kMin; k <= t.kMax; ++k) {
            assert.equal(t.values[k], sickle.trustworthiness(cr, k), `curve mismatch at k=${k}`);
        }
        const r = sickle.rnxCurve(cr);
        for (let k = r.kMin; k <= r.kMax; ++k) close(r.values[k], sickle.rnx(cr, k), 1e-12);
    });

    /*
     * Every curve, not just the two above: each is a separate `buildCurve`
     * call with its own k ceiling, so a wrong bound or a transcription slip in
     * one is invisible in the others.
     */
    it("agree for every measure that has a curve", () => {
        const cases: [string, sickle.Curve, (k: number) => number][] = [
            ["continuity", sickle.continuityCurve(cr), (k) => sickle.continuity(cr, k)],
            ["qnx", sickle.qnxCurve(cr), (k) => sickle.qnx(cr, k)],
            ["lcmc", sickle.lcmcCurve(cr), (k) => sickle.lcmc(cr, k)],
            ["mrreFalse", sickle.mrreFalseCurve(cr), (k) => sickle.mrreFalse(cr, k)],
            ["mrreMissing", sickle.mrreMissingCurve(cr), (k) => sickle.mrreMissing(cr, k)],
        ];
        for (const [name, curve, scalar] of cases) {
            for (let k = curve.kMin; k <= curve.kMax; ++k) {
                close(curve.values[k], scalar(k), 1e-12, `${name} at k=${k}`);
            }
        }
    });

    it("stop where their own measure stops", () => {
        // Q_NX and LCMC reach n-1; R_NX loses one more to its rescaling.
        assert.equal(sickle.qnxCurve(cr).kMax, sickle.maxKQnx(cr.n));
        assert.equal(sickle.lcmcCurve(cr).kMax, sickle.maxKQnx(cr.n));
        assert.equal(sickle.rnxCurve(cr).kMax, sickle.maxKRnx(cr.n));
        assert.equal(sickle.continuityCurve(cr).kMax, sickle.maxKTrustworthiness(cr.n));
    });

    it("are NaN outside their validity domain", () => {
        const t = sickle.trustworthinessCurve(cr);
        assert.ok(Number.isNaN(t.values[0]), "k=0 must be NaN");
        assert.ok(Number.isNaN(t.values[t.kMax + 1]), "beyond kMax must be NaN");
        assert.equal(t.kMax, sickle.maxKTrustworthiness(cr.n));
    });

    it("reject out-of-domain k rather than returning a plausible wrong number", () => {
        assert.throws(() => sickle.trustworthiness(cr, sickle.maxKTrustworthiness(140) + 1), /k must be/);
        assert.throws(() => sickle.rnx(cr, 139), /k must be/);
        assert.throws(() => sickle.trustworthiness(cr, 0), /k must be/);
        assert.throws(() => sickle.trustworthiness(cr, 2.5), /k must be/);
    });
});

/*
 * The cap on k for trustworthiness and continuity is load-bearing, not tidiness.
 *
 * Their shared normaliser is the reciprocal of the worst penalty a projection
 * can incur, so the worst case scores exactly 0. That holds while k <= n/2: a
 * maximally wrong projection fills all k neighbour slots from the other half and
 * the counts meet. Above n/2 there are only n-1-k points outside the
 * neighbourhood, fewer than k, so the true worst case is smaller than the
 * constant assumes and the score runs below 0 — it reached -6.6 at n=200, k=132
 * under the previous cap of floor((2n-2)/3), which only kept the denominator
 * positive.
 *
 * Nothing caught it because every other test picks a small k on a decent
 * projection. These check the boundary itself, on a deliberately bad one.
 */
describe("trustworthiness/continuity domain of k", () => {
    it("caps k at floor(n/2)", () => {
        for (const n of [7, 8, 20, 21, 200, 201]) {
            assert.equal(sickle.maxKTrustworthiness(n), Math.floor(n / 2), `n=${n}`);
        }
    });

    it("stays in [0, 1] at every admissible k, even for a terrible projection", () => {
        for (const n of [8, 21, 50, 120]) {
            // makeFixture's projection is independent of X by construction.
            const { X, Y } = makeFixture(n, 4, n);
            const bad = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y));
            for (let k = 1; k <= sickle.maxKTrustworthiness(n); ++k) {
                const t = sickle.trustworthiness(bad, k);
                const c = sickle.continuity(bad, k);
                assert.ok(t >= 0 && t <= 1, `trustworthiness ${t} out of range at n=${n} k=${k}`);
                assert.ok(c >= 0 && c <= 1, `continuity ${c} out of range at n=${n} k=${k}`);
            }
        }
    });

    it("refuses the k values that used to return negative scores", () => {
        const { X, Y } = makeFixture(200, 4, 3);
        const bad = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y));
        // 132 = the old cap, floor((2*200-2)/3); 101 = the first k past n/2.
        for (const k of [101, 125, 132]) {
            assert.throws(() => sickle.trustworthiness(bad, k), /k must be/, `k=${k}`);
            assert.throws(() => sickle.continuity(bad, k), /k must be/, `k=${k}`);
        }
    });

    it("stops the curves at the same place", () => {
        const { X, Y } = makeFixture(200, 4, 3);
        const bad = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y));
        for (const curve of [sickle.trustworthinessCurve(bad), sickle.continuityCurve(bad)]) {
            assert.equal(curve.kMax, 100);
            for (let k = curve.kMin; k <= curve.kMax; ++k) {
                assert.ok(
                    curve.values[k] >= 0 && curve.values[k] <= 1,
                    `curve value ${curve.values[k]} out of range at k=${k}`,
                );
            }
        }
    });
});

describe("input adapters", () => {
    it("accepts a DruidJS-shaped matrix without copying", () => {
        const data = Float64Array.from([0, 0, 1, 0, 0, 1, 1, 1]);
        const v = sickle.toVectors({ values: data, shape: [4, 2] });
        assert.equal(v.data, data, "should be zero-copy");
        assert.equal(v.n, 4);
        assert.equal(v.d, 2);
    });

    it("accepts number[][] and a bare Float64Array", () => {
        assert.deepEqual(sickle.toVectors([[1, 2], [3, 4]]).data, Float64Array.from([1, 2, 3, 4]));
        assert.equal(sickle.toVectors(Float64Array.from([1, 2, 3, 4]), 2).n, 2);
    });

    it("rejects malformed input", () => {
        assert.throws(() => sickle.toVectors(Float64Array.from([1, 2, 3]), 2), /multiple of/);
        assert.throws(() => sickle.toVectors([[1, 2], [3]]), /row 1/);
        assert.throws(() => sickle.toVectors([]), /empty/);
    });

    it("reports mismatched point counts", () => {
        assert.throws(
            () => sickle.coRanking(sickle.toVectors([[1, 1], [2, 2], [3, 3]]), sickle.toVectors([[1, 1], [2, 2]])),
            /point count mismatch/,
        );
    });
});

describe("cancellation and progress", () => {
    it("reports monotonic progress ending at 1", () => {
        const { X, Y } = makeFixture(100, 4);
        const seen: number[] = [];
        sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), {
            onProgress: (f) => seen.push(f),
            progressInterval: 10,
        });
        assert.ok(seen.length > 1);
        assert.equal(seen.at(-1), 1);
        for (let i = 1; i < seen.length; ++i) assert.ok(seen[i] >= seen[i - 1]);
    });

    it("honours an abort signal", () => {
        const { X, Y } = makeFixture(400, 4);
        const ac = new AbortController();
        let calls = 0;
        assert.throws(() => {
            sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), {
                progressInterval: 8,
                onProgress: () => { if (++calls === 3) ac.abort(); },
                signal: ac.signal,
            });
        }, /abort/i);
    });
});

describe("fused pass", () => {
    // The point of fusing: one sweep must give exactly what two sweeps gave.
    it("matches the separate passes exactly", () => {
        const { X, Y } = makeFixture(220, 7, 55);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);

        const separateCr = sickle.coRanking(hd, ld, { localK: [10, 25] });
        const separateDm = sickle.distanceMoments(hd, ld);
        const fused = sickle.analyze(hd, ld, { localK: [10, 25] });

        assert.deepEqual(fused.coRanking.tPenalty, separateCr.tPenalty);
        assert.deepEqual(fused.coRanking.cPenalty, separateCr.cPenalty);
        assert.deepEqual(fused.coRanking.corner, separateCr.corner);
        assert.deepEqual(
            sickle.localTrustworthiness(fused.coRanking, 10),
            sickle.localTrustworthiness(separateCr, 10),
        );
        for (const key of ["sumH", "sumL", "sumHH", "sumLL", "sumHL", "sumDiff2"] as const) {
            assert.equal(fused.moments[key], separateDm[key], `moments.${key} differs`);
        }
        assert.deepEqual(fused.moments.rowDiff2, separateDm.rowDiff2);
        assert.equal(sickle.stress(fused.moments).value, sickle.stress(separateDm).value);
        assert.equal(sickle.pearsonR(fused.moments).value, sickle.pearsonR(separateDm).value);
    });

    it("reduces across row ranges", () => {
        const { X, Y } = makeFixture(200, 5, 66);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const whole = sickle.analyze(hd, ld, { localK: [10] });
        const parts = sickle.rowRanges(hd.n, 4).map(([rowStart, rowEnd]) =>
            sickle.fusedPartial(hd, ld, { localK: [10], rowStart, rowEnd }));
        const split = sickle.reduceFused(parts);
        assert.equal(sickle.trustworthiness(split.coRanking, 10), sickle.trustworthiness(whole.coRanking, 10));
        assert.deepEqual(split.moments.rowDiff2, whole.moments.rowDiff2);
        assert.ok(Math.abs(sickle.stress(split.moments).value - sickle.stress(whole.moments).value) < 1e-14);
    });
});
