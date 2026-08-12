/**
 * Density preservation and triplet accuracy.
 *
 * Neither has a reference implementation to check against, so both are verified
 * against independent naive computations — and triplet accuracy additionally
 * against the sampling estimator it replaces, which is the check that matters:
 * the exhaustive answer must be what random sampling converges to.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import { lcg, makeFixture, makeGoodFixture, mean } from "./fixtures.ts";

const euclid = (a: number[], b: number[]) => {
    let s = 0;
    for (let i = 0; i < a.length; ++i) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
};

/** Triplet accuracy by brute force over every triplet. */
function refTripletAccuracy(X: number[][], Y: number[][]): number {
    const n = X.length;
    let ok = 0, total = 0;
    for (let i = 0; i < n; ++i) {
        for (let j = 0; j < n; ++j) {
            if (j === i) continue;
            for (let k = j + 1; k < n; ++k) {
                if (k === i) continue;
                const hd = euclid(X[i], X[j]) - euclid(X[i], X[k]);
                const ld = euclid(Y[i], Y[j]) - euclid(Y[i], Y[k]);
                if (hd < 0 === ld < 0) ok += 1;
                total += 1;
            }
        }
    }
    return ok / total;
}

/** The sampling estimator this measure replaces. */
function sampledTripletAccuracy(X: number[][], Y: number[][], draws: number, seed: number): number {
    const n = X.length;
    const rnd = lcg(seed);
    let ok = 0;
    for (let t = 0; t < draws; ++t) {
        const i = Math.floor(rnd() * n);
        let j = Math.floor(rnd() * n), k = Math.floor(rnd() * n);
        if (j === i) j = (j + 1) % n;
        if (k === i || k === j) k = (k + 2) % n;
        if (k === i || k === j) continue;
        const hd = euclid(X[i], X[j]) - euclid(X[i], X[k]);
        const ld = euclid(Y[i], Y[j]) - euclid(Y[i], Y[k]);
        if (hd < 0 === ld < 0) ok += 1;
    }
    return ok / draws;
}

function refLocalRadii(X: number[][], k: number): number[] {
    return X.map((p) => {
        const d = X.map((q) => euclid(p, q)).sort((a, b) => a - b);
        let s = 0;
        for (let t = 1; t <= k; ++t) s += d[t];
        return s / k;
    });
}

describe("triplet accuracy", () => {
    const { X, Y } = makeFixture(60, 5, 21);
    const a = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), { triplets: true });
    const r = sickle.tripletAccuracy(a.structure);

    it("equals the exhaustive brute-force count", () => {
        // The whole point: inversion counting must give the exact all-triplets
        // answer, not an approximation of it.
        const want = refTripletAccuracy(X, Y);
        assert.ok(Math.abs(r.value - want) < 1e-12, `got ${r.value}, brute force ${want}`);
    });

    it("is what random sampling converges to", () => {
        const sampled = sampledTripletAccuracy(X, Y, 400_000, 7);
        assert.ok(Math.abs(r.value - sampled) < 0.005,
            `exhaustive ${r.value}, sampled ${sampled}`);
    });

    it("satisfies its declared contract", () => {
        assert.equal(r.localKind, "mean");
        assert.equal(sickle.checkContract(r), null);
        assert.ok(Math.abs(mean(r.local!) - r.value) < 1e-12);
    });

    it("is 1 for an identity projection", () => {
        const v = sickle.toVectors(X);
        assert.equal(sickle.tripletAccuracy(sickle.analyze(v, v, { triplets: true }).structure).value, 1);
    });

    it("is near chance for an unrelated projection", () => {
        const rnd = lcg(5);
        const noise = X.map(() => [rnd(), rnd()]);
        const v = sickle.analyze(sickle.toVectors(X), sickle.toVectors(noise), { triplets: true });
        const value = sickle.tripletAccuracy(v.structure).value;
        assert.ok(Math.abs(value - 0.5) < 0.12, `expected ~0.5, got ${value}`);
    });

    it("prefers a faithful projection", () => {
        const good = makeGoodFixture(60, 5, 7);
        const g = sickle.tripletAccuracy(
            sickle.analyze(sickle.toVectors(good.X), sickle.toVectors(good.Y), { triplets: true }).structure).value;
        assert.ok(g > r.value, `faithful ${g} should beat poor ${r.value}`);
    });

    it("explains itself when the pass was run without it", () => {
        const plain = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y));
        assert.throws(() => sickle.tripletAccuracy(plain.structure), /without `triplets`/);
    });
});

describe("density preservation", () => {
    const { X, Y } = makeFixture(120, 5, 33);
    const K = 10;
    const a = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), { densityK: K });
    const r = sickle.densityPreservation(a.structure);

    it("computes the local radii correctly", () => {
        const wantH = refLocalRadii(X, K), wantL = refLocalRadii(Y, K);
        for (let i = 0; i < X.length; ++i) {
            assert.ok(Math.abs(r.radiusHigh[i] - wantH[i]) < 1e-12, `radiusHigh[${i}]`);
            assert.ok(Math.abs(r.radiusLow[i] - wantL[i]) < 1e-12, `radiusLow[${i}]`);
        }
    });

    it("is 1 for an identity projection", () => {
        const v = sickle.toVectors(X);
        const id = sickle.densityPreservation(sickle.analyze(v, v, { densityK: K }).structure);
        assert.ok(Math.abs(id.value - 1) < 1e-12, `got ${id.value}`);
    });

    it("is 1 under a uniform rescaling", () => {
        // Scaling every distance by a constant shifts log-radii by a constant,
        // which a correlation must ignore.
        const scaled = X.map((row) => row.map((v) => v * 12.5));
        const v = sickle.analyze(sickle.toVectors(X), sickle.toVectors(scaled), { densityK: K });
        assert.ok(Math.abs(sickle.densityPreservation(v.structure).value - 1) < 1e-9);
    });

    it("detects density being destroyed while neighbourhoods survive", () => {
        // Two clusters, one tight and one diffuse, projected so both come out the
        // same width. Every local neighbourhood is preserved, so trustworthiness
        // stays high -- but the density contrast is gone.
        const rnd = lcg(3);
        const hd: number[][] = [], ld: number[][] = [];
        for (let i = 0; i < 60; ++i) {
            const t = rnd() * 2 - 1;
            hd.push([t * 0.05, rnd() * 0.05]);       // tight
            ld.push([t * 1.0, rnd() * 1.0]);         // stretched out
        }
        for (let i = 0; i < 60; ++i) {
            const t = rnd() * 2 - 1;
            hd.push([10 + t * 1.0, rnd() * 1.0]);    // diffuse
            ld.push([10 + t * 1.0, rnd() * 1.0]);    // unchanged
        }
        const H = sickle.toVectors(hd), L = sickle.toVectors(ld);
        const cr = sickle.coRanking(H, L);
        const density = sickle.densityPreservation(
            sickle.analyze(H, L, { densityK: 5 }).structure).value;
        assert.ok(sickle.trustworthiness(cr, 5) > 0.9, "trustworthiness should stay high");
        assert.ok(density < 0.9, `density preservation should drop, got ${density}`);
    });

    it("supports Spearman as well as Pearson", () => {
        const s = sickle.densityPreservation(a.structure, "spearman").value;
        assert.ok(Number.isFinite(s) && s >= -1 && s <= 1);
    });

    it("explains itself when the pass was run without it", () => {
        const plain = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y));
        assert.throws(() => sickle.densityPreservation(plain.structure), /without `densityK`/);
    });
});
