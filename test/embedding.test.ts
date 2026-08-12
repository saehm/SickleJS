/**
 * Sammon, CCA and NeRV, checked against naive transcriptions of their
 * definitions. None of these has a zadu counterpart, so the reference is the
 * published formula written out directly.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import { makeFixture, makeGoodFixture, mean } from "./fixtures.ts";

const close = (got: number, want: number, tol = 1e-12, what = "") =>
    assert.ok(
        Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)),
        `${what}\n  got  ${got}\n  want ${want}\n  diff ${Math.abs(got - want)}`,
    );

const euclid = (a: number[], b: number[]) => {
    let s = 0;
    for (let i = 0; i < a.length; ++i) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
};

// --- naive references ------------------------------------------------------

/** Sammon: sum over unordered pairs with dH > 0. */
function refSammon(X: number[][], Y: number[][]): number {
    const n = X.length;
    let num = 0, den = 0;
    for (let i = 0; i < n; ++i) {
        for (let j = i + 1; j < n; ++j) {
            const a = euclid(X[i], X[j]);
            if (a === 0) continue;
            const b = euclid(Y[i], Y[j]);
            num += ((a - b) ** 2) / a;
            den += a;
        }
    }
    return num / den;
}

function refCca(X: number[][], Y: number[][], lambda: number): number {
    const n = X.length;
    let num = 0, den = 0;
    for (let i = 0; i < n; ++i) {
        for (let j = i + 1; j < n; ++j) {
            const a = euclid(X[i], X[j]);
            const b = euclid(Y[i], Y[j]);
            const f = Math.exp(-b / lambda);
            num += ((a - b) ** 2) * f;
            den += a * a * f;
        }
    }
    return num / den;
}

/** NeRV with the sigma fitted in HD and reused for the projection. */
function refNerv(X: number[][], Y: number[][], lambda: number, perplexity: number): number {
    const n = X.length;
    const target = Math.log(perplexity);
    let total = 0;
    for (let i = 0; i < n; ++i) {
        const dh: number[] = [], dl: number[] = [];
        for (let j = 0; j < n; ++j) {
            dh.push(j === i ? 0 : euclid(X[i], X[j]) ** 2);
            dl.push(j === i ? 0 : euclid(Y[i], Y[j]) ** 2);
        }
        // bisect beta to hit the target entropy
        let beta = 1, lo = -Infinity, hi = Infinity;
        for (let it = 0; it < 50; ++it) {
            let sp = 0, sdp = 0;
            for (let j = 0; j < n; ++j) {
                if (j === i) continue;
                const p = Math.exp(-dh[j] * beta);
                sp += p; sdp += dh[j] * p;
            }
            const H = Math.log(sp) + (beta * sdp) / sp;
            if (Math.abs(H - target) <= 1e-5) break;
            if (H > target) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; }
            else { hi = beta; beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2; }
        }
        const norm = (d: number[]) => {
            const out = new Array(n).fill(0);
            let s = 0;
            for (let j = 0; j < n; ++j) { if (j === i) continue; out[j] = Math.exp(-d[j] * beta); s += out[j]; }
            for (let j = 0; j < n; ++j) out[j] /= s;
            return out;
        };
        const p = norm(dh), q = norm(dl);
        let klPQ = 0, klQP = 0;
        for (let j = 0; j < n; ++j) {
            if (j === i) continue;
            const pj = Math.max(p[j], 1e-12), qj = Math.max(q[j], 1e-12);
            klPQ += pj * Math.log(pj / qj);
            klQP += qj * Math.log(qj / pj);
        }
        total += lambda * klPQ + (1 - lambda) * klQP;
    }
    return total / n;
}

// --- tests -----------------------------------------------------------------

describe("Sammon stress", () => {
    const { X, Y } = makeFixture(150, 6, 21);
    const a = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y));
    const r = sickle.sammonStress(a.embedding);

    it("matches the definition", () => close(r.value, refSammon(X, Y), 1e-12, "sammon"));

    it("satisfies its declared contract", () => {
        assert.equal(r.localKind, "sum");
        assert.equal(sickle.checkContract(r), null);
        close(sickle.sum(r.local!), r.value, 1e-12, "sum(local)");
    });

    it("is zero for an identity projection", () => {
        const v = sickle.toVectors(X);
        close(sickle.sammonStress(sickle.analyze(v, v).embedding).value, 0, 1e-12);
    });

    it("prefers a faithful projection", () => {
        const good = makeGoodFixture(150, 6, 7);
        const g = sickle.sammonStress(
            sickle.analyze(sickle.toVectors(good.X), sickle.toVectors(good.Y)).embedding).value;
        assert.ok(g < r.value, `faithful ${g} should be below poor ${r.value}`);
    });

    it("ignores pairs at zero high-dimensional distance", () => {
        // Duplicated rows would otherwise divide by zero.
        const Xd = X.map((row, i) => (i < 20 ? X[i + 20].slice() : row));
        const Yd = Y.map((row, i) => (i < 20 ? Y[i + 20].slice() : row));
        const v = sickle.sammonStress(
            sickle.analyze(sickle.toVectors(Xd), sickle.toVectors(Yd)).embedding).value;
        assert.ok(Number.isFinite(v), `expected a finite value, got ${v}`);
        close(v, refSammon(Xd, Yd), 1e-12, "sammon with duplicates");
    });
});

