<script>
    /**
     * Both persistence degrees, side by side, for the data and the projection.
     *
     * Each mark or bar is one topological feature: born when it appears as the
     * scale grows, dead when it fills in. How long it lasted is what separates
     * real structure from noise.
     *
     * The two degrees get different pictures, and that is a property of the
     * degrees rather than a styling choice:
     *
     *   H0 — every feature is born at 0, since a point is its own component from
     *        the start. A birth/death diagram would stack the whole population on
     *        a single vertical line and the diagonal would carry no information.
     *        It is a one-dimensional quantity, so it gets a barcode.
     *   H1 — births genuinely differ, so distance from the diagonal is the whole
     *        point, and it gets a diagram.
     *
     * Both spaces are normalised by their own diameter, as `topologicalH0` and
     * `topologicalH1` do before comparing them; without that the two clouds sit
     * at unrelated scales. The `raw` rows in the read-out are not.
     */
    import Scatterplot from "./Scatterplot.svelte";

    let { showPoints = true } = $props();

    let item = $state(null);
    let error = $state(null);
    let container = $state(null);
    let width = $state(680);

    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

    $effect(() => {
        fetch(`${BASE}/data/persistence.json`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
            .then((d) => (item = d))
            .catch((e) => (error = e.message));
    });

    const h0 = $derived({ hd: item?.hd.h0 ?? [], ld: item?.ld.h0 ?? [] });
    const h1 = $derived({ hd: item?.hd.h1 ?? [], ld: item?.ld.h1 ?? [] });

    /* Side by side under ~640px would give each panel less than 300px. */
    const stacked = $derived(width < 640);
    const panel = $derived(stacked ? width : Math.floor((width - 18) / 2));

    // `b` holds a row of tick labels *and* the axis title beneath them.
    const PAD = { l: 46, r: 10, t: 14, b: 44 };
    const plotW = $derived(Math.max(150, panel - PAD.l - PAD.r));

    /*
     * One height for both panels, so the captions and read-outs beneath them
     * start on the same line. The diagram sets it — it must be square, since
     * both its axes are the same quantity — and the barcode fills the same box
     * by sizing its rows to fit.
     */
    const size = $derived(plotW);
    const panelHeight = $derived(size + PAD.t + PAD.b);

    /** Each degree keeps its own scale: they measure different things. */
    function extent(d) {
        const all = [...d.hd, ...d.ld].flat();
        const m = all.length ? Math.max(...all) : 1;
        return m > 0 ? m * 1.1 : 1;
    }

    /** Three to five round ticks, whatever the magnitude. */
    function ticksFor(max) {
        const steps = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
        const step = steps.find((s) => max / s <= 5) ?? 1;
        const out = [];
        for (let v = 0; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(4)));
        return out;
    }

    const fmt = (v) => (v >= 1 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(2) : v.toFixed(3));
    const most = (dg) =>
        dg.length ? dg.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a)) : null;

    // --- H0 barcode ---------------------------------------------------------

    const GROUP_GAP = 20;
    const max0 = $derived(extent(h0));
    const ticks0 = $derived(ticksFor(max0));
    const x0 = $derived((v) => PAD.l + (v / max0) * plotW);
    /** Row pitch chosen so both groups of bars fill the shared panel height. */
    const ROW = $derived(
        Math.max(2, (size - GROUP_GAP) / Math.max(1, h0.hd.length + h0.ld.length)),
    );
    const hdTop = $derived(PAD.t);
    const ldTop = $derived(hdTop + h0.hd.length * ROW + GROUP_GAP);
    /** Sorted by length, so the shape of the distribution is readable. */
    const sorted = (dg) => [...dg].sort((p, q) => p[1] - p[0] - (q[1] - q[0]));

    // --- H1 diagram ---------------------------------------------------------

    const max1 = $derived(extent(h1));
    const ticks1 = $derived(ticksFor(max1));
    const x1 = $derived((v) => PAD.l + (v / max1) * size);
    const y1 = $derived((v) => PAD.t + size - (v / max1) * size);

    $effect(() => {
        if (!container) return;
        const o = new ResizeObserver((e) => {
            width = Math.max(280, Math.floor(e[0].contentRect.width));
        });
        o.observe(container);
        return () => o.disconnect();
    });
</script>

