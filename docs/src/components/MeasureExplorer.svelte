<script>
    /**
     * Pick a dataset and a measure; see the projection coloured by that
     * measure's per-point values, with the aggregate beside it.
     *
     * Every number here was computed at build time by `scripts/precompute.mjs`
     * from the fixtures in `test/fixtures/data/`, so what the page shows is what
     * the test suite asserts.
     */
    import Scatterplot from "./Scatterplot.svelte";
    import ColourLegend from "./ColourLegend.svelte";
    import { dataset as loadDataset, datasets as loadIndex } from "../lib/data.js";
    import { scale, categorical } from "../lib/colour.js";
    import {
        meta, lowerIsBetter, isBounded, absoluteDomain, bandsOf, LOCAL_KINDS,
    } from "../lib/measures.js";

    let {
        dataset = "blobs_pca",
        measure = "trustworthiness",
        /** Lock the pickers when a page wants to make one specific point. */
        pick = true,
        /** Restrict the measure list to one family. Omit to offer all of them. */
        category = null,
    } = $props();

    let index = $state([]);
    let data = $state(null);
    let error = $state(null);
    let current = $state(dataset);
    let chosen = $state(measure);
    let colourBy = $state("measure");
    let chosenK = $state(null);

    $effect(() => {
        loadIndex().then((i) => (index = i)).catch((e) => (error = e.message));
    });

    $effect(() => {
        const name = current;
        loadDataset(name)
            .then((d) => {
                if (current === name) data = d;
            })
            .catch((e) => (error = e.message));
    });

    /*
     * Bookkeeping the pass emits alongside a measure, not measures themselves.
     */
    const NOT_MEASURES = new Set(["topologicalH1Points", "nervRecall", "nervPrecision"]);

    /*
     * A measure with a parameter is not one number, it is a family of them, and
     * the neighbourhood measures move a long way with k — trustworthiness runs
     * 0.93 to 0.9997 between k = 5 and k = 50 on the same projection. So k is a
     * control, and every other parameter is at least stated rather than left as
     * an unexplained constant.
     */
    const k = $derived(chosenK ?? data?.k ?? null);
    const kTable = $derived(data?.byK?.[k] ?? null);
    const usesK = $derived(new Set(Object.keys(data?.byK?.[data?.ks?.[0]]?.scalars ?? {})));

    /** Everything at the selected k, over the k-independent results. */
    const scalars = $derived({ ...(data?.scalars ?? {}), ...(kTable?.scalars ?? {}) });
    const locals = $derived({ ...(data?.locals ?? {}), ...(kTable?.locals ?? {}) });

    /*
     * Measures whose parameter is the question rather than a tuning knob get a
     * control per parameter, and the precompute holds every combination.
     *
     * NeRV's λ is the clearest case: 0 asks "are the neighbours I see real",
     * 1 asks "did I keep the ones that existed", and pinning it to 0.5 hides
     * what the measure is for.
     */
    const PARAM_LABEL = { lambda: "λ", perplexity: "perplexity", densityK: "densityK" };
    const VARIANT_DEFAULT = {
        nerv: (p) => [p.nervLambda, p.nervPerplexity],
        curvilinearStress: (p) => [p.ccaLambda],
        densityPreservation: (p) => [p.densityK],
    };

    /** Chosen parameter values per measure, until the reader changes them. */
    let variantChoice = $state({});

    const spec = $derived(data?.variants?.[chosen] ?? null);
    const chosenParams = $derived(
        spec
            ? (variantChoice[chosen] ?? VARIANT_DEFAULT[chosen]?.(data.params) ?? spec.params.map((p) => spec.values[p][0]))
            : [],
    );
    const variant = $derived(spec ? (spec.table[chosenParams.join("|")] ?? null) : null);

    function setParam(i, value) {
        const next = [...chosenParams];
        next[i] = value;
        variantChoice = { ...variantChoice, [chosen]: next };
    }

    /* Parameters that are fixed rather than swept: stated, not hidden. */
    const FIXED_FOR = {
        steadiness: (p) => [["iterations", p.sncIterations], ["seed", p.sncSeed]],
        cohesiveness: (p) => [["iterations", p.sncIterations], ["seed", p.sncSeed]],
        topologicalH1: (p) => [["on", `${p.h1Points} pts`]],
    };
    const params = $derived(
        data?.params && FIXED_FOR[chosen] ? FIXED_FOR[chosen](data.params) : [],
    );

    const FAMILY_ORDER = [
        "Neighbourhood", "Distance", "Embedding cost", "Class separability",
        "Structure", "Topology", "Cluster reliability",
    ];

    /** Every measure this dataset carries, bucketed by family and in library order. */
    function group(names) {
        const buckets = new Map();
        for (const name of names) {
            const fam = meta(name).category ?? "Other";
            if (!buckets.has(fam)) buckets.set(fam, []);
            buckets.get(fam).push(name);
        }
        return [...buckets.entries()]
            .sort((a, b) => {
                const ai = FAMILY_ORDER.indexOf(a[0]), bi = FAMILY_ORDER.indexOf(b[0]);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            })
            .map(([label, items]) => ({
                label,
                items: items.sort((x, y) => meta(x).title.localeCompare(meta(y).title)),
            }));
    }

    const present = $derived.by(() => {
        if (!data) return [];
        return Object.keys(scalars).filter((name) => {
            if (NOT_MEASURES.has(name)) return false;
            if (scalars[name] === null || scalars[name] === undefined) return false;
            return !category || (meta(name).category ?? "Other") === category;
        });
    });

    /*
     * The picker offers only what can actually be coloured. Everything else —
     * `aucLogRnx`, `rnx`, `spearmanRho`, the topological pair, steadiness and
     * cohesiveness — is listed underneath with its value instead.
     *
     * Offering them in the dropdown was worse in both directions: they were
     * missing entirely at first, and selecting one afterwards produced a plot
     * that looked like it had failed to colour. A measure with no per-point
     * decomposition has a number and nothing more, so that is what it gets.
     */
    const colourable = $derived(group(present.filter((n) => locals[n]?.local)));
    const scalarOnly = $derived(group(present.filter((n) => !locals[n]?.local)));

    /** Fall back to a measure this page actually offers. */
    $effect(() => {
        const all = colourable.flatMap((f) => f.items);
        if (all.length && !all.includes(chosen)) chosen = all[0];
    });

    const info = $derived(meta(chosen));
    /* The swept result wins over the default one when a sweep exists. */
    const entry = $derived(variant ?? locals[chosen] ?? null);

    /*
     * The measure's declared range, when it has one and the array is a score.
     *
     * Using it rather than the data's own spread is what makes a colour mean the
     * same thing in every plot on the site. Fitting to the data instead made
     * trustworthiness span 0.50-0.99 on one projection and 0.85-1.00 on another,
     * with the same deep purple at both tops.
     */
    const domain = $derived(absoluteDomain(chosen, entry?.localKind));
    const bandSpec = $derived(domain ? bandsOf(chosen, data) : null);

    /** `domain` | `data` | `bands`, falling back to whatever is available. */
    let scaleMode = $state("domain");
    const mode = $derived(
        scaleMode === "bands" && bandSpec ? "bands" : scaleMode === "domain" && domain ? "domain" : "data",
    );

    const painted = $derived.by(() => {
        if (!data) return null;
        if (colourBy === "class") {
            const c = categorical(data.labels);
            return { colours: c.colours, legend: c.legend, kind: "class" };
        }
        if (!entry?.local) return null;
        // A `share` or `sum` is a contribution, not a score: more is not worse,
        // so the direction flip does not apply to it.
        const s = scale(entry.local, {
            domain: mode === "data" ? null : domain,
            bands: mode === "bands" ? bandSpec.bands : null,
            lowerIsBetter: isScore && lowerIsBetter(chosen),
        });
        return { ...s, kind: entry.localKind };
    });

    /*
     * A `share` or `sum` is a contribution, not a score: more of it is not
     * worse, so neither the colour flip nor a worse/better legend applies.
     */
    const isScore = $derived(
        entry?.localKind === "mean" || entry?.localKind === "partial-mean",
    );

    const aggregate = $derived(variant?.value ?? scalars[chosen] ?? entry?.value ?? null);
    /** True when this measure has something to colour by. */
    const hasLocal = $derived(Boolean(entry?.local));
    const showRamp = $derived(colourBy !== "class" && hasLocal);
    const fmt = (v) =>
        v === null || v === undefined
            ? "—"
            : Math.abs(v) >= 1000
              ? v.toFixed(0)
              : v.toFixed(4);
