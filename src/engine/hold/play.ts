import { countSymbol } from "../feature.ts";
import { nextInt } from "../rng.ts";
import type { Rng } from "../rng.ts";
import { checkLineBet, spin, spinFromStops } from "../spin.ts";
import type { Position, SpinResult } from "../types.ts";
import type { BoughtHold, Coin, HoldFeature, HoldGameConfig, HoldResult, HoldRespin, HoldRoundResult } from "./types.ts";

/**
 * The order the random numbers are drawn in, so a result can be replayed from a seed and a test can
 * work one out by hand:
 *  - A spin's own stops come first, one per reel, as in every line game.
 *  - The coins that start the feature then each draw a value, reel by reel and top to bottom.
 *  - Each respin visits the empty cells in that same order. A cell draws whether it fills; if it does,
 *    it draws the coin's value straight away, before the next cell is looked at.
 *  - A bought feature first picks its starting cells (a partial shuffle, one draw per cell chosen),
 *    then draws their values in reel-by-reel order.
 */

const cellPosition = (game: HoldGameConfig, cell: number): Position => [Math.floor(cell / game.base.rows), cell % game.base.rows];

function totalWeight(hold: HoldFeature): number {
  let total = 0;
  for (const entry of hold.values) total += entry.weight;
  return total;
}

/** Draws one coin for `position`: a uniform draw over the total weight, walked down the list. */
function drawCoin(hold: HoldFeature, weight: number, rng: Rng, position: Position, lineBet: number): Coin {
  let pick = nextInt(rng, weight);
  for (const entry of hold.values) {
    if (pick < entry.weight) return { position, value: entry.value, jackpot: entry.jackpot ?? null, win: entry.value * lineBet };
    pick -= entry.weight;
  }
  throw new Error("unreachable: a draw below the total weight always lands on an entry");
}

/** Plays the feature from the coins it starts with: respins until none are left or the board is full. */
function playFeature(game: HoldGameConfig, rng: Rng, lineBet: number, start: readonly Coin[]): HoldResult {
  const { hold } = game;
  const cells = game.base.reels * game.base.rows;
  const weight = totalWeight(hold);
  const { numerator, denominator } = hold.landing;

  const filled = new Array<boolean>(cells).fill(false);
  for (const coin of start) filled[coin.position[0] * game.base.rows + coin.position[1]] = true;
  const coins: Coin[] = [...start];
  const respins: HoldRespin[] = [];
  let left = hold.respins;

  while (left > 0 && coins.length < cells) {
    const landed: Coin[] = [];
    for (let cell = 0; cell < cells; cell++) {
      if (filled[cell]) continue;
      if (nextInt(rng, denominator) >= numerator) continue;
      filled[cell] = true;
      landed.push(drawCoin(hold, weight, rng, cellPosition(game, cell), lineBet));
    }
    coins.push(...landed);
    left = landed.length > 0 ? hold.respins : left - 1;
    const full = coins.length === cells;
    respins.push({ landed, respinsLeft: full ? 0 : left, coinCount: coins.length });
  }

  const full = coins.length === cells;
  let coinWin = 0;
  for (const coin of coins) coinWin += coin.win;
  const fullBoardWin = full ? hold.fullBoard.value * lineBet : 0;
  return { start, respins, coins, full, coinWin, fullBoardWin, win: coinWin + fullBoardWin };
}

/** The coins an opening spin starts the feature with: each coin symbol on the grid draws its value. */
function coinsOnGrid(game: HoldGameConfig, rng: Rng, spinResult: SpinResult): Coin[] {
  const { hold } = game;
  const weight = totalWeight(hold);
  const start: Coin[] = [];
  spinResult.grid.forEach((column, reel) =>
    column.forEach((symbol, row) => {
      if (symbol === hold.coin) start.push(drawCoin(hold, weight, rng, [reel, row], spinResult.lineBet));
    }),
  );
  return start;
}

/** Finishes a round whose opening spin has been decided: plays the feature if the spin started it. */
function finishRound(game: HoldGameConfig, rng: Rng, base: SpinResult): HoldRoundResult {
  const triggered = countSymbol(base.grid, game.hold.coin) >= game.hold.minCoins;
  const feature = triggered ? playFeature(game, rng, base.lineBet, coinsOnGrid(game, rng, base)) : null;
  return { lineBet: base.lineBet, totalBet: base.totalBet, base, feature, totalWin: base.totalWin + (feature?.win ?? 0) };
}

/** Plays a whole bet from random stops. The outcome, every respin included, is final before any animation. */
export function playHoldRound(game: HoldGameConfig, rng: Rng, lineBet: number): HoldRoundResult {
  return finishRound(game, rng, spin(game.base, rng, lineBet));
}

/** The same, with the opening spin's stops chosen (for QA and tests); the feature is still drawn from `rng`. */
export function playHoldRoundFromStops(game: HoldGameConfig, rng: Rng, stops: readonly number[], lineBet: number): HoldRoundResult {
  return finishRound(game, rng, spinFromStops(game.base, stops, lineBet));
}

/** What buying the feature costs at this bet, in credits, or null if the game's feature cannot be bought. */
export function holdPrice(game: HoldGameConfig, lineBet: number): number | null {
  const { buyCost } = game.hold;
  return buyCost === null ? null : buyCost * lineBet * game.base.paylines.length;
}

/** `count` distinct cells chosen at random, in reel-by-reel order: a partial shuffle, one draw per cell chosen. */
function pickCells(cells: number, count: number, rng: Rng): number[] {
  const pool = Array.from({ length: cells }, (_, cell) => cell);
  for (let i = 0; i < count; i++) {
    const j = i + nextInt(rng, cells - i);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/** The feature started from `count` coins in cells chosen at random: what a bought feature is, and what the simulator measures. */
function playFromCount(game: HoldGameConfig, rng: Rng, lineBet: number, count: number): HoldResult {
  const cells = game.base.reels * game.base.rows;
  const weight = totalWeight(game.hold);
  const start = pickCells(cells, count, rng).map((cell) => drawCoin(game.hold, weight, rng, cellPosition(game, cell), lineBet));
  return playFeature(game, rng, lineBet, start);
}

/** Buys the feature and plays it. The outcome, every respin of it, is final before anything is shown. */
export function buyHold(game: HoldGameConfig, rng: Rng, lineBet: number): BoughtHold {
  checkLineBet(lineBet);
  const price = holdPrice(game, lineBet);
  if (price === null) throw new Error(`${game.base.id}'s feature cannot be bought`);
  const feature = playFromCount(game, rng, lineBet, game.hold.minCoins);
  return { lineBet, totalBet: lineBet * game.base.paylines.length, price, feature, totalWin: feature.win };
}

/**
 * Plays the feature on its own, as if an opening spin had just landed `coins` coins, and returns what
 * it won in credits. The simulator uses it to measure the feature's value directly.
 */
export function playHoldSession(game: HoldGameConfig, rng: Rng, lineBet: number, coins: number): number {
  checkLineBet(lineBet);
  const cells = game.base.reels * game.base.rows;
  if (!Number.isInteger(coins) || coins < game.hold.minCoins || coins > cells) {
    throw new RangeError(`${coins} coins do not start ${game.base.id}'s feature (it takes ${game.hold.minCoins} to ${cells})`);
  }
  return playFromCount(game, rng, lineBet, coins).win;
}
