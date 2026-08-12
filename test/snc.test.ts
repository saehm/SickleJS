/**
 * Steadiness & Cohesiveness against zadu.
 *
 * S&C is the one stochastic measure in this library, so it cannot be checked by
 * equality. `test/fixtures/snc.json` records a *distribution* — mean, standard
 * deviation and range over 12 zadu runs with `clustering_strategy="kmeans"` —
 * and these tests assert agreement in those terms, plus the invariants that must
 * hold regardless of the draw.
 *
 * A small systematic offset is expected and tolerated: sickle clusters with
 * DruidJS's k-means and zadu with scikit-learn's, so the extracted partitions
 * differ slightly even given the same walks. See `src/passes/NOTES-snc.md`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const DATA = join(DIR, "data");

interface Stats { mean: number; std: number; min: number; max: number }
const reference = JSON.parse(readFileSync(join(DIR, "snc.json"), "utf8")) as {
    _iterations: number;
    fixtures: Record<string, { steadiness: Stats; cohesiveness: Stats }>;
};
const manifest = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")) as Array<{
    name: string; description: string;
}>;

const csv = (p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => l.split(",").map(Number));
const load = (name: string) => ({
    hd: sickle.toVectors(csv(join(DATA, `${name}.X.csv`))),
    ld: sickle.toVectors(csv(join(DATA, `${name}.Y.csv`))),
});

/**
 * Absolute agreement band. zadu's own run-to-run spread is ~0.005; the residual
 * is the k-means difference. 0.05 is wide enough to absorb both and still far
 * tighter than the 0.7 range the measure spans across these fixtures, so a real
 * regression would break it.
 */
const TOLERANCE = 0.05;

describe("Steadiness & Cohesiveness vs zadu", () => {
    for (const { name, description } of manifest) {
        const ref = reference.fixtures[name];
        if (!ref) continue;

        it(`${name} -- ${description}`, () => {
            const { hd, ld } = load(name);
            const got = sickle.snc(hd, ld, { iterations: reference._iterations, seed: 42 });

            for (const [key, stats] of [
                ["steadiness", ref.steadiness] as const,
                ["cohesiveness", ref.cohesiveness] as const,
            ]) {
                const value = got[key];
                assert.ok(
                    Math.abs(value - stats.mean) <= TOLERANCE,
                    `${name}.${key}: sickle ${value.toFixed(4)}, zadu ${stats.mean.toFixed(4)} ` +
                    `+/- ${stats.std.toFixed(4)} (range ${stats.min.toFixed(4)}..${stats.max.toFixed(4)})`,
                );
            }
        });
    }

    it("ranks the fixtures the same way zadu does", () => {
        // Stronger than any individual value: the measure must order projections
        // identically, which is what it is actually used for.
        const mine: Array<[string, number]> = [];
        const theirs: Array<[string, number]> = [];
        for (const { name } of manifest) {
            const ref = reference.fixtures[name];
            if (!ref) continue;
            const { hd, ld } = load(name);
            mine.push([name, sickle.snc(hd, ld, { iterations: 100, seed: 42 }).steadiness]);
            theirs.push([name, ref.steadiness.mean]);
        }
        const order = (xs: Array<[string, number]>) =>
            [...xs].sort((a, b) => a[1] - b[1]).map(([n]) => n);
        assert.deepEqual(order(mine), order(theirs));
    });
});

describe("Steadiness & Cohesiveness invariants", () => {
    it("is exactly 1 for an identity projection", () => {
        // No cluster can be distorted when the two spaces coincide.
        const v = sickle.toVectors(csv(join(DATA, "blobs_pca.X.csv")));
        const got = sickle.snc(v, v, { iterations: 40, seed: 7 });
        assert.equal(got.steadiness, 1);
        assert.equal(got.cohesiveness, 1);
    });

    it("scores a faithful projection above a random one", () => {
        const good = load("blobs_pca");
        const bad = load("blobs_random");
        const g = sickle.snc(good.hd, good.ld, { iterations: 60, seed: 3 });
        const b = sickle.snc(bad.hd, bad.ld, { iterations: 60, seed: 3 });
        assert.ok(g.steadiness > b.steadiness, `${g.steadiness} vs ${b.steadiness}`);
        assert.ok(g.cohesiveness > b.cohesiveness, `${g.cohesiveness} vs ${b.cohesiveness}`);
    });

    it("stays within [0,1]", () => {
        for (const { name } of manifest) {
            const { hd, ld } = load(name);
            const got = sickle.snc(hd, ld, { iterations: 40, seed: 11 });
            for (const key of ["steadiness", "cohesiveness"] as const) {
                assert.ok(got[key] >= 0 && got[key] <= 1, `${name}.${key} = ${got[key]}`);
            }
        }
    });

    it("is reproducible for a given seed", () => {
        const { hd, ld } = load("blobs_pca");
        const a = sickle.snc(hd, ld, { iterations: 40, seed: 99 });
        const b = sickle.snc(hd, ld, { iterations: 40, seed: 99 });
        assert.equal(a.steadiness, b.steadiness);
        assert.equal(a.cohesiveness, b.cohesiveness);
    });

    it("varies little across seeds, and less as iterations grow", () => {
        const { hd, ld } = load("blobs_pca");
        const spread = (iterations: number) => {
            const vs = [1, 2, 3, 4, 5].map((seed) => sickle.snc(hd, ld, { iterations, seed }).steadiness);
            return Math.max(...vs) - Math.min(...vs);
        };
        const few = spread(25);
        const many = spread(150);
        assert.ok(many < 0.02, `spread at 150 iterations is ${many}`);
        assert.ok(many <= few + 0.01, `more iterations should not widen the spread: ${few} -> ${many}`);
    });

    it("does not mutate its inputs", () => {
        const { hd, ld } = load("blobs_pca");
        const before = hd.data.slice();
        sickle.snc(hd, ld, { iterations: 20, seed: 5 });
        assert.deepEqual(hd.data, before);
    });

    it("reports per-point contributions on request", () => {
        const { hd, ld } = load("blobs_pca");
        const got = sickle.snc(hd, ld, { iterations: 40, seed: 5, local: true });
        assert.equal(got.localSteadiness?.length, hd.n);
        assert.equal(got.localCohesiveness?.length, hd.n);
        for (const v of got.localSteadiness!) assert.ok(v >= 0 && v <= 1, `local value ${v}`);
    });

    it("refuses datasets too large for its N x N similarity matrices", () => {
        const big = sickle.toVectors(Array.from({ length: 40 }, (_, i) => [i, i]));
        assert.throws(() => sickle.snc(big, big, { maxPoints: 10 }), /maxPoints/);
    });
});
