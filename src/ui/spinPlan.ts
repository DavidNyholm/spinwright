import type { SymbolId } from "../engine/index.ts";
import { FEEL } from "./reelMotion.ts";

/** How long a reel holds on, spinning, while the player waits to see if it brings the scatter that starts a feature. */
export const ANTICIPATION_MS = 1000;

/** How a spin is staged, worked out from an outcome that is already decided. */
export interface SpinPlan {
  /** How long each reel spins before it starts to land, in milliseconds (before turbo scaling). */
  readonly spinMs: readonly number[];
  /** Reels that hold on because one more scatter would start a feature. */
  readonly anticipating: readonly boolean[];
  /** How many scatters each reel lands on, so each can be chimed as it appears. */
  readonly scatters: readonly number[];
}

/**
 * Stages a spin. The reels normally stop left to right, one stagger apart. When all but one of the
 * scatters a feature needs have already landed, every reel after that spins on for an extra
 * moment: the wait is the tension. It is staged from the grid the reels will land on, which is
 * known before they move, so nothing about the outcome depends on it.
 */
export function planSpin(grid: readonly (readonly SymbolId[])[], scatter: SymbolId | null, needed: number | null): SpinPlan {
  const scatters = grid.map((column) => (scatter === null ? 0 : column.filter((symbol) => symbol === scatter).length));
  const spinMs: number[] = [];
  const anticipating: boolean[] = [];
  let landed = 0;
  grid.forEach((_, reel) => {
    const holds = needed !== null && landed < needed && landed >= needed - 1;
    anticipating.push(holds);
    spinMs.push(reel === 0 ? FEEL.minSpinMs : spinMs[reel - 1]! + FEEL.stopStaggerMs + (holds ? ANTICIPATION_MS : 0));
    landed += scatters[reel]!;
  });
  // A reel that holds on does so before it lands, so the extra time belongs to the reel itself, not the one after it.
  return { spinMs, anticipating, scatters };
}
