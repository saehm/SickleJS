---
title: Performance
description: What each measure costs, where the ceilings are, and why parallel results are bit-identical.
---

The expensive part is almost never the measure. It is the pass underneath it, and the
whole library is arranged so you pay for that once.

## One pass, every measure

Nearly everything here needs the same thing: every point's distance to every other
point, in both spaces, ranked. That is $O(N^2 \log N)$, and it is the only significant
cost in the library.

So `analyze()` sweeps the pairs once and accumulates everything at the same time —
rank statistics, distance moments, Sammon and CCA terms, density radii, triplet
inversions. Afterwards each measure is arithmetic on numbers that already exist:

```js
const a = analyze(hd, ld, { localK: [20], densityK: 20, triplets: true });

trustworthiness(a.coRanking, 20);   // O(1)
continuity(a.coRanking, 20);        // O(1)
stress(a.moments).value;            // O(1)
tripletAccuracy(a.structure).value; // O(1)
```

Eight neighbourhood measures, six distance measures and two structure measures cost
one sweep between them.

## Every k, for free

A naive implementation computes trustworthiness at one $k$. Computing the curve over
all $k$ then looks like $N$ separate computations.

It is not. A pair with ranks $s$ in the projection and $r$ in the data contributes to
trustworthiness at $k$ exactly when $s \le k < r$, and contributes $r - k$:

$$
\text{penalty}(k) \;=\; \sum_{\substack{(i,j) \\ s_{ij} \,\le\, k \,<\, r_{ij}}} (r_{ij} - k)
$$

So each pair adds a term that is *linear in $k$* over the contiguous range
$k \in [s, r-1]$ — a range update. Two difference arrays, one for the constant part
and one for the coefficient of $k$, turn each pair into $O(1)$ writes; a single prefix
sum at the end yields every $k$ at once. The whole curve costs what one value costs,
in $O(N)$ extra memory.

The co-ranking matrix itself is never materialised. It is $N \times N$ — 400 MB at
$N = 10\,000$ — while the difference arrays are $O(N)$: two `Float64Array`s of length
$N$, about 160 KB at $N = 10\,000$.

## Costs

| stage | cost | notes |
| ---- | ---- | ---- |
| `analyze` / `coRanking` | $O(N^2 \log N)$ | the one expensive thing |
| any neighbourhood measure | $O(1)$ | read-out |
| any distance measure from the pass | $O(1)$ | read-out |
| `spearmanRho`, `nonMetricStress` | $O(N^2 \log N)$, $O(N^2)$ memory | materialise every pair |
| `silhouette`, `dunnIndex`, and most label measures | $O(N^2 D)$ | |
| `calinskiHarabasz` | $O(N D)$ | centroids only |
| `gabrielClassificationError` | $O(N \log N)$ graph, $O(N^2 D)$ weighting | |
| `snc` | $O(N^2)$ time and memory | capped at 6 000 points |
| `nervPass` | $O(N^2 D)$, plus a bisection per point | the slowest pass |
| `topologicalH0` | $O(N^2 D)$ | it is an MST |
| `topologicalH1` | $O(N^3)$ | capped at 200 points |
| scagnostics | $O(N \log N)$ | after binning |

## Ceilings

Four measures will refuse rather than exhaust your memory, each with an option to
override deliberately:

- **`topologicalH1`** — `maxPoints: 200`. It enumerates $\binom{N}{3}$ triangles; at $N = 500$
  that is 20 million. Subsample instead.
- **`snc`** — `maxPoints: 6000`.
- **`spearmanRho`, `nonMetricStress`** — `maxPairs: 60e6`, about 800 MB at
  $N = 10\,000$.

Refusing with a message that names the option is deliberate. Silently sampling, or
silently allocating 8 GB, are both worse.

## Parallelism

Past roughly 5 000 points, move the pass to workers:

```js
const a = await analyzeAsync(hd, ld, { localK: [20] });
const p = await nervAsync(hd, ld);
```

The drivers fall back to the synchronous kernel when workers are unavailable, the
dataset is small, or one worker was requested, so they are always safe to call.

### Bit-identical parallelism

Splitting rows across workers and summing the results gives **exactly** the same
bits as a single-threaded run, for any worker count. That is a stronger guarantee
than "close enough", and it took work to get.

