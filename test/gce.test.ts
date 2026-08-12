/**
 * Gabriel Classification Error, against the DRquality reference.
 *
 * `test/fixtures/gce.json` is produced by `tools/gce-reference.R`, which runs the
 * GPL-3 R package as a black box. Only its numbers are committed — running a
 * program does not make its output GPL, and measurements are facts rather than
 * expression, so no DRquality code is distributed here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const DATA = join(DIR, "data");

const reference = JSON.parse(readFileSync(join(DIR, "gce.json"), "utf8")) as {
    fixtures: Record<string, { gce: number; gce_perpoint: (number | null)[]; anz_nn: number[]; nn: number }>;
};
const manifest = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")) as Array<{
    name: string; description: string;
}>;

const csv = (p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => l.split(",").map(Number));

function load(name: string) {
    return {
        hd: sickle.toVectors(csv(join(DATA, `${name}.X.csv`))),
        ld: sickle.toVectors(csv(join(DATA, `${name}.Y.csv`))),
        labels: readFileSync(join(DATA, `${name}.labels.csv`), "utf8").trim().split("\n").map(Number),
    };
}

/**
 * `duplicates` contains coincident points, which sit exactly on the boundary of
 * the Gabriel empty-disc test. This implementation excludes them (strict `<`);
 * spdep, which DRquality uses, includes them, giving a denser graph. That is a
 * tie-breaking convention on a degenerate configuration, the same class of
 * disagreement as the rank ties in `parity.test.ts`, and it is documented rather
 * than hidden behind a loose tolerance.
 */
const COINCIDENT_POINTS = "duplicates";

describe("Gabriel Classification Error vs DRquality", () => {
    for (const { name, description } of manifest) {
        const ref = reference.fixtures[name];
        if (!ref || name === COINCIDENT_POINTS) continue;

        describe(`${name} -- ${description}`, () => {
            const { hd, ld, labels } = load(name);
            const got = sickle.gabrielClassificationError(hd, ld, labels);

            it("matches the reference value", () => {
                const diff = Math.abs(got.value - ref.gce);
                assert.ok(diff <= 1e-12 * Math.max(1, Math.abs(ref.gce)),
                    `GCE: got ${got.value}, DRquality ${ref.gce}, diff ${diff}`);
            });

            it("builds the same Gabriel graph", () => {
                const degree = new Array(ld.n).fill(0);
                for (const [i, j] of sickle.gabrielEdges(ld)) { degree[i] += 1; degree[j] += 1; }
                assert.deepEqual(degree, ref.anz_nn, "per-point Gabriel degree differs");
                assert.equal(Math.max(...degree), ref.nn);
            });

            it("excludes exactly the leaves the reference drops", () => {
                // DRquality divides by `kj - 1`, so a point with one Gabriel
                // neighbour yields NaN and is removed by `na.rm = TRUE`.
                const nullIndices = ref.gce_perpoint
                    .map((v, i) => (typeof v === "number" ? -1 : i))
                    .filter((i) => i >= 0);
                assert.deepEqual(Array.from(got.excluded), nullIndices);
                assert.equal(got.counted, ld.n - nullIndices.length);
            });

            it("matches the reference point by point", () => {
                for (let i = 0; i < ld.n; ++i) {
                    const want = ref.gce_perpoint[i];
                    if (typeof want !== "number") {
                        assert.ok(Number.isNaN(got.local![i]), `point ${i} should be excluded`);
                        continue;
                    }
                    const diff = Math.abs(got.local![i] - want);
                    assert.ok(diff <= 1e-12 * Math.max(1, Math.abs(want)),
                        `point ${i}: got ${got.local![i]}, DRquality ${want}`);
                }
            });
        });
    }

    it("documents the coincident-point divergence", () => {
        const { hd, ld, labels } = load(COINCIDENT_POINTS);
        const got = sickle.gabrielClassificationError(hd, ld, labels);
        const ref = reference.fixtures[COINCIDENT_POINTS];
        assert.notEqual(got.value, ref.gce, "fixture no longer has coincident points");
        // Same measure, different empty-disc tie-breaking: stay in the same range.
        assert.ok(Math.abs(got.value - ref.gce) < 0.5,
            `divergence ${Math.abs(got.value - ref.gce)} is larger than tie-breaking explains`);
    });
});

describe("Gabriel graph strategies", () => {
    // The fast path assumes the triangulation is well defined; coincident points
    // break that, which is why `auto` falls back. Everywhere else the two must
    // agree exactly, or the fast path is silently wrong.
    for (const { name } of manifest) {
        const ld = sickle.toVectors(csv(join(DATA, `${name}.Y.csv`)));
        const hasDuplicates = name === COINCIDENT_POINTS;

        it(`${name}: fast and exact ${hasDuplicates ? "differ (coincident points)" : "agree"}`, () => {
            const fast = sickle.gabrielEdges(ld, "fast").map(String).sort();
            const exact = sickle.gabrielEdges(ld, "exact").map(String).sort();
            if (hasDuplicates) assert.notDeepEqual(fast, exact);
            else assert.deepEqual(fast, exact);
        });

        it(`${name}: auto picks the right one`, () => {
            const auto = sickle.gabrielEdges(ld).map(String).sort();
            const want = sickle.gabrielEdges(ld, hasDuplicates ? "exact" : "fast").map(String).sort();
            assert.deepEqual(auto, want);
        });
    }

    it("agrees on random point sets", () => {
        for (const n of [200, 500]) {
            let s = n;
            const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
            const data = new Float64Array(n * 2);
            for (let i = 0; i < n * 2; ++i) data[i] = rnd();
            const ld = { data, n, d: 2 };
            assert.deepEqual(
                sickle.gabrielEdges(ld, "fast").map(String).sort(),
                sickle.gabrielEdges(ld, "exact").map(String).sort(),
                `fast and exact disagree at n=${n}`,
            );
        }
    });
});
