# Topological quality: H0 now, H1 open

## What is implemented

`topologicalH0` compares the **0-dimensional** persistence diagrams of the data
and its projection — connected components, across every scale at once.

It rests on an identity: the 0-dimensional Vietoris–Rips diagram has every birth
at 0, and its **deaths are exactly the euclidean MST edge lengths**. So no
persistence engine is needed; Prim's algorithm on the complete graph gives the
diagram directly in O(N²·D) time and O(N) memory.

Verified against `ripser` (the diagram) and `gudhi` (both distances) — see
`tools/topology-reference.py`.

### Diagram distances

Both are exact, and neither is the obvious formula:

- **Bottleneck.** With all births at 0 the diagrams are multisets on a line, so
  the optimal matching is the sorted one — but each pair may instead be
  *discarded to the diagonal* at half the larger death. Sorted matching alone
  overestimates: 1.18 against a true 0.90 on one test case. Verified exact
  against `gudhi.bottleneck_distance` over 250 randomised trials, including
  scale-mismatched, near-identical and reversed diagrams.
- **Wasserstein-p.** Here a per-pair choice between matching and discarding is
  *not* optimal — the decisions interact, and the greedy version was off by up
  to 2.03. Because the points lie on a line the optimal matching never crosses,
  which reduces it to an O(N²) alignment DP instead of a cubic optimal-transport
  solve. Verified exact against `gudhi.wasserstein` for p = 1 and 2.

### A bug found in the reference

`scipy.sparse.csgraph.minimum_spanning_tree` on a **dense** matrix reads 0 as
"no edge", so it cannot use the zero-length edges between coincident points and
returns a heavier, wrong tree. On the `duplicates` fixture it inflated the total
edge weight from 266.38 to 310.81 (17%). The reference generator uses Prim
instead, which agrees with ripser to 4e-6. Worth knowing for anyone computing
H0 this way.

## H1 — implemented

`topologicalH1` compares the **degree-1** diagrams: loops. This needs a real
Vietoris–Rips engine (`passes/rips.ts`), which reduces the boundary matrix from
triangles to edges over Z/2.

Verified **bit-identical to ripser** on five point clouds with known structure —
a noisy circle (1 loop), two circles (2), a blob (10 noise features), a 3-D torus
(22), and 45 points in 8-D (12). Feature counts and every birth/death agree.

The general bottleneck distance — needed because H1 diagrams are scattered in the
birth–death plane, not on a line as H0 diagrams are — is verified against
`gudhi.bottleneck_distance` to 2e-16 over 40 random diagram pairs.

### Cost, and why `maxPoints` is 200

| N | triangles | time |
|---|---|---|
| 50 | 19 600 | 0.22 s |
| 80 | 82 160 | 1.5 s |
| 120 | 280 840 | 11.8 s |
| 160 | 669 920 | 47.4 s |

Steeper than the triangle count, because reduction densifies columns. Ripser
avoids this by computing persistent *cohomology* with implicit simplex
enumeration and an apparent-pairs shortcut; matching it is a project in its own
right. Until then, subsample both spaces on the same indices — the bottleneck
stability theorem bounds the drift, and subsampling is standard practice in TDA
for exactly this reason.

### What H1 catches that nothing else does

A circle unrolled into an arc keeps every local neighbourhood, so trustworthiness
stays above 0.9 and H0 barely moves — but the hole is gone. The test suite pins
this: on that input the high-dimensional diagram has one loop, the projected one
has none, and only `topologicalH1` reports a problem.
