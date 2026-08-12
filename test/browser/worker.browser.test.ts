/**
 * Browser coverage, in real Chromium via Playwright.
 *
 * This does not re-verify the maths — the node project does that against zadu.
 * It proves the two things Node cannot:
 *
 *   1. the library loads and computes in a browser at all;
 *   2. the parallel path works there, through `workerFactory`.
 *
 * (2) is the point. The default worker URL is assembled at runtime from
 * `import.meta.url`, which a bundler cannot resolve statically, so
 * `workerFactory` is the supported route under any bundler. Until this test it
 * was documented but never actually executed.
 *
 * Note the `new Worker(new URL("...", import.meta.url), { type: "module" })`
 * form below: that exact shape is what Vite (and webpack, and Rollup) special-
 * case and rewrite at build time. It is the idiom to copy into an application.
 */

import { describe, expect, it } from "vitest";
import * as sickle from "../../src/index.ts";
import type { WorkerHandle } from "../../src/parallel/pool.ts";
import { makeFixture } from "../fixtures.ts";

/** The factory an application would write. */
function browserWorkerFactory(): WorkerHandle {
    const worker = new Worker(
        new URL("../../src/parallel/pass.worker.ts", import.meta.url),
        { type: "module" },
    );
    return {
        post: (message, transfer) => worker.postMessage(message, (transfer ?? []) as Transferable[]),
        onMessage: (handler) => { worker.onmessage = (e: MessageEvent) => handler(e.data); },
        onError: (handler) => { worker.onerror = (e: ErrorEvent) => handler(new Error(e.message)); },
        terminate: () => worker.terminate(),
    };
}

describe("sickle in the browser", () => {
    const { X, Y, labels } = makeFixture(300, 6, 31);
    const hd = sickle.toVectors(X);
    const ld = sickle.toVectors(Y);

    it("computes the rank metrics", () => {
        const cr = sickle.coRanking(hd, ld, { localK: [10] });
        const t = sickle.trustworthiness(cr, 10);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(1);
        expect(sickle.localTrustworthiness(cr, 10)).toHaveLength(300);
    });

    it("computes the distance, embedding and label metrics", () => {
        const a = sickle.analyze(hd, ld, { ccaLambda: 1.5 });
        expect(sickle.stress(a.moments).value).toBeGreaterThan(0);
        expect(Number.isFinite(sickle.sammonStress(a.embedding).value)).toBe(true);
        expect(Number.isFinite(sickle.curvilinearStress(a.embedding).value)).toBe(true);

        const cl = sickle.clusters(ld, labels);
        expect(sickle.silhouette(ld, cl).value).toBeGreaterThanOrEqual(-1);
        expect(sickle.distanceConsistency(ld, cl).value).toBeLessThanOrEqual(1);
    });

    it("computes scagnostics, which need Delaunay in the browser", () => {
        const s = sickle.scagnostics(ld);
        for (const name of sickle.SCAGNOSTIC_NAMES) {
            expect(Number.isFinite(s[name]), name).toBe(true);
        }
    });

    it("reports that parallelism is available", () => {
        expect(sickle.parallelAvailable()).toBe(true);
        expect(sickle.defaultPoolSize()).toBeGreaterThanOrEqual(1);
    });

    it("runs the co-ranking pass across real browser workers", async () => {
        const sync = sickle.coRanking(hd, ld, { localK: [10] });
        const par = await sickle.coRankingAsync(hd, ld, {
            localK: [10],
            workers: 3,
            parallelThreshold: 1,
            workerFactory: browserWorkerFactory,
        });
        // Bit-identical, exactly as in Node: the reduction is exact by construction.
        expect(Array.from(par.tPenalty)).toEqual(Array.from(sync.tPenalty));
        expect(sickle.trustworthiness(par, 10)).toBe(sickle.trustworthiness(sync, 10));
        expect(Array.from(sickle.localTrustworthiness(par, 10)))
            .toEqual(Array.from(sickle.localTrustworthiness(sync, 10)));
    });

    it("runs the fused pass across real browser workers", async () => {
        const sync = sickle.analyze(hd, ld, { localK: [10], ccaLambda: 1.5 });
        const par = await sickle.analyzeAsync(hd, ld, {
            localK: [10],
            ccaLambda: 1.5,
            workers: 3,
            parallelThreshold: 1,
            workerFactory: browserWorkerFactory,
        });
        expect(sickle.stress(par.moments).value).toBe(sickle.stress(sync.moments).value);
        expect(sickle.sammonStress(par.embedding).value)
            .toBe(sickle.sammonStress(sync.embedding).value);
        expect(sickle.curvilinearStress(par.embedding).value)
            .toBe(sickle.curvilinearStress(sync.embedding).value);
    });

    it("runs NeRV across real browser workers", async () => {
        const sync = sickle.nerv(sickle.nervPass(hd, ld, { perplexity: 20 }));
        const par = sickle.nerv(await sickle.nervAsync(hd, ld, {
            perplexity: 20,
            workers: 3,
            parallelThreshold: 1,
            workerFactory: browserWorkerFactory,
        }));
        expect(par.value).toBe(sync.value);
        expect(par.recall).toBe(sync.recall);
    });

    it("propagates worker errors and aborts in the browser too", async () => {
        await expect(sickle.analyzeAsync(hd, ld, {
            localK: [99999], workers: 2, parallelThreshold: 1,
            workerFactory: browserWorkerFactory,
        })).rejects.toThrow(/must be an integer/);

        const controller = new AbortController();
        const pending = sickle.analyzeAsync(hd, ld, {
            workers: 3, parallelThreshold: 1, signal: controller.signal,
            workerFactory: browserWorkerFactory,
        });
        queueMicrotask(() => controller.abort(new Error("cancelled in browser")));
        await expect(pending).rejects.toThrow(/cancelled in browser/);
    });

    it("does not detach the caller's buffers", async () => {
        const before = hd.data.length;
        await sickle.coRankingAsync(hd, ld, {
            workers: 2, parallelThreshold: 1, workerFactory: browserWorkerFactory,
        });
        expect(hd.data.length).toBe(before);
    });
});
