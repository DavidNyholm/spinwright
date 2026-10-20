import { defineGame } from "../src/engine/index.ts";
import type { GameConfig, Rng } from "../src/engine/index.ts";
import { defineHoldGame } from "../src/engine/hold/index.ts";
import type { HoldFeature, HoldGameConfig } from "../src/engine/hold/index.ts";

/**
 * A small hold-and-win game that can be worked out by hand: three reels of two rows (six cells), a
 * coin on every strip, two paylines, and coins worth 1 or 4 (three to one). Two coins start the
 * feature, a cell fills on a respin one time in three, and there are two respins.
 *
 * Each strip is A C A A, so the window at stop 0 shows A over C, at stop 1 C over A, and at stops 2
 * and 3 A over A: stop 0 puts a coin in the bottom row, stop 1 in the top row, and 2 or 3 none.
 */
export const TINY_STRIP = ["A", "C", "A", "A"] as const;

export const tinyBase = (overrides: Partial<GameConfig> = {}): GameConfig => ({
  id: "tiny-hold",
  name: "Tiny hold",
  reels: 3,
  rows: 2,
  strips: [TINY_STRIP, TINY_STRIP, TINY_STRIP],
  paylines: [
    [0, 0, 0],
    [1, 1, 1],
  ],
  pays: { A: { 3: 2 } },
  wild: null,
  scatter: { symbol: "C", pays: {} },
  feature: null,
  maxWinMultiple: null,
  ...overrides,
});

export const tinyHold = (overrides: Partial<HoldFeature> = {}): HoldFeature => ({
  coin: "C",
  minCoins: 2,
  respins: 2,
  values: [
    { value: 1, weight: 3 },
    { value: 4, weight: 1 },
  ],
  landing: { numerator: 1, denominator: 3 },
  fullBoard: { name: "Grand", value: 50 },
  buyCost: 5,
  ...overrides,
});

export const makeHoldGame = (hold: Partial<HoldFeature> = {}, base: Partial<GameConfig> = {}): HoldGameConfig =>
  defineHoldGame({ base: defineGame(tinyBase(base)), hold: tinyHold(hold) });

/** The same, unvalidated, so a test can make a game that should be rejected. */
export const rawHoldGame = (hold: Partial<HoldFeature> = {}, base: Partial<GameConfig> = {}): HoldGameConfig => ({ base: tinyBase(base), hold: tinyHold(hold) });

/**
 * A random source that hands out the numbers a test chose, in order. `nextInt` returns the number
 * itself for any bound it is below (the rejection limit is far above a small number), so a script is
 * a list of the draws themselves. It throws if the engine asks for more than the script holds, or
 * if some are left over (`finished`), so a test also pins how many draws were made.
 */
export function scriptedRng(draws: readonly number[]): Rng & { finished(): void; readonly used: number } {
  let next = 0;
  return {
    nextUint32(): number {
      if (next >= draws.length) throw new Error(`the engine asked for draw ${next + 1} but the script holds ${draws.length}`);
      return draws[next++]!;
    },
    finished(): void {
      if (next !== draws.length) throw new Error(`the script holds ${draws.length} draws but the engine used ${next}`);
    },
    get used(): number {
      return next;
    },
  };
}
