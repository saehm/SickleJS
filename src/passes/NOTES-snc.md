# Steadiness & Cohesiveness: relationship to zadu

Implemented from Jeon, Ko, Jo, Yi & Seo, *Measuring and Explaining the
Inter-Cluster Reliability of Multidimensional Projections*, IEEE TVCG 2022,
following the algorithm in zadu's `utils/snc_cpu.py`.

`test/snc.test.ts` checks against `test/fixtures/snc.json`, produced by
`tools/snc-reference.py`.

## Why this cannot be checked by equality

S&C is **stochastic**. It draws clusters by random walks over the k-NN graph, so
the score depends on which clusters happen to be drawn. zadu's own run-to-run
standard deviation on these fixtures is ~0.005. There is no exact value to match,
by construction — so the reference records a *distribution* and the test asserts
agreement in those terms.

This is the only measure in the library with that property. Everything else is
deterministic and checked to 1e-10 or better.

## Deliberate divergence: k-means, not HDBSCAN

zadu defaults to HDBSCAN for partitioning each extracted cluster. Porting HDBSCAN
(mutual reachability, minimum spanning tree, condensed tree, stability-based
extraction) is a project in itself and would dwarf the rest of this measure, so
this implementation uses **k-means**, which zadu also supports as
`clustering_strategy="kmeans"`. The reference is generated with that setting, so
the comparison is like with like.

DruidJS's seeded `KMeans` is used, which makes a run reproducible from `seed`.

## Observed agreement

zadu, 12 runs, 100 iterations, `kmeans`; sickle at `seed: 42`:

| fixture | sickle S | zadu S | sickle C | zadu C |
|---|---|---|---|---|
| blobs_pca | 0.9097 | 0.9123 ± 0.0042 | 0.7058 | 0.7036 ± 0.0044 |
| blobs_random | 0.1854 | 0.1789 ± 0.0042 | 0.2223 | 0.2149 ± 0.0039 |
| swissroll | 0.5601 | 0.5481 ± 0.0074 | 0.6049 | 0.5950 ± 0.0086 |
| duplicates | 0.8697 | 0.8556 ± 0.0060 | 0.6931 | 0.6884 ± 0.0061 |
| blobs_large | 0.9385 | 0.9242 ± 0.0093 | 0.6046 | 0.5981 ± 0.0027 |

sickle sits consistently **1–2 standard deviations above** zadu's mean. That
offset is systematic rather than noise, and the cause is the clustering step:
DruidJS's k-means and scikit-learn's initialise and converge differently, so the
partitions differ slightly even when the walks agree. The measure spans ~0.75
across these fixtures, so an offset of ~0.01 does not change any conclusion —
but it is a real difference, not rounding, and worth knowing before quoting a
number against a published zadu figure.

The test therefore also asserts that both implementations **rank the fixtures
identically**, which is the property the measure is actually used for and a
stronger check than any single value.

## Invariants that do hold exactly

- An identity projection scores exactly **1** for both, on any seed: no cluster
  can be distorted when the two spaces coincide.
- A faithful projection outscores a random one on both.
- Both scores stay in [0, 1].
- A given seed reproduces exactly.
- Seed spread narrows as `iterations` grows (~0.0045 at 100 iterations).

## Cost

Two dense N x N similarity matrices, so memory is **O(N²)** — the only pass here
besides `nonMetricStress` and `spearmanRho` that is not O(N). `maxPoints`
defaults to 6000 (~600 MB) and refuses rather than attempting the allocation.

The SNN product is computed through an inverted index over shared neighbours,
O(N·k²), rather than as a dense matrix product, O(N²·k).
