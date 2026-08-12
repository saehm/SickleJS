/*
 * Computes every number the site shows, once, at build time.
 *
 * Two reasons this is not done in the browser. Four measures must not run live
 * at all — `topologicalH1` is O(N³), `snc` and `spearmanRho` and
 * `nonMetricStress` all materialise every pair — and precomputing the rest
 * means the pages show the *same* numbers the test suite asserts on, rather
 * than numbers a demo happened to produce.
 *
 * Input is `test/fixtures/data/`, the five datasets the test suite already
 * uses. Output is `docs/public/data/*.json`.
 *
 * Run with `pnpm --filter @saehrimnir/sickle-docs precompute` (the docs build
 * runs it first).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as sickle from "@saehrimnir/sickle";
/*
 * The constructions live in the test suite, and both consumers import the
 * same file. That is what lets the disagreements page say its numbers are
 * numbers an assertion holds for — a second copy here would make the claim
 * silently false the first time either side was edited.
 */
import {
    compressedGaps,
    densityFlattened,
    falseSeparation,
    groupSplit,
    loopAndArc,
    strayPoints,
} from "../../test/cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const fixtures = join(root, "test", "fixtures", "data");
const outDir = join(here, "..", "public", "data");
mkdirSync(outDir, { recursive: true });

const csv = (p) =>
    readFileSync(p, "utf8").trim().split("\n").map((l) => l.split(",").map(Number));

/** Round for transport. Twelve digits is far more than any plot can show. */
const r = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
const arr = (a) => Array.from(a, r);

/** A metric result, flattened for JSON, keeping the contract field. */
function result(res) {
    return {
        value: r(res.value),
        localKind: res.localKind,
        local: res.local ? arr(res.local) : null,
    };
}

/** `f()` or, if the measure legitimately refuses this input, the reason. */
function attempt(label, f) {
    try {
        return f();
    } catch (e) {
        console.log(`    ${label}: skipped — ${e.message.split("\n")[0]}`);
        return null;
    }
}

// --------------------------------------------------------------- the datasets

const manifest = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8"));

/** Neighbourhood size used everywhere on the site unless a page says otherwise. */
const K = 20;

/*
 * `k` is a parameter, not a constant, and the whole point of the neighbourhood
 * family is that the answer moves with it — so the demo lets the reader change
 * it. The pass produces every k at once, so the only extra cost here is the
 * per-k k-NN for the two label measures that need one.
 */
const K_CHOICES = [5, 10, 20, 50];

/*
 * Parameter sweeps for the measures whose parameter is the interesting part.
 *
 * NeRV's λ is not a tuning knob, it is the question being asked — 0 penalises
 * only false neighbours, 1 only missing ones — so a demo that pins it to 0.5
 * hides the measure's whole point. Same for CCA's kernel width and the
 * neighbourhood size density preservation is measured over.
 *
 * Each combination is a separate pass, which is affordable: a NeRV pass is
 * ~70 ms at n = 500, the CCA and density passes ~40 ms.
 */
const SWEEPS = {
    nerv: { lambda: [0, 0.5, 1], perplexity: [10, 30, 50] },
    curvilinearStress: { lambda: [0.5, 1, 2] },
    densityPreservation: { densityK: [5, 10, 20, 50] },
};

/** Fixed parameters, emitted so the page can state them rather than guess. */
const PARAMS = {
    densityK: K,
    ccaLambda: 1,
    nervLambda: 0.5,
    nervPerplexity: 30,
    sncIterations: 100,
    sncSeed: 42,
    h1Points: 150,
};

/** Evenly spaced indices — deterministic, and it cannot cluster the way a draw can. */
function subsample(n, target) {
    if (n <= target) return Array.from({ length: n }, (_, i) => i);
    const step = n / target;
    return Array.from({ length: target }, (_, i) => Math.floor(i * step));
}

const pick = (rows, idx) => sickle.toVectors(idx.map((i) => rows[i]));