<div class="sickle-demo" bind:this={container}>
    {#if error}
        <p class="error">Could not load the diagrams: {error}</p>
    {:else}
        <div class="grid" class:stacked>
            <!-- H0 ------------------------------------------------------- -->
            <section>
                <h4>H<sub>0</sub> — connected pieces <span>{h0.hd.length} vs {h0.ld.length}</span></h4>

                <svg width={panel} height={panelHeight} role="img" aria-label="H0 barcode">
                    {#each ticks0 as t (t)}
                        <line x1={x0(t)} x2={x0(t)} y1={PAD.t} y2={PAD.t + size} class="grid-line" />
                        <text x={x0(t)} y={PAD.t + size + 15} class="tick mid">{fmt(t)}</text>
                    {/each}

                    {#each sorted(h0.hd) as [b, d], i (i)}
                        <line
                            x1={x0(b)} x2={x0(d)}
                            y1={hdTop + i * ROW + ROW / 2} y2={hdTop + i * ROW + ROW / 2}
                            class="bar hd"
                        ><title>merges at {fmt(d)}</title></line>
                    {/each}
                    {#each sorted(h0.ld) as [b, d], i (i)}
                        <line
                            x1={x0(b)} x2={x0(d)}
                            y1={ldTop + i * ROW + ROW / 2} y2={ldTop + i * ROW + ROW / 2}
                            class="bar ld"
                        ><title>merges at {fmt(d)}</title></line>
                    {/each}

                    <text x={PAD.l + size / 2} y={panelHeight - 5} class="axis mid">
                        merge scale
                    </text>
                </svg>

                <p>
                    One bar per component, sorted by length. Every H<sub>0</sub> feature is
                    born at 0, so a bar's length <em>is</em> the scale at which that piece
                    merges — exactly the edge lengths of the minimum spanning tree.
                </p>
                {#if most(h0.hd) && most(h0.ld)}
                    <p>
                        The circle's pieces hold out to <b>{fmt(most(h0.hd)[1])}</b>, the arc's
                        are all absorbed by <b>{fmt(most(h0.ld)[1])}</b>.
                    </p>
                {/if}
                {#if item}
                    <dl>
                        <div><dt>topologicalH0</dt><dd>{fmt(item.values.topologicalH0)}</dd></div>
                        <div><dt>bottleneckH0 <em>raw</em></dt><dd>{fmt(item.values.bottleneckH0)}</dd></div>
                        <div><dt>wassersteinH0 <em>raw</em></dt><dd>{fmt(item.values.wassersteinH0)}</dd></div>
                    </dl>
                {/if}
            </section>

            <!-- H1 ------------------------------------------------------- -->
            <section>
                <h4>H<sub>1</sub> — loops <span>{h1.hd.length} vs {h1.ld.length}</span></h4>

                <svg width={panel} height={panelHeight} role="img" aria-label="H1 persistence diagram">
                    {#each ticks1 as t (t)}
                        <line x1={x1(t)} x2={x1(t)} y1={PAD.t} y2={PAD.t + size} class="grid-line" />
                        <line x1={PAD.l} x2={PAD.l + size} y1={y1(t)} y2={y1(t)} class="grid-line" />
                        <text x={x1(t)} y={PAD.t + size + 15} class="tick mid">{fmt(t)}</text>
                        <text x={PAD.l - 6} y={y1(t) + 3} class="tick end">{fmt(t)}</text>
                    {/each}

                    <!-- Everything lies above y = x; the closer to it, the shorter-lived. -->
                    <line x1={x1(0)} y1={y1(0)} x2={x1(max1)} y2={y1(max1)} class="diagonal" />

                    {#each h1.ld as [b, d], i (i)}
                        <circle cx={x1(b)} cy={y1(d)} r="5" class="ld-mark">
                            <title>projection: born {fmt(b)}, dies {fmt(d)}</title>
                        </circle>
                    {/each}
                    {#each h1.hd as [b, d], i (i)}
                        <circle cx={x1(b)} cy={y1(d)} r="4" class="hd-mark">
                            <title>data: born {fmt(b)}, dies {fmt(d)}</title>
                        </circle>
                    {/each}

                    <text x={PAD.l + size / 2} y={panelHeight - 5} class="axis mid">birth</text>
                    <text
                        x={11} y={PAD.t + size / 2} class="axis mid"
                        transform="rotate(-90 11 {PAD.t + size / 2})">death</text
                    >
                </svg>

                <p>
                    Birth against death, so distance from the dashed diagonal is how long a
                    loop survived. Far above it is real structure; hugging it is noise.
                </p>
                {#if most(h1.hd)}
                    <p>
                        The circle's loop lives from {fmt(most(h1.hd)[0])} to
                        {fmt(most(h1.hd)[1])} — a persistence of
                        <b>{fmt(most(h1.hd)[1] - most(h1.hd)[0])}</b>.
                        {#if h1.ld.length === 0}
                            The arc has <b>no loops at all</b>.
                        {/if}
                    </p>
                {/if}
                {#if item}
                    <dl>
                        <div><dt>topologicalH1</dt><dd>{fmt(item.values.topologicalH1)}</dd></div>
                    </dl>
                {/if}
            </section>
        </div>

        <!--
            The plots carry the same two colours as the bars and marks above, so
            the legend can be read once, at the end, and applies to everything in
            the panel.
        -->
        {#if showPoints && item}
            <div class="plots">
                <Scatterplot
                    points={item.hdPoints}
                    height={150}
                    tint="var(--sl-color-accent)"
                    title={item.hdLabel}
                />
                <Scatterplot
                    points={item.ldPoints}
                    height={150}
                    tint="var(--demo-accent, #ff45c6)"
                    title={item.ldLabel}
                />
            </div>
        {/if}

        <div class="key">
            <span><i class="hd"></i>{item?.hdLabel ?? "the data"}</span>
            <span><i class="ld"></i>{item?.ldLabel ?? "the projection"}</span>
            <span class="aside">the same two colours throughout</span>
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

    .key {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem 1.2rem;
        margin-top: 0.7rem;
        padding-top: 0.6rem;
        border-top: 1px solid var(--sl-color-gray-6);
        font-size: 0.72rem;
        color: var(--sl-color-gray-2);
    }
    .key .aside {
        margin-left: auto;
        color: var(--sl-color-gray-4);
        font-style: italic;
    }
    .key i {
        display: inline-block;
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 50%;
        margin-right: 0.4rem;
    }
    .key i.hd {
        background: var(--sl-color-accent);
    }
    .key i.ld {
        background: var(--demo-accent, #ff45c6);
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.1rem;
        /* Stretch, not start: the columns must share a baseline at the bottom. */
        align-items: stretch;
    }
    .grid.stacked {
        grid-template-columns: 1fr;
    }
    /*
     * The two captions are different lengths, so the read-out tables would
     * otherwise sit at different heights and the columns would read as
     * misaligned even though the plots line up.
     */
    .grid section {
        display: flex;
        flex-direction: column;
    }
    .grid section dl {
        margin-top: auto;
    }

    h4 {
        margin: 0 0 0.3rem;
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--sl-color-accent-high);
    }
    h4 span {
        float: right;
        font-weight: 400;
        color: var(--sl-color-gray-3);
        font-variant-numeric: tabular-nums;
    }

    svg {
        display: block;
        background: var(--sl-color-black);
        border-radius: 4px;
    }
    .grid-line {
        stroke: var(--sl-color-gray-6);
        stroke-width: 1;
    }
    .diagonal {
        stroke: var(--sl-color-gray-4);
        stroke-width: 1;
        stroke-dasharray: 4 3;
    }
    .tick,
    .axis {
        fill: var(--sl-color-gray-3);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
    }
    .mid {
        text-anchor: middle;
    }
    .end {
        text-anchor: end;
    }
    .bar {
        stroke-width: 2;
        stroke-linecap: round;
    }
    .bar.hd {
        stroke: var(--sl-color-accent);
    }
    .bar.ld {
        stroke: var(--demo-accent, #ff45c6);
    }
    .hd-mark {
        fill: var(--sl-color-accent);
    }
    .ld-mark {
        fill: none;
        stroke: var(--demo-accent, #ff45c6);
        stroke-width: 1.6;
    }

    section p {
        margin: 0.45rem 0 0;
        font-size: 0.7rem;
        line-height: 1.5;
        color: var(--sl-color-gray-3);
    }
    section p b {
        color: var(--sl-color-white);
    }
    section p em {
        color: var(--sl-color-gray-2);
    }
    section dl {
        border-top: 1px dotted var(--sl-color-gray-6);
        padding-top: 0.3rem;
        margin-bottom: 0;
        font-size: 0.7rem;
    }
    section dl div {
        display: flex;
        justify-content: space-between;
        gap: 0.6rem;
        padding: 0.1rem 0;
    }
    section dt {
        font-family: var(--sl-font-mono, monospace);
        font-size: 0.66rem;
        color: var(--sl-color-gray-3);
    }
    section dt em {
        font-family: inherit;
        font-style: normal;
        color: var(--sl-color-gray-4);
    }
    section dd {
        margin: 0;
        color: var(--sl-color-white);
        font-variant-numeric: tabular-nums;
    }

    .plots {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.6rem;
        padding-top: 0.9rem;
    }
    .error {
        color: var(--sl-color-red);
        font-size: 0.75rem;
    }
    @media (max-width: 560px) {
        .plots {
            grid-template-columns: 1fr;
        }
    }
</style>
