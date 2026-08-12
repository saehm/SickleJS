/*
 * Builds the capability matrix from the TSDoc in `src/`.
 *
 * With ~33 measures a hand-written table is ~200 cells that go stale silently,
 * and a table that quietly lies about a range is the exact failure this library
 * exists to avoid. TypeDoc already reads these same comments for the API
 * reference, so this is a second *view* of one source, not a second source.
 *
 * The contract with the library is three lines in each measure's TSDoc:
 *
 *     - Needs: high-dimensional data and projection. No labels.
 *     - Range: [0, 1], higher is better. A random projection scores about 0.5.
 *     - Cost: O(1), from an O(N^2 log N) pass.
 *
 * Continuation lines are indented and get folded in. If a cell ever reads badly
 * on the page, add an entry to `matrix-overrides.json` rather than loosening the
 * parser — the parser being strict is what makes a missing line an error.
 *
 * Run with `pnpm --filter @saehrimnir/sickle-docs matrix`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const srcDir = join(root, "src");
const outFile = join(here, "..", "src", "generated", "capabilities.json");
const overridesFile = join(here, "matrix-overrides.json");

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
}

/** Fold `- Key: value` plus its indented continuation lines into one string. */
function field(lines, key) {
    const start = lines.findIndex((l) => l.startsWith(`- ${key}:`));
    if (start < 0) return null;
    const parts = [lines[start].slice(key.length + 3).trim()];
    for (let i = start + 1; i < lines.length; ++i) {
        // A continuation is an indented line; the next `- Key:` ends the field.
        if (/^- \w+:/.test(lines[i]) || lines[i] === "" || lines[i].startsWith("@")) break;
        parts.push(lines[i].trim());
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Split "[0, 1], higher is better. Rest of the note." into its parts.
 *
 * Anchoring on the direction phrase rather than on punctuation is what makes
 * this safe: every domain here contains a comma inside its brackets, so any
 * comma-splitting parser truncates "[0, 1]" to "[0".
 */
function splitRange(text) {
    const dir = text.match(/\*{0,2}(higher|lower) is better\*{0,2}/i);
    if (!dir) {
        // No direction stated — the domain runs to the first sentence end.
        const stop = text.search(/\.\s|\.$/);
        return {
            domain: (stop < 0 ? text : text.slice(0, stop)).trim(),
            direction: null,
            note: stop < 0 ? "" : text.slice(stop + 1).trim(),
        };
    }
    return {
        domain: text.slice(0, dir.index).replace(/[,;]\s*$/, "").trim(),
        direction: dir[1].toLowerCase(),
        note: text.slice(dir.index + dir[0].length).replace(/^[.;,\s—-]+/, "").trim(),
    };
}

/**
 * "high-dimensional data and projection. **Labels required.**" -> flags.
 *
 * The source uses exactly four phrasings, and the parser insists on them: an
 * unrecognised one throws rather than silently reporting "no labels", which
 * would be a table cell that lies.
 */
function splitNeeds(text) {
    const lower = text.toLowerCase();

    let labels;
    if (/\*\*labels required\.?\*\*/.test(lower)) labels = true;
    else if (/no labels\.?/.test(lower)) labels = false;
    else throw new Error(`unrecognised label clause in Needs: ${JSON.stringify(text)}`);

    let highDimensional;
    if (/^high-dimensional data and projection/.test(lower)) highDimensional = true;
    else if (/^projection only/.test(lower)) highDimensional = false;
    else throw new Error(`unrecognised input clause in Needs: ${JSON.stringify(text)}`);

    return {
        text,
        highDimensional,
        labels,
        // A measure that never sees the data can only describe the picture.
        projectionOnly: !highDimensional,
        twoDimensionalOnly: /2-dimensional/.test(lower),
    };
}

/*
 * The doc block immediately above an export.
 *
 * The body pattern is written so that it cannot cross a comment terminator,
 * which is what makes the match start at the block belonging to the
 * declaration. A plain lazy "any character" looks equivalent and is not: it
 * happily spans from the module doc at the top of the file, through every
 * intervening block and its code, down to the export. The Needs/Range/Cost
 * lines are still inside that span, so those fields come out right and only
 * the summary is wrong — exactly the kind of failure that survives review.
 */
/**
 * Every `@see` in a block, as `{ citation, url }`.
 *
 * A citation spans several lines — the DOI usually sits on the one after the
 * author and venue — and ends at the next tag or a blank line. Reading only the
 * `@see` line itself loses the link, which is the part worth having.
 */
function citations(lines) {
    const out = [];
    for (let i = 0; i < lines.length; ++i) {
        if (!lines[i].startsWith("@see")) continue;
        const parts = [lines[i].replace(/^@see\s*/, "")];
        for (let j = i + 1; j < lines.length; ++j) {
            if (lines[j] === "" || /^@\w+/.test(lines[j])) break;
            parts.push(lines[j].trim());
            i = j;
        }
        const text = parts.join(" ").replace(/\s+/g, " ").trim();
        const link = text.match(/\{@link\s+(\S+?)\s*\}/);
        out.push({
            citation: text.replace(/\{@link[^}]*\}/g, "").replace(/\s+/g, " ").trim(),
            url: link ? link[1] : null,
        });
    }
    return out;
}

const blockRe = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*\nexport (?:async )?(?:function|const) (\w+)/g;

const measures = [];
for (const file of walk(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(blockRe)) {
        const [, raw, name] = m;
        const lines = raw
            .split("\n")
            .map((l) => l.replace(/^\s*\*ic?\s?/, "").replace(/^\s*\*\s?/, "").trimEnd());
        if (!lines.some((l) => l.startsWith("- Needs:"))) continue;

        const needs = field(lines, "Needs");
        const range = field(lines, "Range");
        const cost = field(lines, "Cost");
        if (!needs || !range || !cost) {
            throw new Error(`${relative(root, file)}: ${name} has an incomplete Needs/Range/Cost block`);
        }

        const category = (lines.find((l) => l.startsWith("@category")) ?? "").replace("@category", "").trim();
        if (!category) throw new Error(`${relative(root, file)}: ${name} has no @category`);

        /*
         * `@category` drives the in-page index, `@group` drives the API sidebar,
         * and they are separate tags TypeDoc does not reconcile. A symbol with
         * only one of them lands in the right place on one page and in "Other"
         * on the other, which nobody notices until the navigation looks wrong.
         */
        const group = (lines.find((l) => l.startsWith("@group")) ?? "").replace("@group", "").trim();
        if (group !== category) {
            throw new Error(
                `${relative(root, file)}: ${name} has @category "${category}" but ` +
                `@group "${group || "(none)"}" — they must match`,
            );
        }

        // Everything before the first `- Needs:` bullet, first sentence only.
        const summaryLines = [];
        for (const l of lines) {
            if (l.startsWith("- ") || l.startsWith("@")) break;
            summaryLines.push(l);
        }
        const summary = summaryLines.join(" ").replace(/\s+/g, " ").trim();

        const references = citations(lines);

        measures.push({
            name,
            category,
            summary,
            // First sentence, with markdown emphasis stripped: the matrix cell
            // is rendered as text, so `*looks*` would appear with its asterisks.
            headline: (summary.split(/(?<=[.?])\s/)[0] ?? summary)
                .replace(/\*\*(.+?)\*\*/g, "$1")
                .replace(/\*(.+?)\*/g, "$1"),
            needs: splitNeeds(needs),
            range: { text: range, ...splitRange(range) },
            cost,
            // The leading O(...) is what the table shows; the rest is a caveat.
            costOrder: (cost.match(/O\([^)]*\)/) ?? [cost])[0],
            references,
            source: relative(root, file).split("\\").join("/"),
        });
    }
}

