<script>
    /**
     * Every measure, with what it needs, what it ranges over and what it costs.
     *
     * Generated from the TSDoc in `src/` by `scripts/capability-matrix.mjs` —
     * never hand-written. With 33 measures a hand-maintained table is ~200
     * cells that go stale silently, and a table that quietly lies about a range
     * is the exact failure this library exists to avoid.
     */
    import { capabilities, directionMark } from "../lib/measures.js";

    let { category = null } = $props();

    let query = $state("");
    let needsLabels = $state("any");
    let usesData = $state("any");

    const rows = $derived.by(() =>
        capabilities.filter((m) => {
            if (category && m.category !== category) return false;
            if (needsLabels === "yes" && !m.needs.labels) return false;
            if (needsLabels === "no" && m.needs.labels) return false;
            if (usesData === "yes" && !m.needs.highDimensional) return false;
            if (usesData === "no" && m.needs.highDimensional) return false;
            if (query) {
                const q = query.toLowerCase();
                if (!m.name.toLowerCase().includes(q) && !m.headline.toLowerCase().includes(q)) {
                    return false;
                }
            }
            return true;
        }),
    );

    /*
     * Categories in the library's own order, so the matrix reads the same way
     * as the sidebar and the API reference.
     */
    const ORDER = [
        "Neighbourhood", "Distance", "Embedding cost", "Class separability",
        "Structure", "Topology", "Cluster reliability", "Scagnostics",
    ];

    const grouped = $derived.by(() => {
        const bucket = new Map();
        for (const m of rows) {
            if (!bucket.has(m.category)) bucket.set(m.category, []);
            bucket.get(m.category).push(m);
        }
        return [...bucket].sort(
            (a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]),
        );
    });

    const reset = () => {
        query = "";
        needsLabels = "any";
        usesData = "any";
    };
</script>

