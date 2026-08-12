---
title: Getting started
description: Install sickle, run one pass, read several measures out of it.
---

## Install

```sh
npm install @saehrimnir/sickle
```

ESM, CommonJS and a browser build are all published. TypeScript types are included.

```js
import * as sickle from "@saehrimnir/sickle";
```

For a plain `<script>` tag, point at the UMD build explicitly — the package's `main`
is CommonJS, so the bare unpkg URL will not run in a browser. The build exposes a
global named `sickle`:

```html
<script src="https://unpkg.com/@saehrimnir/sickle/dist/sickle.umd.js"></script>
```

Bundlers resolve `"browser"` to the ESM build, so `import` works there without this.

## The shape of the library

Almost every measure here needs the same expensive thing: the distance from every
point to every other point, in both spaces. Computing that once and reading many
measures out of it is the difference between a library you can use and one you run
overnight.

So the library is in two halves:

- **A pass** sweeps over the point pairs and accumulates. `analyze()` is the one you
  usually want.
- **Measures** are cheap read-outs of a pass. `trustworthiness(cr, k)` is arithmetic
  on numbers the pass already has.

```js
import { analyze, trustworthiness, continuity, stress } from "@saehrimnir/sickle";

// number[][], a DruidJS Matrix, or an already-converted Vectors — all fine.
const a = analyze(originalData, projection);

trustworthiness(a.coRanking, 20);     // 0.9659
continuity(a.coRanking, 20);          // 0.9709
stress(a.moments).value;              // 0.0807
```

Those three cost one sweep between them, not three.

### What counts as input

Every entry point accepts `number[][]`, a DruidJS `Matrix`, or an already-converted
`Vectors`, and normalises internally. Adopting a `Matrix` or a `Vectors` is free — no
copy is made. A `number[][]` is copied into a flat `Float64Array` each time, so if you
are reading several measures off the same points, convert once and reuse:

```js
import { toVectors, clusters, silhouette, daviesBouldin } from "@saehrimnir/sickle";

const ld = toVectors(projection);        // one copy, not three
const cl = clusters(ld, labels);
silhouette(ld, cl).value;
daviesBouldin(ld, cl).value;
```

The one input that cannot be passed bare is a flat `Float64Array`: it carries no
column count, so there is nothing to infer the dimension from. Give it one:

```js
const hd = toVectors(buffer, 8);   // 8 columns
```

## Some measures need the pass to be told

A few accumulators are off by default, because they are not free. Ask for them when
you set the pass up, not when you read the measure — this is the mistake people
actually make:

```js
const a = analyze(hd, ld, {
    densityK: 20,      // for densityPreservation
    triplets: true,    // for tripletAccuracy
    ccaLambda: 1,      // for curvilinearStress
    localK: [20],      // per-point values at k = 20
});

densityPreservation(a.structure).value;
tripletAccuracy(a.structure).value;
```

Reading one of those out of a pass that was not told to collect it throws an error
naming the option it needs, rather than returning a wrong number.

## Per-point values

Where a measure decomposes per point it returns a `local` array, and where it returns
a full result object it also carries a `localKind` saying what the array *means*.
They are not interchangeable:

```js
import { localTrustworthiness, stress } from "@saehrimnir/sickle";

// A bare Float64Array: per-point scores that average to trustworthiness(cr, 20).
const t = localTrustworthiness(a.coRanking, 20);

// A result object, so it can declare its kind:
const s = stress(a.moments);
s.localKind;   // "share" — s.local sums to 1, it does not average to s.value
```

The dedicated `local*` functions return the array alone; the measures that return a
`MetricResult` are the ones that carry `localKind`.

Averaging a `share` gives a number that is not the stress. See
[Reading a score](/SickleJS/interpreting/#per-point-values) before you colour a
scatterplot by one.

## Labels

Ten measures need class labels. They take them directly:

```js
import { clusters, silhouette, neighborhoodHit } from "@saehrimnir/sickle";

const cl = clusters(ld, labels);
silhouette(ld, cl).value;
neighborhoodHit(ld, labels, 20).value;
```

`clusters()` does the bookkeeping once so that several label measures can share it.

## Large inputs

The pass is O(N² log N). Past roughly 5 000 points, move it to workers:

```js
import { analyzeAsync } from "@saehrimnir/sickle";

const a = await analyzeAsync(hd, ld, { localK: [20] });
```

The result is **bit-identical** to the synchronous call — the pass splits by rows and
recombines in a fixed order, so the worker count cannot change the arithmetic. See
[Performance](/SickleJS/performance/) for what the test suite checks. The worker is
inlined into the published bundle, so this needs no bundler configuration.

## With DruidJS

sickle takes a DruidJS `Matrix` without copying it, because both use the same flat
row-major `Float64Array` layout:

```js
import { Matrix, PCA } from "@saehrimnir/druidjs";

const X = Matrix.from(data);
const Y = new PCA(X, { d: 2 }).transform();

const a = analyze(X, Y);
```

DruidJS is a regular dependency, installed with sickle: `snc` uses its k-means and
the scagnostics use its minimum spanning tree, so it has to resolve at runtime even
if you never import it yourself. The zero-copy handoff above is the only part that is
optional — `toVectors` reads the `Matrix`'s buffer directly rather than converting it.

## Next

- [Choosing a measure](/SickleJS/choosing/) — the decision path, and the full matrix.
- [Reading a score](/SickleJS/interpreting/) — why 0.7 trustworthiness is bad news.
- [Where measures disagree](/SickleJS/disagreements/) — six cases where one number lies.
