/**
 * Correlation between original and projected distances, linear and rank-based.
 *
 * `spearmanRho` ranks every pair and so needs O(N²) memory, unlike the streaming
 * measures elsewhere.
 */

import type { MetricResult } from "../core/result.ts";
import { makeRadixScratch, radixArgsort } from "../core/sort.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";
import type { DistanceMoments } from "../passes/distances.ts";
import { pearsonR } from "./distance.ts";

/**
 * The share of distance variance the projection fails to explain.
 *
 * Simply `1 - r²` of {@link pearsonR}, restated so that lower is better and the
 * number reads as "proportion of structure lost".
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [0, 1], **lower is better**.
 * - Cost: O(1), from an O(N²·D) pass.
 *
 * @see Tenenbaum, de Silva & Langford, Science 290 (2000)
 *   {@link https://doi.org/10.1126/science.290.5500.2319}
 *
 * @category Distance
 * @group Distance
 *
 * @example
 * ```ts
 * import { analyze, residualVariance } from "@saehrimnir/sickle";
 *
 * const a = analyze(data, projection);
 * residualVariance(a.moments).value;  // 0.0066 — 1 - r², so lower is better
 * ```
 */
export function residualVariance(m: DistanceMoments): MetricResult {
    const r = pearsonR(m).value;
    return { value: 1 - r * r, localKind: "none" };
}

/** Ranks with ties averaged, as `scipy.stats.rankdata` produces. */
function averageRanks(values: Float64Array, order: Uint32Array, out: Float64Array): void {
    const n = values.length;
    let i = 0;
    while (i < n) {
        let j = i + 1;
        while (j < n && values[order[j]] === values[order[i]]) j += 1;
        const rank = (i + j - 1) / 2 + 1;
        for (let t = i; t < j; ++t) out[order[t]] = rank;
        i = j;
    }
}

/** * @category Distance * @group Distance */
export interface SpearmanOptions {
    /** Refuse beyond this many entries rather than attempting the allocation. */
    maxPairs?: number;
    signal?: AbortSignal;
}

/**
 * Rank correlation between original and projected distances — Shepard goodness.
 *
 * Asks only whether distances kept their *order*, so a projection that stretches
 * distances non-linearly but consistently still scores 1. That makes it a fairer
 * global measure than {@link stress} for methods that deliberately warp scale.
 *
 * - Needs: high-dimensional data and projection. No labels.
 * - Range: [-1, 1], higher is better.
 * - Cost: O(N² log N) time and **O(N²) memory** — it ranks every pair, so unlike
 *   most measures here it materialises them. `maxPairs` guards the allocation.
 *
 * @see Shepard, Psychometrika 27 (1962)
 *   {@link https://doi.org/10.1007/BF02289630}
 *
 * @category Distance
 * @group Distance
 *
 * @example
 * ```ts
 * import { spearmanRho } from "@saehrimnir/sickle";
 *
 * // Takes the points directly — it needs every pair ranked, so it does not read
 * // off `analyze` and it materialises the full N×N matrix.
 * spearmanRho(data, projection).value;  // 0.988
 *
 * // Guarded by `maxPairs` (default 60e6, counting n²), so it refuses past
 * // n ≈ 7 745 rather than attempting the allocation.
 * spearmanRho(data, projection, { maxPairs: 2e8 });
 * ```
 */
export function spearmanRho(
    hdIn: PointsInput, ldIn: PointsInput, opts: SpearmanOptions = {},
): MetricResult {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const n = hd.n;
    const total = n * n;
    const maxPairs = opts.maxPairs ?? 60e6;
    if (total > maxPairs) {
        throw new RangeError(
            `spearmanRho needs to materialise ${total} entries; n=${n} exceeds ` +
            `maxPairs=${maxPairs}. Raise maxPairs to override.`,
        );
    }

    const dh = new Float64Array(total), dl = new Float64Array(total);
    const hdData = hd.data, ldData = ld.data, dH = hd.d, dL = ld.d;
    for (let i = 0; i < n; ++i) {
        if ((i & 63) === 0) opts.signal?.throwIfAborted();
        for (let j = 0; j < n; ++j) {
            let a = 0;
            for (let c = 0; c < dH; ++c) { const t = hdData[i * dH + c] - hdData[j * dH + c]; a += t * t; }
            let b = 0;
            for (let c = 0; c < dL; ++c) { const t = ldData[i * dL + c] - ldData[j * dL + c]; b += t * t; }
            dh[i * n + j] = Math.sqrt(a);
            dl[i * n + j] = Math.sqrt(b);
        }
    }

    const order = new Uint32Array(total);
    const scratch = makeRadixScratch(total);
    const rankH = new Float64Array(total), rankL = new Float64Array(total);

    for (let t = 0; t < total; ++t) order[t] = t;
    radixArgsort(dh, order, total, scratch);
    averageRanks(dh, order, rankH);

    for (let t = 0; t < total; ++t) order[t] = t;
    radixArgsort(dl, order, total, scratch);
    averageRanks(dl, order, rankL);

    // Pearson on the ranks.
    let meanH = 0, meanL = 0;
    for (let t = 0; t < total; ++t) { meanH += rankH[t]; meanL += rankL[t]; }
    meanH /= total; meanL /= total;
    let cov = 0, varH = 0, varL = 0;
    for (let t = 0; t < total; ++t) {
        const u = rankH[t] - meanH, v = rankL[t] - meanL;
        cov += u * v; varH += u * u; varL += v * v;
    }
    const denom = Math.sqrt(varH * varL);
    return { value: denom === 0 ? 0 : cov / denom, localKind: "none" };
}
