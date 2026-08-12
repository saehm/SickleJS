export { toVectors, row, assertSamePoints } from "./core/vectors.ts";
export type { Vectors, VectorInput, PointsInput, MatrixLike } from "./core/vectors.ts";

export { argsortRange, radixArgsort, makeRadixScratch } from "./core/sort.ts";
export type { RadixScratch } from "./core/sort.ts";

export {
    coRanking,
    coRankingPartial,
    reduceCoRanking,
    rowRanges,
} from "./passes/coranking.ts";
export type { CoRanking, CoRankingPartial, CoRankingOptions } from "./passes/coranking.ts";

export { analyzeAsync, coRankingAsync, nervAsync } from "./passes/parallel.ts";
export type { AnalyzeAsyncOptions, NervAsyncOptions, ParallelOptions } from "./passes/parallel.ts";

export { parallelAvailable, defaultPoolSize, spawnWorker, runOnPool } from "./parallel/pool.ts";
export type { WorkerHandle, WorkerFactory } from "./parallel/pool.ts";

export {
    trustworthiness,
    continuity,
    qnx,
    lcmc,
    rnx,
    aucLogRnx,
    trustworthinessCurve,
    continuityCurve,
    qnxCurve,
    lcmcCurve,
    rnxCurve,
    localTrustworthiness,
    localContinuity,
    maxKTrustworthiness,
    maxKQnx,
    maxKRnx,
    mrreFalse,
    mrreMissing,
    mrreFalseCurve,
    mrreMissingCurve,
    localMrreFalse,
    localMrreMissing,
} from "./metrics/neighborhood.ts";
export type { Curve } from "./metrics/neighborhood.ts";

export { residualVariance, spearmanRho } from "./metrics/correlation.ts";
export type { SpearmanOptions } from "./metrics/correlation.ts";

export {
    knnIndices,
    neighborhoodHit,
    classificationError,
    dunnIndex,
    daviesBouldin,
} from "./metrics/labelled.ts";

export { Accumulator, sum, mean } from "./core/sum.ts";
export { checkContract } from "./core/result.ts";
export type { MetricResult, LocalKind } from "./core/result.ts";

export { distanceMoments } from "./passes/distances.ts";
export { analyze, reduceFused } from "./passes/analyze.ts";
export type { Analysis, AnalyzeOptions, EmbeddingMoments, StructureMoments } from "./passes/analyze.ts";
export { fusedPartial } from "./passes/fused.ts";
export type { FusedPartial, FusedOptions } from "./passes/fused.ts";
export type { DistanceMoments, DistancePassOptions } from "./passes/distances.ts";

export { stress, scaleNormalizedStress, optimalScale, pearsonR } from "./metrics/distance.ts";

export { nervPass, nervPartial, reduceNerv } from "./passes/nerv.ts";
export type { Nerv, NervPartial, NervOptions } from "./passes/nerv.ts";
export { sammonStress, curvilinearStress, nerv } from "./metrics/embedding.ts";
export { nonMetricStress, pava } from "./metrics/nonmetric.ts";
export type { NonMetricStressResult, NonMetricStressOptions } from "./metrics/nonmetric.ts";

export {
    clusters,
    silhouette,
    calinskiHarabasz,
    distanceConsistency,
    averageBetweenWithin,
    hypothesisMargin,
} from "./metrics/separability.ts";
export type { Clusters } from "./metrics/separability.ts";

export { scagnostics, scagnostic, scagnosticsFor, SCAGNOSTIC_NAMES } from "./scagnostics/index.ts";
export type { Scagnostics, ScagnosticName, ScagnosticsOptions } from "./scagnostics/index.ts";

export { gabrielEdges, gabrielClassificationError } from "./metrics/geometric.ts";
export type { GceResult, GabrielStrategy } from "./metrics/geometric.ts";

export { snc } from "./passes/snc.ts";
export type { Snc, SncOptions } from "./passes/snc.ts";

export {
    persistenceH0,
    bottleneckH0,
    wassersteinH0,
    topologicalH0,
    bottleneckDistance,
    topologicalH1,
} from "./metrics/topology.ts";
export type { PersistenceH0, TopologyOptions, TopologyH1Options } from "./metrics/topology.ts";

export { densityPreservation, tripletAccuracy } from "./metrics/structure.ts";

export { ripsH1, enclosingRadius } from "./passes/rips.ts";
export type { Diagram, RipsOptions } from "./passes/rips.ts";
