import { defineCascadeGame } from "../src/engine/cascade/index.ts";
import type { CascadeConfig } from "../src/engine/cascade/index.ts";

/**
 * A small game for tests: 4 columns x 3 rows, three pieces and a scatter, tuned so that clusters,
 * long cascades, the feature and retriggers all happen often enough to be exercised by a few
 * thousand plays.
 */
export const TOY: CascadeConfig = {
  id: "toy",
  name: "Toy cascade",
  columns: 4,
  rows: 3,
  weights: Array.from({ length: 4 }, () => ({ A: 4, B: 3, C: 2, S: 1 })),
  pays: {
    A: { 3: 1, 4: 3, 6: 10, 9: 40 },
    B: { 3: 2, 4: 5, 6: 15, 9: 60 },
    C: { 3: 4, 4: 9, 6: 30, 9: 120 },
  },
  minCluster: 3,
  units: 4,
  scatter: "S",
  feature: { trigger: 2, spins: 3, retrigger: { count: 2, spins: 2 }, maxSpins: 8, heatStep: null, buyCost: null },
  heat: { start: 1, step: 1, max: 4 },
  maxWinMultiple: 1_000,
};

export function makeCascade(overrides: Partial<CascadeConfig> = {}): CascadeConfig {
  return defineCascadeGame({ ...TOY, ...overrides });
}

/** The same, unvalidated, for testing validation itself. */
export function rawCascade(overrides: Partial<CascadeConfig> = {}): CascadeConfig {
  return { ...TOY, ...overrides };
}
