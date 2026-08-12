/*
 * Builds the API reference sidebar, grouped by category.
 *
 * starlight-typedoc cannot do this. It derives each sidebar group from
 * TypeDoc's *groups* and then keeps only those with a matching directory on
 * disk (`libs/starlight.ts`, `isGroupWithDirectory`) — and typedoc-plugin-markdown
 * writes files per *kind*, so the only groups that survive are Functions,
 * Interfaces, Type Aliases and Variables. Adding `@group` tags makes it worse:
 * the kind groups disappear and the new ones have no directory, so the whole
 * API section comes out empty.
 *
 * So the sidebar is generated here instead, straight from the `@category` tags,
 * and `astro.config.mjs` uses it in place of `typeDocSidebarGroup`.
 *
 * The page slugs are predicted rather than read, because this has to run before
 * TypeDoc does. `scripts/verify-demos.mjs` fetches every one of them after the
 * build, so a wrong prediction fails the run instead of shipping a dead link.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const srcDir = join(root, "src");
const outFile = join(here, "..", "src", "generated", "api-sidebar.json");

const { categoryOrder } = JSON.parse(readFileSync(join(root, "typedoc.json"), "utf8"));

/** Where typedoc-plugin-markdown puts each kind of declaration. */
const KIND_DIR = {
    function: "functions",
    const: "variables",
    interface: "interfaces",
    type: "type-aliases",
    class: "classes",
    enum: "enumerations",
};

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
}

/** Every file under `dir`, whatever its extension. */
function walkAll(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...walkAll(p));
        else out.push(p);
    }
    return out;
}

const blockRe =
    /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*\nexport (?:async )?(function|const|interface|type|class|enum) (\w+)([^\n]*)/g;

/*
 * Only what `src/index.ts` re-exports. A symbol can carry `@category` and still
 * be absent from the reference — `scagnosticsDetail` is tagged but not part of
 * the public surface — and linking to a page TypeDoc never wrote fails the build.
 */
const publicNames = new Set(
    [...readFileSync(join(srcDir, "index.ts"), "utf8").matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)]
        .flatMap((m) => m[1].split(","))
        .map((s) => s.trim().split(/\s+as\s+/).pop().trim())
        .filter(Boolean),
);

const entries = [];
for (const file of walk(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const [, body, keyword, name, rest] of source.matchAll(blockRe)) {
        // `excludeInternal` keeps these out of the generated pages, so linking
        // to them would 404.
        if (/^\s*\*\s*@internal\b/m.test(body)) continue;

        const category = (body.match(/@category\s+(.+)/) ?? [])[1]?.trim();
        if (!category) continue;
        if (!publicNames.has(name)) continue;

        /*
         * TypeDoc classifies by what a declaration *is*, not by its keyword: a
         * `const` bound to an arrow function is a Function, and only a `const`
         * bound to a value is a Variable. Going by the keyword alone sends
         * `continuityCurve` to `variables/` and produces a dead link.
         */
        let keyed = keyword;
        if (keyword === "const") {
            keyed = /^\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?(?:\(|function\b)/.test(rest)
                ? "function"
                : "const";
        }

        const dir = KIND_DIR[keyed];
        if (!dir) throw new Error(`${relative(root, file)}: unhandled kind "${keyed}" for ${name}`);

        entries.push({ name, category, slug: `api/${dir}/${name.toLowerCase()}` });
    }
}

// Same order as the in-page category index, with anything unlisted last.
const rank = (c) => {
    const i = categoryOrder.indexOf(c);
    const star = categoryOrder.indexOf("*");
    return i === -1 ? (star === -1 ? categoryOrder.length : star) : i;
};

const byCategory = new Map();
for (const e of entries) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, []);
    byCategory.get(e.category).push(e);
}

const sidebar = [...byCategory.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([category, items]) => ({
        label: category,
        collapsed: true,
        items: items
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => ({ label: e.name, slug: e.slug })),
    }));

/*
 * When a previous build left the generated pages behind, check the predictions
 * against them. This catches a mis-slugged entry here, with the symbol named,
 * rather than as an opaque "slug does not exist" failure from Astro later.
 */
const apiDir = join(here, "..", "src", "content", "docs", "api");
try {
    const onDisk = new Set(
        walkAll(apiDir)
            .filter((p) => p.endsWith(".md"))
            .map((p) => "api/" + relative(apiDir, p).split("\\").join("/").replace(/\.md$/, "").toLowerCase()),
    );
    const wrong = entries.filter((e) => !onDisk.has(e.slug));
    if (wrong.length) {
        throw new Error(
            "predicted slugs that TypeDoc did not generate:\n" +
            wrong.map((e) => `  ${e.name} -> ${e.slug}`).join("\n"),
        );
    }
} catch (e) {
    if (e.code !== "ENOENT") throw e; // no previous build; nothing to check against
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(sidebar, null, 2) + "\n");

console.log(`api sidebar: ${entries.length} symbols in ${sidebar.length} categories`);
for (const g of sidebar) console.log(`  ${String(g.items.length).padStart(3)}  ${g.label}`);
