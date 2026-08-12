import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as sickle from "../src/index.ts";
import { makeFixture } from "./fixtures.ts";

describe("parallel co-ranking", () => {
    it("is bit-identical to the single-threaded pass", async () => {
        const { X, Y } = makeFixture(700, 6, 31);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);

        const sync = sickle.coRanking(hd, ld, { localK: [10, 25] });
        const par = await sickle.coRankingAsync(hd, ld, {
            localK: [10, 25], workers: 4, parallelThreshold: 1,
        });

        // strict equality, not approximate: the reduction is exact by construction
        assert.deepEqual(par.tPenalty, sync.tPenalty);
        assert.deepEqual(par.cPenalty, sync.cPenalty);
        assert.deepEqual(par.corner, sync.corner);
        assert.deepEqual(
            sickle.localTrustworthiness(par, 10),
            sickle.localTrustworthiness(sync, 10),
        );
        assert.equal(sickle.aucLogRnx(par), sickle.aucLogRnx(sync));
        for (const k of [5, 10, 25, 100]) {
            assert.equal(sickle.trustworthiness(par, k), sickle.trustworthiness(sync, k));
            assert.equal(sickle.continuity(par, k), sickle.continuity(sync, k));
        }
    });

    it("gives the same answer for any worker count", async () => {
        const { X, Y } = makeFixture(600, 5, 12);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const ref = sickle.coRanking(hd, ld);
        for (const workers of [2, 3, 5, 8]) {
            const par = await sickle.coRankingAsync(hd, ld, { workers, parallelThreshold: 1 });
            assert.equal(
                sickle.trustworthiness(par, 20),
                sickle.trustworthiness(ref, 20),
                `differs with ${workers} workers`,
            );
        }
    });

    it("falls back to sync below the threshold", async () => {
        const { X, Y } = makeFixture(100, 4, 8);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const par = await sickle.coRankingAsync(hd, ld, { workers: 4 });
        assert.equal(sickle.trustworthiness(par, 10), sickle.trustworthiness(sickle.coRanking(hd, ld), 10));
    });

    it("does not mutate or detach the caller's buffers", async () => {
        const { X, Y } = makeFixture(600, 5, 4);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const hdCopy = hd.data.slice();
        await sickle.coRankingAsync(hd, ld, { workers: 3, parallelThreshold: 1 });
        assert.equal(hd.data.length, hdCopy.length, "buffer was detached by a transfer");
        assert.deepEqual(hd.data, hdCopy);
    });

    it("reports monotonic progress", async () => {
        const { X, Y } = makeFixture(800, 4, 6);
        const seen: number[] = [];
        await sickle.coRankingAsync(sickle.toVectors(X), sickle.toVectors(Y), {
            workers: 4, parallelThreshold: 1, onProgress: (f) => seen.push(f),
        });
        assert.ok(seen.length > 1, "expected progress callbacks");
        assert.equal(seen.at(-1), 1);
        for (let i = 1; i < seen.length; ++i) assert.ok(seen[i] >= seen[i - 1]);
    });

    it("rejects on abort and tears the pool down", async () => {
        const { X, Y } = makeFixture(3000, 20, 9);
        const ac = new AbortController();
        const p = sickle.coRankingAsync(sickle.toVectors(X), sickle.toVectors(Y), {
            workers: 4, parallelThreshold: 1, signal: ac.signal,
        });
        queueMicrotask(() => ac.abort(new Error("cancelled by test")));
        await assert.rejects(p, /cancelled by test/);
    });

    it("surfaces worker-side errors on the main thread", async () => {
        const { X, Y } = makeFixture(600, 4, 2);
        await assert.rejects(
            sickle.coRankingAsync(sickle.toVectors(X), sickle.toVectors(Y), {
                workers: 2, parallelThreshold: 1, localK: [99999],
            }),
            /must be an integer/,
        );
    });

    it("reports whether parallelism is available", () => {
        assert.equal(typeof sickle.parallelAvailable(), "boolean");
        assert.ok(sickle.defaultPoolSize() >= 1);
    });
});

describe("parallel fused pass and NeRV", () => {
    it("analyzeAsync is bit-identical to the synchronous pass", async () => {
        const { X, Y } = makeFixture(700, 6, 31);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const sync = sickle.analyze(hd, ld, { localK: [10], ccaLambda: 1.5 });
        const par = await sickle.analyzeAsync(hd, ld, {
            localK: [10], ccaLambda: 1.5, workers: 4, parallelThreshold: 1,
        });

        assert.deepEqual(par.coRanking.tPenalty, sync.coRanking.tPenalty);
        assert.deepEqual(par.moments.rowDiff2, sync.moments.rowDiff2);
        assert.deepEqual(par.embedding.rowSammon, sync.embedding.rowSammon);
        for (const key of ["sumHH", "sumDiff2", "sammonNum", "ccaNum"] as const) {
            const a = key in par.moments ? (par.moments as never)[key] : (par.embedding as never)[key];
            const b = key in sync.moments ? (sync.moments as never)[key] : (sync.embedding as never)[key];
            assert.equal(a, b, `${key} differs`);
        }
        assert.equal(sickle.stress(par.moments).value, sickle.stress(sync.moments).value);
        assert.equal(
            sickle.sammonStress(par.embedding).value,
            sickle.sammonStress(sync.embedding).value,
        );
    });

    it("nervAsync is bit-identical to the synchronous pass", async () => {
        const { X, Y } = makeFixture(600, 5, 12);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const sync = sickle.nerv(sickle.nervPass(hd, ld, { perplexity: 20 }));
        const par = sickle.nerv(await sickle.nervAsync(hd, ld, {
            perplexity: 20, workers: 4, parallelThreshold: 1,
        }));
        assert.equal(par.value, sync.value);
        assert.equal(par.recall, sync.recall);
        assert.deepEqual(par.local, sync.local);
    });

    it("gives the same answer for any worker count", async () => {
        const { X, Y } = makeFixture(600, 5, 8);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        const ref = sickle.nerv(sickle.nervPass(hd, ld, { perplexity: 15 }));
        for (const workers of [2, 3, 5]) {
            const par = sickle.nerv(await sickle.nervAsync(hd, ld, {
                perplexity: 15, workers, parallelThreshold: 1,
            }));
            assert.equal(par.value, ref.value, `differs with ${workers} workers`);
        }
    });

    it("propagates abort and worker errors for both passes", async () => {
        const { X, Y } = makeFixture(600, 4, 2);
        const hd = sickle.toVectors(X), ld = sickle.toVectors(Y);
        await assert.rejects(
            sickle.analyzeAsync(hd, ld, { workers: 2, parallelThreshold: 1, localK: [99999] }),
            /must be an integer/,
        );
        await assert.rejects(
            sickle.nervAsync(hd, ld, { workers: 2, parallelThreshold: 1, perplexity: 99999 }),
            /perplexity/,
        );
        const ac = new AbortController();
        const p = sickle.analyzeAsync(sickle.toVectors(makeFixture(3000, 20, 9).X),
            sickle.toVectors(makeFixture(3000, 20, 9).Y),
            { workers: 4, parallelThreshold: 1, signal: ac.signal });
        queueMicrotask(() => ac.abort(new Error("cancelled by test")));
        await assert.rejects(p, /cancelled by test/);
    });
});
