<script>
    /**
     * A measure over every neighbourhood size k.
     *
     * The reason this exists rather than a single number: k is a choice, and a
     * projection can win at k=5 and lose at k=100. The curve is free — the pass
     * produces every k at once — so quoting one k without having looked at the
     * curve is a decision made blind.
     */
    import { dataset as loadDataset } from "../lib/data.js";
    import { CATEGORIES } from "../lib/colour.js";
    import { meta } from "../lib/measures.js";

    let {
        datasets = ["blobs_pca", "blobs_random"],
        measures = ["trustworthiness", "continuity"],
        logK = true,
        height = 240,
        /** Zoom in on small k. Defaults to each curve's own validity limit. */
        kLimit = null,
        /*
         * Pin the value axis instead of fitting it to the data. Fitting
         * exaggerates: a curve wandering inside 0.50-0.56 fills the panel and
         * reads like a climb. Pass the measure's own domain to see the
         * movement at its true size.
         */
        yMin = null,
        yMax = null,
    } = $props();

    let loaded = $state([]);
    let container = $state(null);
    let width = $state(560);
    let hoverK = $state(null);

    $effect(() => {
        Promise.all(datasets.map(loadDataset)).then((d) => (loaded = d));
    });

    const PAD = { l: 44, r: 12, t: 10, b: 30 };

    /** One line per (dataset, measure) pair. */
    const lines = $derived.by(() => {
        const out = [];
        loaded.forEach((d, di) => {
            measures.forEach((m, mi) => {
                const c = d.curves?.[m];
                if (!c) return;
                out.push({
                    key: `${d.name}:${m}`,
                    label: `${meta(m).title} — ${d.name}`,
                    colour: CATEGORIES[(di * measures.length + mi) % CATEGORIES.length],
                    kMin: c.kMin,
                    kMax: c.kMax,
                    values: c.values,
                    dash: mi % 2 === 1,
                });
            });
        });
        return out;
    });

    /*
     * Each curve already carries its own `kMax`, the point where that measure's
     * normalisation stops being defined — n/2 for trustworthiness and
     * continuity, n-1 for Q_NX, n-2 for R_NX. Drawing to it is therefore always
     * safe, and `kLimit` only exists to zoom in.
     */
    const kCeiling = $derived(kLimit ?? Infinity);

    const bounds = $derived.by(() => {
        let kMax = 1, lo = Infinity, hi = -Infinity;
        for (const l of lines) {
            kMax = Math.max(kMax, Math.min(l.kMax, kCeiling));
            for (let i = 0; i < l.values.length; ++i) {
                if (l.kMin + i > kCeiling) break;
                const v = l.values[i];
                if (!Number.isFinite(v)) continue;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        if (!Number.isFinite(lo)) return { kMax: 1, lo: yMin ?? 0, hi: yMax ?? 1 };
        /*
         * A pinned axis must never hide a value. If the data leaves the
         * requested window the window widens to admit it -- silently clipping a
         * curve to make a point about where it sits would be the same dishonesty
         * this page warns about elsewhere.
         */
        if (yMin !== null && yMax !== null) {
            return { kMax, lo: Math.min(yMin, lo), hi: Math.max(yMax, hi) };
        }
        if (hi - lo < 1e-9) hi = lo + 1;
        const pad = (hi - lo) * 0.06;
        return {
            kMax,
            lo: yMin !== null ? Math.min(yMin, lo) : lo - pad,
            hi: yMax !== null ? Math.max(yMax, hi) : hi + pad,
        };
    });

    const kx = $derived((k) => {
        const { kMax } = bounds;
        const t = logK
            ? Math.log(k) / Math.log(Math.max(2, kMax))
            : (k - 1) / Math.max(1, kMax - 1);
        return PAD.l + t * (width - PAD.l - PAD.r);
    });

    const vy = $derived((v) => {
        const { lo, hi } = bounds;
        return height - PAD.b - ((v - lo) / (hi - lo)) * (height - PAD.t - PAD.b);
    });

    const path = (l) => {
        let d = "";
        for (let i = 0; i < l.values.length; ++i) {
            const k = l.kMin + i;
            if (k > kCeiling) break;
            const v = l.values[i];
            if (!Number.isFinite(v)) continue;
            const x = kx(k), y = vy(v);
            d += `${d ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        return d;
    };

    const ticksK = $derived.by(() => {
        const { kMax } = bounds;
        const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500];
        return candidates.filter((k) => k <= kMax);
    });

    const ticksV = $derived.by(() => {
        const { lo, hi } = bounds;
        return Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    });

    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

    function onMove(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const inner = width - PAD.l - PAD.r;
        if (x < PAD.l || x > width - PAD.r) return (hoverK = null);
        const t = (x - PAD.l) / inner;
        const { kMax } = bounds;
        const k = logK ? Math.exp(t * Math.log(Math.max(2, kMax))) : 1 + t * (kMax - 1);
        hoverK = Math.max(1, Math.min(kMax, Math.round(k)));
    }

    const readout = $derived.by(() => {
        if (hoverK === null) return [];
        return lines.map((l) => {
            const i = hoverK - l.kMin;
            const v = i >= 0 && i < l.values.length ? l.values[i] : null;
            return { label: l.label, colour: l.colour, value: Number.isFinite(v) ? v : null };
        });
    });

    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver((e) => {
            width = Math.max(280, Math.floor(e[0].contentRect.width));
        });
        observer.observe(container);
        return () => observer.disconnect();
    });
</script>

<div class="sickle-demo" bind:this={container}>
    <svg
        {width}
        {height}
        viewBox="0 0 {width} {height}"
        role="img"
        aria-label="measure against neighbourhood size"
        onmousemove={onMove}
        onmouseleave={() => (hoverK = null)}
    >
        {#each ticksV as v (v)}
            <line x1={PAD.l} x2={width - PAD.r} y1={vy(v)} y2={vy(v)} class="grid" />
            <text x={PAD.l - 6} y={vy(v) + 3} class="tick end">{fmt(v)}</text>
        {/each}
        {#each ticksK as k (k)}
            <text x={kx(k)} y={height - PAD.b + 14} class="tick mid">{k}</text>
        {/each}
        <text x={(width + PAD.l) / 2} y={height - 2} class="axis mid">neighbourhood size k</text>

        {#if hoverK !== null}
            <line x1={kx(hoverK)} x2={kx(hoverK)} y1={PAD.t} y2={height - PAD.b} class="cursor" />
        {/if}

        {#each lines as l (l.key)}
            <path d={path(l)} stroke={l.colour} stroke-dasharray={l.dash ? "4 3" : null} />
        {/each}
    </svg>

    <div class="key">
        {#each lines as l, i (l.key)}
            <span>
                <!--
                    Drawn as a real line rather than a coloured box: the swatch has
                    to carry the dash pattern too, and an inline `background`
                    would blank out any CSS that tried to add it.
                -->
                <svg width="18" height="8" aria-hidden="true">
                    <line
                        x1="0" y1="4" x2="18" y2="4"
                        stroke={l.colour}
                        stroke-width="2"
                        stroke-dasharray={l.dash ? "4 3" : null}
                    />
                </svg>{l.label}
                <!--
                    Always rendered, even when empty: a value that appears only
                    on hover changes the entry's width and reflows the whole
                    legend under the cursor.
                -->
                <b>{readout[i]?.value != null ? fmt(readout[i].value) : ""}</b>
            </span>
        {/each}
        <span class="at" class:idle={hoverK === null}>
            {hoverK !== null ? `k = ${hoverK}` : "hover to read values"}
        </span>
    </div>
</div>

<style>
    .sickle-demo {
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 6px;
        padding: 0.7rem;
        margin: 1.2rem 0;
        background: var(--sl-color-gray-7);
    }
    svg {
        display: block;
        width: 100%;
        height: auto;
        cursor: crosshair;
    }
    path {
        fill: none;
        stroke-width: 1.6;
    }
    .grid {
        stroke: var(--sl-color-gray-5);
        stroke-width: 1;
    }
    .cursor {
        stroke: var(--demo-accent, #ff45c6);
        stroke-width: 1;
        stroke-dasharray: 3 3;
    }
    .tick,
    .axis {
        fill: var(--sl-color-gray-3);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
    }
    .end {
        text-anchor: end;
    }
    .mid {
        text-anchor: middle;
    }
    .key {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem 0.9rem;
        padding-top: 0.5rem;
        font-size: 0.7rem;
        color: var(--sl-color-gray-2);
    }
    /* Each entry is one unbreakable unit: swatch, label and value together. */
    .key > span {
        display: inline-flex;
        align-items: center;
        white-space: nowrap;
    }
    .key svg {
        margin-right: 0.35rem;
        vertical-align: middle;
        overflow: visible;
    }
    .key b {
        font-variant-numeric: tabular-nums;
        color: var(--sl-color-white);
        margin-left: 0.3rem;
        /* Reserve the widest reading the formatter produces, so the row is
           the same width hovered and idle. */
        display: inline-block;
        min-width: 4.2ch;
        text-align: right;
    }
    /* Wide enough for the idle hint, so switching to "k = 20" cannot reflow. */
    .at {
        color: var(--demo-accent, #ff45c6);
        font-variant-numeric: tabular-nums;
        display: inline-block;
        min-width: 19ch;
    }
    .at.idle {
        color: var(--sl-color-gray-4);
        font-style: italic;
    }
</style>
