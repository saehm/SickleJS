/**
 * Loader for the precomputed results in `public/data`.
 *
 * Everything the pages show is computed at build time by `scripts/precompute.mjs`
 * from the same fixtures the test suite uses, so a number on a page is a number
 * an assertion holds for. Four measures could not run in a browser at all.
 */

/** Astro serves `public/` under the site base, which is not `/` here. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const cache = new Map();

async function json(path) {
    if (!cache.has(path)) {
        cache.set(
            path,
            fetch(`${BASE}/data/${path}`).then((r) => {
                if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
                return r.json();
            }),
        );
    }
    return cache.get(path);
}

export const datasets = () => json("datasets.json");
export const dataset = (name) => json(`${name}.json`);
export const disagreements = () => json("disagreements.json");
export const methods = () => json("methods.json");
export const localisation = () => json("localisation.json");
