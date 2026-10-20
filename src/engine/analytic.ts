import { lookupPay } from "./config.ts";
import { evaluateLine } from "./evaluate.ts";
import { spinsAwarded } from "./feature.ts";
import type { GameConfig, SymbolId } from "./types.ts";

export interface ExactRtp {
  /** Return to player from line wins, as a fraction of total bet (0.96 = 96%). */
  readonly lines: number;
  /** Return to player from scatter wins. */
  readonly scatter: number;
  readonly total: number;
  /** `lines` split by the symbol each win is paid as. */
  readonly lineBySymbol: Readonly<Record<SymbolId, number>>;
}

type Distribution = readonly (readonly [symbol: SymbolId, probability: number])[];

/** Probability of each symbol landing at `row` of `strip`, with the stop uniform over the strip. */
function symbolDistribution(strip: readonly SymbolId[], row: number): Distribution {
  const counts = new Map<SymbolId, number>();
  for (let stop = 0; stop < strip.length; stop++) {
    const symbol = strip[(stop + row) % strip.length]!;
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  return [...counts].map(([symbol, count]) => [symbol, count / strip.length]);
}

/** Probability of exactly k scatters in the window of one reel, for k = 0..rows. */
function scatterCountDistribution(config: GameConfig, strip: readonly SymbolId[], scatter: SymbolId): number[] {
  const distribution = new Array<number>(config.rows + 1).fill(0);
  for (let stop = 0; stop < strip.length; stop++) {
    let count = 0;
    for (let row = 0; row < config.rows; row++) {
      if (strip[(stop + row) % strip.length] === scatter) count++;
    }
    distribution[count]! += 1 / strip.length;
  }
  return distribution;
}

/**
 * The exact chance of each number of scatters on the opening grid: entry k is the probability of
 * exactly k. Reel stops are independent, so the counts of the reels convolve.
 */
export function openingScatterProbabilities(config: GameConfig): number[] {
  if (config.scatter === null) return [1];
  let counts: number[] = [1];
  for (const strip of config.strips) {
    const reelCounts = scatterCountDistribution(config, strip, config.scatter.symbol);
    const combined = new Array<number>(counts.length + reelCounts.length - 1).fill(0);
    counts.forEach((p, i) => reelCounts.forEach((q, j) => (combined[i + j]! += p * q)));
    counts = combined;
  }
  return counts;
}

/**
 * The smallest amount any winning spin can pay, as a multiple of the total bet: the smallest line pay (in
 * bets per line, so divided by the number of lines) or scatter pay the game has. Above 1, no win ever pays
 * less than was staked. Infinity for a game that pays nothing.
 */
export function smallestWinMultiple(config: GameConfig): number {
  const lines = config.paylines.length;
  const linePays = Object.values(config.pays).flatMap((table) => Object.values(table).filter((pay) => pay > 0).map((pay) => pay / lines));
  const scatterPays = config.scatter === null ? [] : Object.values(config.scatter.pays).filter((pay) => pay > 0);
  return Math.min(Infinity, ...linePays, ...scatterPays);
}

/** The exact chance that a spin's opening grid starts the feature (0 if the game has none). */
export function triggerProbability(config: GameConfig): number {
  if (config.feature === null) return 0;
  return openingScatterProbabilities(config).reduce((sum, p, count) => sum + (spinsAwarded(config, count) > 0 ? p : 0), 0);
}

/**
 * Exact return to player of a single spin, with no sampling. This is the opening spin only: the
 * free spins a feature game may go on to award are worth more, and are measured by simulation
 * (see src/sim), because the locked wilds make every spin depend on the ones before.
 *
 * Reel stops are independent, so for a payline the symbols along it are independent draws
 * from per-reel distributions. Expected value is linear across paylines, so each line is
 * enumerated on its own over distinct symbol sequences (a few hundred thousand at most),
 * and scatter counts are convolved across reels.
 *
 * This reuses evaluateLine for the payout rules, so it cross-checks the sampling, the grid
 * window, the payline plumbing and the bet arithmetic, not the payout rules themselves.
 */
export function exactRtp(config: GameConfig): ExactRtp {
  const lineBySymbol: Record<SymbolId, number> = {};
  let lines = 0;

  for (const rowsByReel of config.paylines) {
    const perReel = config.strips.map((strip, reel) => symbolDistribution(strip, rowsByReel[reel]!));
    const sequence: SymbolId[] = new Array<SymbolId>(config.reels);
    const walk = (reel: number, probability: number): void => {
      if (reel === config.reels) {
        const evaluation = evaluateLine(config, sequence);
        if (evaluation !== null) {
          const contribution = probability * evaluation.multiplier;
          lines += contribution;
          lineBySymbol[evaluation.symbol] = (lineBySymbol[evaluation.symbol] ?? 0) + contribution;
        }
        return;
      }
      for (const [symbol, p] of perReel[reel]!) {
        sequence[reel] = symbol;
        walk(reel + 1, probability * p);
      }
    };
    walk(0, 1);
  }

  // A line win is `multiplier * lineBet` and the total bet is `lineBet * paylines`.
  const lineCount = config.paylines.length;
  for (const symbol of Object.keys(lineBySymbol)) lineBySymbol[symbol]! /= lineCount;
  lines /= lineCount;

  let scatterRtp = 0;
  if (config.scatter !== null) {
    const { pays } = config.scatter;
    // A scatter win is `multiplier * totalBet`.
    openingScatterProbabilities(config).forEach((p, count) => (scatterRtp += p * lookupPay(pays, count)));
  }

  return { lines, scatter: scatterRtp, total: lines + scatterRtp, lineBySymbol };
}
