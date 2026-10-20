import type { CascadeResult } from "../engine/cascade/index.ts";

/** Win-size bands as a multiple of the total bet; a play lands in the last band whose `min` it reaches. */
export const CASCADE_WIN_BANDS: readonly { readonly label: string; readonly min: number }[] = [
  { label: "no win", min: 0 },
  { label: "< 1x", min: Number.MIN_VALUE },
  { label: "1x - 2x", min: 1 },
  { label: "2x - 5x", min: 2 },
  { label: "5x - 20x", min: 5 },
  { label: "20x - 100x", min: 20 },
  { label: "100x - 1000x", min: 100 },
  { label: "1000x +", min: 1_000 },
];

/** How many winning steps the base spin had: 0, 1, 2, 3, 4, and 5 or more. */
export const STEP_BUCKETS = 6;

/** A running mean and variance that never stores the samples (Welford's method). */
export class Running {
  count = 0;
  mean = 0;
  #m2 = 0;

  add(value: number): void {
    this.count++;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.#m2 += delta * (value - this.mean);
  }

  get variance(): number {
    return this.count > 1 ? this.#m2 / (this.count - 1) : 0;
  }

  get standardError(): number {
    return Math.sqrt(this.variance / this.count);
  }
}

export interface CascadeStats {
  plays: number;
  /** Per play, win as a multiple of the total bet: overall, from the base spin, and from the feature. */
  total: Running;
  base: Running;
  feature: Running;
  hits: number;
  triggers: number;
  featureSpins: number;
  capped: number;
  maxX: number;
  bandCounts: number[];
  baseStepCounts: number[];
  maxHeat: number;
}

export function createCascadeStats(): CascadeStats {
  return {
    plays: 0,
    total: new Running(),
    base: new Running(),
    feature: new Running(),
    hits: 0,
    triggers: 0,
    featureSpins: 0,
    capped: 0,
    maxX: 0,
    bandCounts: CASCADE_WIN_BANDS.map(() => 0),
    baseStepCounts: new Array<number>(STEP_BUCKETS).fill(0),
    maxHeat: 0,
  };
}

export function recordCascade(stats: CascadeStats, result: CascadeResult): void {
  const bet = result.totalBet;
  const x = result.totalWin / bet;
  const featureWin = result.totalWin - result.base.win;

  stats.plays++;
  stats.total.add(x);
  stats.base.add(result.base.win / bet);
  stats.feature.add(featureWin / bet);
  if (result.totalWin > 0) stats.hits++;
  if (result.feature !== null) {
    stats.triggers++;
    stats.featureSpins += result.feature.length;
  }
  if (result.capped) stats.capped++;
  if (x > stats.maxX) stats.maxX = x;

  let band = 0;
  while (band + 1 < CASCADE_WIN_BANDS.length && x >= CASCADE_WIN_BANDS[band + 1]!.min) band++;
  stats.bandCounts[band]!++;
  stats.baseStepCounts[Math.min(STEP_BUCKETS - 1, result.base.stepCount)]!++;
  stats.maxHeat = Math.max(stats.maxHeat, result.base.endHeat, ...(result.feature ?? []).map((round) => round.endHeat));
}