</script>

<!--
    The whole shell renders immediately, before the data arrives.

    Not only to avoid a layout jump: Astro collects the scoped styles of the
    components that actually render during server rendering, so a child behind a
    `{#if data}` gate contributes no CSS to the page at all and arrives in the
    browser unstyled. `ColourLegend` was invisible for exactly that reason. Any
    component here must therefore be in the tree from the first render, with
    empty data rather than absent.
-->
<div class="sickle-demo">
    {#if error}
        <p class="error">Could not load the precomputed results: {error}</p>
    {:else}
        {#if pick}
            <div class="controls">
                <label>
                    Dataset
                    <select bind:value={current}>
                        {#each index as d (d.name)}
                            <option value={d.name}>{d.name} (n={d.n}, D={d.dHigh})</option>
                        {/each}
                    </select>
                </label>
                <label>
                    Measure
                    <select bind:value={chosen}>
                        {#if colourable.length === 1}
                            {#each colourable[0].items as m (m)}
                                <option value={m}>{meta(m).title}</option>
                            {/each}
                        {:else}
                            {#each colourable as f (f.label)}
                                <optgroup label={f.label}>
                                    {#each f.items as m (m)}
                                        <option value={m}>{meta(m).title}</option>
                                    {/each}
                                </optgroup>
                            {/each}
                        {/if}
                    </select>
                </label>
                {#if usesK.has(chosen) && data?.ks?.length}
                    <label>
                        Neighbours <em>k</em>
                        <select bind:value={chosenK}>
                            {#each data.ks as kk (kk)}
                                <option value={kk}>{kk}</option>
                            {/each}
                        </select>
                    </label>
                {/if}
                {#if spec}
                    {#each spec.params as p, i (p)}
                        <label>
                            {PARAM_LABEL[p] ?? p}
                            <select
                                value={chosenParams[i]}
                                onchange={(e) => setParam(i, Number(e.currentTarget.value))}
                            >
                                {#each spec.values[p] as v (v)}
                                    <option value={v}>{v}</option>
                                {/each}
                            </select>
                        </label>
                    {/each}
                {/if}
                <label>
                    Colour by
                    <select bind:value={colourBy}>
                        <option value="measure">the measure</option>
                        <option value="class">class label</option>
                    </select>
                </label>
                {#if colourBy === "measure" && domain}
                    <label>
                        Scale
                        <select bind:value={scaleMode}>
                            <option value="domain">full domain</option>
                            {#if bandSpec}<option value="bands">quality bands</option>{/if}
                            <option value="data">fit to this data</option>
                        </select>
                    </label>
                {/if}
            </div>
        {/if}

        <div class="body">
            <div class="plot">
                <Scatterplot
                    points={data?.points ?? []}
                    colours={painted?.colours ?? null}
                    title={`${dataset}, coloured by ${info.title}`}
                    summary={`Each point is coloured by its own ${info.title} value; `
                        + `the whole projection scores ${fmt(aggregate)}. `
                        + (LOCAL_KINDS[entry?.localKind]?.blurb ?? "")}
                />
            </div>
            <dl class="readout">
                <dt>{info.title}</dt>
                <dd class="value">{fmt(aggregate)}</dd>
                <!--
                    Only the parameters this measure actually takes. A fixed
                    "at k" row was shown against every measure, including the
                    two thirds that have no k at all.
                -->
                {#if usesK.has(chosen)}
                    <dt>at <em>k</em></dt>
                    <dd>{k}</dd>
                {/if}
                {#each params as [label, value] (label)}
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                {/each}
                <!-- NeRV's two halves: what λ is trading off. -->
                {#if variant?.recall !== undefined}
                    <dt>recall</dt>
                    <dd>{fmt(variant.recall)}</dd>
                    <dt>precision</dt>
                    <dd>{fmt(variant.precision)}</dd>
                {/if}
                {#if !usesK.has(chosen) && !spec && params.length === 0}
                    <dt>parameters</dt>
                    <dd class="none">none</dd>
                {/if}
                <dt>points</dt>
                <dd>{data ? `${data.n}, ${data.dHigh}-D` : "—"}</dd>
                <dt>cost</dt>
                <dd><code>{info.cost}</code></dd>
            </dl>
        </div>

        <div class="classes" class:hidden={colourBy !== "class"}>
            {#each painted?.legend ?? [] as c (c.label)}
                <span><i style="background: {c.colour}"></i>class {c.label}</span>
            {/each}
            <span class="note">
                Class colour, not a measure — the thing to compare a per-point encoding
                against.
            </span>
        </div>



        <div class:hidden={!showRamp}>
            <ColourLegend
                title={info.title}
                localKind={entry?.localKind ?? "mean"}
                lo={painted?.lo ?? 0}
                hi={painted?.hi ?? 1}
                lowerIsBetter={isScore && lowerIsBetter(chosen)}
                excluded={painted?.excluded ?? 0}
                domain={info.domain}
                family={painted?.family ?? "relative"}
                bands={mode === "bands" ? bandSpec?.bands : null}
                bandColours={painted?.bandColours ?? null}
                counts={painted?.counts ?? null}
                bandKind={bandSpec?.kind ?? null}
                bandSource={bandSpec?.source ?? null}
            />
        </div>

        <!--
            Measures with no per-point decomposition: ratios of sums, correlations,
            and properties of the whole point cloud. They cannot be drawn on the
            points, so they are reported as values rather than hidden.
        -->
        {#if scalarOnly.length}
            <details class="scalars">
                <summary>
                    No per-point values
                    <span>{scalarOnly.reduce((n, f) => n + f.items.length, 0)} more</span>
                </summary>
                <p>
                    These are ratios of sums, correlations, or properties of the whole point
                    cloud, so there is nothing to colour a point with — the number is the
                    whole result.
                    <span class="dirkey">
                        <b>▲</b> higher is better · <b>▼</b> lower is better ·
                        <b class="open">▲</b><b class="open">▼</b> unbounded, so comparable
                        only between projections of the same data
                    </span>
                </p>
                {#each scalarOnly as f (f.label)}
                    {#if scalarOnly.length > 1}<h4>{f.label}</h4>{/if}
                    <dl>
                        {#each f.items as m (m)}
                            <div class="row" title={meta(m).summary}>
                                <dt>{meta(m).title}</dt>
                                <dd>
                                    {fmt(scalars[m])}
                                    {#if meta(m).direction}
                                        <i
                                            class:open={!isBounded(m)}
                                            title="{meta(m).direction} is better; {isBounded(m)
                                                ? 'bounded range, comparable across datasets'
                                                : 'unbounded, comparable only within a dataset'}"
                                        >{meta(m).direction === "higher" ? "▲" : "▼"}</i>
                                    {/if}
                                </dd>
                            </div>
                        {/each}
                    </dl>
                {/each}
            </details>
        {/if}

        {#if info.summary}
            <p class="summary">{info.summary}</p>
        {/if}
    {/if}
</div>

<style>
    .sickle-demo {
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 6px;
        padding: 0.85rem;
        margin: 1.2rem 0;
        background: var(--sl-color-gray-7);
    }
    .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem 1rem;
        padding-bottom: 0.75rem;
    }
    label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.72rem;
        color: var(--sl-color-gray-3);
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
        display: flex;
        gap: 0.9rem;
        align-items: flex-start;
    }
    .plot {
        flex: 1 1 auto;
        min-width: 0;
    }
    .readout {
        flex: none;
        width: 10rem;
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.1rem;
        font-size: 0.72rem;
    }
    .readout dt {
        color: var(--sl-color-gray-3);
    }
    .readout dd {
        margin: 0 0 0.5rem 0;
        color: var(--sl-color-white);
        font-variant-numeric: tabular-nums;
    }
    .readout dd.value {
        font-size: 1.35rem;
        line-height: 1.2;
        color: var(--sl-color-accent-high);
    }
    /*
     * Hidden, not removed. Both legends stay in the tree so their styles are
     * collected during server rendering; see the note above the markup.
     *
     * Doubled class for specificity: `.classes` below also sets `display`, and
     * a single `.hidden` ties with it and loses on source order.
     */
    .hidden.hidden {
        display: none;
    }
    .classes {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem 0.9rem;
        padding-top: 0.6rem;
        font-size: 0.7rem;
        color: var(--sl-color-gray-2);
    }
    .classes .note {
        color: var(--sl-color-gray-3);
    }
    .scalars {
        margin-top: 0.7rem;
        border-top: 1px solid var(--sl-color-gray-6);
        padding-top: 0.5rem;
        font-size: 0.72rem;
    }
    .scalars summary {
        cursor: pointer;
        color: var(--sl-color-gray-2);
        list-style-position: outside;
    }
    .scalars summary span {
        color: var(--sl-color-gray-4);
        margin-left: 0.4rem;
    }
    .scalars > p {
        margin: 0.4rem 0 0.2rem;
        line-height: 1.55;
        color: var(--sl-color-gray-3);
    }
    .scalars h4 {
        margin: 0.6rem 0 0.15rem;
        font-size: 0.68rem;
        font-weight: 600;
        color: var(--sl-color-accent-high);
    }
    /*
     * Narrow columns on purpose. At 15rem a wide screen gave three columns and
     * each row stretched the name and its value to opposite ends of 20-odd
     * characters of empty space, which is exactly what makes a value hard to
     * attach to its label.
     */
    .scalars dl {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
        gap: 0 1.4rem;
        margin: 0;
    }
    .scalars .row {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        padding: 0.2rem 0;
        border-bottom: 1px dotted var(--sl-color-gray-6);
    }
    .scalars dt {
        color: var(--sl-color-gray-3);
        /* Takes the slack, so every value lines up on the right. */
        flex: 1 1 auto;
        min-width: 0;
    }
    .scalars dd {
        margin: 0;
        flex: none;
        color: var(--sl-color-white);
        font-variant-numeric: tabular-nums;
    }
    .scalars dd i {
        font-style: normal;
        font-size: 0.72em;
        margin-left: 0.1rem;
    }
    /*
     * Shape carries the direction, colour carries comparability — the same
     * purple/amber rule as the colour scales. Not purple/pink: that pair means
     * good/bad here, and would say a lower-is-better measure is a bad one.
     */
    .scalars dd i,
    .dirkey b {
        color: var(--sl-color-accent);
    }
    .scalars dd i.open,
    .dirkey b.open {
        color: var(--demo-relative, #f0ad3c);
    }
    .dirkey {
        display: block;
        padding-top: 0.2rem;
        color: var(--sl-color-gray-4);
        font-size: 0.95em;
    }
    .dirkey b {
        font-size: 0.8em;
        font-weight: 400;
    }
    .classes i {
        display: inline-block;
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 50%;
        margin-right: 0.3rem;
    }
    .summary {
        font-size: 0.72rem;
        line-height: 1.55;
        color: var(--sl-color-gray-3);
        padding-top: 0.55rem;
        margin: 0;
    }
    .error {
        color: var(--sl-color-red);
        font-size: 0.75rem;
    }
    @media (max-width: 620px) {
        .body {
            flex-direction: column;
        }
        .readout {
            width: 100%;
            grid-template-columns: repeat(4, 1fr);
        }
    }
</style>
