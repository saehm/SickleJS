/**
 * Generate the shared fixtures that both sickle and the Python reference score.
 *
 * Data is produced with DruidJS's seeded Mersenne Twister and, where a realistic
 * projection is wanted, DruidJS's own PCA -- so the fixtures exercise exactly the
 * kind of input this library exists to score. Everything is deterministic: the
 * CSVs are committed, and regenerating them must not change a byte.
 *
 *   node --experimental-strip-types tools/export-fixtures.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Matrix, PCA, Randomizer } from "@saehrimnir/druidjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "data");
mkdirSync(OUT, { recursive: true });

const csv = (rows: number[][]) => rows.map((r) => r.map((v) => v.toPrecision(17)).join(",")).join("\n") + "\n";

interface Fixture {
    name: string;
    description: string;
    X: number[][];
    Y: number[][];
    labels: number[];
}

const fixtures: Fixture[] = [];

/** Gaussian blobs in HD, projected with druid's PCA: a realistic, faithful projection. */
function blobsPCA(name: string, n: number, d: number, clusters: number, seed: number): Fixture {
    const r = new Randomizer(seed);
    const centers = Array.from({ length: clusters }, () =>
        Array.from({ length: d }, () => r.gauss_random() * 6));
    const X: number[][] = [], labels: number[] = [];
    for (let i = 0; i < n; ++i) {
        const c = i % clusters;
        X.push(centers[c].map((m) => m + r.gauss_random()));
        labels.push(c);
    }
    // NOTE: `to2dArray` is a method in druid >= 0.9 (it was a getter in 0.7).
    const Y = (PCA.transform(Matrix.from(X), { d: 2 }) as InstanceType<typeof Matrix>)
        .to2dArray()
        .map((row) => Array.from(row));
    return { name, description: `${clusters} gaussian blobs, ${d}-D, projected by druid PCA`, X, Y, labels };
}

/** Same HD data, but a deliberately uninformative random projection. */
function blobsRandom(name: string, n: number, d: number, clusters: number, seed: number): Fixture {
    const base = blobsPCA(name, n, d, clusters, seed);
    const r = new Randomizer(seed + 1000);
    return {
        ...base,
        name,
        description: `${clusters} gaussian blobs, ${d}-D, random 2-D projection (poor)`,
        Y: base.X.map(() => [r.gauss_random(), r.gauss_random()]),
    };
}

/** Swiss roll: the classic case where a linear projection tears the manifold. */
function swissRoll(name: string, n: number, seed: number): Fixture {
    const r = new Randomizer(seed);
    const X: number[][] = [], Y: number[][] = [], labels: number[] = [];
    for (let i = 0; i < n; ++i) {
        const t = 1.5 * Math.PI * (1 + 2 * r.random);
        const h = 21 * r.random;
        X.push([t * Math.cos(t), h, t * Math.sin(t)]);
        Y.push([t, h]);                       // the true 2-D parameterisation
        labels.push(Math.min(3, Math.floor((t - 1.5 * Math.PI) / (Math.PI))));
    }
    return { name, description: "swiss roll, unrolled to its true parameterisation", X, Y, labels };
}

/** Exact duplicate points: makes ranks ambiguous without a deterministic tie-break. */
function withDuplicates(name: string, n: number, d: number, seed: number): Fixture {
    const base = blobsPCA(name, n, d, 3, seed);
    const X = base.X.map((r) => r.slice());
    const Y = base.Y.map((r) => r.slice());
    const dup = Math.floor(n / 6);
    for (let i = 0; i < dup; ++i) {
        X[i] = X[i + dup].slice();
        Y[i] = Y[i + dup].slice();
    }
    return { ...base, name, description: `${dup} exact duplicate points`, X, Y };
}

fixtures.push(
    blobsPCA("blobs_pca", 200, 8, 4, 42),
    blobsRandom("blobs_random", 200, 8, 4, 42),
    swissRoll("swissroll", 300, 7),
    withDuplicates("duplicates", 180, 6, 13),
    blobsPCA("blobs_large", 500, 20, 5, 99),
);

const manifest = fixtures.map((f) => {
    writeFileSync(join(OUT, `${f.name}.X.csv`), csv(f.X));
    writeFileSync(join(OUT, `${f.name}.Y.csv`), csv(f.Y));
    writeFileSync(join(OUT, `${f.name}.labels.csv`), f.labels.join("\n") + "\n");
    return {
        name: f.name,
        description: f.description,
        n: f.X.length,
        dHigh: f.X[0].length,
        dLow: f.Y[0].length,
        clusters: new Set(f.labels).size,
    };
});

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${fixtures.length} fixtures to ${OUT}`);
for (const m of manifest) console.log(`  ${m.name.padEnd(14)} n=${m.n} d=${m.dHigh}->${m.dLow}  ${m.description}`);
