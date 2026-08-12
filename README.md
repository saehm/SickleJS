## sickle — Quality Metrics for Dimensionality-Reduction Projections.

<a href="#"><img src="https://raw.githubusercontent.com/saehm/SickleJS/refs/heads/main/icon.svg" width=80 align="left" hspace="10" vspace="6"></a>

Every projection distorts. The question is not whether, but how much and in which way — and no single number answers it.
sickle gives you 33 measures across eight families behind one API, each declaring what it needs, what it ranges over, and what it was verified against.

<br>

[![CI](https://img.shields.io/github/actions/workflow/status/saehm/SickleJS/ci.yml?branch=main&label=tests)](https://github.com/saehm/SickleJS/actions/workflows/ci.yml)
![NPM Downloads](https://img.shields.io/npm/dw/%40saehrimnir%2Fsickle)
[![License](https://img.shields.io/github/license/saehm/SickleJS)](https://raw.githubusercontent.com/saehm/SickleJS/refs/heads/main/LICENCE)

### Installation

If you use npm, install with `npm install @saehrimnir/sickle`, and use it with

```js
import * as sickle from "@saehrimnir/sickle";
```

Otherwise download the files [here](https://github.com/saehm/SickleJS/releases/latest), or use for instance [unpkg](https://unpkg.com/@saehrimnir/sickle/dist/sickle.umd.js) this way:

```html
<script src="https://unpkg.com/@saehrimnir/sickle/dist/sickle.umd.js"></script>
```

### Quick start

```js
import * as sickle from "@saehrimnir/sickle";

const a = sickle.analyze(data, projection); // one O(N²·D) sweep

sickle.trustworthiness(a.coRanking, 20); // 0.9659 — are the drawn neighbours real?
sickle.continuity(a.coRanking, 20);      // 0.9709 — are the real ones still drawn together?
sickle.stress(a.moments).value;          // 0.0807 — did the distances survive?
```

Almost every measure is a cheap read-out of a shared pass, so computing eight costs what computing one costs.
Inputs are `number[][]`, a DruidJS `Matrix` (zero-copy), or an already-converted `Vectors`.

A few accumulators are off by default because they are not free. Ask for them when you set the pass up, not when you read the measure:

```js
const a = sickle.analyze(data, projection, {
    localK: [20],   // per-point values, at these k
    densityK: 20,   // for densityPreservation
    triplets: true, // for tripletAccuracy
    ccaLambda: 1,   // for curvilinearStress
});
```

Past roughly 5 000 points, move the sweep to workers. The result is bit-identical, and the worker is inlined into the published bundle, so it needs no bundler configuration:

```js
const a = await sickle.analyzeAsync(data, projection, { localK: [20] });
```

### Measures

**Neighbourhood** —
[trustworthiness](https://saehm.github.io/SickleJS/families/neighbourhood/) ·
[continuity](https://saehm.github.io/SickleJS/families/neighbourhood/) ·
[qnx](https://saehm.github.io/SickleJS/families/neighbourhood/) ·
[rnx](https://saehm.github.io/SickleJS/families/neighbourhood/) ·
[lcmc](https://saehm.github.io/SickleJS/families/neighbourhood/) ·
[aucLogRnx](https://saehm.github.io/SickleJS/families/neighbourhood/) ·
[mrreFalse](https://saehm.github.io/SickleJS/families/neighbourhood/) ·
[mrreMissing](https://saehm.github.io/SickleJS/families/neighbourhood/)

**Distance** —
[stress](https://saehm.github.io/SickleJS/families/distance/) ·
[scaleNormalizedStress](https://saehm.github.io/SickleJS/families/distance/) ·
[nonMetricStress](https://saehm.github.io/SickleJS/families/distance/) ·
[pearsonR](https://saehm.github.io/SickleJS/families/distance/) ·
[spearmanRho](https://saehm.github.io/SickleJS/families/distance/) ·
[residualVariance](https://saehm.github.io/SickleJS/families/distance/)

**Embedding cost** —
[sammonStress](https://saehm.github.io/SickleJS/families/embedding/) ·
[curvilinearStress](https://saehm.github.io/SickleJS/families/embedding/) ·
[nerv](https://saehm.github.io/SickleJS/families/embedding/)

**Class separability** —
[silhouette](https://saehm.github.io/SickleJS/families/separability/) ·
[calinskiHarabasz](https://saehm.github.io/SickleJS/families/separability/) ·
[daviesBouldin](https://saehm.github.io/SickleJS/families/separability/) ·
[dunnIndex](https://saehm.github.io/SickleJS/families/separability/) ·
[distanceConsistency](https://saehm.github.io/SickleJS/families/separability/) ·
[averageBetweenWithin](https://saehm.github.io/SickleJS/families/separability/) ·
[hypothesisMargin](https://saehm.github.io/SickleJS/families/separability/) ·
[neighborhoodHit](https://saehm.github.io/SickleJS/families/separability/) ·
[classificationError](https://saehm.github.io/SickleJS/families/separability/) ·
[gabrielClassificationError](https://saehm.github.io/SickleJS/families/separability/)

**Structure** — [densityPreservation](https://saehm.github.io/SickleJS/families/structure/) · [tripletAccuracy](https://saehm.github.io/SickleJS/families/structure/)

**Topology** — [topologicalH0](https://saehm.github.io/SickleJS/families/topology/) · [topologicalH1](https://saehm.github.io/SickleJS/families/topology/)

**Cluster reliability** — [snc](https://saehm.github.io/SickleJS/families/snc/) (steadiness & cohesiveness)

**Scagnostics** — [nine shape measures](https://saehm.github.io/SickleJS/families/scagnostics/) of the projection alone: outlying, skewed, clumpy, sparse, striated, convex, skinny, stringy, monotonic

```js
const cl = sickle.clusters(projection, labels); // built once, shared by ten measures
sickle.silhouette(projection, cl).value;
sickle.scagnostics(projection); // { outlying, skewed, clumpy, ... }
```

### Per-point values have a contract

Where a measure decomposes, the `local` array comes with a `localKind` saying how it relates to the total — `mean`, `share`, `sum`, `partial-mean` or `none`.
They are not interchangeable: averaging a `share` does not give the total, and colouring one on a "0 = good" scale claims every point is nearly perfect.

`checkContract()` asserts the declared relationship, and the test suite applies it to every registered measure.
See [Reading a score](https://saehm.github.io/SickleJS/interpreting/).

### Verification

Every measure says what it was checked against, in three tiers: a published reference implementation (zadu, scikit-learn, scipy, gudhi, ripser, DRquality, Scagnostics2018), a naive transcription of the definition, or behaviour only.
The [verification page](https://saehm.github.io/SickleJS/verification/) gives the tolerance for each, and documents the places where sickle deliberately does *not* match its reference — including a scipy MST that drops zero-weight edges and a DRquality division that silently discards Gabriel leaves.

```sh
pnpm fixtures   # regenerate the CSVs (deterministic)
pnpm reference  # regenerate reference.json  — needs: pip install zadu
pnpm test
```

### Performance

One pass, every measure, every `k`. The co-ranking matrix is `(N-1)²` — 400 MB at N = 10 000 — so it is never materialised; every quantity is a range update over `k`, folded into difference arrays and resolved by one prefix sum. That gives the complete curve in O(N² log N) time and **O(N) memory**.

Partial passes are a monoid, so `analyzeAsync` splits rows across workers and recombines in a fixed order — bit-identical to the single-threaded run, asserted with `deepEqual` rather than a tolerance. No `SharedArrayBuffer`, so no cross-origin-isolation requirement.

Numbers, complexity per measure and the ceilings that make a measure refuse rather than exhaust memory: [Performance](https://saehm.github.io/SickleJS/performance/).

### Resources

- [Documentation](https://saehm.github.io/SickleJS/)
- [Choosing a measure](https://saehm.github.io/SickleJS/choosing/) — the decision path, and the full capability matrix
- [Where measures disagree](https://saehm.github.io/SickleJS/disagreements/) — six cases where one number lies
- [API Reference](https://saehm.github.io/SickleJS/api/)

Built to interoperate with [DruidJS](https://github.com/saehm/DruidJS), which produces the projections it scores.

> **Status:** neighbourhood, distance, embedding-cost, separability, structure, topology, cluster-reliability and scagnostics families are implemented and verified.
> Still missing: Procrustes and the topographic product. Persistent homology covers H0 and H1; H1 is capped at ~200 points, see [`src/metrics/NOTES-topology.md`](./src/metrics/NOTES-topology.md).
> SepMe lives in its own project ([SepMeJS](https://github.com/saehm/SepMeJS)) — a framework of 2002 measures with a different contract, not a metric.
