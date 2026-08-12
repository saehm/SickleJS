/**
 * Parallel drivers for the row-sliceable passes.
 *
 * Correctness rests on the property established in `coranking.ts` and carried
 * through `fused.ts` and `nerv.ts`: a partial pass over a row range is a monoid.
 * Splitting rows across workers and summing the accumulators is **bit-identical**
 * to a single-threaded pass -- every accumulator is either an integer count held
 * exactly in a double, or a per-row value written to a disjoint slot.
 *
 * All three drivers fall back to the synchronous kernel when parallelism is
 * unavailable, the dataset is small, or one worker was requested, so they are
 * always safe to call.
 */

import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";
import { type Analysis, reduceFused } from "./analyze.ts";
import { type CoRanking, reduceCoRanking, rowRanges } from "./coranking.ts";
import { type FusedPartial, fusedPartial } from "./fused.ts";
import { type Nerv, type NervPartial, nervPartial, reduceNerv } from "./nerv.ts";
import type { FusedRequest, NervRequest, WorkerRequest } from "../parallel/pass.worker.ts";
import {
    type WorkerFactory,
    defaultPoolSize,
    parallelAvailable,
    runOnPool,
} from "../parallel/pool.ts";

/** * @category Passes * @group Passes */
export interface ParallelOptions {
    /** Worker count. Defaults to `hardwareConcurrency`, capped at 16. */
    workers?: number;
    /** Below this many points, run single-threaded. */
    parallelThreshold?: number;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
    /** Required under bundlers, which cannot resolve the default worker URL. */
    workerFactory?: WorkerFactory;
}

interface Result<K extends string, P> {
    type: "result";
    kind: K;
    partial: P;
}

function isResult<K extends string, P>(kind: K) {
    return (m: unknown): m is Result<K, P> =>
        typeof m === "object" && m !== null &&
        (m as { type?: string }).type === "result" &&
        (m as { kind?: string }).kind === kind;
}

/** Decide the split, or return null to run single-threaded. */
function plan(n: number, opts: ParallelOptions): Array<[number, number]> | null {
    const threshold = opts.parallelThreshold ?? 512;
    const requested = opts.workers ?? defaultPoolSize();
    const count = Math.min(requested, Math.ceil(n / 64));
    if (!parallelAvailable() || n < threshold || count < 2) return null;
    return rowRanges(n, count);
}

async function run<K extends "fused" | "nerv", P>(
    kind: K,
    ranges: Array<[number, number]>,
    n: number,
    make: (rowStart: number, rowEnd: number) => WorkerRequest,
    opts: ParallelOptions,
): Promise<P[]> {
    let rowsDone = 0;
    const results = await runOnPool<WorkerRequest, Result<K, P>>({
        tasks: ranges.map(([a, b]) => make(a, b)),
        isResult: isResult<K, P>(kind),
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.workerFactory ? { workerFactory: opts.workerFactory } : {}),
        onMessage: (msg) => {
            if (typeof msg === "object" && msg !== null &&
                (msg as { type?: string }).type === "progress") {
                rowsDone += (msg as { rows: number }).rows;
                opts.onProgress?.(Math.min(1, rowsDone / n));
            }
        },
    });
    opts.onProgress?.(1);
    return results.map((r) => r.partial);
}

// --- the fused pass --------------------------------------------------------

/** * @category Passes * @group Passes */
export interface AnalyzeAsyncOptions extends ParallelOptions {
    localK?: readonly number[];
    ranks?: boolean;
    distances?: boolean;
    ccaLambda?: number;
    ccaKernel?: "exponential" | "step";
}

/**
 * Rank and distance accumulators together, across workers.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { analyzeAsync, trustworthiness } from "@saehrimnir/sickle";
 *
 * // Same result as `analyze`, bit for bit, on however many workers. The worker
 * // is inlined into the published bundle, so this needs no bundler config.
 * const a = await analyzeAsync(data, projection, {
 *     localK: [20],
 *     workers: 4,                       // defaults to the hardware concurrency
 *     onProgress: (done, total) => console.log(`${done}/${total}`),
 *     signal: AbortSignal.timeout(30_000),
 * });
 *
 * trustworthiness(a.coRanking, 20);  // 0.9659
 * ```
 * Below `parallelThreshold` points, or where workers are unavailable, it runs
 * the synchronous kernel instead.
 */
