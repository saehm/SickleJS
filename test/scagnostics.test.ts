/**
 * Scagnostics: comparison against upstream ScagnosticsJS.
 *
 * `test/fixtures/scagnostics.json` is a snapshot of the upstream implementation's
 * output, produced by `tools/scagnostics-reference.mjs`. It is committed so this
 * test needs neither the original repository nor its dependencies.
 *
 * Seven of the nine measures must match upstream exactly. `convex` and `skinny`
 * are allowed a bounded deviation because upstream triangulates the hulls with a
 * different library than it uses for the MST; see src/scagnostics/NOTES.md.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const DATA = join(DIR, "data");

const reference = JSON.parse(readFileSync(join(DIR, "scagnostics.json"), "utf8")) as {
    fixtures: Record<string, Record<sickle.ScagnosticName, number>>;
};
const manifest = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")) as Array<{
    name: string; description: string;
}>;

/** Derived from the MST alone: must be identical to upstream. */
const EXACT: sickle.ScagnosticName[] = [
    "outlying", "skewed", "clumpy", "sparse", "striated", "stringy", "monotonic",
];
/** Derived from the alpha hull: bounded deviation, see NOTES.md. */
const HULL_TOLERANCE: Record<string, number> = { convex: 0.01, skinny: 0.03 };

function loadProjection(name: string) {
    return sickle.toVectors(
        readFileSync(join(DATA, `${name}.Y.csv`), "utf8")
            .trim().split("\n").map((l) => l.split(",").map(Number)),
    );
}

describe("scagnostics vs upstream ScagnosticsJS", () => {
    for (const { name, description } of manifest) {
        const ref = reference.fixtures[name];
        if (!ref) continue;

        describe(`${name} -- ${description}`, () => {
            const got = sickle.scagnostics(loadProjection(name));

            it("matches upstream exactly on the MST-derived measures", () => {
                for (const measure of EXACT) {
                    assert.equal(
                        got[measure], ref[measure],
                        `${measure}: got ${got[measure]}, upstream ${ref[measure]}`,
                    );
                }
            });

            it("stays close to upstream on the hull-derived measures", () => {
                for (const [measure, tol] of Object.entries(HULL_TOLERANCE)) {
                    const m = measure as sickle.ScagnosticName;
                    const diff = Math.abs(got[m] - ref[m]);
                    assert.ok(
                        diff <= tol,
                        `${measure}: got ${got[m]}, upstream ${ref[m]}, diff ${diff} > ${tol}. ` +
                        "A larger gap means more than the known triangulator difference.",
                    );
                }
            });
        });
    }
});

describe("scagnostics behaviour", () => {
    it("is deterministic", () => {
        const ld = loadProjection("blobs_pca");
        assert.deepEqual(sickle.scagnostics(ld), sickle.scagnostics(ld));
    });

    it("does not mutate the projection", () => {
        const ld = loadProjection("blobs_pca");
        const before = ld.data.slice();
        sickle.scagnostics(ld);
        assert.deepEqual(ld.data, before);
    });

    it("rejects data that is not 2-dimensional", () => {
        assert.throws(
            () => sickle.scagnostics(sickle.toVectors([[1, 2, 3], [4, 5, 6], [7, 8, 9]])),
            /requires 2-dimensional/,
        );
    });

    it("exposes each measure through the shared result shape", () => {
        const ld = loadProjection("blobs_pca");
        for (const measure of sickle.SCAGNOSTIC_NAMES) {
            const r = sickle.scagnostic(ld, measure);
            assert.equal(r.localKind, "none", `${measure} must not claim a per-point decomposition`);
            assert.equal(sickle.checkContract(r), null);
        }
    });

    it("handles collinear points without throwing", () => {
        const pts = Array.from({ length: 60 }, (_, i) => [i, 2 * i]);
        const s = sickle.scagnostics(sickle.toVectors(pts));
        for (const m of sickle.SCAGNOSTIC_NAMES) {
            assert.ok(Number.isFinite(s[m]), `${m} = ${s[m]} on collinear input`);
        }
    });

    it("keeps every measure inside [0,1]", () => {
        for (const { name } of manifest) {
            const s = sickle.scagnostics(loadProjection(name));
            for (const m of sickle.SCAGNOSTIC_NAMES) {
                assert.ok(s[m] >= 0 && s[m] <= 1, `${m} = ${s[m]} on ${name} is outside [0,1]`);
            }
        }
    });
});

describe("monotonic, which upstream gets wrong", () => {
    // Upstream computes Spearman via the sum-of-d^2 shortcut plus a tie
    // correction. That combination can leave [-1,1], so `rho^2` can exceed 1.
    // Here the correlation is Pearson's r on average ranks. See NOTES.md.
    it("is exactly 1 for any monotone relationship", () => {
        const n = 200;
        for (const f of [(i: number) => i, (i: number) => -i, (i: number) => i ** 3]) {
            const pts = Array.from({ length: n }, (_, i) => [i, f(i)]);
            const v = sickle.scagnostics(sickle.toVectors(pts)).monotonic;
            assert.ok(Math.abs(v - 1) < 1e-9, `expected 1, got ${v}`);
        }
    });

    it("stays in range on the input where upstream returned 5.38", () => {
        let s = 42;
        const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
        const pts = Array.from({ length: 300 }, () => [rnd() * 10, rnd() * 10 + 0.3 * rnd()]);
        const v = sickle.scagnostics(sickle.toVectors(pts)).monotonic;
        assert.ok(v >= 0 && v <= 1, `monotonic = ${v} is outside [0,1]`);
    });
});
