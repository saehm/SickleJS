<script>
    /**
     * Several projection methods over one dataset: the layouts, and the scores.
     *
     * Both come from the same precomputed file. The section this illustrates is
     * about scores that only mean something relative to other projections of
     * the same points, so a hand-written table beside separately generated
     * pictures would be the exact failure being warned about.
     */
    import Scatterplot from "./Scatterplot.svelte";
    import { methods } from "../lib/data.js";
    import { categorical } from "../lib/colour.js";
    import { lowerIsBetter, directionMark } from "../lib/measures.js";

    let {
        dataset = "blobs_pca",
        /*
         * Unbounded first, bounded after, so the amber and purple markers form
         * two blocks and the split the section is about is visible in the
         * header rather than only stated in the prose.
         */
        measures = [
            "calinskiHarabasz", "daviesBouldin", "dunnIndex",
            "silhouette", "trustworthiness", "scaleNormalizedStress",
        ],
        /** Highlight the best and worst cell in each column. */
        rank = true,
        height = 150,
    } = $props();

    let all = $state(null);
    let error = $state(null);

    $effect(() => {
        methods()
            .then((d) => (all = d))
            .catch((e) => (error = String(e)));
    });

    const entry = $derived(all?.find((d) => d.dataset === dataset) ?? null);
    const classes = $derived(entry ? categorical(entry.labels) : null);

    /*
     * Best and worst per column, so the reader can see the ordering without
     * squinting at digits. Direction comes from the library's own TSDoc via
     * `lowerIsBetter`, not from a list maintained here.
     */
    const extremes = $derived.by(() => {
        if (!entry) return {};
        const out = {};
        for (const m of measures) {
            const vals = entry.projections.map((p) => p.scores[m]).filter((v) => Number.isFinite(v));
            if (!vals.length) continue;
            const lo = Math.min(...vals), hi = Math.max(...vals);
            out[m] = lowerIsBetter(m) ? { best: lo, worst: hi } : { best: hi, worst: lo };
        }
        return out;
    });

    const fmt = (v) => {
        if (!Number.isFinite(v)) return "—";
        const a = Math.abs(v);
        if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
        if (a >= 100) return v.toFixed(0);
        if (a >= 10) return v.toFixed(1);
        return v.toFixed(3);
    };
</script>

<div class="sickle-demo" class:pending={!entry}>
    {#if error}
        <p class="muted">could not load: {error}</p>
    {:else if !entry}
        <p class="muted">loading…</p>
    {:else}
        <div class="plots">
            {#each entry.projections as p (p.method)}
                <div>
                    <Scatterplot
                        points={p.points}
                        colours={classes?.colours ?? null}
                        {height}
                        title={p.method}
                        summary={`${entry.dataset} projected by ${p.method}, coloured by class. `
                            + "Its scores are the matching row of the table below."}
                    />
                </div>
            {/each}
        </div>

        <!-- The scroll lives on the wrapper so the table itself can span the box. -->
        <div class="scroll">
            <table>
                <thead>
                    <tr>
                        <th class="lead">projection</th>
                        {#each measures as m (m)}
                            <th>
                                <code>{m}</code>
                                <!-- One shared definition; see `directionMark`. -->
                                {#if directionMark(m)}
                                    {@const mark = directionMark(m)}
                                    <i class:open={!mark.bounded} title={mark.title}>{mark.glyph}</i>
                                {/if}
                            </th>
                        {/each}
                    </tr>
                </thead>
                <tbody>
                    {#each entry.projections as p (p.method)}
                        <tr>
                            <th scope="row" class="lead">{p.method}</th>
                            {#each measures as m (m)}
                                <td
                                    class:best={rank && p.scores[m] === extremes[m]?.best}
                                    class:worst={rank && p.scores[m] === extremes[m]?.worst}
                                >{fmt(p.scores[m])}</td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <p class="foot">
            <span class="swatch best">best</span>
            <span class="swatch worst">worst</span>
            <span class="muted">{entry.n} points, {entry.d}-D, {classes?.legend.length} classes</span>
        </p>
        <p class="arrowkey">
            <i>▲</i> higher is better · <i>▼</i> lower is better ·
            <i class="open">△</i><i class="open">▽</i> hollow: unbounded, so the number
            is comparable only between projections of the same data
        </p>
    {/if}
</div>

<style>
    .sickle-demo {
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 6px;
        padding: 0.7rem;
        margin: 1.2rem 0;
        background: var(--sl-color-gray-7);
    }
    .sickle-demo.pending {
        min-height: 8rem;
    }
    .plots {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.6rem;
        min-width: 0;
    }
    @media (max-width: 48rem) {
        .plots {
            grid-template-columns: repeat(2, 1fr);
        }
    }
    .scroll {
        margin-top: 0.8rem;
        overflow-x: auto;
    }
    table {
        width: 100%;
        margin: 0;
        border-collapse: collapse;
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
    }
    th,
    td {
        padding: 0.25rem 0.5rem;
        text-align: right;
        border-bottom: 1px solid var(--sl-color-gray-5);
        white-space: nowrap;
    }
    thead th {
        color: var(--sl-color-gray-2);
        font-weight: 400;
    }
    .lead {
        /* Absorbs the slack, so the numeric columns stay narrow and the table
           still spans the panel. */
        width: 30%;
        text-align: left;
        color: var(--sl-color-white);
    }
    code {
        font-size: 0.95em;
        background: none;
        padding: 0;
    }
    /*
     * Direction by shape, comparability by colour — the same purple/amber rule
     * the colour scales and the disagreement tables use. Purple: a bounded
     * range, so the number means the same thing in any dataset. Amber:
     * unbounded, so it is only meaningful against another projection of the
     * same points.
     */
    thead th i,
    .arrowkey i {
        font-style: normal;
        font-size: 0.8em;
        margin-left: 0.15rem;
        color: var(--sl-color-accent);
    }
    thead th i.open,
    .arrowkey i.open {
        color: var(--demo-relative, #f0ad3c);
    }
    .arrowkey {
        margin: 0.35rem 0 0;
        font-size: 0.64rem;
        line-height: 1.5;
        color: var(--sl-color-gray-4);
    }
    td.best {
        color: var(--sl-color-white);
        font-weight: 600;
        background: color-mix(in srgb, var(--demo-accent, #ff45c6) 16%, transparent);
    }
    td.worst {
        color: var(--sl-color-gray-3);
        background: color-mix(in srgb, var(--sl-color-gray-4) 16%, transparent);
    }
    .foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem 0.7rem;
        margin: 0.5rem 0 0;
        font-size: 0.68rem;
    }
    .swatch {
        padding: 0.05rem 0.35rem;
        border-radius: 3px;
        font-size: 0.65rem;
    }
    .swatch.best {
        background: color-mix(in srgb, var(--demo-accent, #ff45c6) 16%, transparent);
        color: var(--sl-color-white);
    }
    .swatch.worst {
        background: color-mix(in srgb, var(--sl-color-gray-4) 16%, transparent);
        color: var(--sl-color-gray-3);
    }
    .muted {
        color: var(--sl-color-gray-3);
    }
</style>