<div class="sickle-demo">
    <div class="controls">
        <label>
            <span>Search</span>
            <input type="search" bind:value={query} placeholder="name or description" />
        </label>
        <label>
            <span>Original data</span>
            <select bind:value={usesData}>
                <option value="any">any</option>
                <option value="yes">uses it</option>
                <option value="no">projection only</option>
            </select>
        </label>
        <label>
            <span>Labels</span>
            <select bind:value={needsLabels}>
                <option value="any">any</option>
                <option value="no">not needed</option>
                <option value="yes">required</option>
            </select>
        </label>
        <span class="count">
            {rows.length} of {capabilities.length}
            {#if rows.length !== capabilities.length}
                <button onclick={reset}>clear</button>
            {/if}
        </span>
    </div>

    <!--
        One table for every category, with the section name as a spanning row.
        A table per category would let each one size its own columns, so the
        `range` column would sit in a different place in every section and the
        eye would have to re-find it eight times. Fixed layout plus a colgroup
        pins them.
    -->
    <div class="scroll">
        <table>
            <colgroup>
                <col class="c-name" />
                <col class="c-what" />
                <col class="c-need" />
                <col class="c-need" />
                <col class="c-range" />
                <col class="c-cost" />
            </colgroup>
            <thead>
                <tr>
                    <th>measure</th>
                    <th>answers</th>
                    <th class="mid" title="Needs the original high-dimensional data">data</th>
                    <th class="mid" title="Needs class labels">labels</th>
                    <th>range</th>
                    <th>cost</th>
                </tr>
            </thead>
            {#each grouped as [cat, items] (cat)}
                <tbody>
                    <tr class="section">
                        <th colspan="6">{cat}</th>
                    </tr>
                    {#each items as m (m.name)}
                        <tr>
                            <td class="name"><code>{m.name}</code></td>
                            <td class="what">{m.headline}</td>
                            <td class="mid">
                                {#if m.needs.highDimensional}
                                    <span class="yes" title="uses the original data">✓</span>
                                {:else}
                                    <span class="no" title="projection only">·</span>
                                {/if}
                            </td>
                            <td class="mid">
                                {#if m.needs.labels}
                                    <span class="yes" title="labels required">✓</span>
                                {:else}
                                    <span class="no" title="no labels needed">·</span>
                                {/if}
                            </td>
                            <td class="range">
                                <span class="domain">{m.range.domain}</span>
                                {#if directionMark(m.name)}
                                    {@const mark = directionMark(m.name)}
                                    <span class="dir">
                                        <i class:open={!mark.bounded} title={mark.title}>{mark.glyph}</i>
                                        better
                                    </span>
                                {/if}
                            </td>
                            <td class="cost"><code>{m.costOrder}</code></td>
                        </tr>
                    {/each}
                </tbody>
            {/each}
        </table>
    </div>

    {#if rows.length === 0}
        <p class="empty">Nothing matches that filter.</p>
    {:else}
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
    }

    .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.6rem 1rem;
        padding-bottom: 0.7rem;
    }
    label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.72rem;
        color: var(--sl-color-gray-3);
    }
    input,
    select {
        font-size: 0.75rem;
        padding: 0.22rem 0.4rem;
        background: var(--sl-color-black);
        color: var(--sl-color-white);
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 4px;
    }
    input {
        min-width: 11rem;
    }
    .count {
        margin-left: auto;
        font-size: 0.7rem;
        color: var(--sl-color-gray-3);
        font-variant-numeric: tabular-nums;
    }
    .count button {
        margin-left: 0.4rem;
        font-size: 0.68rem;
        padding: 0.1rem 0.4rem;
        border-radius: 3px;
        border: 1px solid var(--sl-color-gray-5);
        background: transparent;
        color: var(--sl-color-accent-high);
        cursor: pointer;
    }
    .count button:hover {
        border-color: var(--sl-color-accent);
    }

    /* The table scrolls inside the panel; the page never moves sideways. */
    .scroll {
        overflow-x: auto;
    }
    /*
     * The fixed columns total 26rem, which leaves the `answers` column room to
     * breathe inside Starlight's ~42rem prose measure. Sized any wider and the
     * `cost` column falls off the right edge, where a horizontal scrollbar is
     * the only thing announcing it exists.
     */
    table {
        width: 100%;
        min-width: 34rem;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 0.72rem;
    }
    .c-name {
        width: 9.5rem;
    }
    .c-what {
        width: auto;
    }
    .c-need {
        width: 2.5rem;
    }
    .c-range {
        width: 6.5rem;
    }
    .c-cost {
        width: 5.5rem;
    }

    thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        text-align: left;
        font-weight: 500;
        color: var(--sl-color-gray-3);
        background: var(--sl-color-gray-7);
        padding: 0 0.4rem 0.3rem 0;
        border-bottom: 1px solid var(--sl-color-gray-4);
    }

    tr.section th {
        text-align: left;
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: var(--sl-color-accent-high);
        padding: 0.75rem 0 0.3rem;
        border-bottom: 1px solid var(--sl-color-gray-5);
    }
    tbody:first-of-type tr.section th {
        padding-top: 0.5rem;
    }

    td {
        padding: 0.3rem 0.4rem 0.3rem 0;
        border-bottom: 1px solid var(--sl-color-gray-6);
        color: var(--sl-color-gray-2);
        vertical-align: top;
    }
    tbody tr:hover td {
        background: color-mix(in srgb, var(--sl-color-accent) 8%, transparent);
    }

    .name code {
        /* Long identifiers must wrap rather than widen the column. */
        overflow-wrap: anywhere;
    }
    .what {
        line-height: 1.45;
    }

    .mid {
        text-align: center;
    }
    /*
     * A tick and a dot rather than two pills. The pill treatment gave equal
     * visual weight to "needs labels" and "does not", so a column that is
     * meant to be scanned for the exceptions read as a solid block of chips.
     */
    .yes {
        color: var(--sl-color-accent-high);
        font-weight: 700;
    }
    .no {
        color: var(--sl-color-gray-4);
    }

    .domain {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }
    .dir {
        display: block;
        font-size: 0.64rem;
        color: var(--sl-color-gray-3);
        white-space: nowrap;
    }
    /*
     * Purple: a bounded range, so the number means the same thing in any
     * dataset. Amber: unbounded, so it is only meaningful against another
     * projection of the same points.
     */
    .dir i,
    .arrowkey i {
        font-style: normal;
        color: var(--sl-color-accent);
    }
    .dir i.open,
    .arrowkey i.open {
        color: var(--demo-relative, #f0ad3c);
    }
    .arrowkey {
        margin: 0.6rem 0 0;
        font-size: 0.64rem;
        line-height: 1.5;
        color: var(--sl-color-gray-4);
    }
    .cost code {
        /* Long forms like O(N·D + k²) wrap rather than widen the column. */
        overflow-wrap: anywhere;
    }
    .cost code,
    .name code {
        font-size: 0.9em;
    }

    .empty {
        color: var(--sl-color-gray-3);
        font-size: 0.75rem;
        padding-top: 0.6rem;
        margin: 0;
    }
</style>
