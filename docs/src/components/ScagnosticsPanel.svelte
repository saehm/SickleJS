<script>
    /**
     * The nine shape descriptors for a dataset, beside the plot they describe.
     *
     * Deliberately laid out so the scatterplot and the bars are read together:
     * a scagnostic is a claim about what the picture looks like, and it is only
     * checkable by looking at the picture.
     */
    import Scatterplot from "./Scatterplot.svelte";
    import { dataset as loadDataset, datasets as loadIndex } from "../lib/data.js";
    import { ramp, rampStops } from "../lib/colour.js";

    const stops = rampStops(20);

    let { dataset = "blobs_pca", pick = true } = $props();

    const NAMES = [
        "outlying", "skewed", "clumpy", "sparse", "striated",
        "convex", "skinny", "stringy", "monotonic",
    ];

    const BLURBS = {
        outlying: "how much of the data sits away from the rest",
        skewed: "how uneven the edge lengths of the spanning tree are",
        clumpy: "how strongly the points fall into separate lumps",
        sparse: "how spread out the points are relative to the plot",
        striated: "how much the points lie along parallel strands",
        convex: "how close the outline is to its own convex hull",
        skinny: "how thin the outline is — perimeter against area",
        stringy: "how much the shape is a thread rather than a blob",
        monotonic: "how close the relationship is to a monotone curve",
    };

    let index = $state([]);
    let data = $state(null);
    let current = $state(dataset);
    let error = $state(null);

    $effect(() => {
        loadIndex().then((i) => (index = i)).catch((e) => (error = e.message));
    });
    $effect(() => {
        const name = current;
        loadDataset(name)
            .then((d) => { if (current === name) data = d; })
            .catch((e) => (error = e.message));
    });
</script>

<div class="sickle-demo">
    {#if error}
        <p class="error">{error}</p>
    {:else if !data}
        <p class="muted">Loading…</p>
    {:else}
        {#if pick}
            <label>
                Dataset
                <select bind:value={current}>
                    {#each index as d (d.name)}
                        <option value={d.name}>{d.name} (n={d.n})</option>
                    {/each}
                </select>
            </label>
        {/if}
        <div class="body">
            <div class="plot">
                <Scatterplot points={data.points} title="the projection, as drawn" />
            </div>
            <dl class="bars">
                {#each NAMES as name (name)}
                    {@const v = data.scagnostics[name] ?? 0}
                    <dt>{name}</dt>
                    <dd>
                        <span class="track">
                            <span class="fill" style="width: {Math.max(0, Math.min(1, v)) * 100}%; background: {ramp(v)}"></span>
                        </span>
                        <b>{v.toFixed(3)}</b>
                        <em>{BLURBS[name]}</em>
                    </dd>
                {/each}
            </dl>
        </div>

        <div class="legend">
            <span class="key"><i class="plain"></i>one point — no per-point values here</span>
            <span class="key ramp">
                <span class="swatches" aria-hidden="true">
                    {#each stops as c, i (i)}<span style="background: {c}"></span>{/each}
                </span>
                <span class="ends"><span>0</span><span>1</span></span>
            </span>
            <p>
                Bar length and colour both show the descriptor's value. Unlike every other
                measure on this site, <b>neither end is good</b> — a scagnostic describes what
                the plot looks like, not how faithful it is, so the ramp is a magnitude and
                not a verdict.
            </p>
        </div>
    {/if}
</div>

<style>
    .sickle-demo {
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 6px;
        padding: 0.8rem;
        margin: 1.2rem 0;
        background: var(--sl-color-gray-7);
    }
    label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.72rem;
        color: var(--sl-color-gray-3);
        padding-bottom: 0.6rem;
    }
    select {
        font-size: 0.75rem;
        padding: 0.2rem 0.35rem;
        background: var(--sl-color-black);
        color: var(--sl-color-white);
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 4px;
    }
    .body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
        gap: 1rem;
        align-items: start;
    }
    .bars {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.15rem 0.6rem;
        font-size: 0.7rem;
        margin: 0;
        align-items: center;
    }
    .bars dt {
        color: var(--sl-color-gray-2);
        font-variant-numeric: tabular-nums;
    }
    .bars dd {
        margin: 0;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.2rem 0.5rem;
        align-items: center;
    }
    .track {
        display: block;
        height: 0.5rem;
        background: var(--sl-color-gray-6);
        border-radius: 2px;
        overflow: hidden;
    }
    .fill {
        display: block;
        height: 100%;
    }
    .bars b {
        font-variant-numeric: tabular-nums;
        color: var(--sl-color-white);
        font-weight: 500;
    }
    .bars em {
        grid-column: 1 / -1;
        font-style: normal;
        font-size: 0.62rem;
        color: var(--sl-color-gray-3);
        padding-bottom: 0.35rem;
    }
    .legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem 1rem;
        padding-top: 0.7rem;
        font-size: 0.68rem;
        color: var(--sl-color-gray-2);
    }
    .legend .key {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
    }
    .legend i.plain {
        display: inline-block;
        width: 0.62rem;
        height: 0.62rem;
        border-radius: 50%;
        background: var(--sl-color-accent);
    }
    .legend .ramp {
        flex-direction: column;
        align-items: stretch;
        width: 7rem;
        gap: 0.1rem;
    }
    .legend .swatches {
        display: flex;
        height: 0.5rem;
        border-radius: 2px;
        overflow: hidden;
    }
    .legend .swatches span {
        flex: 1;
    }
    .legend .ends {
        display: flex;
        justify-content: space-between;
        font-size: 0.6rem;
        font-variant-numeric: tabular-nums;
        color: var(--sl-color-gray-3);
    }
    .legend p {
        flex: 1 1 16rem;
        margin: 0;
        line-height: 1.55;
        color: var(--sl-color-gray-3);
    }
    .legend b {
        color: var(--sl-color-gray-1);
        font-weight: 600;
    }
    .muted {
        color: var(--sl-color-gray-3);
        font-size: 0.75rem;
    }
    .error {
        color: var(--sl-color-red);
        font-size: 0.75rem;
    }
    @media (max-width: 720px) {
        .body {
            grid-template-columns: 1fr;
        }
    }
</style>
