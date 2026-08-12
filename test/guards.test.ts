/*
 * The refusals.
 *
 * Several measures materialise every pair or every triangle, and would happily
 * try to allocate tens of gigabytes if asked. Each has a ceiling that throws
 * instead, and the error is expected to name the option that raises it — a
 * limit you cannot find from the message is a dead end rather than a guard.
 *
 * These are the paths a user hits first and the suite exercised least: the
 * branch coverage of the library sat well below its line coverage, almost
 * entirely here.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import { lcg } from "./fixtures.ts";

/** A small well-formed pair of spaces; enough to reach any guard. */
function pair(n = 40, dHi = 4) {
    const rnd = lcg(3);
    const hd: number[][] = [], ld: number[][] = [];
    for (let i = 0; i < n; ++i) {
        hd.push(Array.from({ length: dHi }, () => rnd()));
        ld.push([rnd(), rnd()]);
    }
    return { hd, ld, labels: Array.from({ length: n }, (_, i) => i % 3) };
}

describe("pair-materialising measures refuse rather than exhaust memory", () => {
    const { hd, ld } = pair();

    it("spearmanRho counts the full N x N and names maxPairs", () => {
        assert.throws(
            () => sickle.spearmanRho(hd, ld, { maxPairs: 100 }),
            (e: Error) => /maxPairs/.test(e.message) && e instanceof RangeError,
        );
        // Raising the ceiling is all it takes.
        assert.ok(Number.isFinite(sickle.spearmanRho(hd, ld, { maxPairs: 1e6 }).value));
    });

    it("nonMetricStress counts the i<j pairs and names maxPairs", () => {
        assert.throws(
            () => sickle.nonMetricStress(hd, ld, { maxPairs: 10 }),
            (e: Error) => /maxPairs/.test(e.message) && e instanceof RangeError,
        );
        assert.ok(Number.isFinite(sickle.nonMetricStress(hd, ld, { maxPairs: 1e6 }).value));
    });

    /*
     * The two defaults are the same number in different units: spearmanRho
     * counts n^2, nonMetricStress counts n(n-1)/2. Same n, different verdict.
     */
    it("the two ceilings count different things", () => {
        const n = 40;
        const square = n * n;               // 1600
        const triangle = (n * (n - 1)) / 2; // 780
        assert.ok(triangle < 1000 && square > 1000);
        assert.throws(() => sickle.spearmanRho(hd, ld, { maxPairs: 1000 }), /maxPairs/);
        assert.doesNotThrow(() => sickle.nonMetricStress(hd, ld, { maxPairs: 1000 }));
    });
});

describe("measures that need a two-dimensional projection say so", () => {
    const { hd, labels } = pair();
    const ld3 = hd.map((r) => [r[0], r[1], r[2]]);

    it("gabrielEdges rejects a projection that is not 2-D", () => {
        assert.throws(() => sickle.gabrielEdges(ld3), /2-dimensional/);
    });

    it("gabrielClassificationError rejects it too, through the graph it builds", () => {
        assert.throws(() => sickle.gabrielClassificationError(hd, ld3, labels), /2-dimensional/);
    });

    it("scagnostics rejects it, and also refuses too few points", () => {
        assert.throws(() => sickle.scagnostics(ld3), /2-dimensional/);
        assert.throws(() => sickle.scagnostics([[0, 0], [1, 1]]), /at least 3 points/);
    });
});

describe("labels must line up with the points", () => {
    const { hd, ld, labels } = pair();

    it("is checked rather than read past the end", () => {
        const short = labels.slice(0, 5);
        assert.throws(() => sickle.neighborhoodHit(ld, short, 5), /labels has length 5/);
        assert.throws(() => sickle.classificationError(ld, short, 5), /labels has length 5/);
        assert.throws(() => sickle.gabrielClassificationError(hd, ld, short), /labels has length 5/);
    });
});

describe("the O(N^3) topology guard", () => {
    it("ripsH1 refuses past maxPoints and names it", () => {
        const { ld } = pair(40);
        assert.throws(
            () => sickle.ripsH1(ld, { maxPoints: 10 }),
            (e: Error) => /maxPoints/.test(e.message) && e instanceof RangeError,
        );
    });

    it("the ceiling is a refusal, not a silent subsample", () => {
        // A measure that quietly sampled would return a plausible wrong number.
        const { ld } = pair(40);
        const full = sickle.ripsH1(ld, { maxPoints: 100 });
        assert.ok(Array.isArray(full));
    });
});

describe("read-outs refuse a pass that was not told to collect them", () => {
    const { hd, ld } = pair();

    it("each names the option that would have collected it", () => {
        const bare = sickle.analyze(hd, ld);
        assert.throws(() => sickle.densityPreservation(bare.structure), /densityK/);
        assert.throws(() => sickle.tripletAccuracy(bare.structure), /triplets/);
        assert.throws(() => sickle.curvilinearStress(bare.embedding), /ccaLambda/);
    });

    it("and are satisfied once it was", () => {
        const full = sickle.analyze(hd, ld, { densityK: 5, triplets: true, ccaLambda: 1 });
        assert.ok(Number.isFinite(sickle.densityPreservation(full.structure).value));
        assert.ok(Number.isFinite(sickle.tripletAccuracy(full.structure).value));
        assert.ok(Number.isFinite(sickle.curvilinearStress(full.embedding).value));
    });

    it("curvilinearStress treats a non-positive lambda as not requested", () => {
        // `ccaLambda: 0` would divide by a zero-width kernel.
        const zero = sickle.analyze(hd, ld, { ccaLambda: 0 });
        assert.throws(() => sickle.curvilinearStress(zero.embedding), /ccaLambda/);
    });
});

describe("option validation happens before the expensive part", () => {
    const { hd, ld } = pair();

    it("localK entries must be usable neighbourhood sizes", () => {
        assert.throws(() => sickle.analyze(hd, ld, { localK: [0] }), /localK/);
        assert.throws(() => sickle.analyze(hd, ld, { localK: [2.5] }), /localK/);
        assert.throws(() => sickle.analyze(hd, ld, { localK: [hd.length] }), /localK/);
    });

    it("wassersteinH0 requires p >= 1", () => {
        const d = sickle.persistenceH0(hd).deaths;
        assert.throws(() => sickle.wassersteinH0(d, d, 0.5), /p must be at least 1/);
        assert.ok(Number.isFinite(sickle.wassersteinH0(d, d, 1)));
    });
});
