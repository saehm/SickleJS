/**
 * The contract harness.
 *
 * Every metric is registered here once, and gets checked against the same set of
 * properties. This is what makes adding a metric safe: a new entry in `METRICS`
 * is automatically subjected to the local/global contract, determinism,
 * input-immutability and range checks, with no new test code.
 *
 * If you add a metric and it fails here, the metric is wrong -- not the test.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import type { MetricResult } from "../src/core/result.ts";
import { makeFixture, makeGoodFixture } from "./fixtures.ts";

interface Case {
    name: string;
    /** Compute the metric from scratch, so repeat calls exercise the whole path. */
    run: (X: number[][], Y: number[][], labels: number[]) => MetricResult;
    /** Optional value-range assertion. */
    range?: [number, number];
    /** True if a faithful projection should score higher than a poor one. */
    higherIsBetter?: boolean;
    /**
     * Set for stochastic measures. They are invariant under row permutation only
     * *in distribution*: the random stream is consumed in point order, so
     * reordering the input draws different clusters. The value is the band
     * within which the permuted result must still land.
     */
    stochastic?: number;
    /**
     * Run against only the first N points of the fixture. For metrics too costly
     * at full size -- H1 enumerates triangles. Applied by the harness *before*
     * permuting, so the permutation test still compares like with like.
     */
    maxPoints?: number;
}

const K = 10;

