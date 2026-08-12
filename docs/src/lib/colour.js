/**
 * Colour scales for the per-point encodings.
 *
 * One rule holds everywhere on the site: **deep purple is always good and pink
 * is always bad**, whichever direction the underlying measure runs in. A shared
 * ramp that silently flips meaning between two plots on the same page is worse
 * than no colour at all, so the flip happens here, once, driven by the
 * direction parsed out of the library's own TSDoc.
 */

/**
 * Two ramps, and which one is used carries meaning.
 *
 *   absolute — the scale spans the measure's declared domain, so a colour means
 *              the same thing in every plot on the site.
 *   relative — the scale is fitted to this data, so colours are comparable
 *              within the plot and nowhere else.
 *
 * Encoding that distinction as hue rather than as a footnote is the point: a
 * reader can see whether two plots may be compared without reading anything.
 * Both are monotone in lightness, so they survive greyscale and the common
 * colour-vision deficiencies — the ends differ in lightness, not only in hue.
 */
const RAMP_ABSOLUTE = [
    [255, 69, 198],   // pink — worst
    [214, 92, 196],
    [166, 105, 197],
    [122, 92, 186],
    [106, 63, 174],   // the site accent
    [74, 42, 122],
    [43, 26, 73],     // deep purple — best
];

/*
 * Pale to deep amber. Complementary to the purple, so the two families are
 * unmistakable side by side — and deliberately not green, which reads as
 * "good" and would imply a judgement this ramp is not making. Amber is a
 * magnitude, not a verdict.
 */
const RAMP_RELATIVE = [
    [255, 225, 168],  // pale amber — least
    [252, 202, 116],
    [240, 173, 60],
    [214, 142, 31],
    [176, 111, 18],
    [133, 82, 12],
    [90, 54, 7],      // deep amber — most
];

const RAMPS = { absolute: RAMP_ABSOLUTE, relative: RAMP_RELATIVE };

function lerp(a, b, t) {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

/** Sample a ramp at `t` in [0, 1]. 0 is worst or least, 1 is best or most. */
export function ramp(t, family = "absolute") {
    if (!Number.isFinite(t)) return "transparent";
    const stops = RAMPS[family] ?? RAMP_ABSOLUTE;
    const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const [r, g, b] = lerp(stops[i], stops[i + 1], x - i);
    return `rgb(${r} ${g} ${b})`;
}

/**
 * On a dark ground the deep end of the ramp disappears. Same hues, floor raised.
 */
export function rampFor(t, dark, family = "absolute") {
    if (!Number.isFinite(t)) return "transparent";
    return dark ? ramp(Math.min(1, 0.12 + t * 0.72), family) : ramp(t, family);
}

/** Evenly spaced swatches, for a legend bar. */
export function rampStops(n, dark = true, family = "absolute") {
    return Array.from({ length: n }, (_, i) => rampFor(i / (n - 1), dark, family));
}

/**
 * Build the mapping from a per-point array to colours.
 *
 * @param values     the `local` array
 * @param options.domain  `[lo, hi]` to use the measure's declared range, which
 *                        makes the colours mean the same thing in every plot.
 *                        Omit to fit the scale to the data instead.
 * @param options.lowerIsBetter  flip so that the good end is always the deep end
 * @param options.robust  when fitting to data, clip to the 2nd/98th percentile
 *                        so one outlier cannot flatten everything else
 */
export function scale(values, options = {}) {
    const { domain = null, lowerIsBetter = false, robust = true, dark = true } = options;

    const finite = [];
    for (const v of values) if (Number.isFinite(v)) finite.push(v);
    if (finite.length === 0) {
        return {
            colours: values.map(() => "transparent"),
            lo: 0, hi: 1, excluded: values.length, family: "relative",
        };
    }
    finite.sort((a, b) => a - b);

    /*
     * A declared domain is a claim about the measure and is used as given, so
     * that the same colour means the same score everywhere. Anything else is
     * fitted to this data and is only comparable inside its own plot — which is
     * why the two cases get different hues rather than a footnote.
     */
    const family = domain ? "absolute" : "relative";

    const at = (q) =>
        finite[Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))];
    let lo = domain ? domain[0] : robust ? at(0.02) : finite[0];
    let hi = domain ? domain[1] : robust ? at(0.98) : finite[finite.length - 1];

    // A value outside the declared domain is a bug worth seeing, not clipping.
    if (domain) {
        lo = Math.min(lo, finite[0]);
        hi = Math.max(hi, finite[finite.length - 1]);
    }
    if (hi - lo < 1e-12) hi = lo + 1;

    /*
     * Banded mode: every point in a band gets that band's colour, so the plot
     * answers "how many points are merely fair" at a glance instead of asking
     * the reader to judge shades. The bands are ordered worst to best, so the
     * ramp is sampled by band index and the direction flip is already handled.
     */
    const bands = options.bands ?? null;
    const bandColour = bands
        ? bands.map((_, i) => rampFor(bands.length === 1 ? 1 : i / (bands.length - 1), dark, family))
        : null;

    const bandOf = (v) => {
        for (let i = 0; i < bands.length; ++i) {
            const b = bands[i];
            // Half-open, so a value on a boundary lands in exactly one band.
            if (v >= b.from && (v < b.to || i === bands.length - 1)) return i;
        }
        return v < bands[0].from ? 0 : bands.length - 1;
    };

    const colours = Array.from(values, (v) => {
        if (!Number.isFinite(v)) return "transparent";
        if (bands) {
            const i = bandOf(v);
            return bandColour[lowerIsBetter ? bands.length - 1 - i : i];
        }
        const t = (v - lo) / (hi - lo);
        return rampFor(lowerIsBetter ? 1 - t : t, dark, family);
    });

    let excluded = 0;
    for (const v of values) if (!Number.isFinite(v)) ++excluded;

    /** How many points fell in each band, for the legend. */
    const counts = bands ? bands.map(() => 0) : null;
    if (bands) for (const v of values) if (Number.isFinite(v)) counts[bandOf(v)] += 1;

    return { colours, lo, hi, excluded, family, bandColours: bandColour, counts };
}

/**
 * Categorical colours for class labels. Purple-family plus two contrasting
 * hues, so a five-class plot does not collapse into one smear.
 */
const CATEGORIES = [
    "#9a7bd0", "#ff45c6", "#5ec8c0", "#d1873a", "#6a3fae",
    "#e2576b", "#8fbf5a", "#4a7ad6", "#c58ae0", "#a0a0b8",
];

export function categorical(labels) {
    const seen = [];
    for (const l of labels) if (!seen.includes(l)) seen.push(l);
    seen.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
    const index = new Map(seen.map((l, i) => [l, i]));
    return {
        colours: labels.map((l) => CATEGORIES[index.get(l) % CATEGORIES.length]),
        legend: seen.map((l) => ({ label: l, colour: CATEGORIES[index.get(l) % CATEGORIES.length] })),
    };
}

export { CATEGORIES };
