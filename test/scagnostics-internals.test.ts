/*
 * The pieces the nine scagnostics are assembled from.
 *
 * `scagnostics.test.ts` checks the nine measures against the upstream
 * reference, which catches a wrong answer but not a wrong reason: the union-
 * find, the quantile definition and the unique-point fallback are all shared,
 * so a defect in one moves several measures at once and the fixture comparison
 * cannot say which.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DisjointSet } from "../src/scagnostics/graph.ts";
import { quantile, quantileSorted, quantiles } from "../src/scagnostics/quantile.ts";
import { countUnique, normalize, uniquePoints } from "../src/scagnostics/binning.ts";
import * as sickle from "../src/index.ts";

describe("union-find", () => {
    it("joins and separates", () => {
        const ds = new DisjointSet(6);
        assert.notEqual(ds.find(0), ds.find(1));
        assert.equal(ds.union(0, 1), true);
        assert.equal(ds.find(0), ds.find(1));
        // Already joined: the second union is a no-op and reports it.
        assert.equal(ds.union(0, 1), false);
    });

    it("keeps components disjoint until they are merged", () => {
        const ds = new DisjointSet(6);
        ds.union(0, 1);
        ds.union(2, 3);
        assert.notEqual(ds.find(1), ds.find(3));
        ds.union(1, 2);
        assert.equal(ds.find(0), ds.find(3));
        assert.notEqual(ds.find(0), ds.find(5));
    });

    /*
     * A degenerate chain is what union by rank exists to avoid; the result must
     * be the same either way, which is the property worth pinning.
     */
    it("resolves a long chain to a single root", () => {
        const n = 500;
        const ds = new DisjointSet(n);
        for (let i = 1; i < n; ++i) assert.equal(ds.union(i - 1, i), true);
        const root = ds.find(0);
        for (let i = 0; i < n; ++i) assert.equal(ds.find(i), root);
    });
});

describe("the quantile definition", () => {
    /*
     * Pinned deliberately. `simple-statistics` v7 changed its interpolation and
     * silently moved `skewed` and `sparse`; the definition was written out here
     * instead of depending on a library that could change under it again.
     */
    it("averages the two middle values at an exact index on an even sample", () => {
        // The branch v7 changed: idx lands exactly on a boundary, n is even.
        assert.equal(quantileSorted([1, 2, 3, 4], 0.5), 2.5);
        assert.equal(quantileSorted([10, 20], 0.5), 15);
    });

    it("takes the upper value at an exact index on an odd sample", () => {
        assert.equal(quantileSorted([1, 2, 3, 4, 5], 0.2), 2);
    });

    it("rounds up between indices", () => {
        assert.equal(quantileSorted([1, 2, 3, 4, 5], 0.5), 3);
        assert.equal(quantileSorted([1, 2, 3, 4], 0.9), 4);
    });

    it("returns the ends exactly", () => {
        assert.equal(quantileSorted([4, 8, 15, 16], 0), 4);
        assert.equal(quantileSorted([4, 8, 15, 16], 1), 16);
    });

    it("refuses an empty sample and an out-of-range p", () => {
        assert.throws(() => quantileSorted([], 0.5), /at least one data point/);
        assert.throws(() => quantileSorted([1, 2], 1.5), /between 0 and 1/);
        assert.throws(() => quantileSorted([1, 2], -0.1), /between 0 and 1/);
    });

    it("sorts for you, and shares one sort across several p", () => {
        const unsorted = [5, 1, 4, 2, 3];
        assert.equal(quantile(unsorted, 0.5), 3);
        assert.deepEqual(quantiles(unsorted, [0, 0.5, 1]), [1, 3, 5]);
        // The input is not disturbed.
        assert.deepEqual(unsorted, [5, 1, 4, 2, 3]);
    });
});

describe("the unique-point fallback", () => {
    /*
     * Binning is skipped when the data has too few distinct values to fill a
     * grid; the sites are then the distinct points themselves, weighted by
     * multiplicity. Duplicate-heavy input is the case that takes this path.
     */
    it("collapses duplicates and keeps their multiplicity", () => {
        // normalize(flat xy pairs, n): three copies of (0,0) and one of (1,1).
        const p = normalize(Float64Array.from([0, 0, 0, 0, 1, 1, 0, 0]), 4);
        const bins = uniquePoints(p);
        assert.equal(bins.count, 2);
        assert.equal(bins.weight.length, 2);
        // Three copies of one point, one of the other.
        assert.deepEqual(Array.from(bins.weight).sort((a, b) => a - b), [1, 3]);
    });

    it("counts distinct values, which is what chooses the path", () => {
        const p = normalize(Float64Array.from([0, 0, 0, 0, 1, 1]), 3);
        assert.equal(countUnique(p), 2);
    });

    it("scagnostics runs on duplicate-heavy input rather than dividing by zero", () => {
        // Few distinct points: the fallback, an MST over 3 sites, and the
        // measures on top of it all have to survive.
        const pts: number[][] = [];
        for (let i = 0; i < 30; ++i) pts.push([i % 3, (i % 3) * 2]);
        const s = sickle.scagnostics(pts);
        for (const name of sickle.SCAGNOSTIC_NAMES) {
            assert.ok(Number.isFinite(s[name]), `${name} is not finite`);
        }
    });
});