const METRICS: Case[] = [
    {
        name: "trustworthiness",
        run: (X, Y) => {
            const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), { localK: [K] });
            return {
                value: sickle.trustworthiness(cr, K),
                local: sickle.localTrustworthiness(cr, K),
                localKind: "mean",
            };
        },
        range: [0, 1],
        higherIsBetter: true,
    },
    {
        name: "continuity",
        run: (X, Y) => {
            const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), { localK: [K] });
            return {
                value: sickle.continuity(cr, K),
                local: sickle.localContinuity(cr, K),
                localKind: "mean",
            };
        },
        range: [0, 1],
        higherIsBetter: true,
    },
    {
        name: "aucLogRnx",
        run: (X, Y) => ({
            value: sickle.aucLogRnx(sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y))),
            localKind: "none",
        }),
        higherIsBetter: true,
    },
    {
        name: "stress",
        run: (X, Y) => sickle.stress(sickle.distanceMoments(sickle.toVectors(X), sickle.toVectors(Y))),
        range: [0, Infinity],
        higherIsBetter: false,
    },
    {
        name: "scaleNormalizedStress",
        run: (X, Y) =>
            sickle.scaleNormalizedStress(sickle.distanceMoments(sickle.toVectors(X), sickle.toVectors(Y))),
        range: [0, Infinity],
        higherIsBetter: false,
    },
    {
        name: "pearsonR",
        run: (X, Y) => sickle.pearsonR(sickle.distanceMoments(sickle.toVectors(X), sickle.toVectors(Y))),
        range: [-1, 1],
        higherIsBetter: true,
    },
    {
        name: "sammonStress",
        run: (X, Y) => sickle.sammonStress(
            sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y)).embedding),
        range: [0, Infinity],
        higherIsBetter: false,
    },
    {
        name: "curvilinearStress",
        run: (X, Y) => sickle.curvilinearStress(
            sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), { ccaLambda: 1.5 }).embedding),
        range: [0, Infinity],
        higherIsBetter: false,
    },
    {
        name: "nerv",
        run: (X, Y) => sickle.nerv(
            sickle.nervPass(sickle.toVectors(X), sickle.toVectors(Y), { perplexity: 20 })),
        range: [0, Infinity],
        higherIsBetter: false,
    },
    {
        name: "mrreFalse",
        run: (X, Y) => {
            const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), { localK: [K] });
            return { value: sickle.mrreFalse(cr, K), local: sickle.localMrreFalse(cr, K), localKind: "mean" };
        },
        range: [0, 1],
        higherIsBetter: true,
    },
    {
        name: "mrreMissing",
        run: (X, Y) => {
            const cr = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y), { localK: [K] });
            return { value: sickle.mrreMissing(cr, K), local: sickle.localMrreMissing(cr, K), localKind: "mean" };
        },
        range: [0, 1],
        higherIsBetter: true,
    },
    {
        name: "residualVariance",
        run: (X, Y) => sickle.residualVariance(sickle.distanceMoments(sickle.toVectors(X), sickle.toVectors(Y))),
        range: [0, 1],
        higherIsBetter: false,
    },
    {
        name: "spearmanRho",
        run: (X, Y) => sickle.spearmanRho(sickle.toVectors(X), sickle.toVectors(Y)),
        range: [-1, 1],
        higherIsBetter: true,
    },
    {
        name: "neighborhoodHit",
        run: (_X, Y, labels) => sickle.neighborhoodHit(sickle.toVectors(Y), labels, K),
        range: [0, 1],
        higherIsBetter: true,
    },
    {
        name: "classificationError",
        run: (_X, Y, labels) => sickle.classificationError(sickle.toVectors(Y), labels, K),
        range: [0, 1],
        higherIsBetter: false,
    },
    {
        name: "dunnIndex",
        run: (_X, Y, labels) => {
            const ld = sickle.toVectors(Y);
            return sickle.dunnIndex(ld, sickle.clusters(ld, labels));
        },
        range: [0, Infinity],
        higherIsBetter: true,
    },
    {
        name: "daviesBouldin",
        run: (_X, Y, labels) => {
            const ld = sickle.toVectors(Y);
            return sickle.daviesBouldin(ld, sickle.clusters(ld, labels));
        },
        range: [0, Infinity],
        higherIsBetter: false,
    },
    {
        name: "gabrielClassificationError",
        run: (X, Y, labels) => sickle.gabrielClassificationError(
            sickle.toVectors(X), sickle.toVectors(Y), labels),
        // Not normalised: a sum of harmonic weights, so it can exceed 1.
        range: [0, Infinity],
        higherIsBetter: false,
    },
    {
        name: "steadiness",
        run: (X, Y) => ({
            value: sickle.snc(sickle.toVectors(X), sickle.toVectors(Y), { iterations: 30, seed: 1 }).steadiness,
            localKind: "none",
        }),
        range: [0, 1],
        higherIsBetter: true,
        stochastic: 0.05,
    },
    {
        name: "cohesiveness",
        run: (X, Y) => ({
            value: sickle.snc(sickle.toVectors(X), sickle.toVectors(Y), { iterations: 30, seed: 1 }).cohesiveness,
            localKind: "none",
        }),
        range: [0, 1],
        higherIsBetter: true,
        stochastic: 0.05,
    },
    {
        name: "topologicalH0",
        run: (X, Y) => sickle.topologicalH0(sickle.toVectors(X), sickle.toVectors(Y)),
        range: [0, 1],
        higherIsBetter: false,
    },
    {
        name: "tripletAccuracy",
        run: (X, Y) => sickle.tripletAccuracy(
            sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), { triplets: true }).structure),
        range: [0, 1],
        higherIsBetter: true,
    },
    {
        name: "densityPreservation",
        run: (X, Y) => sickle.densityPreservation(
            sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), { densityK: 10 }).structure),
        range: [-1, 1],
        higherIsBetter: true,
    },
    {
        name: "topologicalH1",
        run: (X, Y) => sickle.topologicalH1(sickle.toVectors(X), sickle.toVectors(Y)),
        range: [0, 1],
        higherIsBetter: false,
        maxPoints: 60,   // H1 enumerates triangles; the full fixture is too costly
    },
    {
        name: "silhouette",
        run: (_X, Y, labels) => {
            const ld = sickle.toVectors(Y);
            return sickle.silhouette(ld, sickle.clusters(ld, labels));
        },
        range: [-1, 1],
        higherIsBetter: true,
    },
    {
        name: "calinskiHarabasz",
        run: (_X, Y, labels) => {
            const ld = sickle.toVectors(Y);
            return sickle.calinskiHarabasz(ld, sickle.clusters(ld, labels));
        },
        range: [0, Infinity],
        higherIsBetter: true,
    },
    {
        name: "distanceConsistency",
        run: (_X, Y, labels) => {
            const ld = sickle.toVectors(Y);
            return sickle.distanceConsistency(ld, sickle.clusters(ld, labels));
        },
        range: [0, 1],
        higherIsBetter: true,
    },
    {
        name: "averageBetweenWithin",
        run: (_X, Y, labels) => {
            const ld = sickle.toVectors(Y);
            return sickle.averageBetweenWithin(ld, sickle.clusters(ld, labels));
        },
        range: [0, Infinity],
        higherIsBetter: true,
    },
    {
        name: "hypothesisMargin",
        run: (_X, Y, labels) => {
            const ld = sickle.toVectors(Y);
            return sickle.hypothesisMargin(ld, sickle.clusters(ld, labels));
        },
        higherIsBetter: true,
    },
];

