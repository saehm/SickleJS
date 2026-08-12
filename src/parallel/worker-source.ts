/**
 * The worker's own source, inlined at build time.
 *
 * `null` when running from source, where the worker is a real file next to this
 * one and can be loaded by URL. The build replaces this module with the worker
 * bundled to a self-contained script, so the published package carries its
 * worker inside the main bundle and needs no file, no URL and no cooperation
 * from whatever bundler the consumer is using.
 *
 * See `rollup.config.js`.
 */
export const WORKER_SOURCE: string | null = null;
