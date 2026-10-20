/** Identifies a symbol. The engine is theme-agnostic: art and display names live in the UI layer. */
export type SymbolId = string;

/**
 * Payout by symbol count. Keys are counts, values are integer multipliers.
 * A count that has no entry pays the entry for the largest key below it
 * ("N or more"); a count below the smallest key pays nothing. See lookupPay.
 */
export type PayTable = Readonly<Record<number, number>>;

/** A grid cell, as [reel, row]. Reel 0 is leftmost, row 0 is the top. */
export type Position = readonly [reel: number, row: number];

/**
 * A free-spins feature. Scatters on the opening spin start it; every wild that lands during it is
 * locked in place until it ends, so the board fills up spin by spin.
 */
export interface FeatureConfig {
  /**
   * Free spins awarded by that many scatters on the opening spin, read like a pay table ("N or
   * more"). The smallest key is the number of scatters that triggers the feature.
   */
  readonly spins: PayTable;
  /** The reel strips used on free spins. They are their own, so the feature can be richer in wilds than the base game. */
  readonly strips: readonly (readonly SymbolId[])[];
  /** Free spins added when that many scatters land on a free spin, read like a pay table. */
  readonly retrigger: PayTable;
  /** The most free spins one feature can reach, retriggers included. */
  readonly maxSpins: number;
}

/**
 * Pure data describing a slot game. Build one with defineGame(), which validates it.
 * Every other engine function assumes the config has already been validated.
 */
export interface GameConfig {
  readonly id: string;
  readonly name: string;
  readonly reels: number;
  readonly rows: number;
  /** One looping strip per reel. A spin picks one stop per reel; the window shows `rows` symbols from the stop. */
  readonly strips: readonly (readonly SymbolId[])[];
  /** Each payline gives, per reel, the row it passes through. */
  readonly paylines: readonly (readonly number[])[];
  /** Line pays, as multiples of the bet per line. Includes the wild's own table if there is a wild. */
  readonly pays: Readonly<Record<SymbolId, PayTable>>;
  /** Substitutes for every symbol except the scatter. If set, `pays` must contain its table (may be empty). */
  readonly wild: SymbolId | null;
  /** Pays anywhere on the grid by count, as multiples of the total bet. */
  readonly scatter: { readonly symbol: SymbolId; readonly pays: PayTable } | null;
  /** The free-spins feature, or null for a game with none. Needs a wild and a scatter. */
  readonly feature: FeatureConfig | null;
  /** The most a whole round (the spin and its feature) can win, as a multiple of the total bet, or null for no limit. */
  readonly maxWinMultiple: number | null;
}

export interface LineWin {
  /** Index into GameConfig.paylines. */
  readonly line: number;
  /** The symbol the win is paid as (the wild only when the wild's own table wins). */
  readonly symbol: SymbolId;
  readonly count: number;
  /** Multiple of the bet per line. */
  readonly multiplier: number;
  /** Credits. */
  readonly win: number;
  /** The cells that form the win, left to right (for highlighting). */
  readonly positions: readonly Position[];
}

export interface ScatterWin {
  readonly symbol: SymbolId;
  readonly count: number;
  /** Multiple of the total bet. */
  readonly multiplier: number;
  readonly win: number;
  readonly positions: readonly Position[];
}

export interface SpinResult {
  /** Credits bet per payline. */
  readonly lineBet: number;
  /** lineBet times the number of paylines. */
  readonly totalBet: number;
  /** The chosen stop on each reel. */
  readonly stops: readonly number[];
  /** grid[reel][row] */
  readonly grid: readonly (readonly SymbolId[])[];
  readonly lineWins: readonly LineWin[];
  readonly scatterWin: ScatterWin | null;
  /** Credits won, line wins plus scatter win. */
  readonly totalWin: number;
}
