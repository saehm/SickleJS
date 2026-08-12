/**
 * `analyze` -- one sweep, every family.
 *
 * The rank-based and distance-based metrics both need each row of the pairwise
 * distance matrix. Calling `coRanking()` and `distanceMoments()` separately
 * computes that twice. `analyze()` runs the shared loop once and returns both.
 */

import { Accumulator } from "../core/sum.ts";
import { type PointsInput, type Vectors, assertSamePoints, toVectors } from "../core/vectors.ts";
import { type CoRanking, reduceCoRanking } from "./coranking.ts";
import type { DistanceMoments } from "./distances.ts";
import { type FusedOptions, type FusedPartial, fusedPartial } from "./fused.ts";

/**
 * Summed Sammon and CCA accumulators; see `metrics/embedding.ts`.
 *
 * @category Passes
 * @group Passes
 */
export interface EmbeddingMoments {
    readonly n: number;
    readonly sammonNum: number;
    readonly sammonDen: number;
    readonly rowSammon: Float64Array;
    /** NaN when the pass ran without `ccaLambda`. */
    readonly ccaNum: number;
    readonly ccaDen: number;
    readonly rowCca: Float64Array;
}

/**
 * Per-point local radii and rank inversions; see `metrics/structure.ts`.
 *
 * @category Passes
 * @group Passes
 */
export interface StructureMoments {
    readonly n: number;
    readonly radiusHigh: Float64Array;
    readonly radiusLow: Float64Array;
    readonly hasDensity: boolean;
    readonly inversions: Float64Array;
    readonly hasTriplets: boolean;
}

/** * @category Passes * @group Passes */
export interface Analysis {
    readonly n: number;
    readonly coRanking: CoRanking;
    readonly moments: DistanceMoments;
    /** Sammon and CCA accumulators, for `metrics/embedding.ts`. */
    readonly embedding: EmbeddingMoments;
    /** Local radii and rank inversions, for `metrics/structure.ts`. */
    readonly structure: StructureMoments;
}

/** * @category Passes * @group Passes */
export interface AnalyzeOptions {
    localK?: readonly number[];
    /** Neighbourhood size for `densityPreservation`. Omit to skip. */
    densityK?: number;
    /** Count rank inversions, for `tripletAccuracy`. Default false. */
    triplets?: boolean;
    /** Enables the CCA accumulators; see `curvilinearStress`. */
    ccaLambda?: number;
    ccaKernel?: "exponential" | "step";
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
    rowStart?: number;
    rowEnd?: number;
}

/**
 * Sum partials from disjoint row ranges. Both families reduce additively.
 *
 * @internal
 */
export function reduceFused(partials: readonly FusedPartial[]): Analysis {
    if (partials.length === 0) throw new Error("reduceFused: no partials");
    const n = partials[0].n;

    const coRanking = reduceCoRanking(partials);

    // Gather the per-row values first. Row ranges are disjoint, so this is a
    // copy, not a sum.
    const names = [
        "rowH", "rowL", "rowHH", "rowLL", "rowHL", "rowDiff2",
        "rowSammonNum", "rowSammonDen", "rowCcaNum", "rowCcaDen",
        "rowRadiusH", "rowRadiusL", "rowInversions",
    ] as const;
    const rows: Record<(typeof names)[number], Float64Array> = Object.fromEntries(
        names.map((k) => [k, new Float64Array(n)]),
    ) as never;
    let hasCca = false, hasDensity = false, hasTriplets = false;
    for (const p of partials) {
        hasCca = hasCca || p.hasCca;
        hasDensity = hasDensity || p.hasDensity;
        hasTriplets = hasTriplets || p.hasTriplets;
        for (const k of names) {
            const src = p[k], dst = rows[k];
            for (let i = p.rowStart; i < p.rowEnd; ++i) dst[i] = src[i];
        }
    }

    // Then sum them once, in row order. This is the same sequence of additions
    // the single-threaded pass performs, so the result does not depend on how
    // the rows were split -- see the note in `fused.ts`.
    const total = (a: Float64Array) => {
        const acc = new Accumulator();
        for (let i = 0; i < n; ++i) acc.add(a[i]);
        return acc.value;
    };

    return {
        n,
        coRanking,
        moments: {
            n,
            pairs: n * n,
            sumH: total(rows.rowH),
            sumL: total(rows.rowL),
            sumHH: total(rows.rowHH),
            sumLL: total(rows.rowLL),
            sumHL: total(rows.rowHL),
            sumDiff2: total(rows.rowDiff2),
            rowDiff2: rows.rowDiff2,
            rowHH: rows.rowHH,
        },
        structure: {
            n,
            radiusHigh: rows.rowRadiusH,
            radiusLow: rows.rowRadiusL,
            hasDensity,
            inversions: rows.rowInversions,
            hasTriplets,
        },
        embedding: {
            n,
            sammonNum: total(rows.rowSammonNum),
            sammonDen: total(rows.rowSammonDen),
            rowSammon: rows.rowSammonNum,
            ccaNum: hasCca ? total(rows.rowCcaNum) : NaN,
            ccaDen: hasCca ? total(rows.rowCcaDen) : NaN,
            rowCca: rows.rowCcaNum,
        },
    };
}

/**
 * Compute the rank and distance passes together, in a single sweep over pairs.
 *
 * Costs one pass instead of two; the rank side additionally skips its square
 * roots, since ranking only needs the ordering.
 *
 * @category Passes
 * @group Passes
 *
 * @example
 * ```ts
 * import { analyze, trustworthiness, continuity, stress } from "@saehrimnir/sickle";
 *
 * // `data` and `projection` are number[][] (or a DruidJS Matrix, or Vectors).
 * // One O(N²·D) sweep; every read-out below is then arithmetic on what it kept.
 * const a = analyze(data, projection);
 *
 * trustworthiness(a.coRanking, 20);  // 0.9659
 * continuity(a.coRanking, 20);       // 0.9709
 * stress(a.moments).value;           // 0.0807
 * ```
 * Some accumulators are off by default because they cost extra. Ask for them
 * here, not when reading the measure — reading one the pass was not told to
 * collect throws an error naming the option it needs:
 * ```ts
 * const b = analyze(data, projection, {
 *     localK: [20],     // per-point arrays, at these k
 *     densityK: 20,     // for densityPreservation
 *     triplets: true,   // for tripletAccuracy
 *     ccaLambda: 1,     // for curvilinearStress
 * });
 * ```
 */
export function analyze(hdIn: PointsInput, ldIn: PointsInput, opts: AnalyzeOptions = {}): Analysis {
    const hd = toVectors(hdIn), ld = toVectors(ldIn);
    assertSamePoints(hd, ld);
    const fusedOpts: FusedOptions = { ...opts, ranks: true, distances: true };
    return reduceFused([fusedPartial(hd, ld, fusedOpts)]);
}
