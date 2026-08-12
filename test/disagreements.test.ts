/**
 * The disagreement gallery, as assertions.
 *
 * The docs page says "every case below is lifted from a passing test, so the
 * numbers beside the plots are numbers an assertion holds for". This file is
 * what makes that sentence true: it builds the same points from
 * `test/cases.mjs` and asserts the relationship each case exists to show.
 *
 * The bounds are deliberately loose. Pinning the exact values would duplicate
 * the precompute and break on any harmless change; what has to hold is the
 * *contradiction* — one measure content, another alarmed.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import {
    compressedGaps,
    densityFlattened,
    falseSeparation,
    groupSplit,
    loopAndArc,
    strayPoints,
} from "./cases.mjs";

const V = (rows: number[][]) => sickle.toVectors(rows);

describe("a circle unrolled into an arc", () => {
    const { hd, ld } = loopAndArc(50);
    const H = V(hd), L = V(ld);

    it("keeps every neighbourhood, and loses the loop", () => {
        const cr = sickle.coRanking(H, L);
        const h1 = sickle.topologicalH1(H, L);

        assert.ok(sickle.trustworthiness(cr, 5) > 0.95, "trustworthiness should stay high");
        assert.ok(sickle.topologicalH0(H, L).value < 0.05, "H0 should barely move");

        assert.equal(h1.hdDiagram.length, 1, "the circle has one loop");
        assert.equal(h1.ldDiagram.length, 0, "the arc has none");
        assert.ok(h1.value > 0.3, `H1 should be alarmed, got ${h1.value}`);
    });
});

describe("a tight cluster inflated to match a diffuse one", () => {
    const { hd, ld } = densityFlattened();
    const H = V(hd), L = V(ld);

    it("keeps every neighbourhood, and flattens the density contrast", () => {
        const cr = sickle.coRanking(H, L);
        const a = sickle.analyze(H, L, { densityK: 5 });

        assert.ok(sickle.trustworthiness(cr, 5) > 0.9, "trustworthiness should stay high");
        assert.ok(
            sickle.densityPreservation(a.structure).value < 0.5,
            "density preservation should drop",
        );
    });
});

describe("one real group drawn as two", () => {
    const { hd, ld } = groupSplit();
    const H = V(hd), L = V(ld);

    it("is invisible point-by-point and obvious cluster-by-cluster", () => {
        const cr = sickle.coRanking(H, L);
        const s = sickle.snc(H, L, { iterations: 200, seed: 42 });

        assert.ok(sickle.trustworthiness(cr, 10) > 0.99, "trustworthiness should stay high");
        assert.ok(s.cohesiveness < 0.4, `cohesiveness should collapse, got ${s.cohesiveness}`);
        // The direction matters: nothing was merged, something was split.
        assert.ok(
            s.steadiness > s.cohesiveness,
            `steadiness ${s.steadiness} should exceed cohesiveness ${s.cohesiveness}`,
        );
    });
});

describe("classes drawn cleanly apart that overlap in the data", () => {
    const { hd, ld, labels } = falseSeparation();
    const H = V(hd), L = V(ld);

    it("fools every separability measure that sees only the projection", () => {
        const cl = sickle.clusters(L, labels);
        assert.ok(sickle.silhouette(L, cl).value > 0.9, "silhouette should be high");
        assert.equal(sickle.distanceConsistency(L, cl).value, 1);
        assert.equal(sickle.neighborhoodHit(L, labels, 10).value, 1);
    });

    it("is caught by trustworthiness, and not by GCE", () => {
        const t = sickle.trustworthiness(sickle.coRanking(H, L), 10);
        assert.ok(t < 0.7, `trustworthiness should fall, got ${t}`);

        // GCE weights a cross-class edge by how far apart the pair really is,
        // and here the classes genuinely overlap, so those edges are cheap.
        const gce = sickle.gabrielClassificationError(H, L, labels).value;
        assert.ok(gce < 0.1, `GCE should stay low here, got ${gce}`);
    });
});

describe("a few points drawn inside the wrong class", () => {
    const strayed = strayPoints(6);
    const clean = strayPoints(0);

    it("moves GCE far more than any projection-only measure", () => {
        const L = V(strayed.ld), H = V(strayed.hd);
        const cl = sickle.clusters(L, strayed.labels);

        // Everything that sees only the picture still calls it good.
        assert.ok(sickle.silhouette(L, cl).value > 0.85);
        assert.ok(sickle.distanceConsistency(L, cl).value > 0.97);
        assert.ok(sickle.neighborhoodHit(L, strayed.labels, 10).value > 0.95);

        const gce = sickle.gabrielClassificationError(H, L, strayed.labels).value;
        const baseline = sickle.gabrielClassificationError(
            V(clean.hd), V(clean.ld), clean.labels,
        ).value;
        assert.ok(
            gce > 8 * baseline,
            `GCE should jump: ${gce} vs baseline ${baseline}`,
        );
    });
});

describe("cluster gaps compressed, orderings intact", () => {
    const { hd, ld } = compressedGaps();
    const H = V(hd), L = V(ld);

    it("satisfies the rank measures and not the metric ones", () => {
        const a = sickle.analyze(H, L);
        const snStress = sickle.scaleNormalizedStress(a.moments).value;
        const nonMetric = sickle.nonMetricStress(H, L).value;
        const rho = sickle.spearmanRho(H, L).value;

        assert.ok(rho > 0.999, `orderings should survive, Spearman ${rho}`);
        assert.ok(nonMetric < 0.02, `non-metric stress should be tiny, got ${nonMetric}`);
        assert.ok(snStress > 0.1, `scale-normalised stress should not be, got ${snStress}`);
        assert.ok(
            snStress > 10 * nonMetric,
            `the gap is the point: ${snStress} vs ${nonMetric}`,
        );
    });

    it("really is a monotone transform, unlike a radial warp", () => {
        /*
         * The case this replaced warped the radius about the origin, which is
         * monotone in the radius and says nothing about pairwise distances: it
         * scored Spearman 0.963 while the page claimed every ordering held.
         */
        const rnd = (() => { let s = 17 >>> 0; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
        const rh: number[][] = [], rl: number[][] = [];
        for (let i = 0; i < 150; ++i) {
            const x = rnd() * 6 - 3, y = rnd() * 6 - 3;
            rh.push([x, y]);
            const rad = Math.hypot(x, y);
            const f = rad === 0 ? 0 : Math.sqrt(rad) / rad;
            rl.push([x * f, y * f]);
        }
        const warped = sickle.spearmanRho(V(rh), V(rl)).value;
        const kept = sickle.spearmanRho(H, L).value;
        assert.ok(warped < 0.98, `the radial warp does not preserve orderings: ${warped}`);
        assert.ok(kept > warped, "the replacement does");
    });
});