function computeDataset(meta) {
    const X = csv(join(fixtures, `${meta.name}.X.csv`));
    const Y = csv(join(fixtures, `${meta.name}.Y.csv`));
    const labels = csv(join(fixtures, `${meta.name}.labels.csv`)).map((row) => row[0]);
    const hd = sickle.toVectors(X);
    const ld = sickle.toVectors(Y);
    const n = hd.n;
    const k = Math.min(K, sickle.maxKTrustworthiness(n));

    console.log(`  ${meta.name} (n=${n}, D=${meta.dHigh})`);

    // One sweep carries the rank, distance, embedding, density and triplet
    // accumulators. This is the call the demos show, because forgetting an
    // option here is the mistake people actually make.
    const ks = K_CHOICES.filter((v) => v <= sickle.maxKTrustworthiness(n));
    const a = sickle.analyze(hd, ld, {
        localK: ks,
        densityK: PARAMS.densityK,
        triplets: true,
        ccaLambda: PARAMS.ccaLambda,
    });
    const cr = a.coRanking;
    const cl = sickle.clusters(ld, labels);
    const knn = sickle.knnIndices(ld, k);

    /*
     * Every combination of the sweeps above, keyed by the parameter values
     * joined in declared order. Each entry is a full metric result, so the page
     * swaps both the number and the per-point colouring when a knob moves.
     */
    const variants = {};
    for (const [name, axes] of Object.entries(SWEEPS)) {
        const names = Object.keys(axes);
        const combos = names.reduce(
            (acc, p) => acc.flatMap((c) => axes[p].map((v) => [...c, v])),
            [[]],
        );
        const table = {};
        for (const combo of combos) {
            const opt = Object.fromEntries(names.map((p, i) => [p, combo[i]]));
            if (name === "nerv") {
                const p = sickle.nervPass(hd, ld, opt);
                const res = sickle.nerv(p);
                table[combo.join("|")] = {
                    ...result(res),
                    recall: r(res.recall),
                    precision: r(res.precision),
                };
            } else if (name === "curvilinearStress") {
                const pass = sickle.analyze(hd, ld, { ranks: false, ccaLambda: opt.lambda });
                table[combo.join("|")] = result(sickle.curvilinearStress(pass.embedding));
            } else {
                const pass = sickle.analyze(hd, ld, { ranks: false, densityK: opt.densityK });
                table[combo.join("|")] = result(sickle.densityPreservation(pass.structure));
            }
        }
        variants[name] = { params: names, values: axes, table };
    }

    /* Everything that moves with k, at each k the reader can pick. */
    const byK = Object.fromEntries(ks.map((kk) => {
        const nn = sickle.knnIndices(ld, kk);
        return [kk, {
            scalars: {
                trustworthiness: r(sickle.trustworthiness(cr, kk)),
                continuity: r(sickle.continuity(cr, kk)),
                qnx: r(sickle.qnx(cr, kk)),
                lcmc: r(sickle.lcmc(cr, kk)),
                rnx: r(sickle.rnx(cr, kk)),
                mrreFalse: r(sickle.mrreFalse(cr, kk)),
                mrreMissing: r(sickle.mrreMissing(cr, kk)),
                neighborhoodHit: r(sickle.neighborhoodHit(ld, labels, kk, nn).value),
                classificationError: r(sickle.classificationError(ld, labels, kk, nn).value),
            },
            locals: {
                trustworthiness: { localKind: "mean", local: arr(sickle.localTrustworthiness(cr, kk)) },
                continuity: { localKind: "mean", local: arr(sickle.localContinuity(cr, kk)) },
                mrreFalse: { localKind: "mean", local: arr(sickle.localMrreFalse(cr, kk)) },
                mrreMissing: { localKind: "mean", local: arr(sickle.localMrreMissing(cr, kk)) },
                neighborhoodHit: result(sickle.neighborhoodHit(ld, labels, kk, nn)),
                classificationError: result(sickle.classificationError(ld, labels, kk, nn)),
            },
        }];
    }));
    // NeRV is its own pass: it fits a Gaussian per point by bisection.
    const nervResult = sickle.nervPass(hd, ld, { lambda: 0.5, perplexity: 30 });

    // A Curve is indexed by k, so slot 0 is unused and slots past kMax are NaN;
    // ship only the defined span and the k it starts at.
    const curve = (c) => ({
        kMin: c.kMin,
        kMax: c.kMax,
        values: arr(c.values.slice(c.kMin, c.kMax + 1)),
    });

    return {
        name: meta.name,
        description: meta.description,
        n,
        dHigh: meta.dHigh,
        clusters: meta.clusters,
        k,
        ks,
        byK,
        variants,
        params: PARAMS,
        points: Y.map(([x, y]) => [r(x), r(y)]),
        labels,

        scalars: {
            trustworthiness: r(sickle.trustworthiness(cr, k)),
            continuity: r(sickle.continuity(cr, k)),
            qnx: r(sickle.qnx(cr, k)),
            lcmc: r(sickle.lcmc(cr, k)),
            rnx: r(sickle.rnx(cr, k)),
            aucLogRnx: r(sickle.aucLogRnx(cr)),
            mrreFalse: r(sickle.mrreFalse(cr, k)),
            mrreMissing: r(sickle.mrreMissing(cr, k)),

            stress: r(sickle.stress(a.moments).value),
            scaleNormalizedStress: r(sickle.scaleNormalizedStress(a.moments).value),
            pearsonR: r(sickle.pearsonR(a.moments).value),
            residualVariance: r(sickle.residualVariance(a.moments).value),
            spearmanRho: r(sickle.spearmanRho(hd, ld).value),
            nonMetricStress: r(sickle.nonMetricStress(hd, ld).value),

            sammonStress: r(sickle.sammonStress(a.embedding).value),
            curvilinearStress: r(sickle.curvilinearStress(a.embedding).value),
            nerv: r(sickle.nerv(nervResult).value),
            nervRecall: r(sickle.nerv(nervResult).recall),
            nervPrecision: r(sickle.nerv(nervResult).precision),

            silhouette: r(sickle.silhouette(ld, cl).value),
            calinskiHarabasz: r(sickle.calinskiHarabasz(ld, cl).value),
            daviesBouldin: r(sickle.daviesBouldin(ld, cl).value),
            dunnIndex: r(sickle.dunnIndex(ld, cl).value),
            distanceConsistency: r(sickle.distanceConsistency(ld, cl).value),
            averageBetweenWithin: r(sickle.averageBetweenWithin(ld, cl).value),
            hypothesisMargin: r(sickle.hypothesisMargin(ld, cl).value),
            neighborhoodHit: r(sickle.neighborhoodHit(ld, labels, k, knn).value),
            classificationError: r(sickle.classificationError(ld, labels, k, knn).value),
            gabrielClassificationError: r(sickle.gabrielClassificationError(hd, ld, labels).value),

            densityPreservation: r(sickle.densityPreservation(a.structure).value),
            tripletAccuracy: r(sickle.tripletAccuracy(a.structure).value),

            topologicalH0: r(sickle.topologicalH0(hd, ld).value),
            // H1 enumerates every triangle, so it is computed on an evenly
            // spaced subsample. The page says so — a number quietly taken from
            // 150 of 500 points, presented as if from all 500, is exactly the
            // kind of thing this library exists to stop.
            topologicalH1: attempt("topologicalH1", () => {
                const s = subsample(n, 150);
                return r(sickle.topologicalH1(
                    pick(X, s), pick(Y, s), { maxPoints: 150 },
                ).value);
            }),
            topologicalH1Points: Math.min(n, 150),

            ...(() => {
                const s = sickle.snc(hd, ld, { iterations: 100, seed: 42 });
                return { steadiness: r(s.steadiness), cohesiveness: r(s.cohesiveness) };
            })(),
        },

        scagnostics: Object.fromEntries(
            Object.entries(sickle.scagnostics(ld)).map(([key, v]) => [key, r(v)]),
        ),

        // The per-point arrays, each tagged with the kind that says how to
        // render it. Kinds are not interchangeable — see the docs page.
        locals: {
            trustworthiness: {
                localKind: "mean",
                local: arr(sickle.localTrustworthiness(cr, k)),
            },
            continuity: { localKind: "mean", local: arr(sickle.localContinuity(cr, k)) },
            mrreFalse: { localKind: "mean", local: arr(sickle.localMrreFalse(cr, k)) },
            mrreMissing: { localKind: "mean", local: arr(sickle.localMrreMissing(cr, k)) },
            stress: result(sickle.stress(a.moments)),
            sammonStress: result(sickle.sammonStress(a.embedding)),
            curvilinearStress: result(sickle.curvilinearStress(a.embedding)),
            nerv: result(sickle.nerv(nervResult)),
            silhouette: result(sickle.silhouette(ld, cl)),
            distanceConsistency: result(sickle.distanceConsistency(ld, cl)),
            hypothesisMargin: result(sickle.hypothesisMargin(ld, cl)),
            neighborhoodHit: result(sickle.neighborhoodHit(ld, labels, k, knn)),
            classificationError: result(sickle.classificationError(ld, labels, k, knn)),
            gabrielClassificationError: result(sickle.gabrielClassificationError(hd, ld, labels)),
            densityPreservation: result(sickle.densityPreservation(a.structure)),
            tripletAccuracy: result(sickle.tripletAccuracy(a.structure)),
        },

        curves: {
            trustworthiness: curve(sickle.trustworthinessCurve(cr)),
            continuity: curve(sickle.continuityCurve(cr)),
            qnx: curve(sickle.qnxCurve(cr)),
            lcmc: curve(sickle.lcmcCurve(cr)),
            rnx: curve(sickle.rnxCurve(cr)),
        },

        // Shepard diagram: projected distance against original distance. A
        // sample, because n² points is both unreadable and a large file.
        shepard: shepardSample(X, Y, 4000, 12345),
    };
}

