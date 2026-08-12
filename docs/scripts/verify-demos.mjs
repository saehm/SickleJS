/*
 * Loads every page in a real browser and fails on anything the build cannot see.
 *
 * `astro build` type-checks and renders, but the demos are islands: a component
 * that throws on hydration, a fetch to a path the base broke, or a canvas that
 * draws nothing all produce a *successful* build and a blank box on the page.
 * The build is not evidence that the site works.
 *
 * Assumes `astro preview` is already serving. Run with `pnpm verify`.
 */
import { chromium } from "playwright";

const BASE = process.env.SICKLE_DOCS_URL ?? "http://localhost:4321/SickleJS";

const PAGES = [
    "/",
    "/getting-started/",
    "/choosing/",
    "/interpreting/",
    "/families/neighbourhood/",
    "/families/distance/",
    "/families/embedding/",
    "/families/separability/",
    "/families/structure/",
    "/families/topology/",
    "/families/snc/",
    "/families/scagnostics/",
    "/disagreements/",
    "/verification/",
    "/performance/",
    "/api/functions/trustworthiness/",
];

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) ++failures;
    console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();

for (const path of PAGES) {
    const problems = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.removeAllListeners("requestfailed");
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
    page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));

    const response = await page.goto(BASE + path, { waitUntil: "networkidle" });
    check(`${path} responds`, response?.ok() === true, String(response?.status()));

    /*
     * Every demo is `client:visible`, so one below the fold has not hydrated
     * yet and its server-rendered "Loading…" is correct rather than broken.
     * Scroll the whole page first: without this the checks below pass
     * vacuously on exactly the components most likely to be wrong.
     */
    await page.evaluate(async () => {
        const step = window.innerHeight * 0.8;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
    });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    check(`${path} console clean`, problems.length === 0, problems.slice(0, 2).join(" | "));

    /*
     * The real test: a canvas that was never drawn to is not an error anywhere
     * in the stack. Reading a pixel back is the only way to tell the difference
     * between "the component rendered" and "the component mounted and gave up".
     */
    const canvases = await page.locator("canvas").count();
    if (canvases > 0) {
        const painted = await page.evaluate(() =>
            [...document.querySelectorAll("canvas")].map((c) => {
                if (!c.width || !c.height) return false;
                const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
                for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
                return false;
            }),
        );
        check(
            `${path} ${canvases} canvas drawn`,
            painted.every(Boolean),
            `${painted.filter(Boolean).length}/${painted.length} have pixels`,
        );
    }

    // Every demo shell must have put something in it.
    const empties = await page.evaluate(() =>
        [...document.querySelectorAll(".sickle-demo")].filter(
            (d) => d.textContent.trim() === "" || /^Loading…?$/.test(d.textContent.trim()),
        ).length,
    );
    check(`${path} demos populated`, empties === 0, `${empties} still empty`);

    /*
     * A component that renders nothing leaves no `.sickle-demo` behind, so the
     * check above would pass by finding zero of them. Count the islands the
     * page declared and require each to have produced a demo.
     */
    const islands = await page.locator("astro-island").count();
    const demos = await page.locator(".sickle-demo").count();
    if (islands > 0) {
        check(`${path} ${islands} island(s) rendered`, demos >= islands, `${demos} demo(s) for ${islands} island(s)`);
    }

    /*
     * Scoped styles can go missing without anything failing.
     *
     * Astro only collects the CSS of components that actually render during
     * server rendering, so a child behind an `{#if data}` gate ships with no
     * styles at all: correct markup, right classes, no rules. The colour legend
     * was invisible this way — a flex row collapsed to stacked text and a ramp
     * with zero height, on a page that built and hydrated cleanly.
     *
     * Measuring a box that must have size is the cheapest way to see it.
     */
    const collapsed = await page.evaluate(() =>
        [".legend", ".swatches", ".ramp", ".readout"]
            .flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => ({ sel, el })))
            .filter(({ el }) => {
                const r = el.getBoundingClientRect();
                // Deliberately hidden subtrees have no box at all; ignore those.
                return el.offsetParent !== null && (r.width < 1 || r.height < 1);
            })
            .map(({ sel }) => sel),
    );
    if (islands > 0) {
        check(
            `${path} demo styles applied`,
            collapsed.length === 0,
            collapsed.length ? `collapsed: ${[...new Set(collapsed)].join(", ")}` : "",
        );
    }
}

/*
 * Every link in the generated API sidebar must resolve.
 *
 * `scripts/api-sidebar.mjs` has to predict TypeDoc's page slugs, because it runs
 * before TypeDoc does. Astro only validates a slug it can see in the sidebar
 * config at build time — it cannot tell that `api/variables/continuitycurve`
 * should have been `api/functions/…` once the page exists under a different
 * name. Fetching them is the only end-to-end check.
 */
{
    // Not the landing page: it uses the splash template, which has no sidebar.
    await page.goto(`${BASE}/getting-started/`, { waitUntil: "networkidle" });
    const links = await page.evaluate(() =>
        [...document.querySelectorAll('#starlight__sidebar a[href*="/api/"]')].map((a) => a.href),
    );
    const dead = [];
    for (const href of links) {
        const res = await page.request.get(href);
        if (!res.ok()) dead.push(`${res.status()} ${href}`);
    }
    check(
        `API sidebar: ${links.length} link(s) resolve`,
        links.length > 0 && dead.length === 0,
        links.length === 0 ? "no API links found in the sidebar" : dead.slice(0, 3).join(" | "),
    );
}

await browser.close();
console.log(failures === 0 ? "\nall good" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
