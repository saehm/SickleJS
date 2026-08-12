/**
 * Degree-1 persistent homology, against ripser and gudhi.
 *
 * `test/fixtures/rips.json` holds point clouds with known loop structure and
 * ripser's H1 diagram for each; `test/fixtures/bottleneck.json` holds random
 * diagram pairs with gudhi's bottleneck distance. Both are committed, so these
 * tests need no Python.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import { lcg } from "./fixtures.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const rips = JSON.parse(readFileSync(join(DIR, "rips.json"), "utf8")) as
    Record<string, { points: number[][]; h1: number[][] }>;
const bottleneckCases = JSON.parse(readFileSync(join(DIR, "bottleneck.json"), "utf8")) as
    Array<{ a: [number, number][]; b: [number, number][]; d: number }>;

/** Drop zero-persistence features, which sit on the diagonal either way. */
const real = (dgm: number[][]) => dgm.filter(([b, d]) => d - b > 1e-9);

describe("Vietoris-Rips H1 vs ripser", () => {
    for (const [name, c] of Object.entries(rips)) {
        it(`${name} (n=${c.points.length})`, () => {
            const mine = real(sickle.ripsH1(sickle.toVectors(c.points)));
            const theirs = real(c.h1);
            assert.equal(mine.length, theirs.length,
                `feature count: ${mine.length} vs ripser ${theirs.length}`);
            for (let i = 0; i < mine.length; ++i) {
                assert.ok(Math.abs(mine[i][0] - theirs[i][0]) < 1e-5,
                    `${name}[${i}] birth: ${mine[i][0]} vs ${theirs[i][0]}`);
                assert.ok(Math.abs(mine[i][1] - theirs[i][1]) < 1e-5,
                    `${name}[${i}] death: ${mine[i][1]} vs ${theirs[i][1]}`);
            }
        });
    }
});

describe("bottleneck distance for general diagrams vs gudhi", () => {
    it("matches on random diagram pairs", () => {
        for (const [i, c] of bottleneckCases.entries()) {
            const got = sickle.bottleneckDistance(c.a, c.b);
            assert.ok(Math.abs(got - c.d) < 1e-12,
                `case ${i}: got ${got}, gudhi ${c.d}`);
        }
    });

    it("is zero between a diagram and itself", () => {
        assert.equal(sickle.bottleneckDistance(bottleneckCases[0].a, bottleneckCases[0].a), 0);
    });

    it("handles empty diagrams", () => {
        assert.equal(sickle.bottleneckDistance([], []), 0);
        // A lone point must be matched to the diagonal: half its persistence.
        assert.equal(sickle.bottleneckDistance([[1, 3]], []), 1);
    });
});

describe("H1 topological quality", () => {
    /** A noisy circle and the same circle cut open into an arc. */
    function loopAndArc(n = 50) {
        const rnd = lcg(9);
        const circle: number[][] = [], arc: number[][] = [];
        for (let i = 0; i < n; ++i) {
            const t = (2 * Math.PI * i) / n;
            circle.push([Math.cos(t) + (rnd() - 0.5) * 0.04, Math.sin(t) + (rnd() - 0.5) * 0.04]);
            arc.push([i / n, (rnd() - 0.5) * 0.01]);
        }
        return { circle, arc };
    }

    it("is zero for an identity projection", () => {
        const { circle } = loopAndArc(40);
        const v = sickle.toVectors(circle);
        assert.equal(sickle.topologicalH1(v, v).value, 0);
    });

    it("is zero under a uniform rescaling", () => {
        const { circle } = loopAndArc(40);
        const a = sickle.toVectors(circle);
        const b = sickle.toVectors(circle.map((p) => p.map((x) => x * 8)));
        assert.ok(sickle.topologicalH1(a, b).value < 1e-12);
    });

    it("catches a torn loop that every other measure calls good", () => {
        // This is the case H1 exists for. Unrolling a circle into a line keeps
        // every local neighbourhood, so the rank- and distance-based measures
        // are satisfied; the hole is gone all the same.
        const { circle, arc } = loopAndArc(50);
        const hd = sickle.toVectors(circle), ld = sickle.toVectors(arc);

        const cr = sickle.coRanking(hd, ld);
        assert.ok(sickle.trustworthiness(cr, 5) > 0.9, "trustworthiness stays high");
        assert.ok(sickle.topologicalH0(hd, ld).value < 0.1, "H0 barely notices");

        const h1 = sickle.topologicalH1(hd, ld);
        assert.equal(h1.hdDiagram.length, 1, "the circle has one loop");
        assert.equal(h1.ldDiagram.length, 0, "the arc has none");
        assert.ok(h1.value > 0.2, `H1 should flag it, got ${h1.value}`);
    });

    it("preserves a loop that survives projection", () => {
        // A circle embedded in 5-D, projected back to its own plane.
        const rnd = lcg(4);
        const n = 45;
        const hd: number[][] = [], ld: number[][] = [];
        for (let i = 0; i < n; ++i) {
            const t = (2 * Math.PI * i) / n;
            const x = Math.cos(t), y = Math.sin(t);
            hd.push([x, y, rnd() * 0.01, rnd() * 0.01, rnd() * 0.01]);
            ld.push([x, y]);
        }
        const value = sickle.topologicalH1(sickle.toVectors(hd), sickle.toVectors(ld)).value;
        assert.ok(value < 0.05, `a preserved loop should score near 0, got ${value}`);
    });

    it("refuses point counts it cannot enumerate", () => {
        const big = sickle.toVectors(Array.from({ length: 50 }, (_, i) => [i, i * 2]));
        assert.throws(() => sickle.ripsH1(big, { maxPoints: 20 }), /maxPoints/);
    });

    it("computes the enclosing radius, above which homology is trivial", () => {
        const { circle } = loopAndArc(30);
        const v = sickle.toVectors(circle);
        const radius = sickle.enclosingRadius(v);
        assert.ok(radius > 0 && Number.isFinite(radius));
        // Thresholding above it cannot change the answer.
        assert.deepEqual(
            sickle.ripsH1(v, { threshold: radius }),
            sickle.ripsH1(v, { threshold: radius * 1.5 }),
        );
    });
});