const poor = makeFixture(150, 6, 42);
const good = makeGoodFixture(150, 6, 7);

describe("metric contracts", () => {
    for (const m of METRICS) {
        describe(m.name, () => {
            // Trim first, so every check below -- including the permutation --
            // operates on the same point set.
            const cut = <T,>(xs: T[]) => (m.maxPoints ? xs.slice(0, m.maxPoints) : xs);
            const P = { X: cut(poor.X), Y: cut(poor.Y), labels: cut(poor.labels) };
            const G = { X: cut(good.X), Y: cut(good.Y), labels: cut(good.labels) };

            const r = m.run(P.X, P.Y, P.labels);

            it("declares a local/global relationship that holds", () => {
                const problem = sickle.checkContract(r, 1e-9);
                assert.equal(problem, null, `${m.name}: ${problem}`);
            });

            it("returns a finite value", () => {
                assert.ok(Number.isFinite(r.value), `${m.name} returned ${r.value}`);
            });

            if (m.range) {
                const [lo, hi] = m.range;
                it(`stays within [${lo}, ${hi}]`, () => {
                    assert.ok(r.value >= lo && r.value <= hi, `${m.name} = ${r.value}`);
                });
            }

            it("has a local array of the right length, when it has one", () => {
                if (r.local) assert.equal(r.local.length, P.X.length);
            });

            it("is deterministic across repeated computation", () => {
                const again = m.run(P.X, P.Y, P.labels);
                assert.equal(again.value, r.value, `${m.name} is not reproducible`);
                if (r.local) assert.deepEqual(again.local, r.local);
            });

            it("does not mutate its inputs", () => {
                const X = P.X.map((row) => row.slice());
                const Y = P.Y.map((row) => row.slice());
                const Xc = JSON.stringify(X), Yc = JSON.stringify(Y);
                m.run(X, Y, P.labels);
                assert.equal(JSON.stringify(X), Xc, `${m.name} mutated X`);
                assert.equal(JSON.stringify(Y), Yc, `${m.name} mutated Y`);
            });

            it(m.stochastic
                ? "is invariant under row permutation, in distribution"
                : "is invariant under row permutation", () => {
                const perm = [...P.X.keys()].reverse();
                const p = m.run(
                    perm.map((i) => P.X[i]),
                    perm.map((i) => P.Y[i]),
                    perm.map((i) => P.labels[i]),
                );
                const tolerance = m.stochastic ?? 1e-9 * Math.max(1, Math.abs(r.value));
                assert.ok(
                    Math.abs(p.value - r.value) <= tolerance,
                    `${m.name}: ${p.value} vs ${r.value} after permuting rows` +
                    (m.stochastic ? ` (stochastic band ${m.stochastic})` : ""),
                );
            });

            if (m.higherIsBetter !== undefined) {
                it(`scores a faithful projection ${m.higherIsBetter ? "higher" : "lower"} than a poor one`, () => {
                    const g = m.run(G.X, G.Y, G.labels).value;
                    const b = m.run(P.X, P.Y, P.labels).value;
                    assert.ok(
                        m.higherIsBetter ? g > b : g < b,
                        `${m.name}: faithful=${g}, poor=${b} -- the metric points the wrong way`,
                    );
                });
            }
        });
    }

    it("covers every exported metric", () => {
        // Guards against adding a metric and forgetting to register it here.
        const exported = [
            "trustworthiness", "continuity", "aucLogRnx", "stress", "scaleNormalizedStress",
            "pearsonR", "silhouette", "calinskiHarabasz", "distanceConsistency",
            "averageBetweenWithin", "hypothesisMargin",
            "sammonStress", "curvilinearStress", "nerv",
            "mrreFalse", "mrreMissing", "residualVariance", "spearmanRho",
            "neighborhoodHit", "classificationError", "dunnIndex", "daviesBouldin",
            "gabrielClassificationError", "steadiness", "cohesiveness", "topologicalH0", "tripletAccuracy", "densityPreservation", "topologicalH1",
        ];
        const registered = new Set(METRICS.map((m) => m.name));
        for (const name of exported) {
            assert.ok(registered.has(name), `${name} is exported but has no contract test`);
        }
    });
});
