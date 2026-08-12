/**
 * Deliberately naive, obviously-correct reference implementations.
 * Transcribed straight from the definitions / zadu, with no cleverness.
 * Used only to validate the fused kernel.
 */

export function euclidean(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; ++i) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
}

export function distanceMatrix(X: number[][]): number[][] {
    return X.map((a) => X.map((b) => euclidean(a, b)));
}

/** sortedIndices[i] = point indices ordered by distance from i (self first). */
export function sortedIndices(D: number[][]): number[][] {
    return D.map((row, i) =>
        row.map((d, j) => [j === i ? -1 : d, j] as [number, number])
            .sort((p, q) => p[0] - q[0])
            .map((p) => p[1]),
    );
}

/** ranking[i][j] = rank of j from i's perspective (self = 0). */
export function ranking(sorted: number[][]): number[][] {
    return sorted.map((row) => {
        const r = new Array(row.length);
        row.forEach((pt, pos) => { r[pt] = pos; });
        return r;
    });
}

/** zadu's tnc_computation, transcribed. Returns [global, perPoint]. */
export function tnc(
    baseKnn: number[][], baseRank: number[][], targetKnn: number[][], k: number,
): [number, number[]] {
    const n = baseKnn.length;
    const local: number[] = [];
    for (let i = 0; i < n; ++i) {
        const inBase = new Set(baseKnn[i]);
        let distortion = 0;
        for (const missing of targetKnn[i]) {
            if (!inBase.has(missing)) distortion += baseRank[i][missing] - k;
        }
        local.push(1 - distortion * (2 / (k * (2 * n - 3 * k - 1))));
    }
    return [local.reduce((a, b) => a + b, 0) / n, local];
}

export function referenceTC(X: number[][], Y: number[][], k: number) {
    const sx = sortedIndices(distanceMatrix(X));
    const sy = sortedIndices(distanceMatrix(Y));
    const rx = ranking(sx), ry = ranking(sy);
    const knnX = sx.map((r) => r.slice(1, k + 1));
    const knnY = sy.map((r) => r.slice(1, k + 1));
    const [trust, localTrust] = tnc(knnX, rx, knnY, k);
    const [cont, localCont] = tnc(knnY, ry, knnX, k);
    return { trust, cont, localTrust, localCont };
}

/** zadu's local_continuity_meta_criteria, transcribed. */
export function referenceLCMC(X: number[][], Y: number[][], k: number): number {
    const n = X.length;
    const knnX = sortedIndices(distanceMatrix(X)).map((r) => r.slice(1, k + 1));
    const knnY = sortedIndices(distanceMatrix(Y)).map((r) => r.slice(1, k + 1));
    let acc = 0;
    for (let i = 0; i < n; ++i) {
        const s = new Set(knnX[i]);
        let inter = 0;
        for (const j of knnY[i]) if (s.has(j)) inter++;
        acc += inter - (k * k) / (n - 1);
    }
    return acc / (n * k);
}

/** Q_NX(k): mean fraction of k-NN preserved. */
export function referenceQNX(X: number[][], Y: number[][], k: number): number {
    const n = X.length;
    const knnX = sortedIndices(distanceMatrix(X)).map((r) => r.slice(1, k + 1));
    const knnY = sortedIndices(distanceMatrix(Y)).map((r) => r.slice(1, k + 1));
    let acc = 0;
    for (let i = 0; i < n; ++i) {
        const s = new Set(knnX[i]);
        for (const j of knnY[i]) if (s.has(j)) acc++;
    }
    return acc / (k * n);
}
