import * as sickle from "../src/index.ts";
import { lcg } from "../test/fixtures.ts";

function vectors(n: number, d: number, seed: number): sickle.Vectors {
    const rnd = lcg(seed);
    const data = new Float64Array(n * d);
    for (let i = 0; i < n * d; ++i) data[i] = rnd();
    return { data, n, d };
}

const fmt = (ms: number) => (ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`);

console.log(`\nCores reported: ${sickle.defaultPoolSize()}\n`);
console.log("     N | D_hi |     sync |  1 worker |  2 workers |  4 workers |  8 workers | best speedup");
console.log("-------|------|----------|-----------|------------|------------|------------|-------------");

for (const [n, dHi] of [[2000, 50], [4000, 50], [8000, 50], [4000, 2]] as const) {
    const hd = vectors(n, dHi, 1), ld = vectors(n, 2, 2);

    let t = performance.now();
    sickle.coRanking(hd, ld, { localK: [10] });
    const sync = performance.now() - t;

    const times: number[] = [];
    for (const workers of [1, 2, 4, 8]) {
        t = performance.now();
        await sickle.coRankingAsync(hd, ld, { localK: [10], workers, parallelThreshold: 1 });
        times.push(performance.now() - t);
    }
    const best = Math.min(...times);
    console.log(
        `${String(n).padStart(6)} | ${String(dHi).padStart(4)} | ${fmt(sync).padStart(8)} | ` +
        times.map((x) => fmt(x).padStart(9)).join(" | ") +
        ` | ${(sync / best).toFixed(2)}x`,
    );
}
console.log();
