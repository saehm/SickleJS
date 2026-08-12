<script>
    /**
     * One case where two measures contradict each other.
     *
     * This is the most instructive thing the library can show, because it is
     * exactly where a single number would have misled. Each case is lifted from
     * a passing test, so the numbers beside the plots are numbers an assertion
     * holds for.
     */
    import Scatterplot from "./Scatterplot.svelte";
    import { disagreements } from "../lib/data.js";
    import { categorical } from "../lib/colour.js";
    import { meta, directionMark } from "../lib/measures.js";

    let { id } = $props();

    let item = $state(null);
    let error = $state(null);

    $effect(() => {
        disagreements()
            .then((all) => {
                item = all.find((c) => c.id === id) ?? null;
                if (!item) error = `no disagreement case named "${id}"`;
            })
            .catch((e) => (error = e.message));
    });

    /** Counts are integers and must not be dressed up as scores. */
    const COUNTS = { hdLoops: "loops in the data", ldLoops: "loops in the projection" };

    /** Rows that are context rather than a measure, and need saying so. */
    const NOTES = { gceBaseline: "the same layout without the strays" };

    const fmt = (v, name) => {
        if (typeof v !== "number") return String(v);
        if (name in COUNTS) return String(v);
        return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(4);
    };

    /*
     * Class colour where there are labels, one colour otherwise. The same
     * mapping is used for both plots — comparing them is the entire point, and
     * a per-plot scale would make the same class a different colour on each.
     */
    const classes = $derived(item?.labels ? categorical(item.labels) : null);

    const rows = $derived.by(() => {
        if (!item) return [];
        return Object.entries(item.values).map(([name, value]) => ({
            name,
            title: meta(name).title,
            value,
            // Rows showing a count instead of a score carry no direction.
            mark: name in COUNTS || name in NOTES ? null : directionMark(name),
            count: COUNTS[name] ?? NOTES[name] ?? null,
            role: name === item.fooled ? "fooled" : name === item.caught ? "caught" : "",
        }));
    });
</script>

<!--
    The shell is always rendered, even before the data arrives.

    Not cosmetic: `client:visible` hydrates on an IntersectionObserver, and an
    island that server-renders to nothing has zero height, never intersects, and
    so never hydrates — leaving it permanently empty because it was empty. Any
    component here that loads its data after mount must occupy space first.
