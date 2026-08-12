/**
 * Worker entry for the row-sliceable passes.
 *
 * Every pass in this library visits rows independently and accumulates sums that
 * reduce by addition, so the same worker serves all of them: it runs the
 * requested pass over a row range and ships the accumulators back. Which pass to
 * run is chosen by `kind`.
 *
 * Runs unchanged in Node (`node:worker_threads`) and in browsers (module
 * Worker); the only environment-specific part is the message plumbing.
 */

import { type FusedPartial, fusedPartial } from "../passes/fused.ts";
import { type NervPartial, nervPartial } from "../passes/nerv.ts";
import type { Vectors } from "../core/vectors.ts";

interface Shared {
    hd: { data: Float64Array; n: number; d: number };
    ld: { data: Float64Array; n: number; d: number };
    rowStart: number;
    rowEnd: number;
    reportProgress: boolean;
}

export interface FusedRequest extends Shared {
    kind: "fused";
    localK: number[];
    ranks: boolean;
    distances: boolean;
    ccaLambda?: number | undefined;
    ccaKernel?: "exponential" | "step" | undefined;
}

export interface NervRequest extends Shared {
    kind: "nerv";
    lambda: number;
    perplexity: number;
    tolerance?: number | undefined;
    maxIterations?: number | undefined;
}

export type WorkerRequest = FusedRequest | NervRequest;

export interface FusedResult {
    type: "result";
    kind: "fused";
    partial: FusedPartial;
}

export interface NervResult {
    type: "result";
    kind: "nerv";
    partial: NervPartial;
}

export type WorkerMessage =
    | FusedResult
    | NervResult
    | { type: "progress"; rows: number }
    | { type: "error"; message: string; stack?: string | undefined };

/** Buffers of every typed array in the payload, so it transfers without copying. */
function transferable(partial: object): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    for (const value of Object.values(partial)) {
        if (ArrayBuffer.isView(value)) out.push(value.buffer as ArrayBuffer);
        else if (Array.isArray(value)) {
            for (const inner of value) if (ArrayBuffer.isView(inner)) out.push(inner.buffer as ArrayBuffer);
        }
    }
    return out;
}

export function handleRequest(
    req: WorkerRequest,
    post: (msg: WorkerMessage, transfer: ArrayBuffer[]) => void,
): void {
    try {
        const hd = req.hd as Vectors;
        const ld = req.ld as Vectors;
        let lastReported = req.rowStart;
        const onProgress = req.reportProgress
            ? (fraction: number) => {
                  const done = req.rowStart + Math.round(fraction * (req.rowEnd - req.rowStart));
                  if (done > lastReported) {
                      post({ type: "progress", rows: done - lastReported }, []);
                      lastReported = done;
                  }
              }
            : undefined;

        if (req.kind === "fused") {
            const partial = fusedPartial(hd, ld, {
                localK: req.localK,
                ranks: req.ranks,
                distances: req.distances,
                rowStart: req.rowStart,
                rowEnd: req.rowEnd,
                progressInterval: 32,
                ...(req.ccaLambda !== undefined ? { ccaLambda: req.ccaLambda } : {}),
                ...(req.ccaKernel !== undefined ? { ccaKernel: req.ccaKernel } : {}),
                ...(onProgress ? { onProgress } : {}),
            });
            post({ type: "result", kind: "fused", partial }, transferable(partial));
        } else {
            const partial = nervPartial(hd, ld, {
                lambda: req.lambda,
                perplexity: req.perplexity,
                rowStart: req.rowStart,
                rowEnd: req.rowEnd,
                progressInterval: 32,
                ...(req.tolerance !== undefined ? { tolerance: req.tolerance } : {}),
                ...(req.maxIterations !== undefined ? { maxIterations: req.maxIterations } : {}),
                ...(onProgress ? { onProgress } : {}),
            });
            post({ type: "result", kind: "nerv", partial }, transferable(partial));
        }
    } catch (err) {
        const e = err as Error;
        post({ type: "error", message: e.message, stack: e.stack }, []);
    }
}

// --- environment plumbing --------------------------------------------------

declare const self: {
    onmessage: ((e: { data: WorkerRequest }) => void) | null;
    postMessage: (msg: unknown, transfer?: ArrayBuffer[]) => void;
} | undefined;
declare const require: ((id: string) => never) | undefined;

const nodeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;

/**
 * Attach the message handler.
 *
 * Deliberately an unawaited async function rather than top-level `await`: the
 * build inlines this file as a self-contained script, and a plain script cannot
 * express top-level await. Node reaches `worker_threads` synchronously through
 * `require` when the worker was spawned from source text, and falls back to a
 * dynamic import when it was loaded as a module from disk.
 */
async function listen(): Promise<void> {
    if (nodeProcess?.versions?.node) {
        const threads = typeof require === "function"
            ? (require as (id: string) => typeof import("node:worker_threads"))("node:worker_threads")
            : await import("node:worker_threads");
        const port = threads.parentPort;
        port?.on("message", (req: WorkerRequest) => {
            handleRequest(req, (msg, transfer) => port.postMessage(msg, transfer));
        });
    } else if (typeof self !== "undefined") {
        self.onmessage = (e) => {
            handleRequest(e.data, (msg, transfer) => self!.postMessage(msg, transfer));
        };
    }
}

void listen();
