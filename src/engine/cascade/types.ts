import type { PayTable, Position, SymbolId } from "../types.ts";

/**
 * A cascade game: a grid of pieces where connected groups of the same piece pay, then vanish so
 * the pieces above fall and new ones drop in. Each winning step raises a multiplier ("heat").
 * Pure data; build one with defineCascadeGame(), which validates it.
 */
export interface CascadeConfig {
  readonly id: string;
  readonly name: string;
  readonly columns: number;
  readonly rows: number;
  /**
   * Piece weights for each column, used for the opening fill and every refill. A piece's chance of
   * being drawn is its weight over the column's total weight. Include the scatter here.
   */
  readonly weights: readonly Readonly<Record<SymbolId, number>>[];
  /** Cluster pays by cluster size, in bet units. Every piece except the scatter needs an entry. */
  readonly pays: Readonly<Record<SymbolId, PayTable>>;
  /** The smallest connected group (up and down, left and right) that pays. */
  readonly minCluster: number;
  /** Bet units in a total bet: total bet = bet per unit x units. Pays are in units, so wins stay whole credits. */
  readonly units: number;
  /** Pays nothing itself and never joins a group; may trigger the feature. Null for a game without one. */
  readonly scatter: SymbolId | null;
  readonly feature: FeatureConfig | null;
  readonly heat: HeatConfig;
  /** The most one play can win, as a multiple of the total bet. The play ends the moment it is reached. */
  readonly maxWinMultiple: number;
}

export interface FeatureConfig {
  /** Scatters on the opening grid of a base spin that start the feature. */
  readonly trigger: number;
  readonly spins: number;
  /** Scatters on the opening grid of a feature spin that add spins, or null for no retrigger. */
  readonly retrigger: { readonly count: number; readonly spins: number } | null;
  /** The most spins one feature can run, retriggers included. */
  readonly maxSpins: number;
  /** Heat added after each winning step during the feature, or null to use the base game's step. */
  readonly heatStep: number | null;
  /**
   * What buying the feature outright costs, as a multiple of the total bet, or null if it cannot be
   * bought. The price is chosen from the feature's measured average value (see src/sim), so a buy returns about what a spin does.
   */
  readonly buyCost: number | null;
}

export interface HeatConfig {
  /** The multiplier at the start of a base spin and of a feature. */
  readonly start: number;
  /** Added after every winning step. */
  readonly step: number;
  readonly max: number;
}

export interface ClusterWin {
  readonly symbol: SymbolId;
  readonly size: number;
  readonly cells: readonly Position[];
  /** Credits this group paid, with the step's heat applied. */
  readonly win: number;
}

/** One winning step of a cascade. */
export interface CascadeStep {
  /** grid[column][row] when this step was evaluated, before the winners were removed. */
  readonly grid: readonly (readonly SymbolId[])[];
  readonly clusters: readonly ClusterWin[];
  /** The multiplier applied to this step. */
  readonly heat: number;
  /** Credits won in this step. */
  readonly win: number;
}

/** One spin: an opening fill and everything that cascaded from it. */
export interface RoundResult {
  /** Credits won by this spin. */
  readonly win: number;
  readonly stepCount: number;
  /** Scatters on the opening grid. */
  readonly scatters: number;
  readonly startHeat: number;
  /** The heat after the last winning step (what a feature carries into its next spin). */
  readonly endHeat: number;
  /** True if the win cap ended this spin early. */
  readonly capped: boolean;
  /** Only recorded when asked for (the simulator does not need them). */
  readonly openingGrid: readonly (readonly SymbolId[])[] | null;
  readonly steps: readonly CascadeStep[];
  /** The grid once everything has settled. */
  readonly finalGrid: readonly (readonly SymbolId[])[] | null;
}

export interface CascadeResult {
  readonly unitBet: number;
  readonly totalBet: number;
  readonly base: RoundResult;
  /** The feature's spins, or null if it was not triggered. */
  readonly feature: readonly RoundResult[] | null;
  /** Credits won over the whole play, base spin and feature together. */
  readonly totalWin: number;
  /** True if the win cap ended the play early. */
  readonly capped: boolean;
}

/** A feature bought outright: no base spin, only the feature's spins. */
export interface BoughtFeature {
  readonly unitBet: number;
  readonly totalBet: number;
  /** What it cost, in credits. */
  readonly price: number;
  readonly feature: readonly RoundResult[];
  /** What the feature won, never more than the cap. */
  readonly totalWin: number;
  readonly capped: boolean;
}

export interface PlayOptions {
  /** Keep every grid and step in the result, for drawing. Off by default. */
  readonly record?: boolean;
}
