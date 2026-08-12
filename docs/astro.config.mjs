// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import svelte from "@astrojs/svelte";
import starlightTypeDoc from "starlight-typedoc";
import apiSidebar from "./src/generated/api-sidebar.json" with { type: "json" };
import starlightLlmsTxt from "starlight-llms-txt";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import typedocOptions from "../typedoc.json" with { type: "json" };

/*
 * A GitHub Pages *project* site, so the whole thing lives under /SickleJS/.
 * `base` covers Astro's own routing but not hand-written Markdown links, so
 * cross-references between pages carry the prefix themselves. Both values are
 * also baked into llms.txt as absolute URLs, so they must be right before the
 * first publish.
 */
const site = "https://saehm.github.io";
const base = "/SickleJS";

/*
 * The category names and their order come from the root `typedoc.json`, which
 * is also what `pnpm docs:api` uses. One source, two consumers — a category
 * added to a new measure shows up here without a second edit.
 */
const { categoryOrder, groupOrder, excludeInternal, excludePrivate, categorizeByGroup } =
    typedocOptions;

export default defineConfig({
    site,
    base,
    /*
     * Math via the standard remark/rehype pair: `$…$` inline and `$$…$$`
     * display, rendered to HTML at build time. KaTeX is used rather than
     * MathJax because it renders during the build — nothing ships to the
     * browser except markup and one stylesheet, so the formulas are in the
     * static HTML and searchable by Pagefind.
     *
     * `katex.min.css` is imported through `customCss` below rather than a CDN
     * link: the fonts it references are then resolved and fingerprinted by
     * Vite, and the site keeps working offline and behind a strict CSP.
     */
    markdown: {
        remarkPlugins: [remarkMath],
        rehypePlugins: [[rehypeKatex, { strict: "warn", throwOnError: false }]],
    },
    integrations: [
        starlight({
            title: "sickle",
            description:
                "Quality metrics for dimensionality-reduction projections, verified against published reference implementations.",
            // Two files rather than one inverted with a filter: the mark keeps
            // its purple ramp in both themes and only the wordmark flips, which
            // a filter could not do without damaging the colours.
            logo: {
                light: "./src/assets/light-icon.svg",
                dark: "./src/assets/dark-icon.svg",
                alt: "",
            },
            favicon: "/favicon.svg",
            social: [
                {
                    icon: "github",
                    label: "GitHub",
                    href: "https://github.com/saehm/SickleJS",
                },
            ],
            plugins: [
                starlightTypeDoc({
                    entryPoints: ["../src/index.ts"],
                    tsconfig: "../tsconfig.json",
                    output: "api",
                    sidebar: { label: "API reference", collapsed: true },
                    typeDoc: {
                        categoryOrder,
                        /*
                         * starlight-typedoc builds the sidebar from TypeDoc's
                         * *groups*, never its categories — so without `@group`
                         * tags in the source the API navigation falls back to
                         * grouping by kind (Functions, Interfaces, Type Aliases,
                         * Variables), which says nothing about what a symbol is
                         * for. Every export carries `@group` mirroring its
                         * `@category`; the matrix generator asserts they agree.
                         */
                        groupOrder,
                        excludeInternal,
                        excludePrivate,
                        categorizeByGroup,
                        // ~110 exports in one flat module; a page per member is
                        // far easier to link into than one wall of text.
                        outputFileStrategy: "members",
                        useCodeBlocks: true,
                        expandObjects: true,
                        parametersFormat: "table",
                        propertiesFormat: "table",
                        interfacePropertiesFormat: "table",
                    },
                }),
                starlightLlmsTxt({
                    projectName: "sickle",
                    description:
                        "A JavaScript/TypeScript library of quality metrics for dimensionality-reduction projections. Every measure reports an aggregate and, where one exists, a per-point decomposition.",
                    // The generated API pages restate the TSDoc that is already
                    // in llms-full.txt via the family pages; including them
                    // roughly doubles the file for little gain.
                    exclude: ["api/**"],
                    // Required, not a preference: the plugin renders each page
                    // through an Astro container that has no Svelte renderer,
                    // so any page importing a demo throws. Raw mode skips the
                    // render and emits the MDX source, import lines and all.
                    rawContent: true,
                }),
                /*
                 * Versioning: the dependency is installed and the activation
                 * step is one line, but the plugin is not enabled yet and
                 * cannot be.
                 *
                 * `versions` lists the *archived* versions — the live docs are
                 * always the current release — and the plugin rejects an empty
                 * list. 0.2.0 is the first release, so there is nothing older to
                 * archive; snapshotting it now would create a "0.2" identical to
                 * the live pages and double the page count for nothing.
                 *
                 * When 0.3 is ready, before changing the pages:
                 *   1. `pnpm --filter @saehrimnir/sickle-docs exec astro versions`
                 *      to snapshot the current pages into `src/content/docs/v/0.2/`
                 *   2. uncomment the line below with `{ slug: "0.2" }`
                 *
                 * Order matters — the snapshot must be taken while the pages
                 * still describe 0.2.
                 */
                // starlightVersions({ versions: [{ slug: "0.2" }] }),
            ],
            sidebar: [
                {
                    label: "Start here",
                    items: [
                        { label: "Introduction", link: "/" },
                        { label: "Getting started", slug: "getting-started" },
                        { label: "Choosing a measure", slug: "choosing" },
                        { label: "Reading a score", slug: "interpreting" },
                    ],
                },
                {
                    label: "Families",
                    items: [{ autogenerate: { directory: "families" } }],
                },
                {
                    label: "In depth",
                    items: [
                        { label: "Where measures disagree", slug: "disagreements" },
                        { label: "Verification", slug: "verification" },
                        { label: "Performance", slug: "performance" },
                    ],
                },
                /*
                 * Not `typeDocSidebarGroup`. That placeholder is filled from
                 * TypeDoc's groups, and starlight-typedoc keeps only the ones
                 * backed by a directory on disk — which means grouping by kind
                 * (Functions, Interfaces, …), never by what a symbol is for.
                 * `scripts/api-sidebar.mjs` builds this from the `@category`
                 * tags instead; `pnpm verify` checks every slug resolves.
                 */
                {
                    label: "API reference",
                    collapsed: true,
                    items: apiSidebar,
                },
            ],
            customCss: ["katex/dist/katex.min.css", "./src/styles/custom.css"],
        }),
        svelte(),
    ],
});
