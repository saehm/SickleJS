/**
 * Compensated summation.
 *
 * These metrics accumulate over N^2 terms: 10^8 at N=10000. Naive float64
 * summation has worst-case relative error ~N^2 * eps, which at that size is
 * ~2e-8 -- eight digits gone. Neumaier compensation keeps the error at ~eps
 * regardless of term count, for a cost of two extra flops per term.
 *
 * DruidJS exports `neumair_sum`/`kahan_sum` for whole arrays, and those are the
 * right choice when an array already exists. The streaming case here cannot
 * materialise its terms, hence this accumulator.
 */

/**
 * Incremental Neumaier (improved Kahan) accumulator.
 *
 * @internal
 */
export class Accumulator {
    #sum = 0;
    #compensation = 0;

    add(x: number): void {
        const t = this.#sum + x;
        this.#compensation += Math.abs(this.#sum) >= Math.abs(x)
            ? this.#sum - t + x
            : x - t + this.#sum;
        this.#sum = t;
    }

    get value(): number {
        return this.#sum + this.#compensation;
    }

    reset(): void {
        this.#sum = 0;
        this.#compensation = 0;
    }

    /** Merge another accumulator, for reducing partial passes. */
    merge(other: Accumulator): void {
        this.add(other.value);
    }
}

/**
 * Compensated sum of an array. Equivalent to druid's `neumair_sum`.
 *
 * @internal
 */
export function sum(values: ArrayLike<number>): number {
    const acc = new Accumulator();
    for (let i = 0, n = values.length; i < n; ++i) acc.add(values[i]);
    return acc.value;
}

/**
 * Compensated mean. `NaN` for an empty input.
 *
 * @internal
 */
export function mean(values: ArrayLike<number>): number {
    return values.length === 0 ? NaN : sum(values) / values.length;
}
