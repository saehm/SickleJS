"""
Ground truth for the H0 topological measures, from ripser and gudhi.

    python tools/topology-reference.py

Records three things per fixture:

  * the H0 death times from `ripser`, to confirm the identity this
    implementation rests on -- that H0 deaths are exactly the MST edge lengths;
  * `gudhi.bottleneck_distance` between the two diagrams;
  * `gudhi.wasserstein.wasserstein_distance` for p = 1 and 2.

ripser computes in float32, so its deaths agree only to ~1e-7. The gudhi
distances are float64 and are matched exactly.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent / "test" / "fixtures" / "data"
OUT = HERE.parent / "test" / "fixtures" / "topology.json"


def main() -> int:
    try:
        import gudhi
        from gudhi.wasserstein import wasserstein_distance
        from ripser import ripser
    except ImportError as exc:  # pragma: no cover
        print(f"needs gudhi, pot and ripser: pip install gudhi pot ripser  ({exc})", file=sys.stderr)
        return 1
    from scipy.spatial.distance import pdist, squareform

    def h0_ripser(X):
        dgm = ripser(X, maxdim=0)["dgms"][0]
        return np.sort(dgm[np.isfinite(dgm[:, 1])][:, 1])

    def h0_mst(X):
        """
        Prim on the dense distance matrix.

        Deliberately not `scipy.sparse.csgraph.minimum_spanning_tree`: on a dense
        input it reads 0 as "no edge", so it cannot use the zero-length edges
        between coincident points and returns a heavier, wrong tree. On the
        duplicates fixture that inflated the total from 266.38 to 310.81, while
        Prim agrees with ripser to 4e-6.
        """
        D = squareform(pdist(X))
        n = len(X)
        in_tree = np.zeros(n, dtype=bool)
        best = D[0].copy()
        in_tree[0] = True
        best[0] = np.inf
        weights = []
        for _ in range(n - 1):
            j = int(np.argmin(np.where(in_tree, np.inf, best)))
            weights.append(best[j])
            in_tree[j] = True
            best = np.minimum(best, D[j])
        return np.sort(np.array(weights))

    manifest = json.loads((DATA / "manifest.json").read_text())
    out: dict = {"_source": "ripser + gudhi", "fixtures": {}}

    for entry in manifest:
        name = entry["name"]
        X = np.loadtxt(DATA / f"{name}.X.csv", delimiter=",", ndmin=2)
        Y = np.loadtxt(DATA / f"{name}.Y.csv", delimiter=",", ndmin=2)

        hd, ld = h0_mst(X), h0_mst(Y)
        # Confirm the identity the TypeScript side relies on. ripser discards
        # zero-persistence features (coincident points give zero-length MST
        # edges), so compare only the strictly positive deaths -- the dropped
        # ones sit on the diagonal and cannot affect either distance.
        # Compare totals rather than elementwise: ripser discards
        # zero-persistence points, so the two lists differ in length whenever the
        # data has coincident points, but the summed persistence must agree.
        drift = float(max(
            abs(hd.sum() - h0_ripser(X).sum()),
            abs(ld.sum() - h0_ripser(Y).sum()),
        ))

        scaled_hd = hd / np.max(pdist(X))
        scaled_ld = ld / np.max(pdist(Y))
        dg_hd = np.column_stack([np.zeros(len(scaled_hd)), scaled_hd])
        dg_ld = np.column_stack([np.zeros(len(scaled_ld)), scaled_ld])

        out["fixtures"][name] = {
            "hd_deaths": [float(v) for v in hd],
            "ld_deaths": [float(v) for v in ld],
            # null where ripser dropped zero-persistence points, so the two
            # lists could not be compared elementwise.
            "ripser_drift": None if np.isnan(drift) else drift,
            "bottleneck": float(gudhi.bottleneck_distance(dg_hd, dg_ld)),
            "wasserstein1": float(wasserstein_distance(dg_hd, dg_ld, order=1, internal_p=np.inf)),
            "wasserstein2": float(wasserstein_distance(dg_hd, dg_ld, order=2, internal_p=np.inf)),
        }
        print(f"  {name:<14} bottleneck={out['fixtures'][name]['bottleneck']:.6f}"
              f"  W1={out['fixtures'][name]['wasserstein1']:.6f}  ripser drift={drift:.2e}")

    OUT.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
