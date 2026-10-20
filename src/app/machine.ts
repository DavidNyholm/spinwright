import type { Sfx } from "../audio/sfx.ts";
import type { Rng } from "../engine/index.ts";
import type { RulesDoc } from "./rules.ts";

/** What a machine may show on the page while a round plays. */
export interface RoundHooks {
  /** Shows a win total in credits; call it as wins add up. `animateMs` lets the counter roll up. */
  setWin(total: number, animateMs?: number): void;
  setMessage(text: string): void;
}

/** A round whose outcome is already decided, ready to be shown. */
export interface PlannedRound {
  readonly totalBet: number;
  readonly totalWin: number;
  /** For the QA panel: a plain description of the outcome. */
  readonly summary: unknown;
  /** Plays the animation and shows the wins. Resolves once everything has settled. */
  present(hooks: RoundHooks, options: { turbo: boolean }): Promise<void>;
}

/**
 * A playable machine: one game and the way it looks and moves. The page around it (wallet, bet,
 * spin button, readouts) is the same for every machine and only talks to this interface.
 */
export interface Machine {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  /** Total bet = bet per unit x units. */
  readonly units: number;
  /** What a unit is called in the small line under the bet, such as "line". */
  readonly unitName: string;
  /** Reel counts for the QA panel's forced stops, or null if the machine cannot force an outcome. */
  readonly forcedStopLimits: readonly number[] | null;
  readonly idleMessage: string;
  /** What the machine's bonus is called in the buy bar ("free spins"), or null if it has none to buy. */
  readonly bonusName: string | null;
  /** The machine's "how it works" page, built from its own configuration. */
  rules(): RulesDoc;

  /** Builds the machine's stage inside `host` and returns its size in stage units. */
  mount(host: HTMLElement, options: { reduceMotion: boolean; sfx: Sfx }): Promise<{ width: number; height: number }>;
  /** Decides a round without drawing anything. `forcedStops` is QA-only and may be ignored. */
  plan(unitBet: number, rng: Rng, forcedStops: readonly number[] | null): PlannedRound;
  /** What buying the bonus costs at this bet, in credits, or null if the machine has none to buy. */
  bonusPrice(unitBet: number): number | null;
  /**
   * Decides a bought bonus without drawing anything, as `plan` does for a spin. The round's `totalBet`
   * is the price, so the page settles it like any other bet.
   */
  planBonus(unitBet: number, rng: Rng): PlannedRound;
  /** Brings a running round to its end quickly. */
  quickStop(): void;
  /** Clears any win highlights left on screen, because a new round is starting. */
  clear(): void;
  /** State for QA scripts, shown only with ?debug. */
  qa(): Record<string, unknown>;
  dispose(): void;
}
