"""
Compute ground-truth metric values with the established reference
implementations, so the TypeScript library can be checked against them.

Sources of truth, in order of preference:
  * zadu            -- the DR-quality-metric library this project cross-checks
  * scipy / sklearn -- for measures zadu itself delegates to them

The output JSON is committed, so CI needs neither Python nor zadu. Regenerate
after changing a fixture:

    python tools/reference.py

Two sources of legitimate disagreement, both recorded explicitly rather than
papered over with a loose tolerance:

1. **Tied distances.** Rank-based measures are under-specified when two points
   sit at exactly the same distance: which one gets rank 3 is arbitrary, but it
   changes the score. zadu calls `np.argsort` with its default introsort, whose
   tie order is an implementation detail. sickle breaks ties by point index,
   which is exactly what `np.argsort(kind="stable")` does. So for every rank
   measure we emit both: `<metric>` (zadu as shipped) and `<metric>__stable`
   (the deterministic convention). They are bit-identical unless the fixture
   contains ties.

2. **float32 in faiss.** zadu's `knn()` (used by LCMC) goes through faiss with
   float32 coordinates, so near-ties can rank differently from an exact float64
   computation. Its `knn_with_ranking()` (trustworthiness/continuity) uses a
   float64 distance matrix and is exact.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent / "test" / "fixtures" / "data"
OUT = HERE.parent / "test" / "fixtures" / "reference.json"

KS = [5, 10, 25]


def _version(pkg: str) -> str:
    from importlib.metadata import PackageNotFoundError, version

    try:
        return version(pkg)
    except PackageNotFoundError:
        return "unknown"


def tnc_stable(X, Y, k: int):
    """
    zadu's trustworthiness/continuity, but with ties broken by point index.

    This is a faithful transcription of `zadu.measures.trustworthiness_continuity`
    with `kind="stable"` threaded through every argsort -- the only change. It
    defines the deterministic convention that sickle implements.
    """
    from scipy.spatial.distance import cdist

    n = X.shape[0]

    def ranks(D):
        order = np.argsort(D, axis=1, kind="stable")
        return order, np.argsort(order, axis=1, kind="stable")

    ox, rx = ranks(cdist(X, X, "euclidean"))
    oy, ry = ranks(cdist(Y, Y, "euclidean"))
    kx, ky = ox[:, 1 : k + 1], oy[:, 1 : k + 1]

    def side(base_knn, base_rank, target_knn):
        local = []
        for i in range(n):
            missing = np.setdiff1d(target_knn[i], base_knn[i])
            local.append(float(sum(base_rank[i, m] - k for m in missing)))
        return 1 - np.array(local) * (2 / (k * (2 * n - 3 * k - 1)))

    return side(kx, rx, ky), side(ky, ry, kx)


def mrre_stable(X, Y, k: int):
    """
    zadu's MRRE, with ties broken by point index.

    Same relationship to `zadu.measures.mean_relative_rank_error` that
    `tnc_stable` has to trustworthiness/continuity: identical except that every
    argsort uses `kind="stable"`. Differs from zadu only where distances tie.
    """
    from scipy.spatial.distance import cdist

    n = X.shape[0]

    def ranks(D):
        order = np.argsort(D, axis=1, kind="stable")
        return order, np.argsort(order, axis=1, kind="stable")

    ox, rx = ranks(cdist(X, X, "euclidean"))
    oy, ry = ranks(cdist(Y, Y, "euclidean"))
    kx, ky = ox[:, 1 : k + 1], oy[:, 1 : k + 1]

    c = sum(abs(n - 2 * i + 1) / i for i in range(1, k + 1))

    def side(base_rank, target_rank, target_knn):
        local = []
        for i in range(n):
            base_arr = base_rank[i][target_knn[i]]
            target_arr = target_rank[i][target_knn[i]]
            local.append(float(np.sum(np.abs(base_arr - target_arr) / target_arr)))
        return float(np.mean(1 - np.array(local) / c))

    return side(rx, ry, ky), side(ry, rx, kx)


def load(name: str):
    X = np.loadtxt(DATA / f"{name}.X.csv", delimiter=",", ndmin=2)
    Y = np.loadtxt(DATA / f"{name}.Y.csv", delimiter=",", ndmin=2)
    labels = np.loadtxt(DATA / f"{name}.labels.csv", dtype=int, ndmin=1)
    return X, Y, labels


def main() -> int:
    try:
        from zadu.measures import distance_consistency as zadu_dsc
        from zadu.measures import local_continuity_meta_criteria as zadu_lcmc
        from zadu.measures import pearson_r as zadu_pearson
        from zadu.measures import mean_relative_rank_error as zadu_mrre
        from zadu.measures import neighborhood_hit as zadu_nh
        from zadu.measures import non_metric_stress as zadu_nms
        from zadu.measures import stress as zadu_stress
        from zadu.measures import trustworthiness_continuity as zadu_tnc
        import zadu
    except ImportError as exc:  # pragma: no cover
        print(f"zadu is required: pip install zadu  ({exc})", file=sys.stderr)
        return 1

    from scipy.spatial.distance import cdist
    from scipy.stats import spearmanr
    from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score

    manifest = json.loads((DATA / "manifest.json").read_text())
    out: dict = {
        "_generated_by": "tools/reference.py",
        "_versions": {
            "zadu": _version("zadu"),
            "scipy": _version("scipy"),
            "scikit-learn": _version("scikit-learn"),
            "numpy": np.__version__,
        },
        "_ks": KS,
        "fixtures": {},
    }

    for entry in manifest:
        name = entry["name"]
        X, Y, labels = load(name)
        n = X.shape[0]
        res: dict = {"n": n}

        # --- rank-based, from zadu -----------------------------------------
        for k in KS:
            tnc = zadu_tnc.measure(X, Y, k)
            res[f"trustworthiness@{k}"] = float(tnc["trustworthiness"])
            res[f"continuity@{k}"] = float(tnc["continuity"])
            res[f"lcmc@{k}"] = float(zadu_lcmc.measure(X, Y, k)["lcmc"])

            # Same measure, ties broken by index. Differs only where ties exist.
            mrre = zadu_mrre.measure(X, Y, k)
            res[f"mrre_false@{k}"] = float(mrre["mrre_false"])
            res[f"mrre_missing@{k}"] = float(mrre["mrre_missing"])
            res[f"neighborhood_hit@{k}"] = float(zadu_nh.measure(Y, labels, k)["neighborhood_hit"])

            mf, mm = mrre_stable(X, Y, k)
            res[f"mrre_false__stable@{k}"] = mf
            res[f"mrre_missing__stable@{k}"] = mm

            lt, lc = tnc_stable(X, Y, k)
            res[f"trustworthiness__stable@{k}"] = float(lt.mean())
            res[f"continuity__stable@{k}"] = float(lc.mean())

        # per-point values, for the local/global contract
        local = zadu_tnc.measure(X, Y, 10, return_local=True)[1]
        res["local_trustworthiness@10"] = [float(v) for v in local["local_trustworthiness"]]
        res["local_continuity@10"] = [float(v) for v in local["local_continuity"]]

        lt10, lc10 = tnc_stable(X, Y, 10)
        res["local_trustworthiness__stable@10"] = [float(v) for v in lt10]
        res["local_continuity__stable@10"] = [float(v) for v in lc10]

        # Flag fixtures where the two conventions actually diverge.
        res["_has_distance_ties"] = bool(
            any(
                abs(res[f"trustworthiness@{k}"] - res[f"trustworthiness__stable@{k}"]) > 1e-15
                for k in KS
            )
        )

        # --- distance-based --------------------------------------------------
        res["stress"] = float(zadu_stress.measure(X, Y)["stress"])
        res["non_metric_stress"] = float(zadu_nms.measure(X, Y)["non_metric_stress"])
        res["pearson_r"] = float(zadu_pearson.measure(X, Y)["pearson_r"])

        dx = cdist(X, X, "euclidean")
        dy = cdist(Y, Y, "euclidean")
        res["spearman_rho"] = float(spearmanr(dx.flatten(), dy.flatten()).statistic)

        # zadu's scale_normalized_stress, spelled out so the alpha is visible
        alpha = float(np.sum(dx * dy) / np.sum(dy**2))
        res["scale_normalized_stress"] = float(
            np.sqrt(np.sum((dx - alpha * dy) ** 2) / np.sum(dx**2))
        )
        res["_alpha"] = alpha

        # --- label-based ------------------------------------------------------
        if len(np.unique(labels)) > 1:
            res["distance_consistency"] = float(
                zadu_dsc.measure(Y, labels)["distance_consistency"]
            )
            res["silhouette"] = float(silhouette_score(Y, labels))
            res["calinski_harabasz"] = float(calinski_harabasz_score(Y, labels))
            res["davies_bouldin"] = float(davies_bouldin_score(Y, labels))

        out["fixtures"][name] = res
        print(f"  {name:<14} n={n:<4} T@10={res['trustworthiness@10']:.6f} stress={res['stress']:.6f}")

    OUT.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