/** Distance pairs for a Shepard diagram, sampled deterministically. */
function shepardSample(X, Y, target, seed) {
    const n = X.length;
    const total = (n * (n - 1)) / 2;
    const stride = Math.max(1, Math.floor(total / target));
    let s = seed >>> 0;
    const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;

    const euclid = (a, b) => {
        let acc = 0;
        for (let i = 0; i < a.length; ++i) { const d = a[i] - b[i]; acc += d * d; }
        return Math.sqrt(acc);
    };

    const pairs = [];
    let seen = 0;
    for (let i = 0; i < n; ++i) {
        for (let j = i + 1; j < n; ++j) {
            if (seen++ % stride !== 0) continue;
            void next();
            pairs.push([r(euclid(X[i], X[j])), r(euclid(Y[i], Y[j]))]);
        }
    }
    return pairs;
}

console.log("datasets:");
const datasets = manifest.map(computeDataset);
for (const d of datasets) {
    writeFileSync(join(outDir, `${d.name}.json`), JSON.stringify(d));
}
writeFileSync(
    join(outDir, "datasets.json"),
    JSON.stringify(
        datasets.map((d) => ({
            name: d.name,
            description: d.description,
            n: d.n,
            dHigh: d.dHigh,
            clusters: d.clusters,
            k: d.k,
        })),
        null,
        2,
    ),
);