export async function analyzeAsync(
    hdIn: PointsInput, ldIn: PointsInput, opts: AnalyzeAsyncOptions = {},
): Promise<Analysis> {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const n = hd.n;
    const localK = [...(opts.localK ?? [])];
    const ranks = opts.ranks !== false;
    const distances = opts.distances !== false;

    const ranges = plan(n, opts);
    if (!ranges) {
        return reduceFused([fusedPartial(hd, ld, {
            localK, ranks, distances,
            ...(opts.ccaLambda !== undefined ? { ccaLambda: opts.ccaLambda } : {}),
            ...(opts.ccaKernel !== undefined ? { ccaKernel: opts.ccaKernel } : {}),
            ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
        })]);
    }

    const partials = await run<"fused", FusedPartial>("fused", ranges, n,
        (rowStart, rowEnd): FusedRequest => ({
            kind: "fused",
            hd: { data: hd.data, n: hd.n, d: hd.d },
            ld: { data: ld.data, n: ld.n, d: ld.d },
            localK, ranks, distances, rowStart, rowEnd,
            reportProgress: Boolean(opts.onProgress),
            ccaLambda: opts.ccaLambda,
            ccaKernel: opts.ccaKernel,
        }), opts);

    return reduceFused(partials);
}

/**
 * Co-ranking only, across workers. Equivalent to `analyzeAsync` with distances off.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { coRankingAsync, aucLogRnx } from "@saehrimnir/sickle";
 *
 * const cr = await coRankingAsync(data, projection, { workers: 4 });
 * aucLogRnx(cr);  // 0.4658
 * ```
 */
export async function coRankingAsync(
    hd: PointsInput, ld: PointsInput, opts: AnalyzeAsyncOptions = {},
): Promise<CoRanking> {
    const analysis = await analyzeAsync(hd, ld, { ...opts, ranks: true, distances: false });
    return analysis.coRanking;
}

// --- NeRV ------------------------------------------------------------------

/** * @category Passes * @group Passes */
export interface NervAsyncOptions extends ParallelOptions {
    lambda?: number;
    perplexity?: number;
    tolerance?: number;
    maxIterations?: number;
}

/**
 * NeRV across workers.
 *
 * NeRV benefits most from this: it fits a Gaussian per row by bisection, so it
 * is the slowest pass per point in the library.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { nervAsync, nerv } from "@saehrimnir/sickle";
 *
 * const p = await nervAsync(data, projection, { lambda: 0.5, workers: 4 });
 * nerv(p).value;  // 0.4611
 * ```
 */
export async function nervAsync(
    hdIn: PointsInput, ldIn: PointsInput, opts: NervAsyncOptions = {},
): Promise<Nerv> {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const n = hd.n;
    const lambda = opts.lambda ?? 0.5;
    const perplexity = opts.perplexity ?? 30;

    const ranges = plan(n, opts);
    if (!ranges) {
        return reduceNerv([nervPartial(hd, ld, {
            lambda, perplexity,
            ...(opts.tolerance !== undefined ? { tolerance: opts.tolerance } : {}),
            ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
            ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
        })]);
    }

    const partials = await run<"nerv", NervPartial>("nerv", ranges, n,
        (rowStart, rowEnd): NervRequest => ({
            kind: "nerv",
            hd: { data: hd.data, n: hd.n, d: hd.d },
            ld: { data: ld.data, n: ld.n, d: ld.d },
            lambda, perplexity, rowStart, rowEnd,
            reportProgress: Boolean(opts.onProgress),
            tolerance: opts.tolerance,
            maxIterations: opts.maxIterations,
        }), opts);

    return reduceNerv(partials);
}

export { reduceCoRanking };
