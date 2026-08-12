/**
 * A minimal, portable worker pool.
 *
 * DruidJS 0.9 ships a pool of its own, but it is private, Node-only, requires
 * `SharedArrayBuffer`, and dispatches WASM kernels by name -- none of which fits
 * a JavaScript kernel that must also run in a browser. This one:
 *
 *   - works in Node (`node:worker_threads`) and browsers (module `Worker`)
 *   - needs no `SharedArrayBuffer`, so no COOP/COEP cross-origin isolation
 *   - transfers results instead of copying them back
 *
 * The opt-out env var mirrors druid's `DRUID_DISABLE_PARALLEL` convention so the
 * single-threaded path can be exercised without code changes.
 */

import { WORKER_SOURCE } from "./worker-source.ts";

/** @internal */
export interface WorkerHandle {
    post(message: unknown, transfer?: ArrayBuffer[]): void;
    onMessage(handler: (message: unknown) => void): void;
    onError(handler: (error: Error) => void): void;
    terminate(): void;
}

/**
 * Supply your own worker constructor. Needed under bundlers, which cannot
 * statically resolve the runtime-built URL used by the default factory.
 *
 * @category Passes
 * @group Passes
 */
export type WorkerFactory = () => WorkerHandle;

const nodeProcess = (globalThis as {
    process?: { versions?: { node?: string }; env?: Record<string, string | undefined> };
}).process;

const isNode = Boolean(nodeProcess?.versions?.node);

/**
 * True when parallelism is possible and not disabled.
 *
 * @internal
 */
export function parallelAvailable(): boolean {
    const off = nodeProcess?.env?.SICKLE_DISABLE_PARALLEL;
    if (off !== undefined && off !== "" && off !== "0" && off !== "false") return false;
    if (isNode) return true;
    return typeof Worker !== "undefined";
}

/**
 * Default concurrency: one worker per core, capped to something sensible.
 *
 * @internal
 */
export function defaultPoolSize(): number {
    const nav = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator;
    const cores = nav?.hardwareConcurrency
        ?? (isNode ? Number(nodeProcess?.env?.["NUMBER_OF_PROCESSORS"] ?? 4) : 4);
    return Math.max(1, Math.min(16, cores || 4));
}

/**
 * Resolve the worker module URL.
 *
 * Two layouts to cover. Running from source, this file sits next to
 * `pass.worker.ts` and Node executes it directly with type stripping. In the
 * published bundle everything is flattened, and the worker is emitted alongside
 * as `sickle.worker.js`.
 *
 * Only reached when the worker was not inlined, i.e. when running from source.
 * The published bundle carries its worker as a string and never needs a URL.
 */
function defaultWorkerURL(): URL {
    const here = import.meta.url;
    if (here.endsWith(".ts")) return new URL("./pass.worker.ts", here);
    return new URL("./sickle.worker.js", here);
}

async function spawnNode(): Promise<WorkerHandle> {
    const { Worker } = await import("node:worker_threads");
    // Prefer the inlined source: the published bundle carries its own worker, so
    // nothing has to resolve a path inside node_modules.
    const w = WORKER_SOURCE
        ? new Worker(WORKER_SOURCE, { eval: true })
        : new Worker(defaultWorkerURL());
    w.unref();
    return {
        post: (m, t) => w.postMessage(m, t),
        onMessage: (h) => w.on("message", h),
        onError: (h) => w.on("error", h),
        terminate: () => void w.terminate(),
    };
}

function spawnBrowser(): WorkerHandle {
    // A Blob URL sidesteps the bundler entirely. The inlined source is a plain
    // script, not a module, so it must not be spawned with `type: "module"`.
    let objectURL: string | null = null;
    let w: Worker;
    if (WORKER_SOURCE) {
        objectURL = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
        w = new Worker(objectURL);
    } else {
        w = new Worker(defaultWorkerURL(), { type: "module" });
    }
    return {
        post: (m, t) => w.postMessage(m, (t ?? []) as unknown as Transferable[]),
        onMessage: (h) => { w.onmessage = (e: MessageEvent) => h(e.data); },
        onError: (h) => { w.onerror = (e: ErrorEvent) => h(new Error(e.message)); },
        terminate: () => {
            w.terminate();
            if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
        },
    };
}

/**
 * Start one worker: from the inlined source when the package was built,
 * otherwise from `factory` or the default URL.
 *
 * @internal
 */
export async function spawnWorker(factory?: WorkerFactory): Promise<WorkerHandle> {
    if (factory) return factory();
    return isNode ? spawnNode() : spawnBrowser();
}

export interface RunOptions<Req, Res> {
    /** One request per worker. Concurrency equals `tasks.length`. */
    tasks: Req[];
    /** Buffers to hand over per task, avoiding a copy. */
    transferFor?: (task: Req) => ArrayBuffer[];
    /** Called for any non-result message a worker posts. */
    onMessage?: (message: unknown) => void;
    /** Recognises the terminal message; anything else goes to `onMessage`. */
    isResult: (message: unknown) => message is Res;
    signal?: AbortSignal;
    workerFactory?: WorkerFactory;
}

/**
 * Run one task per worker and collect the results in task order.
 * Every worker is terminated before this resolves or rejects.
 *
 * @internal
 */
export async function runOnPool<Req, Res>(opts: RunOptions<Req, Res>): Promise<Res[]> {
    const { tasks } = opts;
    if (tasks.length === 0) return [];

    const workers = await Promise.all(tasks.map(() => spawnWorker(opts.workerFactory)));
    const results = new Array<Res | undefined>(tasks.length);

    try {
        await new Promise<void>((resolve, reject) => {
            let remaining = tasks.length;
            let settled = false;

            const finish = (err?: Error) => {
                if (settled) return;
                settled = true;
                opts.signal?.removeEventListener("abort", onAbort);
                err ? reject(err) : resolve();
            };
            function onAbort() {
                finish(new Error(String(opts.signal?.reason ?? "aborted")));
            }

            if (opts.signal?.aborted) return onAbort();
            opts.signal?.addEventListener("abort", onAbort, { once: true });

            workers.forEach((w, i) => {
                w.onError((e) => finish(e));
                w.onMessage((msg) => {
                    if (opts.isResult(msg)) {
                        results[i] = msg;
                        if (--remaining === 0) finish();
                    } else if (
                        typeof msg === "object" && msg !== null &&
                        (msg as { type?: string }).type === "error"
                    ) {
                        const m = msg as { message: string; stack?: string };
                        const e = new Error(m.message);
                        if (m.stack) e.stack = m.stack;
                        finish(e);
                    } else {
                        opts.onMessage?.(msg);
                    }
                });
                w.post(tasks[i], opts.transferFor?.(tasks[i]));
            });
        });
    } finally {
        for (const w of workers) w.terminate();
    }

    return results as Res[];
}
