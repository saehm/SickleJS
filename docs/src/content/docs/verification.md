---
title: Verification
description: What each measure is checked against, and where the reference implementations are wrong.
---

Scientific work depends on these numbers being right, so this page says exactly how
far each one has been checked — including the ones that have been checked least.

There are three tiers, and the distinction matters more than any individual number.

## Tier 1 — against a reference implementation

Checked against an independent implementation by someone else. Most agree to 1e-12; the
relative tolerances actually asserted run from 1e-12 down to 1e-9, and three rows are
looser still for reasons the table names. Every figure below is the tolerance in the
test, not an estimate.

Unless a row says otherwise the tolerance is relative, and the comparison runs on the
five fixtures in `test/fixtures/data/manifest.json`.

| measure | checked against | agreement |
| ---- | ---- | ---- |
| `trustworthiness`, `continuity` | [zadu](https://github.com/hj-n/zadu) | 1e-12 |
| `mrreFalse`, `mrreMissing` | zadu | 1e-12 |
| `lcmc` | zadu | 1e-9 — zadu's path goes through faiss in float32 |
| `stress` | zadu | 1e-12 |
| `scaleNormalizedStress` | zadu | 1e-10 |
| `pearsonR` | zadu's `pearson_r` | 1e-11 |
| `residualVariance` | derived from the same stored `pearson_r` as $1 - r^2$ | 1e-10, no independent reference of its own |
| `spearmanRho` | `scipy.stats.spearmanr` | 1e-10, tie correction included |
| `nonMetricStress` | zadu's `non_metric_stress` (which uses `sklearn.isotonic` internally) | 1e-10 |
| `silhouette` | scikit-learn | 1e-11 |
| `calinskiHarabasz` | scikit-learn | 1e-10 |
| `daviesBouldin` | scikit-learn | 1e-10 |
| `distanceConsistency` | zadu | 1e-12 |
| `neighborhoodHit` | zadu | 1e-9 — faiss float32 again |
| `gabrielClassificationError` | [DRquality](https://CRAN.R-project.org/package=DRquality) (R) | 1e-12 on 4 of 5 fixtures — see below |
| `topologicalH0` | a Prim MST computed inside the fixture generator, 1e-12; the bottleneck value against [gudhi](https://gudhi.inria.fr/), 1e-12 | 1e-12 |
| `topologicalH1` | [ripser](https://github.com/Ripser/ripser) | **absolute** 1e-5, on constructed shapes — ripser computes in float32 |
| `bottleneckH0`, `wassersteinH0`, `bottleneckDistance` | gudhi | 1e-10 |
| the nine scagnostics | [Scagnostics2018](https://github.com/iDataVisualizationLab/Scagnostics2018) | seven exact; `convex` ±0.01 and `skinny` ±0.03, plus three deliberate differences |

Two notes the tolerances do not carry on their own.

`topologicalH0` is not asserted against ripser. ripser appears only as an aggregate
cross-check inside `tools/topology-reference.py`, which confirms that H0 deaths are the
MST edge lengths; the committed assertions compare against the generator's own Prim MST
and against gudhi.

`convex` and `skinny` are derived from the alpha hull, and upstream triangulates it with
a different library than it uses for the MST. The band is a hull/triangulator
difference, not floating-point slack — the other seven measures, which come from the MST
alone, match exactly.

## Tier 2 — against the published definition

No reference implementation exists, so each is verified against an independent naive
transcription of the formula from the paper, on inputs small enough for the naive
version to be tractable.

| measure | how it is checked |
| ---- | ---- |
| `sammonStress` | naive $O(N^2)$ transcription of the 1969 formula |
| `curvilinearStress` | naive transcription, both kernels |
| `nerv` | naive transcription; the $\sigma$ search is separately checked to hit the requested perplexity exactly |
| `tripletAccuracy` | brute force over every triplet on small inputs, plus convergence of the sampling estimator it replaces |
| `densityPreservation` | the local radii against a naive JS reference, to 1e-12; there is no correlation fixture, so the correlation step itself has no external check |
| `qnx` | a naive transcription of $Q_{NX}(k)$ in `test/reference.ts`, to 1e-10, at $k \in \{5, 10, 25, 50\}$ — despite the name, zadu records no `qnx` value here |

These are not less correct — a formula transcribed twice and agreeing is good
evidence — but nobody outside this project has confirmed them.

## Tier 3 — behaviour-tested only

Plausible, contract-satisfying, and with nothing external to compare against.

| measure | why |
| ---- | ---- |
| `dunnIndex` | many published variants; no canonical implementation of this one |
| `classificationError` | trivial to state, but no reference uses the same k-NN tie rule |
| `rnx`, `aucLogRnx` | no reference value is recorded. Checked for identity projections (both exactly 1), permutation invariance, agreement between `rnx(cr, k)` and `rnxCurve`, and that a good projection outscores a random one |
| `averageBetweenWithin`, `hypothesisMargin` | present in neither `reference.json` nor `tools/reference.py`. Covered by the contract suite only: range, direction, degenerate inputs |

These are checked for the properties they must have — correct on degenerate inputs,
monotone under the distortions they should respond to, invariant under permutation —
but the absolute values rest on the implementation alone.

### `snc`, separately

`snc` is the one stochastic measure, so it cannot be checked by equality at all. The
comparison is against **zadu**'s `steadiness_cohesiveness` with
`clustering_strategy="kmeans"` — not the authors' own
[steadiness-cohesiveness](https://github.com/hj-n/steadiness-cohesiveness) repository —
recorded as a distribution over 12 runs. The assertion is an **absolute** band of 0.05
around it, which is nowhere near the tolerances above. A systematic offset is expected:
sickle clusters with DruidJS's k-means and zadu with scikit-learn's.

## Every measure is contract-checked

Separately from the numeric comparisons, every measure that reports per-point values
is machine-checked against its declared `localKind`:

- `mean` — the mean of `local` must equal `value`
- `sum` — the entries must sum to `value`
- `share` — the entries must sum to 1
- `partial-mean` — the mean over the *finite* entries must equal `value`

This runs for every measure, including any added later, so a per-point array cannot
silently stop meaning what it says it means. Measures are also checked for permutation
invariance — reordering the input must not change the result — with `snc` declared
stochastic and exempted explicitly rather than by omission.

## Where the references are wrong

Three cases where sickle deliberately does not match its reference, because the
reference is incorrect. Each is reported upstream.

### GCE and DRquality's leaves

DRquality's Gabriel classification error divides by `kj - 1`, where `kj` is the
number of Gabriel neighbours. Leaves of the Gabriel graph have `kj = 1`, so the
divisor is 0: the term becomes `Inf`, then `0 * Inf = NaN`, and the `NaN` is dropped
by `na.rm = TRUE`.

The effect is that leaves are silently excluded from the average. sickle reproduces
this exclusion — so it is *not* the reason for the one fixture that disagrees — but
reports it, in `counted` and `excluded`, rather than hiding it. The per-point array
marks those points `NaN` and the plots draw them hollow.

The remaining mismatch, on the `duplicates` fixture, comes from somewhere else: when
two points coincide, the Gabriel empty-disc test sits exactly on its boundary and the
tie can break either way. That is a genuine ambiguity in the definition rather than a
defect in either implementation, so the fixture is skipped rather than fudged. The
other four fixtures match exactly.

### scipy's MST on a dense matrix

`scipy.sparse.csgraph.minimum_spanning_tree` treats a stored 0 as "no edge", not as a
zero-weight edge. On a dataset with exact duplicate points that discards the
zero-length edges and inflates the answer — 266.38 became 310.81, a 17% error, in the
fixture generator. sickle's implementation is correct; the *reference generator* was
fixed.

### The k limit on trustworthiness and continuity

sickle caps $k$ at $\lfloor N/2 \rfloor$ for both measures. Implementations that follow the
paper's formula literally, zadu included, accept larger `k` — and return values
outside $[0, 1]$ when they do, because the normalising constant is only the
reciprocal of the worst-case penalty while $k \le N/2$.

The collapse is easy to see with the naive transcription in `test/reference.ts`,
which applies the formula literally and imposes no limit. On 200 points with 10
high-dimensional columns and a 2-D projection drawn independently of them — both from
`lcg(42)` in `test/fixtures.ts`, so this is reproducible — `referenceTC` gives:

| k | trustworthiness |
| ---- | ---- |
| 100 (= n/2) | 0.4945 |
| 110 | 0.4146 |
| 125 | −0.1682 |
| 132 | −6.6744 |

Any random draw shows the same shape: near chance at $k = N/2$, then a fall through
zero into arbitrarily negative values. The exact figures depend on the draw.

The penalty itself stays correct throughout — only the constant it is divided by
stops applying. Rather than switch to the two-branch normaliser, which would make the
numbers disagree with every other implementation in the region where they *are*
comparable, sickle refuses the range where the measure is not defined.

This is the one place sickle deliberately accepts *less* input than its reference.
Parity against zadu is asserted at $k \in \{5, 10, 25\}$ on five fixtures, where the
two agree to the tolerances tabled above.

### Scagnostics2018

Three differences, each documented on the [scagnostics page](/SickleJS/families/scagnostics/):
`monotonic` could exceed its range, the `simple-statistics` v7 quantile change moved
`skewed` and `sparse`, and the MST was not rebuilt after outlier removal when it
needed to be.

A fourth difference is not a defect in the reference. `convex` and `skinny` are read
off the alpha hull, and Scagnostics2018 triangulates the hull with a different
library than it uses for the MST, so on degenerate input the two can disagree about
which triangles exist. Typical deltas are around 8.5e-5, rising to 5.6e-3 for
`convex` and 1.9e-2 for `skinny` on the `duplicates` fixture — which is why those two
measures carry tolerances where the other seven are asserted exact.

## Tie-breaking

Rank-based measures are **under-specified** when two points sit at exactly the same
distance — duplicate rows, quantised data. Which point gets rank 3 and which gets rank
4 is arbitrary, but it changes the score.

sickle breaks ties by point index, which is what `numpy.argsort(kind="stable")` does.
zadu uses numpy's default introsort, which is unstable, so on data with exact ties the
two libraries can legitimately differ in the last digits. The `duplicates` fixture
exists to exercise this, and the difference is a property of the definition, not a bug
in either implementation.

Both of sickle's sorts break ties the same way, and the radix sort is asserted
bit-identical to the comparison sort.

## Determinism

Every measure except `snc` is deterministic and reproducible across engines. The
parallel passes are **bit-identical** to the single-threaded ones for any worker
count — see [Performance](/SickleJS/performance/#bit-identical-parallelism) for what is
asserted and at which worker counts.

The maths is verified in Node. A second Vitest project runs in Chromium, Firefox and
WebKit, but it covers only `test/browser/` — a worker smoke test confirming the
inlined worker spawns and returns; it deliberately does not re-verify the measures.

Nothing here runs in CI: `.github/workflows/` builds the documentation site only. The
suite is run locally with `pnpm test`, and `prepublishOnly` runs typecheck, tests and
build before a release, so publication is gated even though pushes are not.

## Licensing note

`gabrielClassificationError` is a clean-room implementation rather than a port.
DRquality is GPL-3 and sickle is LGPL-3; porting the source would have forced the
whole library to GPL. *Running* DRquality to produce reference numbers does not — the
output of a program is not covered by its licence, and a measurement is a fact — so it
is used as a reference and not as a source.
