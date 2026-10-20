import { exactRtp, openingScatterProbabilities, smallestWinMultiple } from "../analytic.ts";
import type { ExactRtp } from "../analytic.ts";
import type { HoldFeature, HoldGameConfig } from "./types.ts";

/** The mean of one coin's value, in bets per line. */
export function meanCoinValue(hold: HoldFeature): number {
  let weight = 0;
  let sum = 0;
  for (const entry of hold.values) {
    weight += entry.weight;
    sum += entry.weight * entry.value;
  }
  return sum / weight;
}

/** The chance of exactly `k` successes in `n` independent tries of probability `p`, for k = 0..n. */
function binomial(n: number, p: number): number[] {
  const pmf = new Array<number>(n + 1).fill(0);
  // Built from the k = 0 term upward: pmf[k+1] = pmf[k] * (n - k) / (k + 1) * p / (1 - p).
  pmf[0] = (1 - p) ** n;
  for (let k = 0; k < n; k++) pmf[k + 1] = (pmf[k]! * (n - k) * p) / ((k + 1) * (1 - p));
  return pmf;
}

export interface HoldOutcome {
  /** The average number of coins on the board when the feature ends. */
  readonly expectedCoins: number;
  /** The chance that the board is full when it ends. */
  readonly fullProbability: number;
}

/**
 * Where the feature ends up, worked out exactly from `start` coins. Only how many coins there are
 * matters, not where they sit, because every empty cell fills with the same chance and the values
 * never change what happens next. So the board is a state (coins, respins left) with a short
 * chain between states, and it is solved from the full board backwards:
 *  - a full board, or no respins left, ends the feature as it stands;
 *  - otherwise each empty cell fills on its own, the number that do is binomial, and if any did the
 *    respins reset, otherwise one is used up.
 */
export function holdOutcome(hold: HoldFeature, cells: number, start: number): HoldOutcome {
  const p = hold.landing.numerator / hold.landing.denominator;
  const respins = hold.respins;
  const expected: number[][] = [];
  const full: number[][] = [];
  for (let n = cells; n >= 0; n--) {
    expected[n] = new Array<number>(respins + 1).fill(0);
    full[n] = new Array<number>(respins + 1).fill(0);
    const empty = cells - n;
    const chances = binomial(empty, p);
    for (let r = 0; r <= respins; r++) {
      if (n === cells) {
        expected[n]![r] = cells;
        full[n]![r] = 1;
      } else if (r === 0) {
        expected[n]![r] = n;
      } else {
        let coins = chances[0]! * expected[n]![r - 1]!;
        let fills = chances[0]! * full[n]![r - 1]!;
        for (let k = 1; k <= empty; k++) {
          coins += chances[k]! * expected[n + k]![respins]!;
          fills += chances[k]! * full[n + k]![respins]!;
        }
        expected[n]![r] = coins;
        full[n]![r] = fills;
      }
    }
  }
  return { expectedCoins: expected[start]![respins]!, fullProbability: full[start]![respins]! };
}

/**
 * What the feature is worth on average when it starts from `start` coins, as a multiple of the total
 * bet. Coin values are independent of what happens next, so the average is the mean coin times the
 * average number of coins, plus the full-board prize times its chance.
 */
export function holdValue(game: HoldGameConfig, start: number): number {
  const { hold } = game;
  const outcome = holdOutcome(hold, game.base.reels * game.base.rows, start);
  const perLine = meanCoinValue(hold) * outcome.expectedCoins + hold.fullBoard.value * outcome.fullProbability;
  return perLine / game.base.paylines.length;
}

export interface HoldReturn {
  /** The opening spin, exactly: its lines (the coin pays nothing). */
  readonly base: ExactRtp;
  /** The exact chance that the opening spin starts the feature. */
  readonly trigger: number;
  /** For each number of coins that starts it: the exact chance of that many, and what the feature is then worth (multiples of the total bet). */
  readonly perStart: readonly { readonly coins: number; readonly probability: number; readonly value: number; readonly fullProbability: number }[];
  /** Return from the feature, as a fraction of the bet. */
  readonly feature: number;
  readonly total: number;
  /** What a bought feature is worth on average (multiples of the total bet). */
  readonly buyValue: number;
}

/**
 * The game's return with no sampling at all: the opening spin exactly, plus the exact chance of each
 * number of coins times the exact value of the feature from that many. (Unlike free spins with
 * locked wilds, this feature can be solved exactly, so the simulator is a check on the engine and
 * not the source of the number.)
 */
export function exactHoldReturn(game: HoldGameConfig): HoldReturn {
  const cells = game.base.reels * game.base.rows;
  const base = exactRtp(game.base);
  const perStart: { coins: number; probability: number; value: number; fullProbability: number }[] = [];
  let trigger = 0;
  let feature = 0;
  openingScatterProbabilities(game.base).forEach((probability, coins) => {
    if (coins < game.hold.minCoins || probability === 0) return;
    const value = holdValue(game, coins);
    perStart.push({ coins, probability, value, fullProbability: holdOutcome(game.hold, cells, coins).fullProbability });
    trigger += probability;
    feature += probability * value;
  });
  return { base, trigger, perStart, feature, total: base.total + feature, buyValue: holdValue(game, game.hold.minCoins) };
}

/**
 * The smallest amount any win can pay, as a multiple of the total bet: the smallest line pay, or the
 * smallest feature (the fewest coins, each the least valuable). Above 1, no win ever pays less than was staked.
 */
export function smallestHoldWinMultiple(game: HoldGameConfig): number {
  const lowestCoin = Math.min(...game.hold.values.map((entry) => entry.value));
  return Math.min(smallestWinMultiple(game.base), (game.hold.minCoins * lowestCoin) / game.base.paylines.length);
}
