import { rollup } from "rollup";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";
import pkg from "./package.json" with { type: "json" };

const banner = `/* ${pkg.name} v${pkg.version} — ${pkg.homepage ?? "https://github.com/saehm/sickle"} */`;

// DruidJS and d3-delaunay are runtime dependencies, so they stay out of the
// ESM/CJS bundles. The browser build is the exception: a <script> tag has no
// resolver, so that one bundles them in.
const external = [...Object.keys(pkg.dependencies ?? {})];

/**
 * The source imports with explicit `.ts` extensions, so that Node can run it
 * directly with type stripping (used by `tools/` and `bench/`). TypeScript
 * refuses to *emit* under that flag, because emitted `.ts` specifiers would be
 * broken — but rollup rewrites every specifier itself, so none survives into the
 * output. The warning does not apply to this pipeline.
 */
const onwarn = (warning, warn) => {
    if (warning.plugin === "typescript" && warning.message.includes("TS5096")) return;
    warn(warning);
};

const plugins = () => [
    replace({
        preventAssignment: true,
        __VERSION__: JSON.stringify(pkg.version),
    }),
    resolve(),
    typescript({
        tsconfig: "./tsconfig.build.json",
        // Types are emitted once, by the dts bundle below.
        declaration: false,
        declarationMap: false,
        outDir: undefined,
    }),
];

/**
 * Bundle the worker to a single self-contained script, and hand it back as text.
 *
 * It is spawned from that text rather than from a file: in Node through
 * `new Worker(src, { eval: true })`, in a browser through a Blob URL. That
 * removes the one thing a bundler cannot do for us — rewrite a worker URL it
 * could not statically match — so the published package works under Vite,
 * webpack and a plain script tag alike, with no `workerFactory` needed.
 *
 * The worker imports only from `src/`, so nothing external is pulled in. It is
 * emitted as an IIFE because a plain script cannot express the ESM syntax the
 * module build uses.
 */
async function bundleWorkerSource() {
    const bundle = await rollup({
        input: "src/parallel/pass.worker.ts",
        plugins: plugins(),
        onwarn,
    });
    const { output } = await bundle.generate({ format: "iife" });
    await bundle.close();
    return output[0].code;
}

const workerSource = await bundleWorkerSource();

/** Replace the placeholder module with the bundled worker text. */
const inlineWorker = () => ({
    name: "inline-worker",
    transform(_code, id) {
        // Windows paths arrive with backslashes; compare on a normalised form.
        if (!id.split("\\").join("/").endsWith("src/parallel/worker-source.ts")) return null;
        return { code: `export const WORKER_SOURCE = ${JSON.stringify(workerSource)};`, map: null };
    },
});

export default [
    {
        input: "src/index.ts",
        external,
        onwarn,
        output: [
            { file: pkg.module, format: "es", banner, sourcemap: true },
            { file: pkg.main, format: "cjs", banner, sourcemap: true, exports: "named" },
        ],
        plugins: [inlineWorker(), ...plugins()],
    },
    {
        input: "src/index.ts",
        onwarn,
        output: {
            file: "dist/sickle.umd.js",
            format: "umd",
            name: "sickle",
            banner,
            sourcemap: true,
            plugins: [terser()],
        },
        plugins: [inlineWorker(), ...plugins()],
    },
    {
        // Two identical declaration bundles. Under node16/nodenext resolution a
        // `require` of this package looks for types next to the CJS entry and in
        // CJS form, so the ESM .d.ts alone leaves those consumers untyped.
        input: "src/index.ts",
        external,
        output: [
            { file: "dist/sickle.d.ts", format: "es" },
            { file: "dist/sickle.d.cts", format: "es" },
        ],
        plugins: [dts({ tsconfig: "./tsconfig.build.json" })],
    },
];
