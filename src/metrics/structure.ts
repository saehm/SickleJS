/**
 * Density preservation and triplet accuracy.
 *
 * Both cover ground the other measures leave open: density is invisible to
 * rank- and distance-based measures alike, and triplet accuracy judges global
 * arrangement rather than local neighbourhoods.
 */

import type { MetricResult } from "../core/result.ts";
import { Accumulator } from "../core/sum.ts";
import type { StructureMoments } from "../passes/analyze.ts";

/**
 * Whether dense regions stayed dense and sparse ones sparse.
 *
 * The one thing no other measure here sees. Trustworthiness checks ordering,
 * stress checks magnitudes — a projection that inflates a tight cluster to the
 * size of a diffuse one satisfies both while destroying the density contrast,
 * which is the failure t-SNE and UMAP are known for.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [-1, 1], higher is better. Above ~0.8 means density is broadly kept;
 *   near 0 means it carries no information.
 * - Cost: O(N), or O(N log N) for `"spearman"`, on top of an O(N² log N) pass
 *   given `densityK`. Unlike most read-outs here it is not constant-time: it
 *   walks every point and correlates the two radius arrays.
 *
 * The correlation is taken over the **logarithms** of the two radii, following
 * den-SNE; points whose radius is 0 in either space are dropped from it. The
 * `radiusHigh` and `radiusLow` arrays expose the raw per-point radii, including
 * any that were dropped, and plot against each other as a density-preservation
 * scatterplot.
 *
 * @see Narayan, Berger & Cho, Nature Biotechnology 39 (2021)
 *   {@link https://doi.org/10.1038/s41587-020-00801-7}
 *
 * @category Structure
 * @group Structure
 *
 * @example
 * ```ts
 * import { analyze, densityPreservation } from "@saehrimnir/sickle";
 *
 * // The pass must be told to collect local radii.
 * const a = analyze(data, projection, { densityK: 20 });
 *
 * densityPreservation(a.structure).value;              // 0.4271 — Pearson by default
 * densityPreservation(a.structure, "spearman").value;  // 0.4229
 * ```
 */
export function densityPreservation(
    s: StructureMoments, method: "pearson" | "spearman" = "pearson",
): MetricResult & { readonly radiusHigh: Float64Array; readonly radiusLow: Float64Array } {
    if (!s.hasDensity) {
        throw new Error(
            "densityPreservation: the pass was run without `densityK`. " +
            "Pass { densityK } to analyze() to enable it.",
        );
    }
    const n = s.n;
    // A zero radius means coincident points; log is undefined there, so those
    // points are dropped rather than clamped to an arbitrary floor.
    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < n; ++i) {
        if (s.radiusHigh[i] > 0 && s.radiusLow[i] > 0) {
            a.push(Math.log(s.radiusHigh[i]));
            b.push(Math.log(s.radiusLow[i]));
        }
    }
    const value = a.length < 2
        ? NaN
        : method === "spearman"
            ? correlate(rank(a), rank(b))
            : correlate(a, b);

    return { value, localKind: "none", radiusHigh: s.radiusHigh, radiusLow: s.radiusLow };
}

/** Average ranks, ties shared. */
function rank(values: readonly number[]): number[] {
    const order = values.map((_, i) => i).sort((x, y) => values[x] - values[y] || x - y);
    const out = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
        let j = i + 1;
        while (j < order.length && values[order[j]] === values[order[i]]) j += 1;
        const shared = (i + j - 1) / 2 + 1;
        for (let t = i; t < j; ++t) out[order[t]] = shared;
        i = j;
    }
    return out;
}

function correlate(a: readonly number[], b: readonly number[]): number {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; ++i) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; ++i) {
        const u = a[i] - ma, v = b[i] - mb;
        cov += u * v; va += u * u; vb += v * v;
    }
    const denom = Math.sqrt(va * vb);
    return denom === 0 ? 0 : cov / denom;
}

/**
 * Share of point triples whose relative ordering survives the projection.
 *
 * For every anchor and every pair of other points, does the nearer one stay
 * nearer? Purely ordinal, so it ignores scale entirely, and it reaches across the
 * whole dataset rather than a k-neighbourhood — the best single check that
 * *global* arrangement is right.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], higher is better. **0.5 is chance**, so read that as the floor.
 * - Cost: O(1), from an O(N² log N) pass given `triplets: true`.
 *
 * Every triple is counted exactly; this is not a sample, so it has no seed and no
 * run-to-run variation. Per-point values give each anchor's own accuracy.
 *
 * @see Wang, Huang, Rudin & Shaposhnik, JMLR 22 (2021)
 *   {@link https://jmlr.org/papers/v22/20-1061.html}
 *
 * @category Structure
 * @group Structure
 *
 * @example
 * ```ts
 * import { analyze, tripletAccuracy } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection, { triplets: true });
 * tripletAccuracy(a.structure).value;  // 0.956 — 0.5 is a coin flip
 * ```
 */
export function tripletAccuracy(s: StructureMoments): MetricResult {
    if (!s.hasTriplets) {
        throw new Error(
            "tripletAccuracy: the pass was run without `triplets`. " +
            "Pass { triplets: true } to analyze() to enable it.",
        );
    }
    const n = s.n;
    // Pairs (j,k) available to each anchor, from the n-1 other points.
    const pairs = ((n - 1) * (n - 2)) / 2;
    if (pairs === 0) return { value: 1, local: new Float64Array(n).fill(1), localKind: "mean" };

    const local = new Float64Array(n);
    const acc = new Accumulator();
    for (let i = 0; i < n; ++i) {
        local[i] = 1 - s.inversions[i] / pairs;
        acc.add(local[i]);
    }
    return { value: acc.value / n, local, localKind: "mean" };
}