// ------------------------------------------------------- the disagreements

/*
 * Each of these is a passing test lifted out of `test/`. The point is not that
 * one measure is better: it is that a single number would have missed
 * something, and which number depends on which distortion you care about.
 */

const cases = [];

function addCase({
    id, title, fooled, caught, fooledLabel, caughtLabel, hd, ld, labels, highlight, measure,
}) {
    const H = sickle.toVectors(hd), L = sickle.toVectors(ld);
    console.log(`  ${id}`);
    cases.push({
        id,
        title,
        fooled,
        caught,
        fooledLabel: fooledLabel ?? "misses it",
        caughtLabel: caughtLabel ?? "catches it",
        n: H.n,
        // Only shown when the data is already 2-D and can be drawn honestly.
        hdPoints: H.d === 2 ? hd.map(([x, y]) => [r(x), r(y)]) : null,
        ldPoints: ld.map(([x, y]) => [r(x), r(y)]),
        labels: labels ?? null,
        highlight: highlight ?? null,
        values: measure(H, L, labels),
    });
}

console.log("disagreement cases:");

{
    const { hd, ld } = loopAndArc(50);
    addCase({
        id: "loop-unrolled",
        title: "A circle unrolled into an arc",
        fooled: "trustworthiness",
        caught: "topologicalH1",
        hd, ld,
        measure: (H, L) => {
            const cr = sickle.coRanking(H, L);
            const h1 = sickle.topologicalH1(H, L);
            return {
                trustworthiness: r(sickle.trustworthiness(cr, 5)),
                continuity: r(sickle.continuity(cr, 5)),
                topologicalH0: r(sickle.topologicalH0(H, L).value),
                topologicalH1: r(h1.value),
                hdLoops: h1.hdDiagram.length,
                ldLoops: h1.ldDiagram.length,
            };
        },
    });
}

