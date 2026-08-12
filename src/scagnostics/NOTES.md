# Scagnostics: relationship to ScagnosticsJS

This is a reimplementation, not a port. The pipeline and measure definitions
follow **ScagnosticsJS** by Tommy Dang and Vung Pham
(<https://github.com/iDataVisualizationLab/Scagnostics2018>), which implements
Wilkinson, Anand & Grossman, *Graph-Theoretic Scagnostics* (InfoVis 2005).

`test/scagnostics.test.ts` compares against a committed snapshot of upstream's
output (`test/fixtures/scagnostics.json`).

## Parity

Seven of nine measures — `outlying`, `skewed`, `clumpy`, `sparse`, `striated`,
`stringy`, `monotonic` — are **bit-identical to upstream on every fixture**.

`convex` and `skinny` differ slightly, because they are the only two derived from
the alpha hull:

| fixture | `convex` Δ | `skinny` Δ |
|---|---|---|
| blobs_pca | 8.5e-5 | exact |
| blobs_large | 1.4e-5 | exact |
| duplicates | 5.6e-3 | 1.9e-2 |
| blobs_random, swissroll | exact | exact |

**Cause.** Upstream triangulates twice, with two different libraries: the MST uses
`d3-delaunay`, while the hulls go through `alpha-shape` → `alpha-complex` →
`delaunay-triangulate`. Those disagree on degenerate configurations — cocircular
points, duplicates — and produce different boundary edges. This implementation
uses `d3-delaunay` for both, so the pipeline is at least self-consistent.

The largest divergence is on the `duplicates` fixture, which contains 30 exact
duplicate points and is therefore maximally degenerate. That is the expected
place for two triangulators to differ.

## Deliberate deviations

### `monotonic` is fixed

Upstream computes Spearman's rho through the `Σd²` shortcut plus a tie
correction. That shortcut is only valid without ties, and combining it with a
tie correction lets the result leave [-1, 1] — on a 300-point random fixture
upstream returns **5.38** for a quantity defined as `rho²`.

Here the correlation is computed directly as Pearson's r on average ranks, which
is the definition and is correct with or without ties.

| input | upstream | here |
|---|---|---|
| random 300 points | 5.384915 | 0.000000 |
| y = x | 1.0 | 1.0 |
| y = −x | 1.0 | 1.0 |
| y = x³ | 1.0 | 1.0 |

On all five committed fixtures the two agree exactly, because those have few
enough ties for the shortcut to hold.

### Removed dependencies

`underscore`, `simple-statistics`, `d3-polygon` and `alpha-shape` are gone.
Only `d3-delaunay` remains, plus DruidJS for the MST.

- **`simple-statistics`** was used for `quantile` and `max`. Its quantile
  interpolation changed between v6 and v7, silently shifting `skewed` and
  `sparse`; pinning a major version to preserve a numeric definition is fragile,
  so the v6 definition is written out explicitly in `quantile.ts`.
- **`underscore`** was used for `map`/`filter`/`min`/`uniq`/`zip`/`pairs`, all of
  which are language builtins now.
- **`d3-polygon`** supplied `polygonArea` and `polygonLength`, ~15 lines each.
- **`alpha-shape`** is replaced by `alphaBoundary`, which applies the same
  definition (keep triangles with `circumradius * alpha < 1`, take edges in
  exactly one kept triangle) to the triangulation we already have.

### Reused from DruidJS

`minimum_spanning_tree` — it takes exactly the shape needed, a weighted edge list
over vertex indices, and runs Kruskal's algorithm.

Note the graph passed to it holds only Delaunay edges, not all N² pairs. That is
not an approximation: the Euclidean MST is always a subgraph of the Delaunay
triangulation.

## Performance

Upstream's hot paths were quadratic by construction:

| upstream | here |
|---|---|
| nodes and edges keyed by `[x,y].join(",")` strings | integer vertex indices |
| `linkExists` linear-scans every edge → O(E²) | hash set on a packed key |
| `idExists` linear-scans every node → O(V·E) | coordinate map |
| `DisjointSet.size()` rebuilds a key set per loop iteration | live set counter |
| union-by-rank broken (`rank` vs `rank_`, so it never balanced) | druid's implementation |
| `JSON.parse(JSON.stringify(tree))` cloned the tree per measure | one shared structure |
| leader binning scans all leaders per point → O(P·L) | uniform grid, O(P) expected |
| clumpy rebuilds an adjacency map per edge | CSR adjacency built once |

| N | upstream | here | speedup |
|---|---|---|---|
| 2 000 | 194 ms | 8 ms | 24× |
| 20 000 | 2 150 ms | 45 ms | 48× |
| 100 000 | 12 453 ms | 200 ms | 62× |

Runtime is dominated by binning, which caps the site count at a few hundred
regardless of N — so the measures themselves cost the same at N=100 000 as at
N=2 000.
