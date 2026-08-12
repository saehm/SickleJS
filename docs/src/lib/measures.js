/**
 * What the demo layer needs to know about a measure that a number alone does
 * not say: which way is better, and where the scale should start.
 *
 * Direction and domain are *not* written here — they come from
 * `generated/capabilities.json`, which is parsed out of the TSDoc in `src/`. If
 * a measure's range changes in the library, this file does not need editing and
 * cannot disagree with it.
 *
 * The floors do live here, because they are stated in prose ("a random
 * projection scores about 0.5") rather than in the machine-readable part. Each
 * one is quoted from the TSDoc it came from.
 */
import capabilities from "../generated/capabilities.json";

const byName = new Map(capabilities.map((m) => [m.name, m]));

/**
 * Practical floors. Mapping trustworthiness onto [0, 1] wastes half the scale
 * and makes every projection look good.
 */
const FLOORS = {
    // "A random projection scores about 0.5, so read that as the practical floor."
    trustworthiness: 0.5,
    continuity: 0.5,
    // "**0.5 is chance**, so read that as the floor."
    tripletAccuracy: 0.5,
    // "about 0.5 for a random projection."
    mrreFalse: 0.5,
    mrreMissing: 0.5,
    // "0 is a random projection."
    rnx: 0,
    aucLogRnx: 0,
    qnx: 0,
    lcmc: 0,
};

/**
 * Floors that depend on the data rather than being constant. Returned as a
 * function of the dataset so the legend can state the real chance level.
 */
