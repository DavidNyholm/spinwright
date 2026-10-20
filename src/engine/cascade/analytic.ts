import type { CascadeConfig } from "./types.ts";

/**
 * The chance that a freshly filled grid holds exactly k scatters, for k = 0..cells, with no
 * sampling. Cells are filled independently, so each column's scatter count is binomial with that
 * column's scatter probability, and the columns convolve.
 */
export function scatterCountDistribution(config: CascadeConfig): number[] {
  const { scatter, columns, rows } = config;
  if (scatter === null) return [1];

  let distribution: number[] = [1];
  for (let column = 0; column < columns; column++) {
    const weights = config.weights[column]!;
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const p = (weights[scatter] ?? 0) / total;

    // Binomial(rows, p) by the standard recurrence on k.
    const binomial = new Array<number>(rows + 1).fill(0);
    let term = (1 - p) ** rows;
    for (let k = 0; k <= rows; k++) {
      binomial[k] = term;
      if (k < rows) term = p === 1 ? 0 : (term * (rows - k) * p) / ((k + 1) * (1 - p));
    }

    const combined = new Array<number>(distribution.length + rows).fill(0);
    distribution.forEach((a, i) => binomial.forEach((b, j) => (combined[i + j]! += a * b)));
    distribution = combined;
  }
  return distribution;
}

/** The chance a freshly filled grid holds at least `count` scatters. */
export function scatterAtLeast(config: CascadeConfig, count: number): number {
  return scatterCountDistribution(config)
    .slice(count)
    .reduce((a, b) => a + b, 0);
}

/** The chance a base spin triggers the feature, or 0 for a game without one. */
export function triggerProbability(config: CascadeConfig): number {
  return config.feature === null ? 0 : scatterAtLeast(config, config.feature.trigger);
}
