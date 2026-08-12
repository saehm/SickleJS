<script>
    /**
     * A projection, optionally coloured by a per-point value.
     *
     * The scale is isotropic. Fitting x and y independently would fill the
     * canvas more neatly and distort every distance in the plot — which is the
     * one thing a page about distance-preservation measures must not do.
     */
    let {
        points = [],
        colours = null,
        highlight = null,
        radius = null,
        height = null,
        title = "",
        /**
         * One colour for every point, as a CSS value. Set inline so it beats the
         * stylesheet's own `--demo-point`, and resolved through
         * `getComputedStyle`, so `var(--sl-color-accent)` follows the theme.
         */
        tint = null,
        /**
         * Extra sentence for the text alternative — what the plot is *of*, and
         * anything the caller knows that the coordinates do not say (which
         * measure is encoded, how many points are excluded).
         *
         * A canvas is opaque to assistive technology: whatever is not said here
         * is not available at all.
         */
        summary = null,
    } = $props();

    let canvas = $state(null);
    let container = $state(null);
    let width = $state(560);

    /** Unique per instance, so several plots on a page do not collide. */
    const describedBy = `plot-desc-${Math.random().toString(36).slice(2, 9)}`;

    /*
     * The text alternative. Point counts and the spread of the cloud are the
     * parts a sighted reader gets for free; `summary` carries the meaning the
     * coordinates cannot.
     */
    const description = $derived.by(() => {
        const n = points.length;
        if (!n) return "An empty scatterplot.";
        const { x0, y0, x1, y1 } = extent();
        const round = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
        const parts = [
            `Scatterplot of ${n} points${title ? `, ${title}` : ""}.`,
            `Horizontal extent ${round(x0)} to ${round(x1)}, vertical ${round(y0)} to ${round(y1)};`
            + " the scale is the same on both axes, so distances are comparable.",
        ];
        if (highlight?.length) parts.push(`${highlight.length} points are highlighted.`);
        const missing = colours ? colours.filter((c) => c == null).length : 0;
        if (missing) parts.push(`${missing} points have no value and are drawn hollow.`);
        if (summary) parts.push(summary);
        return parts.join(" ");
    });

    const PAD = 12;

    const boxHeight = $derived.by(() => {
        if (height) return height;
        const { x0, y0, x1, y1 } = extent();
        const aspect = (x1 - x0) / (y1 - y0 || 1);
        const fitted = Number.isFinite(aspect) && aspect > 0 ? width / aspect : width * 0.66;
        return Math.round(Math.min(460, Math.max(180, fitted)));
    });

    function extent() {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of points) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
        if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
        // A degenerate axis would divide by zero; give it something to occupy.
        if (x1 - x0 < 1e-9) ((x0 -= 0.5), (x1 += 0.5));
        if (y1 - y0 < 1e-9) ((y0 -= 0.5), (y1 += 0.5));
        return { x0, y0, x1, y1 };
    }

    function css(name, fallback) {
        if (!container) return fallback;
        const v = getComputedStyle(container).getPropertyValue(name).trim();
        return v || fallback;
    }

    function draw() {
        if (!canvas || points.length === 0) return;
        const dpr = window.devicePixelRatio || 1;
        const w = width, h = boxHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const { x0, y0, x1, y1 } = extent();
        const k = Math.min((w - 2 * PAD) / (x1 - x0), (h - 2 * PAD) / (y1 - y0));
        const ox = (w - (x1 - x0) * k) / 2 - x0 * k;
        const oy = (h - (y1 - y0) * k) / 2 + y1 * k;
        const X = (x) => x * k + ox;
        const Y = (y) => -y * k + oy;

        const plain = css("--demo-point", "#9a7bd0");
        const missing = css("--demo-missing", "#6b6b78");
        const hit = css("--demo-highlight", "#ff45c6");
        const r = radius ?? Math.max(1.6, Math.min(4.2, 90 / Math.sqrt(points.length)));

        if (colours) {
            // One path per point: the whole payload of the encoding is that
            // every mark carries its own value, so they cannot be batched.
            for (let i = 0; i < points.length; ++i) {
                const c = colours[i];
                const [px, py] = points[i];
                if (c === "transparent") {
                    // Excluded points are drawn hollow. Colouring them zero
                    // would put them at one end of the scale and claim a score
                    // the measure explicitly does not assign.
                    ctx.strokeStyle = missing;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(X(px), Y(py), r, 0, Math.PI * 2);
                    ctx.stroke();
                    continue;
                }
                ctx.fillStyle = c;
                ctx.beginPath();
                ctx.arc(X(px), Y(py), r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.fillStyle = plain;
            ctx.beginPath();
            for (const [x, y] of points) {
                ctx.moveTo(X(x) + r, Y(y));
                ctx.arc(X(x), Y(y), r, 0, Math.PI * 2);
            }
            ctx.fill();
        }

        if (highlight?.length) {
            ctx.strokeStyle = hit;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (const i of highlight) {
                if (i < 0 || i >= points.length) continue;
                const [px, py] = points[i];
                ctx.moveTo(X(px) + r + 3, Y(py));
                ctx.arc(X(px), Y(py), r + 3, 0, Math.PI * 2);
            }
            ctx.stroke();
        }
    }

    $effect(() => {
        // Touch every input so the effect re-runs when any of them changes.
        void points; void colours; void highlight; void radius; void width; void boxHeight; void tint;
        draw();
    });

    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver((entries) => {
            /*
             * The floor must stay below any width this can actually be given.
             * A floor above the container's width makes the canvas wider than
             * its cell, CSS scales it down on one axis only, and the isotropic
             * transform above becomes anisotropic — circles render as ellipses,
             * which is precisely what this component must never do.
             */
            width = Math.max(80, Math.floor(entries[0].contentRect.width));
        });
        observer.observe(container);
        return () => observer.disconnect();
    });
</script>

<figure class="plot" bind:this={container} style={tint ? `--demo-point: ${tint}` : null}>
    <!--
        `role="img"` plus a description, because the canvas has no accessible
        content of its own. The visible caption is the short label; the
        description carries what a sighted reader gets from the picture.
    -->
    <canvas
        bind:this={canvas}
        role="img"
        aria-label={title || "projection"}
        aria-describedby={describedBy}
    ></canvas>
    {#if title}<figcaption>{title}</figcaption>{/if}
    <p id={describedBy} class="sr-only">{description}</p>
</figure>

<style>
    .plot {
        width: 100%;
        margin: 0;
        --demo-point: var(--sl-color-accent);
        --demo-missing: var(--sl-color-gray-4);
        --demo-highlight: var(--demo-accent, #ff45c6);
    }
    /*
     * Available to assistive technology, invisible on screen. Not
     * `display: none`, which would remove it from the accessibility tree too.
     */
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }
    canvas {
        display: block;
        background: var(--sl-color-black);
        border-radius: 4px;
        /*
         * Deliberately no `max-width: 100%`. The canvas is sized in script to
         * the container it measured, so it already fits; a max-width would only
         * ever fire if that sizing were wrong, and it would "fix" it by
         * squashing one axis — turning a visible layout bug into an invisible
         * distortion of the data.
         */
    }
    figcaption {
        font-size: 0.72rem;
        color: var(--sl-color-gray-3);
        padding-top: 0.35rem;
    }
</style>
