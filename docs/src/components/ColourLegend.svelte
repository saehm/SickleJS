<script>
    /**
     * States what the colour means. Without this the encoding is decoration —
     * a reader can see that two points differ but not what the difference is,
     * and cannot tell a `share` from a score.
     *
     * Four things must appear here, because getting any of them wrong inverts
     * the reading: the kind of per-point value, which end is good, what range
     * the scale spans, and whether that range is the measure's own or this
     * data's. The last is carried by hue as well — purple/pink is an absolute
     * scale, amber is fitted to the data — so two plots can be compared, or
     * not, at a glance.
     */
    import { rampStops } from "../lib/colour.js";
    import { LOCAL_KINDS } from "../lib/measures.js";

    let {
        title = "",
        localKind = "mean",
        lo = 0,
        hi = 1,
        lowerIsBetter = false,
        excluded = 0,
        domain = "",
        family = "absolute",
        bands = null,
        bandColours = null,
        counts = null,
        bandKind = null,
        bandSource = null,
    } = $props();

    const stops = $derived(rampStops(24, true, family));
    const kind = $derived(LOCAL_KINDS[localKind] ?? LOCAL_KINDS.mean);
    const fmt = (v) =>
        Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(3);

    /*
     * A `share` or `sum` is each point's contribution to the total, so the ramp
     * is a magnitude and neither end is "better". Labelling it worse/better
     * would tell the reader that the points contributing most to the stress are
     * the bad ones, which is the exact misreading `localKind` exists to prevent.
     */
    const isContribution = $derived(localKind === "share" || localKind === "sum");

    /** Bands run worst to best; reverse the swatch order when lower is better. */
    const ordered = $derived(
        bands ? bands.map((b, i) => ({ ...b, colour: bandColours?.[i], count: counts?.[i] ?? 0 })) : [],
    );
</script>

<div class="legend">
    {#if bands}
        <div class="bands">
            {#each ordered as b (b.label)}
                <span class="band">
                    <i style="background: {b.colour}"></i>
                    <b>{b.label}</b>
                    <em>{fmt(b.from)}–{fmt(b.to)}</em>
                    <u>{b.count}</u>
                </span>
            {/each}
        </div>
    {:else}
        <div class="ramp">
            <div class="swatches" aria-hidden="true">
                {#each stops as c, i (i)}<span style="background: {c}"></span>{/each}
            </div>
            <div class="ends">
                <span>{lowerIsBetter ? fmt(hi) : fmt(lo)}</span>
                <span>{lowerIsBetter ? fmt(lo) : fmt(hi)}</span>
            </div>
            <div class="ends muted">
                {#if isContribution}
                    <span>small</span><span>large</span>
                {:else}
                    <span>worse</span><span>better</span>
                {/if}
            </div>
        </div>
    {/if}

    <div class="text">
        <p><b>{title}</b> — {kind.label}. {kind.blurb}</p>

        {#if bands}
            <p class="muted">
                {#if bandKind === "chance"}
                    Split at the <b>chance level</b> — the only threshold here that is a
                    fact about the measure rather than an opinion about it. A point at or
                    below it has told you nothing.
                {:else}
                    Bands follow <b>{bandSource}</b>.
                {/if}
                The number after each range is how many points fall in it.
            </p>
        {:else if family === "absolute"}
            <p class="muted">
                The scale spans the measure's full domain {domain}, so a colour means the
                same thing here as in any other plot on this site.
                {#if !isContribution}
                    {lowerIsBetter ? "Lower" : "Higher"} is better.
                {/if}
            </p>
        {:else}
            <p class="muted">
                <b>Fitted to this projection</b>, from {fmt(lo)} to {fmt(hi)} — amber rather
                than purple for that reason. Colours are comparable inside this plot and
                nowhere else.
                {#if isContribution}
                    The measure itself has domain {domain}; these are contributions to it, so
                    neither end is good or bad.
                {:else if domain}
                    Domain {domain}, {lowerIsBetter ? "lower" : "higher"} is better.
                {/if}
            </p>
        {/if}

        {#if excluded > 0}
            <p class="muted">
                {excluded} point{excluded === 1 ? "" : "s"} drawn hollow: this measure
                excludes them rather than scoring them.
            </p>
        {/if}
    </div>
</div>

<style>
    .legend {
        display: flex;
        align-items: flex-start;
        gap: 0.8rem;
        padding-top: 0.55rem;
    }
    .ramp {
        flex: none;
        width: 9rem;
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
    }
    .swatches {
        display: flex;
        height: 0.6rem;
        border-radius: 2px;
        overflow: hidden;
    }
    .swatches span {
        flex: 1;
    }
    .ends {
        display: flex;
        justify-content: space-between;
        font-size: 0.62rem;
        font-variant-numeric: tabular-nums;
        color: var(--sl-color-gray-2);
    }

    .bands {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
        font-size: 0.66rem;
    }
    .band {
        display: grid;
        grid-template-columns: 0.7rem 6.4rem auto 2rem;
        align-items: center;
        gap: 0.4rem;
        color: var(--sl-color-gray-2);
    }
    /*
     * One line-height for the whole row. The label inherits a different one from
     * Starlight, which centred it 8px below its own swatch.
     */
    .band > * {
        line-height: 1.35;
    }
    .band i {
        width: 0.7rem;
        height: 0.7rem;
        border-radius: 2px;
    }
    .band b {
        font-weight: 500;
        color: var(--sl-color-white);
    }
    .band em {
        font-style: normal;
        color: var(--sl-color-gray-3);
        font-variant-numeric: tabular-nums;
    }
    .band u {
        text-decoration: none;
        text-align: right;
        color: var(--sl-color-gray-3);
        font-variant-numeric: tabular-nums;
    }

    .text {
        min-width: 0;
    }
    p {
        margin: 0;
        font-size: 0.72rem;
        line-height: 1.55;
        color: var(--sl-color-gray-2);
    }
    b {
        color: var(--sl-color-white);
        font-weight: 600;
    }
    .muted,
    p.muted {
        color: var(--sl-color-gray-3);
    }
    .muted b {
        color: var(--sl-color-gray-1);
    }
    @media (max-width: 620px) {
        .legend {
            flex-direction: column;
            gap: 0.5rem;
        }
    }
</style>
