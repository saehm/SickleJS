/**
 * The result contract.
 *
 * Only some metrics decompose into per-point values. Getting this wrong is easy
 * and silent: a "local stress" that people average, producing a number that is
 * not the stress. So every metric declares how its per-point array relates to
 * its scalar, and the test suite asserts that relationship holds.
 */

/** * @category Input * @group Input */
export type LocalKind =
    /** `mean(local) === value`. Produced by silhouette, distanceConsistency,
     hypothesisMargin, neighborhoodHit, classificationError, and the NeRV pass.
     Note that trustworthiness, continuity and lcmc return a bare number: their
     per-point arrays come from localTrustworthiness and localContinuity, which
     hand back a Float64Array rather than a MetricResult. */
    | "mean"
    /** `sum(w_i * l_i) / sum(w_i) === value`. Requires `weights`. */
    | "weighted-mean"
    /** `sum(local) === value`. */
    | "sum"
    /** `sum(local) === 1`: each point's share of a total, not a score. Stress. */
    | "share"
    /**
     * mean over the *finite* entries === value. For measures that legitimately
     * exclude some points -- GCE drops leaves of the Gabriel graph -- so the
     * excluded ones carry NaN rather than a fabricated number.
     */
    | "partial-mean"
    /** No meaningful per-point decomposition exists. Ratios of sums, correlations. */
    | "none";

/** * @category Input * @group Input */
export interface MetricResult {
    readonly value: number;
    readonly local?: Float64Array;
    readonly localKind: LocalKind;
    /** Present exactly when `localKind === "weighted-mean"`. No measure shipped with
     the library returns that kind — it is here for custom metrics built on the
     same contract, and `checkContract` enforces it. */
    readonly weights?: Float64Array;
}

/**
 * Verify a result against its declared contract. Used by the test suite for
 * every metric, including any added later.
 *
 * @returns an error message, or null if the contract holds.
 *
 * @category Input
 * @group Input
 *
 * @example
 * ```ts
 * import { analyze, stress, checkContract } from "@saehrimnir/sickle";
 *
 * // Verifies that `local` really relates to `value` the way `localKind` claims.
 * const a = analyze(data, projection);
 * checkContract(stress(a.moments));  // stress is a "share": its local sums to 1
 * ```
 */
export function checkContract(r: MetricResult, tol = 1e-9): string | null {
    if (r.localKind === "none") {
        return r.local ? "localKind is 'none' but a local array was provided" : null;
    }
    if (!r.local) return `localKind is '${r.localKind}' but no local array was provided`;

    const n = r.local.length;
    let total = 0;
    for (let i = 0; i < n; ++i) total += r.local[i];

    const fail = (got: number, want: number, what: string) =>
        Math.abs(got - want) > tol * Math.max(1, Math.abs(want))
            ? `${what}: got ${got}, expected ${want} (diff ${Math.abs(got - want)})`
            : null;

    switch (r.localKind) {
        case "mean":
            return fail(total / n, r.value, "mean(local) !== value");
        case "sum":
            return fail(total, r.value, "sum(local) !== value");
        case "share":
            return fail(total, 1, "sum(local) !== 1");
        case "partial-mean": {
            let sum = 0, counted = 0;
            for (let i = 0; i < n; ++i) {
                const v = r.local[i];
                if (Number.isFinite(v)) { sum += v; counted += 1; }
            }
            if (counted === 0) return null;
            return fail(sum / counted, r.value, "mean(finite local) !== value");
        }
        case "weighted-mean": {
            if (!r.weights) return "localKind is 'weighted-mean' but no weights were provided";
            if (r.weights.length !== n) return "weights and local have different lengths";
            let num = 0, den = 0;
            for (let i = 0; i < n; ++i) { num += r.weights[i] * r.local[i]; den += r.weights[i]; }
            return fail(num / den, r.value, "weighted mean(local) !== value");
        }
    }
}