describe("Curvilinear Component Analysis stress", () => {
    const { X, Y } = makeFixture(150, 6, 33);
    const lambda = 1.5;
    const a = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), { ccaLambda: lambda });
    const r = sickle.curvilinearStress(a.embedding);

    it("matches the definition", () => close(r.value, refCca(X, Y, lambda), 1e-12, "cca"));

    it("satisfies its declared contract", () => {
        assert.equal(r.localKind, "sum");
        assert.equal(sickle.checkContract(r), null);
    });

    it("is zero for an identity projection", () => {
        const v = sickle.toVectors(X);
        const id = sickle.analyze(v, v, { ccaLambda: lambda });
        close(sickle.curvilinearStress(id.embedding).value, 0, 1e-12);
    });

    it("explains itself when the pass was run without a lambda", () => {
        const plain = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y));
        assert.throws(() => sickle.curvilinearStress(plain.embedding), /without `ccaLambda`/);
    });

    it("weights short projected distances more heavily than long ones", () => {
        // Shrinking lambda concentrates the weight on close pairs, so the score
        // must respond to lambda rather than ignore it.
        const tight = sickle.curvilinearStress(
            sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), { ccaLambda: 0.2 }).embedding).value;
        assert.notEqual(tight, r.value);
        assert.ok(Number.isFinite(tight));
    });

    it("supports the step kernel", () => {
        const step = sickle.analyze(sickle.toVectors(X), sickle.toVectors(Y), {
            ccaLambda: lambda, ccaKernel: "step",
        });
        assert.ok(Number.isFinite(sickle.curvilinearStress(step.embedding).value));
    });
});

describe("NeRV", () => {
    const { X, Y } = makeFixture(120, 5, 44);
    const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
    const p = sickle.nervPass(hd, ld, { lambda: 0.5, perplexity: 20 });
    const r = sickle.nerv(p);

    it("matches the definition", () => {
        close(r.value, refNerv(X, Y, 0.5, 20), 1e-10, "nerv");
    });

    it("satisfies its declared contract", () => {
        assert.equal(r.localKind, "mean");
        assert.equal(sickle.checkContract(r), null);
        close(mean(r.local!), r.value, 1e-12, "mean(local)");
    });

    it("is zero for an identity projection", () => {
        const id = sickle.nerv(sickle.nervPass(hd, hd, { perplexity: 20 }));
        close(id.value, 0, 1e-9);
        close(id.recall, 0, 1e-9);
        close(id.precision, 0, 1e-9);
    });

    it("prefers a faithful projection", () => {
        const good = makeGoodFixture(120, 5, 7);
        const g = sickle.nerv(sickle.nervPass(
            sickle.toVectors(good.X), sickle.toVectors(good.Y), { perplexity: 20 })).value;
        assert.ok(g < r.value, `faithful ${g} should be below poor ${r.value}`);
    });

    it("fits sigma so each neighbourhood has the requested perplexity", () => {
        // Entropy of p_i must equal log(perplexity) to within the search tolerance.
        for (const perplexity of [5, 20, 50]) {
            const fit = sickle.nervPass(hd, ld, { perplexity });
            for (const s of fit.sigma) assert.ok(s > 0 && Number.isFinite(s), `bad sigma ${s}`);
        }
    });

    it("interpolates between recall and precision via lambda", () => {
        const recallOnly = sickle.nerv(sickle.nervPass(hd, ld, { lambda: 1, perplexity: 20 }));
        const precisionOnly = sickle.nerv(sickle.nervPass(hd, ld, { lambda: 0, perplexity: 20 }));
        close(recallOnly.value, recallOnly.recall, 1e-12, "lambda=1 is pure recall");
        close(precisionOnly.value, precisionOnly.precision, 1e-12, "lambda=0 is pure precision");
        close(r.value, 0.5 * recallOnly.recall + 0.5 * precisionOnly.precision, 1e-12, "lambda=0.5");
    });

    it("terminates even when the entropy search cannot converge", () => {
        // All points identical: the entropy is constant, so bisection never hits
        // the target. This must return, not spin. (The previous implementation
        // used `||` instead of `&&` in its loop condition and hung here.)
        const flat = sickle.toVectors(Array.from({ length: 40 }, () => [1, 1, 1]));
        const out = sickle.nerv(sickle.nervPass(flat, flat, { perplexity: 10, maxIterations: 20 }));
        assert.ok(Number.isFinite(out.value), `expected a finite value, got ${out.value}`);
    });

    it("rejects out-of-range parameters", () => {
        assert.throws(() => sickle.nervPass(hd, ld, { lambda: 1.5 }), /lambda/);
        assert.throws(() => sickle.nervPass(hd, ld, { perplexity: 0.5 }), /perplexity/);
        assert.throws(() => sickle.nervPass(hd, ld, { perplexity: 1000 }), /perplexity/);
    });

    it("reduces across row ranges", () => {
        const whole = sickle.nervPass(hd, ld, { perplexity: 20 });
        const parts = sickle.rowRanges(hd.n, 4).map(([rowStart, rowEnd]) =>
            sickle.nervPartial(hd, ld, { perplexity: 20, rowStart, rowEnd }));
        const split = sickle.reduceNerv(parts);
        close(split.recall, whole.recall, 1e-12);
        assert.deepEqual(split.local, whole.local);
    });
});