{
    const { hd, ld } = densityFlattened();
    addCase({
        id: "density-flattened",
        title: "A tight cluster inflated to match a diffuse one",
        fooled: "trustworthiness",
        caught: "densityPreservation",
        hd, ld,
        measure: (H, L) => {
            const cr = sickle.coRanking(H, L);
            const a = sickle.analyze(H, L, { densityK: 5 });
            return {
                trustworthiness: r(sickle.trustworthiness(cr, 5)),
                continuity: r(sickle.continuity(cr, 5)),
                densityPreservation: r(sickle.densityPreservation(a.structure).value),
            };
        },
    });
}

{
    const { hd, ld } = groupSplit();
    addCase({
        id: "group-split",
        title: "One real group drawn as two",
        fooled: "trustworthiness",
        // Cohesiveness, not steadiness: the projection does not merge anything
        // that was apart, it splits something that was together.
        caught: "cohesiveness",
        hd, ld,
        measure: (H, L) => {
            const cr = sickle.coRanking(H, L);
            const s = sickle.snc(H, L, { iterations: 200, seed: 42 });
            return {
                trustworthiness: r(sickle.trustworthiness(cr, 10)),
                continuity: r(sickle.continuity(cr, 10)),
                steadiness: r(s.steadiness),
                cohesiveness: r(s.cohesiveness),
            };
        },
    });
}

{
    const { hd, ld, labels } = falseSeparation();
    addCase({
        id: "false-separation",
        title: "Classes drawn cleanly apart that overlap in the data",
        fooled: "silhouette",
        // Not GCE, despite the obvious guess. GCE charges for drawn-adjacent
        // pairs weighted by how far apart they *really* are — and here the two
        // classes are on top of each other in the data, so a cross-class edge
        // is genuinely short and costs almost nothing. The measure that notices
        // the separation is invented is the one that checks whether the drawn
        // neighbourhoods are real at all.
        caught: "trustworthiness",
        hd, ld, labels,
        measure: (H, L, lab) => {
            const cl = sickle.clusters(L, lab);
            return {
                silhouette: r(sickle.silhouette(L, cl).value),
                distanceConsistency: r(sickle.distanceConsistency(L, cl).value),
                neighborhoodHit: r(sickle.neighborhoodHit(L, lab, 10).value),
                gabrielClassificationError: r(sickle.gabrielClassificationError(H, L, lab).value),
                trustworthiness: r(sickle.trustworthiness(sickle.coRanking(H, L), 10)),
            };
        },
    });
}

{
    const { hd, ld, labels, strayIndices } = strayPoints(6);
    addCase({
        id: "stray-points",
        title: "A few points drawn inside the wrong class",
        fooled: "silhouette",
        caught: "gabrielClassificationError",
        hd, ld, labels,
        highlight: strayIndices,
        measure: (H, L, lab) => {
            const cl = sickle.clusters(L, lab);
            return {
                silhouette: r(sickle.silhouette(L, cl).value),
                distanceConsistency: r(sickle.distanceConsistency(L, cl).value),
                neighborhoodHit: r(sickle.neighborhoodHit(L, lab, 10).value),
                gabrielClassificationError: r(sickle.gabrielClassificationError(H, L, lab).value),
                // The same layout without the strays, for the comparison the
                // page makes: only GCE moves appreciably.
                gceBaseline: r((() => {
                    const clean = strayPoints(0);
                    return sickle.gabrielClassificationError(
                        sickle.toVectors(clean.hd), sickle.toVectors(clean.ld), clean.labels,
                    ).value;
                })()),
            };
        },
    });
}

{
    const { hd, ld } = compressedGaps();
    addCase({
        id: "gaps-compressed",
        title: "Cluster gaps four times too small, orderings intact",
        // Not "misses it" / "catches it": both measures are right, and they are
        // answering different questions. The labels say so.
        fooled: "scaleNormalizedStress",
        fooledLabel: "calls it bad",
        caught: "nonMetricStress",
        caughtLabel: "calls it fine",
        hd, ld,
        measure: (H, L) => {
            const a = sickle.analyze(H, L);
            return {
                stress: r(sickle.stress(a.moments).value),
                scaleNormalizedStress: r(sickle.scaleNormalizedStress(a.moments).value),
                pearsonR: r(sickle.pearsonR(a.moments).value),
                spearmanRho: r(sickle.spearmanRho(H, L).value),
                nonMetricStress: r(sickle.nonMetricStress(H, L).value),
            };
        },
    });
}

