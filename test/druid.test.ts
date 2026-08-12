/**
 * DruidJS produces the projections this library scores, so the adapter path has
 * to work against the real Matrix type -- not just something Matrix-shaped.
 * druid is an optional peer dependency; skip cleanly if it is absent.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import { makeGoodFixture } from "./fixtures.ts";

let druid: typeof import("@saehrimnir/druidjs") | null = null;
try {
    druid = await import("@saehrimnir/druidjs");
} catch {
    /* optional */
}

// druid is an optional peer dependency: skip cleanly when absent.
describe.skipIf(!druid)("DruidJS integration", () => {
    const d = druid!;

    it("adapts a Matrix without copying", () => {
        const M = d.Matrix.from([[0, 0], [1, 0], [0, 1], [1, 1]]);
        const v = sickle.toVectors(M);
        assert.equal(v.n, 4);
        assert.equal(v.d, 2);
        assert.equal(v.data, M.values, "adapter should alias druid's buffer, not copy it");
    });

    it("scores a real PCA projection, and never mutates the Matrix", () => {
        const { X } = makeGoodFixture(120, 8);
        const M = d.Matrix.from(X);
        const P = d.PCA.transform(M, { d: 2 }) as InstanceType<typeof d.Matrix>;

        const hdBefore = M.values.slice();
        const ldBefore = P.values.slice();

        const cr = sickle.coRanking(sickle.toVectors(M), sickle.toVectors(P), { localK: [10] });

        assert.deepEqual(M.values, hdBefore, "high-dimensional Matrix was mutated");
        assert.deepEqual(P.values, ldBefore, "projection Matrix was mutated");

        const t = sickle.trustworthiness(cr, 10);
        const c = sickle.continuity(cr, 10);
        assert.ok(t > 0 && t <= 1, `trustworthiness out of range: ${t}`);
        assert.ok(c > 0 && c <= 1, `continuity out of range: ${c}`);

        // A structure-preserving projection must beat a random one.
        const rnd = d.Matrix.from(X.map((_, i) => [Math.sin(i * 7.3), Math.cos(i * 3.1)]));
        const crRnd = sickle.coRanking(sickle.toVectors(M), sickle.toVectors(rnd));
        assert.ok(
            sickle.aucLogRnx(cr) > sickle.aucLogRnx(crRnd),
            "PCA should score above a random projection",
        );
    });

    it("agrees whether fed a Matrix or the equivalent number[][]", () => {
        const { X, Y } = makeGoodFixture(90, 6);
        const a = sickle.coRanking(sickle.toVectors(d.Matrix.from(X)), sickle.toVectors(d.Matrix.from(Y)));
        const b = sickle.coRanking(sickle.toVectors(X), sickle.toVectors(Y));
        assert.equal(sickle.trustworthiness(a, 10), sickle.trustworthiness(b, 10));
        assert.equal(sickle.aucLogRnx(a), sickle.aucLogRnx(b));
    });
});