The reason it holds: a partial pass over a row range is a monoid, and every
accumulator is either an integer count — which a double holds exactly and which sums
associatively — or a per-row value written to a slot no other row touches. Floating
point sums are *not* associative, so no float is ever accumulated across a worker
boundary; the per-row values come back untouched and are summed once, in row order, in
the reducer.

What the test suite actually asserts (`test/parallel.test.ts`): with **4 workers**, the
co-ranking pass, the fused `analyze` pass and `nervPass` each come back
`deepEqual`-identical to the synchronous run — penalty arrays, per-point locals, raw
accumulators and the derived scores. Across **2, 3, 5 and 8 workers** the check is
narrower: a single scalar (`trustworthiness` at $k = 20$, `nerv`) must be exactly equal
to the synchronous value. `workers: 1` is not a parallel run at all — the planner
returns no plan and the driver falls back to the synchronous kernel — so it is not
covered by these tests.

### Workers need no configuration

The published bundle carries its worker inlined as a string and spawns it from a Blob
URL in the browser, or `new Worker(src, { eval: true })` in Node. That sidesteps the
one thing a bundler cannot do — rewrite a worker URL it could not statically
pattern-match — so `analyzeAsync` works under Vite, webpack and a plain `<script>` tag
alike.

If you import from `src/` directly rather than the built package, the worker is a real
file behind a runtime-built URL that no bundler can match, and you need to supply a
`workerFactory`. `test/browser/worker.browser.test.ts` has one to copy.

## Sorting is the hot loop

A recorded profiling observation, noted in `src/core/sort.ts`, puts sorting at 61–88% of
the pass's runtime for $D \le 50$ — which covers essentially every projection (the
low-dimensional side is always 2-D) and most high-dimensional inputs. No profiling
harness is committed, so treat that range as the note it is rather than as a
reproducible measurement.

So the argsort is a radix sort on the IEEE-754 bit patterns of the squared distances —
valid because for non-negative doubles the bit pattern is monotone in the value — with
a fixup pass for the rare keys sharing a high word. The source records it as ~2.7×
faster than the introsort it replaces; that figure is a note, not a committed
benchmark. Both sorts break ties by point index, so they are intended to be
interchangeable — but no test compares them directly.

Ranks use squared distances throughout; the square root is only taken where a distance
value is actually reported.

## Measured numbers

One run of `pnpm bench` on an Intel Core Ultra 9 185H, Node v24.3.0, Windows 11. Each
row is `coRanking` with per-point locals at $k \in \{10, 25\}$, plus `aucLogRnx` and the
full `trustworthinessCurve` — single-threaded:

| N | D (high) | time |
| ---- | ---- | ---- |
| 500 | 50 | 51 ms |
| 1 000 | 50 | 129 ms |
| 2 000 | 50 | 538 ms |
| 4 000 | 50 | 2.03 s |
| 8 000 | 50 | 12.16 s |
| 4 000 | 2 | 1.28 s |
| 4 000 | 200 | 7.09 s |

`pnpm bench:parallel`, same machine (16 logical cores), same pass at $k = 10$:

| N | D (high) | sync | 2 workers | 4 workers | 8 workers |
| ---- | ---- | ---- | ---- | ---- | ---- |
| 2 000 | 50 | 670 ms | 433 ms | 323 ms | 326 ms |
| 4 000 | 50 | 3.20 s | 1.70 s | 1.02 s | 763 ms |
| 8 000 | 50 | 13.05 s | 7.60 s | 4.52 s | 2.86 s |

So roughly 2× at 2 workers and 4–4.6× at 8, with the win growing with $N$ and vanishing
on small inputs where the pool costs more than it saves.

Treat every number above as an order of magnitude, not a specification. These are
single runs on one machine with no warm-up and no repetition: re-running the same
benchmark on the same laptop moved the small-$N$ rows by up to 40% (500 points came
back at 51 ms once and 72 ms the next time), while the large-$N$ rows, where the
$O(N^2)$ work dominates the noise, repeated to within a few percent. What is stable
here is the shape — quadratic growth in $N$, linear in $D$ — not the milliseconds.
Run `pnpm bench` and `pnpm bench:parallel` to get figures for your own machine.
