import type { SpinResult, SymbolId } from "../engine/index.ts";

/** Win-size bands, as a multiple of the total bet. A spin lands in the last band whose `min` it reaches. */
export const WIN_BANDS: readonly { readonly label: string; readonly min: number }[] = [
  { label: "no win", min: 0 },
  { label: "< 1x", min: Number.MIN_VALUE },
  { label: "1x - 2x", min: 1 },
  { label: "2x - 5x", min: 2 },
  { label: "5x - 10x", min: 5 },
  { label: "10x - 25x", min: 10 },
  { label: "25x - 100x", min: 25 },
  { label: "100x +", min: 100 },
];

/** Streaming totals: memory use does not grow with the number of spins. */
export interface SimStats {
  spins: number;
  totalBet: number;
  totalWin: number;
  lineWin: number;
  scatterWin: number;
  lineWinBySymbol: Record<SymbolId, number>;
  hits: number;
  /** Sum of x and x^2 where x = win / totalBet for the spin. */
  sumX: number;
  sumX2: number;
  maxX: number;
  maxStops: readonly number[];
  bandCounts: number[];
}

export function createStats(): SimStats {
  return {
    spins: 0,
    totalBet: 0,
    totalWin: 0,
    lineWin: 0,
    scatterWin: 0,
    lineWinBySymbol: {},
    hits: 0,
    sumX: 0,
    sumX2: 0,
    maxX: 0,
    maxStops: [],
    bandCounts: WIN_BANDS.map(() => 0),
  };
}

export function record(stats: SimStats, result: SpinResult): void {
  stats.spins++;
  stats.totalBet += result.totalBet;
  stats.totalWin += result.totalWin;

  for (const win of result.lineWins) {
    stats.lineWin += win.win;
    stats.lineWinBySymbol[win.symbol] = (stats.lineWinBySymbol[win.symbol] ?? 0) + win.win;
  }
  if (result.scatterWin !== null) stats.scatterWin += result.scatterWin.win;

  const x = result.totalWin / result.totalBet;
  if (result.totalWin > 0) stats.hits++;
  stats.sumX += x;
  stats.sumX2 += x * x;
  if (x > stats.maxX) {
    stats.maxX = x;
    stats.maxStops = result.stops;
  }

  let band = 0;
  while (band + 1 < WIN_BANDS.length && x >= WIN_BANDS[band + 1]!.min) band++;
  stats.bandCounts[band]!++;
}

export interface Summary {
  /** Return to player as a fraction (0.96 = 96%). */
  rtp: number;
  /** Half-width of the 95% confidence interval on rtp. */
  rtpCi95: number;
  /** Standard error of rtp, for z-scores against the exact value. */
  rtpStdError: number;
  /** Standard deviation of the win per spin, in multiples of the total bet. */
  volatility: number;
  hitFrequency: number;
  lineRtp: number;
  scatterRtp: number;
}

const Z_95 = 1.96;

export function summarize(stats: SimStats): Summary {
  const n = stats.spins;
  const mean = stats.sumX / n;
  // Sample variance of x. Clamp tiny negative values from floating-point cancellation.
  const variance = Math.max(0, (stats.sumX2 - n * mean * mean) / (n - 1));
  const stdError = Math.sqrt(variance / n);
  return {
    rtp: stats.totalWin / stats.totalBet,
    rtpCi95: Z_95 * stdError,
    rtpStdError: stdError,
    volatility: Math.sqrt(variance),
    hitFrequency: stats.hits / n,
    lineRtp: stats.lineWin / stats.totalBet,
    scatterRtp: stats.scatterWin / stats.totalBet,
  };
}
