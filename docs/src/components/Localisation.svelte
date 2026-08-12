<script>
    /**
     * Where each measure sends the blame.
     *
     * One layout, one fixed piece of damage, five decompositions of it. The
     * point is comparative: a reader who has been told "a large entry means
     * this point carries more of the error" needs to see that the *same* six
     * points are billed 24x by one measure and below average by another, or
     * the natural conclusion is that a dim point is a healthy one.
     *
     * The numbers come from `precompute.mjs`, so the ratios quoted in the prose
     * and the ones drawn here cannot drift apart.
     */
    import Scatterplot from "./Scatterplot.svelte";
    import ColourLegend from "./ColourLegend.svelte";
    import { localisation } from "../lib/data.js";
    import { scale } from "../lib/colour.js";
    import { meta } from "../lib/measures.js";

    let { id = "strays", measure = "curvilinearStress" } = $props();

    let cases = $state(null);
    let error = $state(null);
    let chosen = $state(measure);

    $effect(() => {
        localisation()
            .then((d) => (cases = d))
            .catch((e) => (error = String(e)));
    });

    const item = $derived(cases?.find((c) => c.id === id) ?? null);
    const entry = $derived(item?.measures.find((m) => m.name === chosen) ?? null);

    /*
     * No declared domain, so this is the fitted (amber) scale — the rule for
     * every `share` and `sum` on this site. Their entries average to 1/N of the
     * total whatever the projection is worth, so the measure's own [0, 1] would
     * paint every point identically.
     */
    const painted = $derived(entry ? scale(entry.local, { domain: null }) : null);

    const fmt = (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
    const pct = (v) => (100 * v).toFixed(0) + "%";

    /** Reads the ratio back as a sentence, since that is the whole lesson. */
    const verdict = $derived.by(() => {
        if (!entry) return "";
        const marked = item.marked.length;
        if (entry.ratio >= 3) {
            return `charges the ${marked} marked points ${fmt(entry.ratio)}x the average point — it localises this damage.`;
        }
        if (entry.ratio >= 1.3) {
            return `charges them ${fmt(entry.ratio)}x the average point — it notices, but weakly.`;
        }
        if (entry.ratio >= 0.85) {
            return `charges them ${fmt(entry.ratio)}x the average point — no more than anyone else.`;
        }
        return `charges them ${fmt(entry.ratio)}x the average point — *less* than average. This measure is not looking for what went wrong here.`;
    });
</script>

<div class="sickle-demo" class:pending={!item}>
    {#if error}
        <p class="muted">could not load: {error}</p>
    {:else if !item}
        <p class="muted">loading…</p>
    {:else}
        <p class="head">{item.title}</p>
        <p class="muted note">{item.note}</p>

        <div class="tabs" role="group" aria-label="measure">
            {#each item.measures as m (m.name)}
                <button class:on={m.name === chosen} onclick={() => (chosen = m.name)}>
                    <code>{m.name}</code>
                </button>
            {/each}
        </div>

        <div class="body">
            <div class="plot">
                <Scatterplot
                    points={item.points}
                    colours={painted?.colours ?? null}
                    highlight={item.marked}
                    title={`coloured by each point's ${meta(chosen).title} contribution`}
                    summary={`The ${item.marked.length} ringed points are the damaged ones. `
                        + `Brighter means a larger share of the total error. This measure ${verdict}`}
                />
            </div>

            <div class="side">
                <ColourLegend
                    title={meta(chosen).title}
                    localKind={entry?.localKind ?? "share"}
                    lo={painted?.lo ?? 0}
                    hi={painted?.hi ?? 1}
                    family={painted?.family ?? "relative"}
                />

                <p class="verdict">
                    <code>{chosen}</code> {verdict}
                </p>

                <table>
                    <thead>
                        <tr><th>measure</th><th>vs average</th><th>of the total</th></tr>
                    </thead>
                    <tbody>
                        {#each item.measures as m (m.name)}
                            <tr class:on={m.name === chosen}>
                                <th scope="row"><code>{m.name}</code></th>
                                <td class:strong={m.ratio >= 3} class:weak={m.ratio < 0.85}>
                                    {fmt(m.ratio)}&times;
                                </td>
                                <td>{pct(m.carried)}</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
                <p class="muted foot">
                    The {item.marked.length} marked points are {pct(item.measures[0].expected)}
                    of the {item.n}. A measure carrying about that much is spreading the blame
                    evenly; well above it is localising.
                </p>
            </div>
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
    .sickle-demo.pending {
        min-height: 10rem;
    }
    .head {
        margin: 0;
        font-size: 0.85rem;
        color: var(--sl-color-white);
    }
    .note {
        margin: 0.2rem 0 0.6rem;
        font-size: 0.72rem;
        line-height: 1.45;
    }
    .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        padding-bottom: 0.7rem;
    }
    button {
        border: 1px solid var(--sl-color-gray-5);
        background: var(--sl-color-black);
        color: var(--sl-color-gray-2);
        border-radius: 4px;
        padding: 0.2rem 0.45rem;
        font: inherit;
        font-size: 0.68rem;
        cursor: pointer;
    }
    button.on {
        border-color: var(--sl-color-accent);
        color: var(--sl-color-white);
        background: color-mix(in srgb, var(--sl-color-accent) 18%, transparent);
    }
    .body {
        display: grid;
        grid-template-columns: 1fr minmax(14rem, 18rem);
        gap: 1rem;
        align-items: start;
    }
    @media (max-width: 46rem) {
        .body {
            grid-template-columns: 1fr;
        }
    }
    .plot,
    .side {
        min-width: 0;
    }
    .verdict {
        margin: 0.5rem 0;
        font-size: 0.72rem;
        line-height: 1.5;
        color: var(--sl-color-gray-2);
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.68rem;
        font-variant-numeric: tabular-nums;
    }
    th,
    td {
        padding: 0.2rem 0.35rem;
        border-bottom: 1px solid var(--sl-color-gray-5);
        text-align: right;
        white-space: nowrap;
    }
    thead th {
        color: var(--sl-color-gray-3);
        font-weight: 400;
    }
    tbody th {
        text-align: left;
        font-weight: 400;
        color: var(--sl-color-gray-2);
    }
    tr.on th,
    tr.on td {
        color: var(--sl-color-white);
        background: color-mix(in srgb, var(--sl-color-accent) 12%, transparent);
    }
    /* Localising and not-localising are the two readings worth spotting. */
    td.strong {
        color: var(--demo-accent, #ff45c6);
    }
    td.weak {
        color: var(--demo-relative, #f0ad3c);
    }
    code {
        font-size: 0.95em;
        background: none;
        padding: 0;
    }
    .muted {
        color: var(--sl-color-gray-3);
    }
    .foot {
        margin: 0.5rem 0 0;
        font-size: 0.64rem;
        line-height: 1.5;
    }
</style>
