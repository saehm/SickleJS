/**
 * Types for `cases.mjs`.
 *
 * The constructions are plain ESM rather than TypeScript because
 * `docs/scripts/precompute.mjs` imports them under bare `node`, with no type
 * stripping. This declaration keeps the test suite type-checked all the same.
 */

/** Points in the data and in the projection, aligned by index. */
export interface Case {
    hd: number[][];
    ld: number[][];
}

export interface LabelledCase extends Case {
    labels: number[];
}

export interface StrayCase extends LabelledCase {
    /** Indices of the points moved into the wrong class. */
    strayIndices: number[];
}

export function lcg(seed: number): () => number;

export function loopAndArc(n?: number): Case;
export function densityFlattened(): Case;
export function groupSplit(): Case;
export function falseSeparation(): LabelledCase;
export function strayPoints(strays?: number): StrayCase;
export function compressedGaps(): Case;
