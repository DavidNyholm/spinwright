export { scatterAtLeast, scatterCountDistribution, triggerProbability } from "./analytic.ts";
export { CascadeConfigError, defineCascadeGame, findCascadeConfigProblems } from "./config.ts";
export { columnFall, compileCascade, drawPiece, fillGrid, findClusters, removeAndRefill, toSymbolGrid } from "./grid.ts";
export type { ColumnFall, CompiledCascade, RawCluster } from "./grid.ts";
export { buyFeature, featurePrice, playCascade, playFeatureSession } from "./play.ts";
export type {
  BoughtFeature,
  CascadeConfig,
  CascadeResult,
  CascadeStep,
  ClusterWin,
  FeatureConfig,
  HeatConfig,
  PlayOptions,
  RoundResult,
} from "./types.ts";
