<script>
    /**
     * The papers behind a family of measures, each linked to its DOI.
     *
     * Generated from the `@see` tags in `src/`, so a citation added to a measure
     * appears here without a second edit, and one that is wrong is wrong in
     * exactly one place.
     *
     * Rendered **without** a `client:` directive: it is a static list, so it
     * ships as plain HTML with no JavaScript, and Pagefind indexes it.
     */
    import { capabilities } from "../lib/measures.js";

    let {
        /** Show the references cited by every measure in this category. */
        category = null,
        /** Or name the measures explicitly, when a page spans categories. */
        names = null,
    } = $props();

    const TITLES = {
        // The identifier is right but it is not how the sentence reads.
        snc: "steadiness & cohesiveness",
    };

    const refs = $derived.by(() => {
        const measures = capabilities.filter((m) =>
            names ? names.includes(m.name) : m.category === category,
        );

        // One entry per work, listing the measures that cite it.
        const byUrl = new Map();
        for (const m of measures) {
            for (const r of m.references) {
                const key = r.url ?? r.citation;
                if (!byUrl.has(key)) byUrl.set(key, { ...r, cited: [] });
                byUrl.get(key).cited.push(TITLES[m.name] ?? m.name);
            }
        }

        // Chronological: a family reads as a line of work, not an alphabet.
        const year = (c) => Number((c.citation.match(/\((\d{4})\)|\b(19|20)\d{2}\b/) ?? [])[1] ?? (c.citation.match(/\b((?:19|20)\d{2})\b/) ?? [])[1] ?? 0);
        return [...byUrl.values()].sort((a, b) => year(a) - year(b) || a.citation.localeCompare(b.citation));
    });
</script>

{#if refs.length}
    <ul class="refs">
        {#each refs as r (r.url ?? r.citation)}
            <li>
                {#if r.url}
                    <a href={r.url} rel="noreferrer">{r.citation}</a>
                {:else}
                    <span>{r.citation}</span>
                {/if}
                <span class="cited">{r.cited.join(", ")}</span>
            </li>
        {/each}
    </ul>
{/if}

<style>
    .refs {
        list-style: none;
        padding: 0;
        margin: 0.6rem 0 0;
        font-size: 0.8rem;
        line-height: 1.5;
    }
    .refs li {
        padding: 0.3rem 0 0.3rem 1.1rem;
        text-indent: -1.1rem;
        margin: 0;
    }
    .refs a {
        color: var(--sl-color-white);
        text-decoration-color: var(--sl-color-accent);
        text-underline-offset: 0.15em;
    }
    .refs a:hover {
        color: var(--sl-color-accent-high);
    }
    /*
     * Which measures rest on the paper. Set apart rather than parenthesised:
     * the citation is the thing being read, and the names are a cross-reference
     * back into the page above.
     */
    .cited {
        display: block;
        text-indent: 0;
        font-size: 0.72rem;
        color: var(--sl-color-gray-3);
        font-family: var(--sl-font-mono, monospace);
    }
</style>