const DATA_FLOORS = {
    // "The chance level is the largest class's share."
    neighborhoodHit: (d) => {
        const counts = new Map();
        for (const l of d.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
        return Math.max(...counts.values()) / d.labels.length;
    },
    // "The chance level is roughly 1/number of classes."
    distanceConsistency: (d) => 1 / new Set(d.labels).size,
    // Lower is better here, so chance is the error a majority guess would make.
    classificationError: (d) => {
        const counts = new Map();
        for (const l of d.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
        return 1 - Math.max(...counts.values()) / d.labels.length;
    },
};

/** Human-readable names. The identifier is right, but it is not a caption. */
const TITLES = {
    trustworthiness: "Trustworthiness",
    continuity: "Continuity",
    qnx: "Q_NX",
    lcmc: "LCMC",
    rnx: "R_NX",
    aucLogRnx: "AUC of log R_NX",
    mrreFalse: "MRRE (false neighbours)",
    mrreMissing: "MRRE (missing neighbours)",
    stress: "Stress",
    scaleNormalizedStress: "Scale-normalised stress",
    pearsonR: "Pearson r of distances",
    residualVariance: "Residual variance",
    spearmanRho: "Spearman ρ of distances",
    nonMetricStress: "Non-metric stress",
    sammonStress: "Sammon stress",
    curvilinearStress: "CCA stress",
    nerv: "NeRV",
    silhouette: "Silhouette",
    calinskiHarabasz: "Calinski–Harabasz",
    daviesBouldin: "Davies–Bouldin",
    dunnIndex: "Dunn index",
    distanceConsistency: "Distance consistency",
    averageBetweenWithin: "Average between/within",
    hypothesisMargin: "Hypothesis margin",
    neighborhoodHit: "Neighbourhood hit",
    classificationError: "Classification error",
    gabrielClassificationError: "Gabriel classification error",
    densityPreservation: "Density preservation",
    tripletAccuracy: "Triplet accuracy",
    topologicalH0: "Topological H0",
    topologicalH1: "Topological H1",
    steadiness: "Steadiness",
    cohesiveness: "Cohesiveness",
    scagnostics: "Scagnostics",
};

/** Measures reported by a pass under a different name than their export. */
const ALIASES = { steadiness: "snc", cohesiveness: "snc" };

export function meta(name) {
    const cap = byName.get(ALIASES[name] ?? name) ?? null;
    return {
        name,
        title: TITLES[name] ?? name,
        category: cap?.category ?? null,
        summary: cap?.headline ?? "",
        domain: cap?.range.domain ?? "",
        direction: cap?.range.direction ?? null,
        note: cap?.range.note ?? "",
        cost: cap?.costOrder ?? "",
        needs: cap?.needs ?? null,
        reference: cap?.reference ?? null,
    };
}

/** The floor to start the colour scale at, given a dataset. */
export function floorOf(name, dataset) {
    if (name in DATA_FLOORS && dataset) return DATA_FLOORS[name](dataset);
    return FLOORS[name] ?? null;
}

/**
 * The measure's declared range as `[lo, hi]`, or `null` when it is unbounded.
 *
 * Parsed from the `- Range:` line in the library's own TSDoc — the same string
 * the capability matrix prints — so a colour scale cannot claim a domain the
 * documentation disagrees with.
 */
export function domainOf(name) {
    const text = meta(name).domain;
    if (!text || /∞|infinity/i.test(text)) return null;
    const m = text.match(/([[(])\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*([\])])/);
    if (!m) return null;
    const lo = Number(m[2]);
    const hi = Number(m[3]);
    return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : null;
}

/**
 * Whether the measure's range is closed at both ends.
 *
 * This is what decides whether a number can be carried between datasets at all:
 * a bounded measure's 0.9 means the same thing everywhere, while an unbounded
 * one — Calinski–Harabasz at 4687, GCE at 0.21 — is only meaningful against
 * another projection of the same points. The direction markers are coloured by
 * it, on the same purple/green rule the colour scales use.
 */
export function isBounded(name) {
    return domainOf(name) !== null;
}

/**
 * Whether a per-point array may be shown on an absolute scale.
 *
 * Two conditions, and both matter. The measure needs a bounded domain — an
 * unbounded one has no full range to span. And the array has to be a *score*:
 * a `share` or `sum` is a contribution of roughly 1/N per point, so spanning
 * its nominal [0, 1] would paint every point the same colour and hide exactly
 * what the encoding exists to show.
 */
export function absoluteDomain(name, localKind) {
    const isScore = localKind === "mean" || localKind === "partial-mean";
    return isScore ? domainOf(name) : null;
}

/**
 * Published interpretation bands, where a citable convention exists.
 *
 * Only silhouette has one that is both widely used and attributable, from
 * Rousseeuw's original paper. It is a rule of thumb rather than a standard, and
 * the legend says so.
 */
const PUBLISHED_BANDS = {
    silhouette: {
        source: "Rousseeuw's rule of thumb (1987)",
        bands: [
            { from: -1, to: 0.25, label: "no structure" },
            { from: 0.25, to: 0.5, label: "weak" },
            { from: 0.5, to: 0.7, label: "reasonable" },
            { from: 0.7, to: 1, label: "strong" },
        ],
    },
};

/**
 * Bands for a measure, or `null` when there is nothing defensible to draw.
 *
 * Deliberately sparse. An earlier version cut the range between chance and a
 * perfect score into quarters and labelled them poor/fair/good/very good, which
 * looks helpful and is invention: nothing makes 0.75 the boundary between
 * "fair" and "good" for trustworthiness, and a reader has no way to tell a
 * threshold that came from the literature from one that came from a docs
 * script. So only two kinds of band survive:
 *
 *   - a published convention, cited;
 *   - the chance level, which is a fact about the measure rather than an
 *     opinion about it — a projection at or below it has told you nothing.
 *
 * Measures with neither get no banded mode at all.
 */
export function bandsOf(name, dataset) {
    const published = PUBLISHED_BANDS[name];
    if (published) return { ...published, kind: "published" };

    const domain = domainOf(name);
    const chance = floorOf(name, dataset);
    if (!domain || chance === null) return null;

    const [lo, hi] = domain;
    if (chance <= lo || chance >= hi) return null;

    // Lower-is-better measures have chance at the top of the useful range.
    const better = lowerIsBetter(name)
        ? { from: lo, to: chance, label: "better than chance" }
        : { from: chance, to: hi, label: "better than chance" };
    const worse = lowerIsBetter(name)
        ? { from: chance, to: hi, label: "no better than chance" }
        : { from: lo, to: chance, label: "no better than chance" };

    return {
        kind: "chance",
        source: null,
        chance,
        bands: [worse, better].sort((p, q) => p.from - q.from),
    };
}

/** True when a *larger* number means a *worse* projection. */
export function lowerIsBetter(name) {
    return meta(name).direction === "lower";
}

/**
 * What a per-point array means. Kinds are not interchangeable, and rendering a
 * `share` as though it were a `mean` produces a legend that lies.
 */
export const LOCAL_KINDS = {
    mean: {
        label: "per-point score",
        blurb: "Each point's own score. These average to the reported value.",
        unit: "score",
    },
    share: {
        label: "share of total",
        blurb: "Each point's share of the total error. These sum to 1. A large share is a lead worth checking; a small one is not an all-clear.",
        unit: "share",
    },
    sum: {
        label: "contribution",
        blurb: "Each point's contribution, in the measure's own units. These sum to the reported value. A large one is a lead; a small one is not an all-clear.",
        unit: "contribution",
    },
    "partial-mean": {
        label: "per-point score, some excluded",
        blurb: "Each point's own score, but some points are legitimately excluded and carry no value. They are drawn hollow, never as zero.",
        unit: "score",
    },
    "weighted-mean": {
        label: "weighted per-point score",
        blurb: "Each point's score, combined with weights to give the reported value.",
        unit: "score",
    },
    none: {
        label: "no per-point values",
        blurb: "This measure is a ratio of sums and does not decompose per point.",
        unit: "",
    },
};

export { capabilities };

/**
 * The direction mark for a measure: glyph, comparability, and a title.
 *
 * One definition for every table on the site, so the encoding cannot drift
 * between the capability matrix, the disagreement gallery and the method
 * comparisons.
 *
 * Two channels, both carried by shape as well as colour — colour alone would
 * leave the bounded/unbounded distinction invisible to a colour-blind reader
 * or on a printed page:
 *
 * - **Direction** is which way the triangle points. Up: higher is better.
 * - **Comparability** is whether it is filled. Filled (purple) means a bounded
 *   range, so the number means the same thing in any dataset. Hollow (amber)
 *   means unbounded, so it is only meaningful against another projection of
 *   the same points.
 *
 * Returns `null` for a measure with no direction — `scagnostics`, where a high
 * `clumpy` is a description of the shape rather than a score.
 */
export function directionMark(name) {
    const direction = meta(name).direction;
    if (!direction) return null;
    const higher = direction === "higher";
    const bounded = isBounded(name);
    return {
        glyph: bounded ? (higher ? "▲" : "▼") : higher ? "△" : "▽",
        higher,
        bounded,
        title:
            `${higher ? "higher" : "lower"} is better; ` +
            (bounded
                ? "bounded range, comparable across datasets"
                : "unbounded, comparable only within a dataset"),
    };
}
