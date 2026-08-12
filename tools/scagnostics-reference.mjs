/**
 * Snapshot the upstream ScagnosticsJS output for the committed fixtures, so the
 * parity test does not need the original repository checked out.
 *
 *   node tools/scagnostics-reference.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import original from "file:///C:/Users/cuturare/Documents/Projects/ScagnosticsJS/scagnostics/src/scripts/scagnostics.js";

const DATA = "test/fixtures/data";
const manifest = JSON.parse(readFileSync(`${DATA}/manifest.json`, "utf8"));
const out = { _source: "ScagnosticsJS (iDataVisualizationLab/Scagnostics2018), ISC", fixtures: {} };

for (const { name } of manifest) {
    const pts = readFileSync(`${DATA}/${name}.Y.csv`, "utf8").trim().split("\n")
        .map((l) => l.split(",").map(Number));
    const r = original(pts);
    out.fixtures[name] = {
        outlying: r.outlyingScore, skewed: r.skewedScore, clumpy: r.clumpyScore,
        sparse: r.sparseScore, striated: r.striatedScore, convex: r.convexScore,
        skinny: r.skinnyScore, stringy: r.stringyScore, monotonic: r.monotonicScore,
    };
    console.log(`  ${name.padEnd(14)} monotonic=${r.monotonicScore.toFixed(4)}`);
}
writeFileSync("test/fixtures/scagnostics.json", JSON.stringify(out, null, 2) + "\n");
console.log("\nwrote test/fixtures/scagnostics.json");
