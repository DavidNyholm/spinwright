import { columnFall } from "../engine/cascade/index.ts";
import { fallProgress, rebound } from "./animator.ts";

/**
 * The choreography of falling pieces as plain numbers: which piece falls from where to where, when
 * it starts and how long it takes. Nothing here draws; the view runs these plans, and the tests run
 * them against each other to check pieces never fall into one another.
 */

export interface BoardGeometry {
  readonly columns: number;
  readonly rows: number;
  /** Distance between the centres of neighbouring rows. */
  readonly step: number;
  /** The y of the centre of row 0. */
  readonly top: number;
}

export const FALL = {
  baseMs: 190,
  /** Extra time per row fallen, as a multiple of the square root of the rows. */
  perRootMs: 95,
  columnStaggerMs: 32,
  pieceStaggerMs: 22,
  /** New pieces wait this much longer than the survivors they fall behind. */
  spawnDelayMs: 40,
  /** How far a piece bounces after landing, in stage units. Small enough never to touch the piece above. */
  bounce: 7,
} as const;

export interface Drop {
  readonly column: number;
  /** The row a piece lands in. */
  readonly toRow: number;
  /** The row a surviving piece falls from, or null for a new piece dropping in from above. */
  readonly fromRow: number | null;
  readonly fromY: number;
  readonly toY: number;
  readonly delayMs: number;
  readonly durationMs: number;
}

export const centreY = (geometry: BoardGeometry, row: number): number => geometry.top + row * geometry.step;

/** How long a fall of `distance` takes: longer falls take longer, but not in proportion. */
export function fallDuration(distance: number, step: number): number {
  return FALL.baseMs + FALL.perRootMs * Math.sqrt(Math.abs(distance) / step);
}

function makeDrop(geometry: BoardGeometry, column: number, toRow: number, fromRow: number | null, fromY: number, delayMs: number): Drop {
  const toY = centreY(geometry, toRow);
  return { column, toRow, fromRow, fromY, toY, delayMs, durationMs: fallDuration(toY - fromY, geometry.step) };
}

/** A whole new fill dropping in from above the board: bottom pieces first, left columns first. */
export function planDropIn(geometry: BoardGeometry): Drop[] {
  const drops: Drop[] = [];
  for (let column = 0; column < geometry.columns; column++) {
    for (let row = 0; row < geometry.rows; row++) {
      const delay = column * FALL.columnStaggerMs + (geometry.rows - 1 - row) * FALL.pieceStaggerMs;
      const fromY = centreY(geometry, row) - (geometry.rows + 1) * geometry.step;
      drops.push(makeDrop(geometry, column, row, null, fromY, delay));
    }
  }
  return drops;
}

/**
 * After some pieces vanish (`removed[column][row]`): the survivors fall into the gaps and new pieces
 * drop in above them. Survivors start before the new pieces that follow them down.
 */
export function planRefill(geometry: BoardGeometry, removed: readonly (readonly boolean[])[]): Drop[] {
  const drops: Drop[] = [];
  for (let column = 0; column < geometry.columns; column++) {
    const plan = columnFall(removed[column]!);
    for (const { from, to } of plan.moves) {
      const delay = column * FALL.columnStaggerMs + (geometry.rows - 1 - to) * FALL.pieceStaggerMs;
      drops.push(makeDrop(geometry, column, to, from, centreY(geometry, from), delay));
    }
    for (let row = 0; row < plan.spawned; row++) {
      const delay = column * FALL.columnStaggerMs + (geometry.rows - 1 - row) * FALL.pieceStaggerMs + FALL.spawnDelayMs;
      drops.push(makeDrop(geometry, column, row, null, centreY(geometry, row) - (plan.spawned + 1) * geometry.step, delay));
    }
  }
  return drops;
}

/** Where a dropping piece is `elapsedMs` after the plan started: waiting, falling, bouncing, or at rest. */
export function dropY(drop: Drop, elapsedMs: number, bounce: number = FALL.bounce): number {
  const u = Math.min(1, Math.max(0, (elapsedMs - drop.delayMs) / drop.durationMs));
  return drop.fromY + (drop.toY - drop.fromY) * fallProgress(u) - rebound(u, bounce);
}
