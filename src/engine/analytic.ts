import { lookupPay } from "./config.ts";
import { evaluateLine } from "./evaluate.ts";
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
 * Exact return to player of a single spin, with no sampling.
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
    const { symbol, pays } = config.scatter;
    let counts: number[] = [1];
    for (const strip of config.strips) {
      const reelCounts = scatterCountDistribution(config, strip, symbol);
      const combined = new Array<number>(counts.length + reelCounts.length - 1).fill(0);
      counts.forEach((p, i) => reelCounts.forEach((q, j) => (combined[i + j]! += p * q)));
      counts = combined;
    }
    // A scatter win is `multiplier * totalBet`.
    counts.forEach((p, count) => (scatterRtp += p * lookupPay(pays, count)));
  }

  return { lines, scatter: scatterRtp, total: lines + scatterRtp, lineBySymbol };
}
