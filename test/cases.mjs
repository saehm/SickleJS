/**
 * The disagreement cases: constructions where two measures contradict each
 * other, and the contradiction is the point.
 *
 * Plain ESM with no dependencies, because two very different consumers need the
 * *same* points: `test/disagreements.test.ts`, which asserts the relationships,
 * and `docs/scripts/precompute.mjs`, which renders them on the site. Keeping one
 * copy is what lets the docs claim its numbers are numbers an assertion holds
 * for — with two copies that claim would quietly stop being true.
 */

/** Deterministic and portable. No RNG dependency, no snapshot drift. */
export function lcg(seed) {
    let s = seed >>> 0;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/**
 * A noisy circle, and the same circle cut open into a line.
 *
 * Every local neighbourhood survives the cut, so the rank measures see nothing;
 * the loop is gone, which only H1 reports.
 */
export function loopAndArc(n = 50) {
    const rnd = lcg(11);
    const hd = [], ld = [];
    for (let i = 0; i < n; ++i) {
        const t = (2 * Math.PI * i) / n;
        hd.push([Math.cos(t) + (rnd() - 0.5) * 0.04, Math.sin(t) + (rnd() - 0.5) * 0.04]);
        ld.push([i / n, (rnd() - 0.5) * 0.01]);
    }
    return { hd, ld };
}

/** Two clusters of very different density, drawn at the same width. */
export function densityFlattened() {
    const rnd = lcg(3);
    const hd = [], ld = [];
    for (let i = 0; i < 60; ++i) {
        const t = rnd() * 2 - 1;
        hd.push([t * 0.05, rnd() * 0.05]);
        ld.push([t * 1.0, rnd() * 1.0]);
    }
    for (let i = 0; i < 60; ++i) {
        const t = rnd() * 2 - 1;
        hd.push([10 + t * 1.0, rnd() * 1.0]);
        ld.push([10 + t * 1.0, rnd() * 1.0]);
    }
    return { hd, ld };
}

/** One real group in the data, drawn as two separated halves. */
export function groupSplit() {
    const rnd = lcg(5);
    const hd = [], ld = [];
    for (let i = 0; i < 120; ++i) {
        const x = rnd() * 4 - 2, y = rnd() * 2 - 1;
        hd.push([x, y]);
        // Pull the two halves apart in the projection; a gap that is not there.
        ld.push([x + (x > 0 ? 3 : -3), y]);
    }
    return { hd, ld };
}

/** Two classes that overlap in the data, drawn as two tidy groups. */
export function falseSeparation() {
    const rnd = lcg(9);
    const hd = [], ld = [], labels = [];
    for (let i = 0; i < 140; ++i) {
        const c = i % 2;
        hd.push([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
        ld.push([c * 5 + rnd(), rnd()]);
        labels.push(c);
    }
    return { hd, ld, labels };
}

/**
 * Two classes genuinely far apart, drawn apart — but with a handful of points
 * teleported into the middle of the other class.
 *
 * The stray count is deliberately small. Every label measure that sees only the
 * projection averages them away; the one that also sees the data does not.
 */
export function strayPoints(strays = 6) {
    const rnd = lcg(23);
    const hd = [], ld = [], labels = [], strayIndices = [];
    for (let i = 0; i < 160; ++i) {
        const c = i % 2;
        hd.push([c * 20 + rnd(), rnd(), rnd()]);
        ld.push([c * 6 + rnd(), rnd()]);
        labels.push(c);
    }
    for (let s = 0; s < strays; ++s) {
        const i = s * 7;                    // a class-0 point...
        ld[i] = [6 + rnd(), rnd()];         // ...drawn inside class 1
        strayIndices.push(i);
    }
    return { hd, ld, labels, strayIndices };
}

/**
 * Three rigid clusters pushed together: every distance ordering survives, no
 * gap does.
 *
 * Within-cluster distances are untouched and every between-cluster distance is
 * scaled by the same factor, so the transform is monotone and the ordering
 * holds — the clusters are still further from each other than their own points
 * are. Only the *size* of the gaps is wrong, by 4x.
 */
export function compressedGaps() {
    const rnd = lcg(11);
    const centres = [[0, 0], [6, 0], [3, 5.2]];
    const gap = 0.25, spread = 0.5;
    const hd = [], ld = [];
    for (const c of centres) {
        for (let i = 0; i < 50; ++i) {
            const dx = (rnd() - 0.5) * spread, dy = (rnd() - 0.5) * spread;
            hd.push([c[0] + dx, c[1] + dy]);
            ld.push([c[0] * gap + dx, c[1] * gap + dy]);
        }
    }
    return { hd, ld };
}
