import type { Position } from "../engine/index.ts";
import type { Coin, HoldGameConfig, HoldResult } from "../engine/hold/index.ts";

/** The coins that started the feature, turned over to show what they are worth. */
export interface RevealBeat {
  readonly kind: "reveal";
  readonly coins: readonly Coin[];
  /** Coins on the board once they are showing. */
  readonly coinCount: number;
  /** Credits the coins on the board are worth so far. */
  readonly total: number;
}

/** One respin: the empty cells spin, and some of them may fill. */
export interface RespinBeat {
  readonly kind: "respin";
  /** 1 for the first respin, and so on. */
  readonly number: number;
  /** The cells that were empty when it began, in the order they are visited. */
  readonly empty: readonly Position[];
  readonly landed: readonly Coin[];
  /** Respins left after it, as the pips show them. */
  readonly respinsLeft: number;
  /** True when a coin landed, so the respins went back to the full number. */
  readonly refilled: boolean;
  readonly coinCount: number;
  /** Credits the coins on the board are worth after it (without the full-board prize). */
  readonly total: number;
}

/** A feature as a list of beats, in the order they are shown, worked out from a result that is already decided. */
export interface HoldPlan {
  readonly reveal: RevealBeat;
  readonly respins: readonly RespinBeat[];
  readonly full: boolean;
  readonly coinWin: number;
  readonly fullBoardWin: number;
  /** Everything the feature pays. */
  readonly win: number;
  /** The jackpot coins that landed, by name, in the order the ladder lights them. */
  readonly jackpots: readonly string[];
}

const key = ([reel, row]: Position): string => `${reel},${row}`;

/**
 * Stages a feature. It adds nothing to the outcome: it only reads off what each beat should show (which
 * cells are empty, how many respins are left, what the board is worth) so the view can be told, and a
 * test can check, without drawing anything.
 */
export function planHold(game: HoldGameConfig, feature: HoldResult): HoldPlan {
  const { reels, rows } = game.base;
  const occupied = new Set(feature.start.map((coin) => key(coin.position)));
  let total = feature.start.reduce((sum, coin) => sum + coin.win, 0);
  let coinCount = feature.start.length;

  const reveal: RevealBeat = { kind: "reveal", coins: feature.start, coinCount, total };
  const jackpots: string[] = feature.start.flatMap((coin) => (coin.jackpot === null ? [] : [coin.jackpot]));

  const respins: RespinBeat[] = feature.respins.map((respin, index) => {
    const empty: Position[] = [];
    for (let reel = 0; reel < reels; reel++) for (let row = 0; row < rows; row++) if (!occupied.has(key([reel, row]))) empty.push([reel, row]);
    for (const coin of respin.landed) {
      occupied.add(key(coin.position));
      total += coin.win;
      if (coin.jackpot !== null) jackpots.push(coin.jackpot);
    }
    coinCount += respin.landed.length;
    return { kind: "respin", number: index + 1, empty, landed: respin.landed, respinsLeft: respin.respinsLeft, refilled: respin.landed.length > 0, coinCount, total };
  });

  return { reveal, respins, full: feature.full, coinWin: feature.coinWin, fullBoardWin: feature.fullBoardWin, win: feature.win, jackpots };
}

/**
 * What a coin shows on its face: whole credits with separators up to 9,999, then thousands ("12K") and
 * millions ("1.5M"), so the biggest coins at the biggest bets still fit on a coin.
 */
export function coinLabel(credits: number): string {
  if (credits < 10_000) return new Intl.NumberFormat("en-US").format(credits);
  const thousands = Math.round(credits / 1_000);
  // 999,600 rounds to "1000K", which is a million written the long way.
  if (thousands < 1_000) return `${thousands}K`;
  return `${(credits / 1_000_000).toFixed(1)}M`;
}

/**
 * The jackpots in order of value, lowest first: their names, and what each is worth as a multiple of the
 * total bet. The full-board prize, which is the biggest, is last. This is the ladder the view draws.
 */
export function prizeLadder(game: HoldGameConfig): readonly { readonly name: string; readonly multiple: number; readonly fullBoard: boolean }[] {
  const lines = game.base.paylines.length;
  const coins = game.hold.values
    .filter((entry) => entry.jackpot !== undefined)
    .map((entry) => ({ name: entry.jackpot!, multiple: entry.value / lines, fullBoard: false }))
    .sort((a, b) => a.multiple - b.multiple);
  return [...coins, { name: game.hold.fullBoard.name, multiple: game.hold.fullBoard.value / lines, fullBoard: true }];
}

/** A jackpot coin's rank among the jackpot coins, lowest first (0 for the cheapest), or null for an ordinary coin. */
export function jackpotRank(game: HoldGameConfig, coin: Coin): number | null {
  if (coin.jackpot === null) return null;
  // The jackpots come first on the ladder, lowest first, so a jackpot's place on it is its rank.
  const rank = prizeLadder(game).findIndex((prize) => prize.name === coin.jackpot);
  return rank < 0 ? null : rank;
}
