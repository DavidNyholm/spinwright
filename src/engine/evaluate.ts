import { lookupPay } from "./config.ts";
import type { GameConfig, LineWin, Position, ScatterWin, SymbolId } from "./types.ts";

export interface LineEvaluation {
  readonly symbol: SymbolId;
  readonly count: number;
  readonly multiplier: number;
}

/**
 * Evaluates the symbols along one payline, left to right. Rules:
 *  - Wins pay from the leftmost reel and need an unbroken run.
 *  - The wild substitutes for any symbol except the scatter.
 *  - The scatter is not a line symbol: it ends a run and never starts one.
 *  - Leading wilds can pay as the wild (its own table) or as the first real symbol
 *    after them; the larger payout is taken.
 * Returns null when the line does not win.
 */
export function evaluateLine(config: GameConfig, symbols: readonly SymbolId[]): LineEvaluation | null {
  const { wild, scatter, pays } = config;
  let best: LineEvaluation | null = null;

  let leadingWilds = 0;
  if (wild !== null) {
    while (leadingWilds < symbols.length && symbols[leadingWilds] === wild) leadingWilds++;
    const wildPays = pays[wild];
    if (leadingWilds > 0 && wildPays !== undefined) {
      const multiplier = lookupPay(wildPays, leadingWilds);
      if (multiplier > 0) best = { symbol: wild, count: leadingWilds, multiplier };
    }
  }

  const anchor = symbols[leadingWilds];
  if (anchor !== undefined && anchor !== scatter?.symbol) {
    const anchorPays = pays[anchor];
    if (anchorPays !== undefined) {
      let count = leadingWilds + 1;
      while (count < symbols.length) {
        const next = symbols[count];
        if (next !== anchor && next !== wild) break;
        count++;
      }
      const multiplier = lookupPay(anchorPays, count);
      if (multiplier > 0 && (best === null || multiplier > best.multiplier)) {
        best = { symbol: anchor, count, multiplier };
      }
    }
  }

  return best;
}

export interface GridEvaluation {
  readonly lineWins: readonly LineWin[];
  readonly scatterWin: ScatterWin | null;
  readonly totalWin: number;
}

/** Evaluates a full grid (grid[reel][row]) for a bet of `lineBet` credits per payline. */
export function evaluateGrid(
  config: GameConfig,
  grid: readonly (readonly SymbolId[])[],
  lineBet: number,
): GridEvaluation {
  const { paylines, scatter } = config;
  const lineWins: LineWin[] = [];
  let totalWin = 0;

  // Plain loops and one reused scratch array: this runs once per simulated spin.
  const lineSymbols: SymbolId[] = new Array<SymbolId>(config.reels);
  for (let line = 0; line < paylines.length; line++) {
    const rowsByReel = paylines[line]!;
    for (let reel = 0; reel < config.reels; reel++) {
      lineSymbols[reel] = grid[reel]![rowsByReel[reel]!]!;
    }
    const evaluation = evaluateLine(config, lineSymbols);
    if (evaluation === null) continue;
    const positions: Position[] = [];
    for (let reel = 0; reel < evaluation.count; reel++) positions.push([reel, rowsByReel[reel]!]);
    const win = evaluation.multiplier * lineBet;
    lineWins.push({
      line,
      symbol: evaluation.symbol,
      count: evaluation.count,
      multiplier: evaluation.multiplier,
      win,
      positions,
    });
    totalWin += win;
  }

  let scatterWin: ScatterWin | null = null;
  if (scatter !== null) {
    const positions: Position[] = [];
    for (let reel = 0; reel < config.reels; reel++) {
      for (let row = 0; row < config.rows; row++) {
        if (grid[reel]![row] === scatter.symbol) positions.push([reel, row]);
      }
    }
    const multiplier = lookupPay(scatter.pays, positions.length);
    if (multiplier > 0) {
      const win = multiplier * lineBet * paylines.length;
      scatterWin = { symbol: scatter.symbol, count: positions.length, multiplier, win, positions };
      totalWin += win;
    }
  }

  return { lineWins, scatterWin, totalWin };
}