-->
<div class="sickle-demo" class:pending={!item}>
    {#if error}
        <p class="error">{error}</p>
    {:else if !item}
        <p class="muted">Loading…</p>
    {:else}
        <div class="left">
        <div class="plots">
            {#if item.hdPoints}
                <div>
                    <Scatterplot
                        points={item.hdPoints}
                        colours={classes?.colours ?? null}
                        highlight={item.highlight}
                        title="the data"
                        summary={`The original data for the case "${item.title}", `
                            + "coloured by class. Compare it with the projection beside it; "
                            + "the scores below quantify the difference."}
                    />
                </div>
            {/if}
            <div>
                <Scatterplot
                    points={item.ldPoints}
                    colours={classes?.colours ?? null}
                    highlight={item.highlight}
                    title="the projection"
                    summary={`The projection for the case "${item.title}", coloured by class. `
                        + "The table below gives each measure's score on it."}
                />
            </div>
        </div>

        <div class="legend">
            {#if classes}
                {#each classes.legend as c (c.label)}
                    <span><i style="background: {c.colour}"></i>class {c.label}</span>
                {/each}
            {:else}
                <span><i class="plain"></i>one point</span>
            {/if}
            {#if item.highlight?.length}
                <span><i class="ring"></i>{item.highlight.length} moved points</span>
            {/if}
            {#if !item.hdPoints}
                <span class="aside">
                    The original data has more than two dimensions, so only the projection
                    can be drawn honestly.
                </span>
            {/if}
        </div>
        </div>

        <table>
            <thead>
                <tr><th>measure</th><th>value</th><th></th></tr>
            </thead>
            <tbody>
                {#each rows as r (r.name)}
                    <tr class={r.role}>
                        <td><code>{r.name}</code></td>
                        <td class="num">
                            {fmt(r.value, r.name)}
                            <!--
                                Shown on every row, not only the unlabelled ones.
                                "misses it" used to replace the direction, so on
                                exactly the two rows the case is about, nobody
                                could tell which way was good.
                            -->
                            {#if r.mark}
                                <i class:open={!r.mark.bounded} title={r.mark.title}>{r.mark.glyph}</i>
                            {/if}
                        </td>
                        <td class="role">
                            {#if r.role === "fooled"}
                                {item.fooledLabel ?? "misses it"}
                            {:else if r.role === "caught"}
                                {item.caughtLabel ?? "catches it"}
                            {:else if r.count}
                                {r.count}
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>

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
        padding: 0.8rem;
        margin: 1.2rem 0;
        background: var(--sl-color-gray-7);
        display: grid;
        grid-template-columns: 1fr minmax(15rem, 20rem);
        gap: 1rem;
        align-items: start;
    }
    /* Give the not-yet-hydrated shell real height, so it can intersect. */
    .sickle-demo.pending {
        display: block;
        min-height: 8rem;
    }
    .muted {
        color: var(--sl-color-gray-3);
        font-size: 0.75rem;
    }
    .left {
        min-width: 0;
    }
    .plots {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.6rem;
        min-width: 0;
    }
    .plots > div:only-child {
        grid-column: 1 / -1;
    }
    .legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem 0.9rem;
        padding-top: 0.5rem;
        font-size: 0.68rem;
        color: var(--sl-color-gray-2);
    }
    .legend i {
        display: inline-block;
        width: 0.62rem;
        height: 0.62rem;
        border-radius: 50%;
        margin-right: 0.32rem;
        vertical-align: -1px;
    }
    .legend i.plain {
        background: var(--sl-color-accent);
    }
    /* Matches the ring the plot draws, rather than restating it as a fill. */
    .legend i.ring {
        background: transparent;
        border: 2px solid var(--demo-accent, #ff45c6);
    }
    .legend .aside {
        color: var(--sl-color-gray-3);
        font-style: italic;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.72rem;
    }
    th {
        text-align: left;
        font-weight: 500;
        color: var(--sl-color-gray-3);
        padding-bottom: 0.25rem;
        border-bottom: 1px solid var(--sl-color-gray-5);
    }
    td {
        padding: 0.22rem 0.3rem 0.22rem 0;
        border-bottom: 1px solid var(--sl-color-gray-6);
        color: var(--sl-color-gray-2);
    }
    td.num {
        font-variant-numeric: tabular-nums;
        text-align: right;
        color: var(--sl-color-white);
        white-space: nowrap;
    }
    /*
     * Direction by shape, and comparability by colour — the same purple/amber
     * rule the colour scales use. Purple: a bounded range, so the number means
     * the same thing in any dataset. Amber: unbounded, so it is only meaningful
     * against another projection of the same points.
     */
    td.num i,
    .arrowkey i {
        font-style: normal;
        font-size: 0.8em;
        margin-left: 0.15rem;
        color: var(--sl-color-accent);
    }
    td.num i.open,
    .arrowkey i.open {
        color: var(--demo-relative, #f0ad3c);
    }
    .arrowkey {
        margin: 0.5rem 0 0;
        font-size: 0.64rem;
        line-height: 1.5;
        color: var(--sl-color-gray-4);
    }
    td.role {
        color: var(--sl-color-gray-3);
        font-size: 0.66rem;
    }
    tr.fooled td {
        background: color-mix(in srgb, var(--sl-color-red) 12%, transparent);
    }
    tr.caught td {
        background: color-mix(in srgb, var(--sl-color-accent) 18%, transparent);
    }
    tr.fooled td.role,
    tr.caught td.role {
        color: var(--sl-color-white);
    }
    .error {
        color: var(--sl-color-red);
        font-size: 0.75rem;
    }
    @media (max-width: 800px) {
        .sickle-demo {
            grid-template-columns: 1fr;
        }
    }
</style>