if (existsSync(overridesFile)) {
    const overrides = JSON.parse(readFileSync(overridesFile, "utf8"));
    for (const [name, patch] of Object.entries(overrides)) {
        const target = measures.find((x) => x.name === name);
        if (!target) throw new Error(`matrix-overrides.json names ${name}, which no longer exists`);
        Object.assign(target, patch);
    }
}

measures.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(measures, null, 2) + "\n");

/*
 * Every measure must appear in a code example on its family page.
 *
 * The "Using them" blocks were written by hand and quietly fell behind: the
 * neighbourhood page showed three of its eight measures, and nothing anywhere
 * noticed. A measure the docs never demonstrate is, for a reader, a measure the
 * library does not have.
 */
const FAMILY_PAGE = {
    Neighbourhood: "neighbourhood",
    Distance: "distance",
    "Embedding cost": "embedding",
    "Class separability": "separability",
    Structure: "structure",
    Topology: "topology",
    "Cluster reliability": "snc",
    Scagnostics: "scagnostics",
};

const undocumented = [];
for (const m of measures) {
    const page = FAMILY_PAGE[m.category];
    if (!page) throw new Error(`no family page mapped for category "${m.category}"`);
    const text = readFileSync(
        join(here, "..", "src", "content", "docs", "families", `${page}.mdx`),
        "utf8",
    );
    // Only count it if it is inside a fenced block — prose mentions do not
    // tell anyone how to call it.
    let fenced = false;
    let shown = false;
    for (const line of text.split("\n")) {
        if (line.trimStart().startsWith("```")) { fenced = !fenced; continue; }
        if (fenced && line.includes(m.name)) { shown = true; break; }
    }
    if (!shown) undocumented.push(`${m.name} (${m.category} -> ${page}.mdx)`);
}
if (undocumented.length) {
    throw new Error(
        "measures with no code example on their family page:\n  " + undocumented.join("\n  "),
    );
}

const byCategory = {};
for (const m of measures) byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
console.log(`capability matrix: ${measures.length} measures, all shown in an example`);
for (const [c, n] of Object.entries(byCategory)) console.log(`  ${String(n).padStart(3)}  ${c}`);
