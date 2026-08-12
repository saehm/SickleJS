import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Two projects, because two things need proving.
 *
 * `node` runs the whole suite — parity against zadu, the metric contracts, the
 * worker pool on `node:worker_threads`.
 *
 * `browser` runs a much smaller suite in real Chromium via Playwright. Its job
 * is not to re-verify the maths but to exercise what Node cannot: that the
 * library loads in a browser, and that the parallel path works there through
 * `workerFactory`. The default worker URL is built at runtime and bundlers
 * cannot resolve it statically, so `workerFactory` is the supported route under
 * a bundler — and it was, until now, documented but never actually run.
 */
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "node",
                    environment: "node",
                    include: ["test/**/*.test.ts"],
                    exclude: ["test/browser/**"],
                    testTimeout: 60_000,
                    hookTimeout: 60_000,
                },
            },
            {
                test: {
                    name: "browser",
                    include: ["test/browser/**/*.test.ts"],
                    testTimeout: 60_000,
                    browser: {
                        enabled: true,
                        provider: playwright(),
                        headless: true,
                        instances: [
                            { browser: "chromium" },
                            { browser: "firefox" },
                            { browser: "webkit" },
                        ],
                    },
                },
            },
        ],
    },
});
