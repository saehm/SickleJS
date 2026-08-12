/**
 * Cost functions borrowed from embedding algorithms — Sammon, CCA and NeRV.
 *
 * Each is the objective that a projection method minimises, so each favours the
 * method that optimises it. They describe *what* a projection preserves rather
 * than judging it neutrally: Sammon weights short input distances, CCA weights
 * short output distances, NeRV weights neighbourhood membership.
 */

import type { MetricResult } from "../core/result.ts";
import type { Nerv } from "../passes/nerv.ts";
import type { EmbeddingMoments } from "../passes/analyze.ts";

/**
 * Stress that weights short distances most heavily.
 *
 * Dividing each pair's error by its original distance makes local structure
 * dominate, so this rewards projections that get neighbourhoods right even if the
 * global layout drifts.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, ∞), **lower is better**; 0 is exact.
 * - Cost: O(1), from an O(N²·D) pass.
 *
 * The returned `value` is the *normalised* ratio of Sammon 1969,
 * `Σ(d − d̂)²/d ÷ Σd`, not the bare sum — dividing by `Σd` is what makes it
 * comparable across datasets of different scale and size.
 *
 * Pairs at zero original distance are excluded — they would divide by zero — so
 * duplicate points quietly shrink the denominator.
 *
 * @see Sammon, IEEE Trans. Computers C-18 (1969)
 *   {@link https://doi.org/10.1109/T-C.1969.222678}
 *
 * @category Embedding cost
 * @group Embedding cost
 *
 * @example
 * ```ts
 * import { analyze, sammonStress } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);  // the O(N²·D) pass comes first
 * const s = sammonStress(a.embedding);  // read from a.embedding, not from a
 * s.value;     // 0.581 for a noisy 50-point circle cut open into a line
 * s.local[0];  // 0.013 — that point's share; s.local sums to s.value
 * ```
 */
export function sammonStress(f: EmbeddingMoments): MetricResult {
    if (!(f.sammonDen > 0)) return { value: NaN, localKind: "none" };
    const value = f.sammonNum / f.sammonDen;
    // Each point's share of the weighted error; sums to the stress itself.
    const local = new Float64Array(f.n);
    for (let i = 0; i < f.n; ++i) local[i] = f.rowSammon[i] / f.sammonDen;
    return { value, local, localKind: "sum" };
}

/**
 * Stress that forgives tearing but not folding.
 *
 * The weighting depends on the *projected* distance, so errors between points that
 * end up close together are punished and errors between points that end up far
 * apart are excused. That asymmetry matches how a viewer reads a scatterplot:
 * things drawn together look related, things drawn apart simply look unrelated.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, ∞), **lower is better**; 0 is exact.
 * - Cost: O(1), from an O(N²·D) pass, which must be given `ccaLambda`.
 *
 * The returned `value` is normalised: `Σ(d − d̂)²·F(d̂) ÷ Σd²·F(d̂)`, where `d` is
 * the high-dimensional distance, `d̂` the projected one and `F` the weighting
 * kernel. `raw` is the bare numerator `Σ(d − d̂)²·F(d̂)`, the quantity as
 * originally published.
 *
 * The pass options control the kernel: `ccaLambda` is the neighbourhood width the
 * weighting decays over, and `ccaKernel` picks its shape — `"exponential"`
 * (default) uses `F(d̂) = exp(−d̂/λ)`, `"step"` uses `F(d̂) = 1` for `d̂ ≤ λ` and 0
 * beyond. A `ccaLambda` that is missing or not strictly positive leaves the CCA
 * accumulators unfilled, and this read-out then throws.
 *
 * @throws {Error} if the pass ran without a positive `ccaLambda`.
 *
 * @see Demartines & Hérault, IEEE Trans. Neural Networks 8 (1997)
 *   {@link https://doi.org/10.1109/72.554199}
 *
 * @category Embedding cost
 * @group Embedding cost
 *
 * @example
 * ```ts
 * import { analyze, curvilinearStress } from "@saehrimnir/sickle";
 *
 * // ccaLambda is required here, not on the read-out; ccaKernel defaults to
 * // "exponential". Without a positive ccaLambda, curvilinearStress throws.
 * const a = analyze(data, projection, { ccaLambda: 0.3, ccaKernel: "exponential" });
 * const s = curvilinearStress(a.embedding);
 * s.value;  // 0.622 for a noisy 50-point circle cut open into a line
 * s.raw;    // 847.19 — the unnormalised sum
 * ```
 */
export function curvilinearStress(f: EmbeddingMoments): MetricResult & { raw: number } {
    if (Number.isNaN(f.ccaNum)) {
        throw new Error(
            "curvilinearStress: the pass was run without `ccaLambda`. " +
            "Pass { ccaLambda } to analyze()/fusedPartial() to enable it.",
        );
    }
    if (!(f.ccaDen > 0)) return { value: NaN, localKind: "none", raw: f.ccaNum };
    const value = f.ccaNum / f.ccaDen;
    const local = new Float64Array(f.n);
    for (let i = 0; i < f.n; ++i) local[i] = f.rowCca[i] / f.ccaDen;
    return { value, local, localKind: "sum", raw: f.ccaNum };
}

/**
 * Neighbourhood preservation framed as an information-retrieval trade-off.
 *
 * Treats each point's neighbourhood as a probability distribution and measures the
 * divergence between the two spaces. `recall` is the cost of neighbours the
 * projection *missed*; `precision` is the cost of neighbours it *invented*.
 * `lambda` chooses which matters: 1 is pure recall, 0 pure precision, 0.5 balanced.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, ∞), **lower is better**; 0 only when the neighbourhood
 *   distributions coincide.
 * - Cost: O(N²·D) for its own pass, plus a bisection per point.
 *
 * Reported per point rather than summed, so values are comparable across dataset
 * sizes.
 *
 * @see Venna, Peltonen, Nybo, Aidos & Kaski, JMLR 11 (2010)
 *   {@link https://www.jmlr.org/papers/v11/venna10a.html}
 *
 * @category Embedding cost
 * @group Embedding cost
 *
 * @example
 * ```ts
 * import { nervPass, nerv } from "@saehrimnir/sickle";
 *
 * // nerv reads a NeRV pass, not `analyze`.
 * const p = nervPass(data, projection, { lambda: 0.5, perplexity: 30 });
 *
 * nerv(p).value;  // 0.4611 — λ·recall + (1-λ)·precision, lower is better
 * p.recall;       // 77.6049 — KL(p‖q), the SNE/t-SNE end at λ = 1
 * p.precision;    // 106.8424 — KL(q‖p), the λ = 0 end
 * ```
 */
export function nerv(p: Nerv): MetricResult & {
    /** mean_i KL(p_i || q_i): cost of missed neighbours. */
    recall: number;
    /** mean_i KL(q_i || p_i): cost of false neighbours. */
    precision: number;
} {
    const value = (p.lambda * p.recall + (1 - p.lambda) * p.precision) / p.n;
    return {
        value,
        local: p.local,
        localKind: "mean",
        recall: p.recall / p.n,
        precision: p.precision / p.n,
    };
}
