import { defineGame } from "../engine/index.ts";
import { defineHoldGame } from "../engine/hold/index.ts";
import { TWENTY_LINES } from "./paylines.ts";

/**
 * Mint: a 5x3, twenty-line machine whose bonus is hold and win. A theme-free game: the engine only
 * sees symbol ids.
 *   L1-L4  low symbols     H1-H3  high symbols
 *   C      the coin: pays nothing on its own, but six or more anywhere on the opening spin start the
 *          hold and win. (There is no wild.)
 *
 * The base game is an ordinary line game (the coin is its scatter, with no pay), played and worked out
 * exactly by the line engine. Line pays are multiples of the bet per line, and there are twenty lines,
 * so a win of 20 returns the whole bet. As on Clockwork, no win ever pays less than the bet: Nine-style
 * low symbols pay from three in a row at 22 (1.1 times the bet) or more, and the lowest symbol pays only
 * from four. The coin feature's smallest outcome is six of the cheapest coin, which is three times the bet.
 *
 * Hold and win: the coins on the opening grid lock and show their values, and every empty cell then has
 * a one-in-fifteen chance of filling with a coin on each respin. A new coin sets the respins back to
 * three; a respin that fills nothing uses one up. The feature pays every coin on the board, and a
 * full board (all fifteen cells) pays the Grand on top. Coin values are multiples of the total bet,
 * written below as times-the-bet and stored as bets per line (times twenty), so wins are whole credits.
 * Three of the coins are named jackpots: Mini, Minor and Major.
 *
 * About 62.5% of the return comes from the base game's lines and 33.5% from the hold and win. The
 * hold and win is solved exactly (see src/engine/hold/analytic.ts), so unlike Clockwork's free spins the
 * whole return is a calculation, and the simulator is a check on it. Change the strips, the pays, the
 * coins or the landing chance and the numbers move; test/mint.test.ts and the lobby's figure say when.
 */

const strip = (symbols: string): string[] => symbols.trim().split(/\s+/);

const LINES = TWENTY_LINES.length;
/** A coin worth `multiple` times the total bet, in bets per line. */
const times = (multiple: number): number => multiple * LINES;

export const mint = defineHoldGame({
  base: defineGame({
    id: "mint",
    name: "Mint",
    reels: 5,
    rows: 3,
    strips: [
      strip("H1 C C L2 L4 H2 L1 L4 L3 L4 L2 H2 L1 L3 H1 L3 H3 L1 H1 H2 L3 C C L2 L4 L1 L2 L1 L3 L2 H1 L4 L2 L3 L4 L1 L2 L3 H3 L1"),
      strip("H2 L1 L3 L2 C C L3 H3 L4 H1 L4 L3 H3 L1 L2 H2 L1 L2 L3 L2 H1 L1 C C L3 L4 L1 L2 L4 L2 H2 L2 L1 L4 L3 H1 L4 L3 H1 L1"),
      strip("H2 L3 L2 L4 L2 L3 L4 C C L4 H2 L2 H1 L1 L3 L1 L3 L4 L3 L1 L3 L2 L1 C C L3 H1 L1 H3 H2 L2 H1 H3 L2 L4 L1 H1 L2 L4 L1"),
      strip("L2 H2 L4 C C L1 H1 H3 L2 L3 L4 H1 H2 L2 H2 L4 L2 L1 H3 H1 L4 L1 L3 L2 C C L3 L4 H1 L3 L1 L3 L2 L4 L1 L3 L1 L2 L3 L1"),
      strip("L4 H1 L4 L1 H1 L2 C C L1 L2 L3 L2 L3 L4 L1 H2 H1 L3 H2 L4 L1 H1 L1 L3 H3 C C L1 L4 L3 L4 L2 H2 L2 L3 L2 L3 L1 L2 H3"),
    ],
    paylines: TWENTY_LINES,
    pays: {
      L1: { 4: 28, 5: 130 },
      L2: { 3: 22, 4: 40, 5: 220 },
      L3: { 3: 22, 4: 52, 5: 280 },
      L4: { 3: 24, 4: 70, 5: 420 },
      H1: { 3: 36, 4: 130, 5: 650 },
      H2: { 3: 60, 4: 260, 5: 1300 },
      H3: { 3: 120, 4: 600, 5: 3000 },
    },
    wild: null,
    // The coin: it breaks a line like a scatter does, and pays nothing by itself.
    scatter: { symbol: "C", pays: {} },
    feature: null,
    maxWinMultiple: null,
  }),
  hold: {
    coin: "C",
    minCoins: 6,
    respins: 3,
    // What a coin is worth, by weight out of 1,000. The jackpot coins are 5% of all coins; an ordinary coin averages 2.2 times the bet.
    values: [
      { value: times(0.5), weight: 260 },
      { value: times(1), weight: 270 },
      { value: times(2), weight: 200 },
      { value: times(3), weight: 100 },
      { value: times(5), weight: 80 },
      { value: times(8), weight: 40 },
      { value: times(10), weight: 35, jackpot: "Mini" },
      { value: times(25), weight: 12, jackpot: "Minor" },
      { value: times(100), weight: 3, jackpot: "Major" },
    ],
    landing: { numerator: 1, denominator: 15 },
    fullBoard: { name: "Grand", value: times(500) },
    // A bought feature is worth 29.7x the bet on average, so 31x returns 95.8%: a little under the machine itself.
    buyCost: 31,
  },
});
