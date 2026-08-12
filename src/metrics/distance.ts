/**
 * Distance measures: are the distances themselves preserved?
 *
 * Read-outs of one shared pass. Pick by how much you care about scale: `stress`
 * is scale-sensitive, `scaleNormalizedStress` is not, and `pearsonR` ignores it
 * entirely.
 */

import type { MetricResult } from "../core/result.ts";
import type { DistanceMoments } from "../passes/distances.ts";

/**
 * How far the projected distances are from the originals.
 *
 * The classic distance-preservation measure. Sensitive to scale: a projection
 * that halves every distance is perfect in shape but scores badly here. Use
 * {@link scaleNormalizedStress} if the projection's units are arbitrary, which
 * they are for t-SNE, UMAP and most non-linear methods.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, ∞), **lower is better**; 0 means the distances match exactly.
 *   Around 1 means the error is as large as the distances themselves.
 * - Cost: O(1), from an O(N²·D) pass.
 *
 * Per-point values give each point's share of the total squared error — useful for
 * colouring, but a share rather than a score, so they sum to 1 instead of
 * averaging to the stress. The one exception is an exactly perfect projection:
 * with no error to apportion the array is all zeros and sums to 0, not 1.
 *
 * @see Kruskal, Psychometrika 29 (1964) {@link https://doi.org/10.1007/BF02289565}
 *
 * @category Distance
 * @group Distance
 *
 * @example
 * ```ts
 * import { analyze, stress } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);
 * const s = stress(a.moments);
 *
 * s.value;       // 0.0807 — raw Kruskal stress, in the data's own units
 * s.localKind;   // "share"
 * s.local[0];    // 0.0104 — this point's share of the error; the array sums to 1
 * ```
 */
export function stress(m: DistanceMoments): MetricResult {
    const value = Math.sqrt(m.sumDiff2 / m.sumHH);
    const local = new Float64Array(m.n);
    if (m.sumDiff2 > 0) {
        for (let i = 0; i < m.n; ++i) local[i] = m.rowDiff2[i] / m.sumDiff2;
    }
    return { value, local, localKind: "share" };
}

/**
 * Stress after rescaling the projection to fit as well as it can.
 *
 * The scale-free version of {@link stress}: it answers "is the *shape* right",
 * ignoring the projection's arbitrary units. Almost always the one you want when
 * comparing methods.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], **lower is better**; 0 is a perfect match up to a global scale.
 *   Substituting the optimal α gives `1 - sumHL²/(sumLL·sumHH)` under the root, so
 *   the value cannot exceed 1 — α = 0 is always available and already scores 1.
 * - Cost: O(1), from an O(N²·D) pass.
 *
 * @category Distance
 * @group Distance
 *
 * @example
 * ```ts
 * import { analyze, stress, scaleNormalizedStress } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);
 *
 * stress(a.moments).value;                 // 0.0807 — punishes a wrong overall scale
 * scaleNormalizedStress(a.moments).value;  // 0.0737 — the shape alone
 * ```
 */
export function scaleNormalizedStress(m: DistanceMoments): MetricResult {
    const alpha = m.sumHL / m.sumLL;
    // sum (dH - alpha*dL)^2 = sumHH - 2*alpha*sumHL + alpha^2*sumLL
    const numerator = m.sumHH - 2 * alpha * m.sumHL + alpha * alpha * m.sumLL;
    return {
        value: Math.sqrt(Math.max(0, numerator) / m.sumHH),
        localKind: "none",
    };
}

/**
 * The factor the projection would have to be multiplied by to minimise stress.
 *
 * Far from 1 means the projection's units differ from the data's — harmless in
 * itself, but it tells you {@link stress} will look worse than the shape deserves.
 *
 * @category Distance
 * @group Distance
 *
 * @example
 * ```ts
 * import { analyze, optimalScale } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);
 * optimalScale(a.moments);  // 1.0342 — multiply the projection by this to minimise stress
 * ```
 */
export const optimalScale = (m: DistanceMoments): number => m.sumHL / m.sumLL;

/**
 * Linear correlation between the original and projected distances.
 *
 * A quick global check: high means far-apart points stayed far apart. Blind to a
 * uniform rescaling, unlike {@link stress}, but also blind to non-linear
 * distortions that preserve ordering — see {@link spearmanRho} for the ordinal
 * version.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [-1, 1], higher is better.
 * - Cost: O(1), from an O(N²·D) pass.
 *
 * Computed over the full N×N matrix including its zero diagonal, matching zadu.
 * That convention shifts the value against a condensed (upper-triangle) one, so
 * compare like with like.
 *
 * @category Distance
 * @group Distance
 *
 * @example
 * ```ts
 * import { analyze, pearsonR, residualVariance } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);
 *
 * pearsonR(a.moments).value;          // 0.9967 — correlation of the two distance sets
 * residualVariance(a.moments).value;  // 0.0066 — the same thing as 1 - r²
 * ```
 */
export function pearsonR(m: DistanceMoments): MetricResult {
    const N = m.pairs;
    const meanH = m.sumH / N, meanL = m.sumL / N;
    const cov = m.sumHL / N - meanH * meanL;
    const varH = m.sumHH / N - meanH * meanH;
    const varL = m.sumLL / N - meanL * meanL;
    return { value: cov / Math.sqrt(varH * varL), localKind: "none" };
}
