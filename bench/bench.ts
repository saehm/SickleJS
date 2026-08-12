import * as sickle from "../src/index.ts";
import { lcg } from "../test/fixtures.ts";

function vectors(n: number, d: number, seed: number): sickle.Vectors {
    const rnd = lcg(seed);
    const data = new Float64Array(n * d);
    for (let i = 0; i < n * d; ++i) data[i] = rnd();
    return { data, n, d };
}

const fmt = (ms: number) => (ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`);

console.log("\nFull k-curve (all k) + AUC + per-point locals, single-threaded\n");
console.log("     N | D_hi |     time | working set | rows/s");
console.log("-------|------|----------|-------------|-------");

for (const [n, dHi] of [[500, 50], [1000, 50], [2000, 50], [4000, 50], [8000, 50], [4000, 2], [4000, 200]] as const) {
    const hd = vectors(n, dHi, 1), ld = vectors(n, 2, 2);
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    const t = performance.now();
    const cr = sickle.coRanking(hd, ld, { localK: [10, 25] });
    sickle.aucLogRnx(cr);
    sickle.trustworthinessCurve(cr);
    const ms = performance.now() - t;
    const mb = (process.memoryUsage().heapUsed - before) / 1048576;
    console.log(
        `${String(n).padStart(6)} | ${String(dHi).padStart(4)} | ${fmt(ms).padStart(8)} | ` +
        `${mb.toFixed(1).padStart(8)} MB | ${(n / (ms / 1000)).toFixed(0)}`,
    );
}
console.log();
