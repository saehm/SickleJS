/**
 * H0 topological quality, against ripser and gudhi.
 *
 * `test/fixtures/topology.json` is produced by `tools/topology-reference.py`.
 * It pins three things: the H0 death times (to confirm the MST identity this
 * implementation rests on), and the bottleneck and Wasserstein distances between
 * the two diagrams.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const DATA = join(DIR, "data");

const reference = JSON.parse(readFileSync(join(DIR, "topology.json"), "utf8")) as {
    fixtures: Record<string, {
        hd_deaths: number[]; ld_deaths: number[];
        bottleneck: number; wasserstein1: number; wasserstein2: number;
    }>;
};
const manifest = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")) as Array<{
    name: string; description: string;
}>;

const csv = (p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => l.split(",").map(Number));
const load = (name: string) => ({
    hd: sickle.toVectors(csv(join(DATA, `${name}.X.csv`))),
    ld: sickle.toVectors(csv(join(DATA, `${name}.Y.csv`))),
});

const close = (got: number, want: number, tol: number, what: string) =>
    assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)),
        `${what}: got ${got}, reference ${want}, diff ${Math.abs(got - want)}`);

describe("H0 persistence vs ripser / gudhi", () => {
    for (const { name, description } of manifest) {
        const ref = reference.fixtures[name];
        if (!ref) continue;

        describe(`${name} -- ${description}`, () => {
            const { hd, ld } = load(name);

            it("H0 deaths are the MST edge lengths", () => {
                // The identity the whole module rests on, cross-checked against
                // an independent MST and, through it, against ripser.
                for (const [diagram, want] of [
                    [sickle.persistenceH0(hd), ref.hd_deaths] as const,
                    [sickle.persistenceH0(ld), ref.ld_deaths] as const,
                ]) {
                    assert.equal(diagram.deaths.length, want.length);
                    for (let i = 0; i < want.length; ++i) {
                        close(diagram.deaths[i], want[i], 1e-12, `death[${i}]`);
                    }
                }
            });

            it("bottleneck distance matches gudhi", () => {
                close(sickle.topologicalH0(hd, ld).value, ref.bottleneck, 1e-12, "bottleneck");
            });

            it("Wasserstein distances match gudhi", () => {
                for (const [p, want] of [[1, ref.wasserstein1], [2, ref.wasserstein2]] as const) {
                    close(
                        sickle.topologicalH0(hd, ld, { distance: "wasserstein", p }).value,
                        want, 1e-10, `wasserstein-${p}`,
                    );
                }
            });
        });
    }
});

describe("H0 topological quality behaviour", () => {
    it("is zero for an identity projection", () => {
        const v = sickle.toVectors(csv(join(DATA, "blobs_pca.X.csv")));
        assert.equal(sickle.topologicalH0(v, v).value, 0);
        assert.equal(sickle.topologicalH0(v, v, { distance: "wasserstein" }).value, 0);
    });

    it("is zero under a uniform rescaling, by default", () => {
        // A projection's scale is arbitrary, so `scale: "diameter"` must ignore it.
        const X = csv(join(DATA, "blobs_pca.Y.csv"));
        const a = sickle.toVectors(X);
        const b = sickle.toVectors(X.map((row) => row.map((v) => v * 37.5)));
        assert.ok(sickle.topologicalH0(a, b).value < 1e-12);
        // Without normalisation the same pair is far apart.
        assert.ok(sickle.topologicalH0(a, b, { scale: "none" }).value > 1);
    });

    it("prefers a faithful projection", () => {
        const good = load("blobs_pca");
        const bad = load("blobs_random");
        assert.ok(
            sickle.topologicalH0(good.hd, good.ld).value <
            sickle.topologicalH0(bad.hd, bad.ld).value,
        );
    });

    it("satisfies its declared contract", () => {
        const { hd, ld } = load("blobs_pca");
        const r = sickle.topologicalH0(hd, ld);
        assert.equal(r.localKind, "share");
        assert.equal(sickle.checkContract(r), null);
    });

    it("does not mutate its inputs", () => {
        const { hd, ld } = load("blobs_pca");
        const before = hd.data.slice();
        sickle.topologicalH0(hd, ld);
        assert.deepEqual(hd.data, before);
    });

    it("notices a torn loop, which local measures miss", () => {
        // A circle cut open: every local neighbourhood survives, so
        // trustworthiness stays high, but the topology changed.
        const n = 120;
        const circle: number[][] = [], arc: number[][] = [];
        for (let i = 0; i < n; ++i) {
            const t = (2 * Math.PI * i) / n;
            circle.push([Math.cos(t), Math.sin(t)]);
            arc.push([i / n, 0]);            // unrolled into a line
        }
        const hd = sickle.toVectors(circle), ld = sickle.toVectors(arc);
        const cr = sickle.coRanking(hd, ld);
        assert.ok(sickle.trustworthiness(cr, 5) > 0.9, "trustworthiness should stay high");
        // H0 sees the change in merge scales even though H1 is what a loop lives in.
        assert.ok(sickle.topologicalH0(hd, ld).value > 0);
    });

    describe("diagram distances", () => {
        it("bottleneck prefers the diagonal when matching is worse", () => {
            // Matching costs |1 - 0.1| = 0.9; discarding both costs max/2 = 0.5.
            assert.equal(sickle.bottleneckH0([1], [0.1]), 0.5);
        });

        it("handles empty and unequal diagrams", () => {
            assert.equal(sickle.bottleneckH0([], []), 0);
            assert.equal(sickle.wassersteinH0([], []), 0);
            assert.equal(sickle.bottleneckH0([0.4], []), 0.2);
        });

        it("rejects p below 1", () => {
            assert.throws(() => sickle.wassersteinH0([1], [2], 0.5), /at least 1/);
        });
    });
});
