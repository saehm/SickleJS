"""
Ground truth for Steadiness & Cohesiveness, from zadu.

    python tools/snc-reference.py

S&C is stochastic: the score depends on which clusters the random walks happen
to draw. There is no single correct number to match, so this records a
*distribution* — mean, standard deviation and range over repeated runs — and the
parity test asserts that sickle's value falls inside it.

`clustering_strategy="kmeans"` is used, not zadu's HDBSCAN default, because
sickle clusters with k-means (porting HDBSCAN is a project in itself). zadu
supports both, so this compares like with like.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent / "test" / "fixtures" / "data"
OUT = HERE.parent / "test" / "fixtures" / "snc.json"

RUNS = 12
ITERATIONS = 100


def main() -> int:
    try:
        from zadu.measures import steadiness_cohesiveness as zadu_snc
    except ImportError as exc:  # pragma: no cover
        print(f"zadu is required: pip install zadu  ({exc})", file=sys.stderr)
        return 1

    manifest = json.loads((DATA / "manifest.json").read_text())
    out: dict = {
        "_source": "zadu steadiness_cohesiveness, clustering_strategy=kmeans",
        "_runs": RUNS,
        "_iterations": ITERATIONS,
        "_note": (
            "Stochastic measure: these are distributions over repeated runs, not "
            "exact values. Compare by interval, never by equality."
        ),
        "fixtures": {},
    }

    for entry in manifest:
        name = entry["name"]
        X = np.loadtxt(DATA / f"{name}.X.csv", delimiter=",", ndmin=2)
        Y = np.loadtxt(DATA / f"{name}.Y.csv", delimiter=",", ndmin=2)

        stead, cohev = [], []
        for run in range(RUNS):
            np.random.seed(run)
            scores = zadu_snc.measure(
                X, Y, iteration=ITERATIONS, clustering_strategy="kmeans"
            )
            stead.append(float(scores["steadiness"]))
            cohev.append(float(scores["cohesiveness"]))

        out["fixtures"][name] = {
            "steadiness": {
                "mean": float(np.mean(stead)),
                "std": float(np.std(stead)),
                "min": float(np.min(stead)),
                "max": float(np.max(stead)),
            },
            "cohesiveness": {
                "mean": float(np.mean(cohev)),
                "std": float(np.std(cohev)),
                "min": float(np.min(cohev)),
                "max": float(np.max(cohev)),
            },
        }
        print(
            f"  {name:<14} steadiness {np.mean(stead):.4f} +/- {np.std(stead):.4f}"
            f"   cohesiveness {np.mean(cohev):.4f} +/- {np.std(cohev):.4f}"
        )

    OUT.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