writeFileSync(join(outDir, "disagreements.json"), JSON.stringify(cases, null, 2));

// ---------------------------------------------------------------- persistence

/*
 * Diagrams for the topology page, from the same circle-and-arc pair the
 * disagreement gallery uses, so the numbers on the two pages agree.
 *
 * Each space is normalised by its own diameter, which is what `topologicalH0`
 * and `topologicalH1` do before comparing — without it the two diagrams sit at
 * different scales and the plot says nothing.
 */
function diagrams(points) {
    const v = sickle.toVectors(points);
    const h0 = sickle.persistenceH0(v);
    const scale = h0.diameter || 1;
    return {
        diameter: r(h0.diameter),
        // H0 features are all born at 0: a point is a component from the start.
        h0: Array.from(h0.deaths, (d) => [0, r(d / scale)]),
        h1: sickle.ripsH1(v, { maxPoints: 200 }).map(([b, d]) => [r(b / scale), r(d / scale)]),
    };
}

console.log("persistence diagrams:");
{
    const { hd, ld } = loopAndArc(50);
    const H = sickle.toVectors(hd), L = sickle.toVectors(ld);
    const h0 = sickle.topologicalH0(H, L);
    const h1 = sickle.topologicalH1(H, L);

    const persistence = {
        id: "loop-unrolled",
        title: "A noisy circle, and the same circle cut open",
        hdLabel: "the data (a circle)",
        ldLabel: "the projection (an arc)",
        hdPoints: hd.map(([x, y]) => [r(x), r(y)]),
        ldPoints: ld.map(([x, y]) => [r(x), r(y)]),
        hd: diagrams(hd),
        ld: diagrams(ld),
        values: {
            topologicalH0: r(h0.value),
            topologicalH1: r(h1.value),
            bottleneckH0: r(sickle.bottleneckH0(h0.hdDiagram.deaths, h0.ldDiagram.deaths)),
            wassersteinH0: r(sickle.wassersteinH0(h0.hdDiagram.deaths, h0.ldDiagram.deaths, 1)),
        },
    };
    console.log(`  ${persistence.id}: H0 ${persistence.hd.h0.length} vs ${persistence.ld.h0.length}` +
        `, H1 ${persistence.hd.h1.length} vs ${persistence.ld.h1.length}`);
    writeFileSync(join(outDir, "persistence.json"), JSON.stringify(persistence, null, 2));
}

console.log(`\nwrote ${datasets.length} datasets and ${cases.length} disagreement cases to public/data`);

/*
 * Several projection methods over the same points, for the "unbounded measures
 * need a baseline" section.
 *
 * The point being made there is that an unbounded score only means something
 * against other projections of the *same* data, so the plots and the table have
 * to come from one computation — a hand-written table beside independently
 * generated pictures is exactly the drift this file exists to prevent.
 *
 * t-SNE and UMAP are stochastic; `Randomizer.seed` fixes them so a rebuild does
 * not silently reorder the rows.
 */
console.log("\nprojection methods:");
{
    const { Matrix, PCA, StressMDS, TSNE, UMAP, Randomizer, WEIGHTS_UNIFORM } =
        await import("@saehrimnir/druidjs");

    const METHODS = {
        PCA: (M) => new PCA(M, { d: 2 }).transform(),
        /*
         * Uniform weights, so this minimises raw Kruskal stress rather than
         * druid's default elastic weighting. That makes it the method the
         * `scaleNormalizedStress` column is actually about.
         */
        StressMDS: (M) => new StressMDS(M, { d: 2, weights: WEIGHTS_UNIFORM }).transform(),
        "t-SNE": (M) => new TSNE(M, { d: 2, perplexity: 30 }).transform(),
        UMAP: (M) => new UMAP(M, { d: 2, n_neighbors: 15 }).transform(),
    };

    const compare = ["blobs_pca", "swissroll"].map((name) => {
        const X = csv(join(fixtures, `${name}.X.csv`));
        const labels = csv(join(fixtures, `${name}.labels.csv`)).map((row) => row[0]);
        const hd = sickle.toVectors(X);
        const M = Matrix.from(X);

        const projections = Object.entries(METHODS).map(([method, run]) => {
            Randomizer.seed = 1212;
            const Y = run(M);
            const ld = sickle.toVectors(Y);
            const cl = sickle.clusters(ld, labels);
            const a = sickle.analyze(hd, ld);
            return {
                method,
                points: Array.from({ length: ld.n }, (_, i) => [r(ld.data[i * ld.d]), r(ld.data[i * ld.d + 1])]),
                scores: {
                    calinskiHarabasz: r(sickle.calinskiHarabasz(ld, cl).value),
                    daviesBouldin: r(sickle.daviesBouldin(ld, cl).value),
                    dunnIndex: r(sickle.dunnIndex(ld, cl).value),
                    silhouette: r(sickle.silhouette(ld, cl).value),
                    trustworthiness: r(sickle.trustworthiness(a.coRanking, 20)),
                    scaleNormalizedStress: r(sickle.scaleNormalizedStress(a.moments).value),
                },
            };
        });

        console.log(`  ${name}: ` + projections.map((p) => `${p.method} CH=${p.scores.calinskiHarabasz.toFixed(0)}`).join(", "));
        return { dataset: name, n: hd.n, d: hd.d, labels, projections };
    });

    writeFileSync(join(outDir, "methods.json"), JSON.stringify(compare, null, 2));
}

