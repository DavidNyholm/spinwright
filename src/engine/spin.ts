import { evaluateGrid } from "./evaluate.ts";
import { nextInt } from "./rng.ts";
import type { Rng } from "./rng.ts";
import type { GameConfig, SpinResult, SymbolId } from "./types.ts";

function checkLineBet(lineBet: number): void {
  if (!Number.isInteger(lineBet) || lineBet < 1) {
    throw new RangeError(`lineBet must be a positive integer number of credits, got ${lineBet}`);
  }
}

/**
 * The visible window for the given stops: grid[reel][row], reading down each strip and wrapping at its end.
 * `strips` defaults to the game's own; the free spins pass theirs.
 */
export function buildGrid(
  config: GameConfig,
  stops: readonly number[],
  strips: readonly (readonly SymbolId[])[] = config.strips,
): SymbolId[][] {
  // Plain loops: the simulator calls this tens of millions of times and closures dominated its cost.
  const grid: SymbolId[][] = new Array<SymbolId[]>(config.reels);
  for (let reel = 0; reel < config.reels; reel++) {
    const strip = strips[reel]!;
    const stop = stops[reel]!;
    const column: SymbolId[] = new Array<SymbolId>(config.rows);
    for (let row = 0; row < config.rows; row++) column[row] = strip[(stop + row) % strip.length]!;
    grid[reel] = column;
  }
  return grid;
}

/**
 * Resolves a spin from chosen stops instead of random ones. This is what spin() uses once it has
 * drawn its stops, and it also lets tests and QA force an exact outcome.
 */
export function spinFromStops(config: GameConfig, stops: readonly number[], lineBet: number): SpinResult {
  checkLineBet(lineBet);
  if (stops.length !== config.reels) {
    throw new RangeError(`expected ${config.reels} stops, got ${stops.length}`);
  }
  stops.forEach((stop, reel) => {
    const length = config.strips[reel]!.length;
    if (!Number.isInteger(stop) || stop < 0 || stop >= length) {
      throw new RangeError(`stop ${stop} on reel ${reel} is outside [0, ${length - 1}]`);
    }
  });

  const grid = buildGrid(config, stops);
  const { lineWins, scatterWin, totalWin } = evaluateGrid(config, grid, lineBet);
  return {
    lineBet,
    totalBet: lineBet * config.paylines.length,
    stops: [...stops],
    grid,
    lineWins,
    scatterWin,
    totalWin,
  };
}

/** Plays one spin: draws a stop per reel, then resolves the outcome. The outcome is final before any animation. */
export function spin(config: GameConfig, rng: Rng, lineBet: number): SpinResult {
  const stops = config.strips.map((strip) => nextInt(rng, strip.length));
  return spinFromStops(config, stops, lineBet);
}
