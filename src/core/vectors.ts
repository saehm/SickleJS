/**
 * The single input representation used everywhere in the library.
 *
 * Row-major, flat, Float64. This is deliberately the same memory layout DruidJS
 * uses for `Matrix.values`, so a druid Matrix adapts with zero copying and
 * without importing druid at all (structural typing only -- druid stays an
 * optional peer dependency).
 *
 * @category Input
 * @group Input
 */
export interface Vectors {
    readonly data: Float64Array;
    readonly n: number;
    readonly d: number;
}

/**
 * Anything shaped like a DruidJS Matrix. Duck-typed on purpose.
 *
 * @category Input
 * @group Input
 */
export interface MatrixLike {
    values: Float64Array | number[];
    shape: [number, number] | number[];
}

/** * @category Input * @group Input */
export type VectorInput = Vectors | MatrixLike | number[][] | Float64Array;

/**
 * What every public entry point accepts for a set of points.
 *
 * {@link VectorInput} minus the bare `Float64Array`, which carries no column
 * count and so cannot be interpreted on its own. Pass one of those through
 * {@link toVectors} with an explicit `d` first:
 *
 * ```ts
 * analyze(toVectors(buffer, 8), toVectors(projection, 2));
 * ```
 *
 * Conversion is free for an existing {@link Vectors} and for a DruidJS `Matrix`
 * -- both are adopted without copying. A `number[][]` is copied into a flat
 * Float64Array on every call, so when reading several measures off the same
 * points, convert once with {@link toVectors} and reuse the result.
 *
 * @category Input
 * @group Input
 */
export type PointsInput = Vectors | MatrixLike | number[][];

function isVectors(x: unknown): x is Vectors {
    return (
        typeof x === "object" && x !== null &&
        "data" in x && "n" in x && "d" in x &&
        (x as Vectors).data instanceof Float64Array
    );
}

function isMatrixLike(x: unknown): x is MatrixLike {
    return (
        typeof x === "object" && x !== null &&
        "values" in x && "shape" in x &&
        Array.isArray((x as MatrixLike).shape)
    );
}

/**
 * Normalise any supported input to {@link Vectors}.
 *
 * Zero-copy for a DruidJS Matrix whose `values` is already a Float64Array, and
 * for an existing Vectors. `number[][]` is converted once, at the boundary --
 * boxed arrays are never used internally.
 *
 * @param input the data
 * @param d required only when passing a bare Float64Array
 *
 * @category Input
 * @group Input
 *
 * @example
 * ```ts
 * import { toVectors, analyze } from "@saehrimnir/sickle";
 *
 * // Rarely needed: every entry point accepts number[][] or a Matrix directly.
 * analyze(data, projection);
 *
 * // The one case that does need it — a flat buffer carries no column count:
 * const hd = toVectors(buffer, 8);   // 8 columns
 * const ld = toVectors(flat2d, 2);
 * analyze(hd, ld);
 *
 * // Idempotent and zero-copy for Vectors and for a DruidJS Matrix. A number[][]
 * // is copied each time, so convert once if several measures share the points.
 * const reusable = toVectors(projection);
 * ```
 */
export function toVectors(input: VectorInput, d?: number): Vectors {
    if (isVectors(input)) return input;

    if (input instanceof Float64Array) {
        if (!d || d <= 0) throw new TypeError("toVectors: `d` is required when passing a Float64Array");
        if (input.length % d !== 0) {
            throw new TypeError(`toVectors: length ${input.length} is not a multiple of d=${d}`);
        }
        return { data: input, n: input.length / d, d };
    }

    if (Array.isArray(input)) {
        const n = input.length;
        if (n === 0) throw new TypeError("toVectors: empty input");
        const dim = input[0].length;
        if (dim === 0) throw new TypeError("toVectors: zero-dimensional input");
        const data = new Float64Array(n * dim);
        for (let i = 0; i < n; ++i) {
            const row = input[i];
            if (row.length !== dim) {
                throw new TypeError(`toVectors: row ${i} has length ${row.length}, expected ${dim}`);
            }
            data.set(row, i * dim);
        }
        return { data, n, d: dim };
    }

    if (isMatrixLike(input)) {
        const [n, dim] = input.shape as [number, number];
        const values = input.values;
        // Zero-copy when druid already hands us a Float64Array of the right size.
        const data = values instanceof Float64Array && values.length === n * dim
            ? values
            : Float64Array.from(values);
        return { data, n, d: dim };
    }

    throw new TypeError("toVectors: unsupported input; expected Vectors, Matrix, number[][] or Float64Array");
}

/**
 * Copy of row `i`. Never hand out a subarray view of the caller's buffer.
 *
 * @category Input
 * @group Input
 *
 * @example
 * ```ts
 * import { toVectors, row } from "@saehrimnir/sickle";
 *
 * const v = toVectors(projection);
 * row(v, 0);  // Float64Array [x, y] — a copy, never a view of your buffer
 * ```
 */
export function row(v: Vectors, i: number): Float64Array {
    return v.data.slice(i * v.d, (i + 1) * v.d);
}

/**
 * Assert that two datasets describe the same points.
 *
 * @category Input
 * @group Input
 *
 * @example
 * ```ts
 * import { assertSamePoints } from "@saehrimnir/sickle";
 *
 * // Throws if the two sides describe different point counts, or fewer than 3.
 * assertSamePoints(data, projection);
 * ```
 */
export function assertSamePoints(a: Vectors, b: Vectors): void {
    if (a.n !== b.n) {
        throw new Error(`point count mismatch: high-dimensional has ${a.n}, projection has ${b.n}`);
    }
    if (a.n < 3) throw new Error(`at least 3 points are required, got ${a.n}`);
}