/*
 * Where each measure sends the blame.
 *
 * A `share` and a `sum` split one total across the points that caused it, and
 * the reading trap is that a small entry looks like an all-clear. It is not:
 * the weighting decides what gets charged, so the same damage lands very
 * differently depending on the measure. Two cases, deliberately opposite —
 * six misplaced points (localised), and a circle cut into an arc (diffuse).
 *
 * Generated rather than written down: `interpreting.mdx` quotes these ratios,
 * and a hand-copied number is exactly the drift this file exists to prevent.
 */
console.log("\nlocalisation:");
{
    const decompose = (hd, ld) => {
        const H = sickle.toVectors(hd), L = sickle.toVectors(ld);
        const a = sickle.analyze(H, L, { ccaLambda: 1 });
        return {
            stress: sickle.stress(a.moments),
            nonMetricStress: sickle.nonMetricStress(H, L),
            topologicalH0: sickle.topologicalH0(H, L),
            sammonStress: sickle.sammonStress(a.embedding),
            curvilinearStress: sickle.curvilinearStress(a.embedding),
        };
    };

    /** Mean contribution of the marked points against everyone else. */
    const concentration = (local, marked) => {
        const flagged = new Set(marked);
        let inSum = 0, outSum = 0;
        for (let i = 0; i < local.length; ++i) {
            if (flagged.has(i)) inSum += local[i]; else outSum += local[i];
        }
        const inMean = inSum / flagged.size;
        const outMean = outSum / (local.length - flagged.size);
        const order = [...local.keys()].sort((i, j) => local[j] - local[i]);
        return {
            ratio: r(inMean / outMean),
            // What fraction of the whole total the marked points carry ...
            carried: r(inSum / (inSum + outSum)),
            // ... against the fraction of the points they are.
            expected: r(flagged.size / local.length),
            ranks: marked.map((i) => order.indexOf(i)).sort((x, y) => x - y),
        };
    };

    const build = (id, title, note, { hd, ld }, marked) => {
        const results = decompose(hd, ld);
        const measures = Object.entries(results).map(([name, res]) => ({
            name,
            value: r(res.value),
            localKind: res.localKind,
            local: arr(res.local),
            ...concentration(res.local, marked),
        }));
        console.log(`  ${id}: ` + measures.map((m) => `${m.name} ${m.ratio.toFixed(1)}x`).join(", "));
        return {
            id, title, note,
            points: ld.map(([x, y]) => [r(x), r(y)]),
            marked,
            n: ld.length,
            measures,
        };
    };

    const strays = strayPoints(6);
    const loop = loopAndArc(50);
    // The cut runs between the last and first points of the circle.
    const atCut = [0, 1, 2, 47, 48, 49];

    writeFileSync(join(outDir, "localisation.json"), JSON.stringify([
        build(
            "strays",
            "Six points dropped into the wrong class",
            "Damage confined to six of the 160 points. A measure that localises should bill them far above the average point.",
            strays,
            strays.strayIndices,
        ),
        build(
            "unrolled",
            "A circle cut open into an arc",
            "Damage spread over every pair at once. No point is more to blame, and a faithful decomposition should say so.",
            loop,
            atCut,
        ),
    ], null, 2));
}
