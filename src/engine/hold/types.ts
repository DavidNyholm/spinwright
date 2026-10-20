import type { GameConfig, Position, SpinResult, SymbolId } from "../types.ts";

/** One kind of coin: what it pays and how often it is the one drawn. */
export interface CoinEntry {
  /** What the coin pays, as a multiple of the bet per line, like a line pay: a whole number, so wins are whole credits. */
  readonly value: number;
  /** How likely this coin is, relative to the others: a whole number. */
  readonly weight: number;
  /** Set for the jackpot coins, which are shown by name instead of by amount. */
  readonly jackpot?: string;
}

/**
 * The hold-and-win feature. Coins on the opening grid lock in place, and then every empty cell gets
 * a chance to fill with a coin on each respin. A new coin sets the respins back to the full number;
 * a respin that fills nothing uses one up. The feature ends when none are left or the board is full,
 * and pays the value of every coin on it (plus a prize if the board is full).
 */
export interface HoldFeature {
  /** The symbol that is a coin on the reels. It must be the base game's scatter, which pays nothing by itself. */
  readonly coin: SymbolId;
  /** Coins on the opening grid that start the feature. */
  readonly minCoins: number;
  /** Respins at the start and after every respin that landed a coin. */
  readonly respins: number;
  /** What each coin is worth, by weight. The same coins are drawn for the opening grid and for every respin. */
  readonly values: readonly CoinEntry[];
  /** The chance that an empty cell fills on a respin: `numerator` in `denominator`, each cell on its own. */
  readonly landing: { readonly numerator: number; readonly denominator: number };
  /** Paid on top of the coins when every cell of the board holds one. A multiple of the bet per line. */
  readonly fullBoard: { readonly name: string; readonly value: number };
  /**
   * What buying the feature outright costs, as a multiple of the total bet, or null if it cannot be
   * bought. A bought feature starts with exactly `minCoins` coins, in cells chosen at random.
   */
  readonly buyCost: number | null;
}

/**
 * A game whose bonus is hold and win. The base game is an ordinary line game (it is played, and its
 * return worked out exactly, by the line engine); its scatter is the coin, which pays nothing on its
 * own, and it has no free spins. Build one with defineHoldGame().
 */
export interface HoldGameConfig {
  readonly base: GameConfig;
  readonly hold: HoldFeature;
}

/** A coin on the board. */
export interface Coin {
  readonly position: Position;
  /** Multiple of the bet per line. */
  readonly value: number;
  /** The jackpot's name, or null for an ordinary coin. */
  readonly jackpot: string | null;
  /** Credits. */
  readonly win: number;
}

/** One respin. */
export interface HoldRespin {
  /** The coins that landed on it, in the order the cells were visited (reel by reel, top to bottom). */
  readonly landed: readonly Coin[];
  /** Respins still to play after this one: the full number again if a coin landed, one fewer if not, 0 once the board is full. */
  readonly respinsLeft: number;
  /** Coins on the board once it is over. */
  readonly coinCount: number;
}

export interface HoldResult {
  /** The coins the feature began with. */
  readonly start: readonly Coin[];
  readonly respins: readonly HoldRespin[];
  /** Every coin on the board at the end, in the order they landed. */
  readonly coins: readonly Coin[];
  /** True if every cell holds a coin. */
  readonly full: boolean;
  /** Credits from the coins. */
  readonly coinWin: number;
  /** Credits from the full-board prize: 0 unless the board is full. */
  readonly fullBoardWin: number;
  /** Everything the feature paid: the coins and the full-board prize. */
  readonly win: number;
}

/** A whole bet: one spin and, if it opens with enough coins, the feature that follows. */
export interface HoldRoundResult {
  readonly lineBet: number;
  readonly totalBet: number;
  readonly base: SpinResult;
  readonly feature: HoldResult | null;
  /** Everything the bet won: the spin's lines and the feature. */
  readonly totalWin: number;
}

/** A feature bought outright: no opening spin, only the feature, which starts with the fewest coins that trigger it. */
export interface BoughtHold {
  readonly lineBet: number;
  readonly totalBet: number;
  /** What it cost, in credits. */
  readonly price: number;
  readonly feature: HoldResult;
  readonly totalWin: number;
}
