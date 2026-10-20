import { lookupPay } from "../config.ts";
import { nextInt } from "../rng.ts";
import type { Rng } from "../rng.ts";
import type { SymbolId } from "../types.ts";
import type { CascadeConfig } from "./types.ts";

/**
 * Grids are flat Uint8Arrays of piece indices, column by column: the cell at (column, row) is
 * grid[column * rows + row], and row 0 is the top. Pieces fall towards higher rows.
 */

/** A connected group of the same piece, as cell indices. */
export interface RawCluster {
  readonly symbol: number;
  readonly cells: readonly number[];
}

/** Scratch space reused by every call, so a simulated spin allocates almost nothing. */
interface Workspace {
  readonly grid: Uint8Array;
  readonly visited: Uint8Array;
  readonly stack: Int32Array;
  readonly members: Int32Array;
  readonly removed: Uint8Array;
}

export interface CompiledCascade {
  readonly config: CascadeConfig;
  /** Piece index -> piece id. */
  readonly symbols: readonly SymbolId[];
  /** The scatter's piece index, or -1 if there is none. */
  readonly scatterIndex: number;
  /** Per column: the piece index of each weight entry, and the running total of the weights. */
  readonly columnPieces: readonly Uint8Array[];
  readonly columnCumulative: readonly Float64Array[];
  /** pay[piece][size] in bet units, for sizes 0..cells (0 below the smallest cluster). */
  readonly pay: readonly Int32Array[];
  readonly cells: number;
  readonly work: Workspace;
}

const compiled = new WeakMap<CascadeConfig, CompiledCascade>();

/** Turns a validated config into the numeric form the engine plays with. Cached per config object. */
export function compileCascade(config: CascadeConfig): CompiledCascade {
  const cached = compiled.get(config);
  if (cached !== undefined) return cached;

  const symbols: SymbolId[] = [];
  const indexOf = new Map<SymbolId, number>();
  const intern = (symbol: SymbolId): number => {
    let index = indexOf.get(symbol);
    if (index === undefined) {
      index = symbols.length;
      symbols.push(symbol);
      indexOf.set(symbol, index);
    }
    return index;
  };
  for (const column of config.weights) for (const symbol of Object.keys(column)) intern(symbol);

  const columnPieces: Uint8Array[] = [];
  const columnCumulative: Float64Array[] = [];
  for (const column of config.weights) {
    const entries = Object.entries(column);
    columnPieces.push(Uint8Array.from(entries, ([symbol]) => indexOf.get(symbol)!));
    let running = 0;
    columnCumulative.push(Float64Array.from(entries, ([, weight]) => (running += weight)));
  }

  const cells = config.columns * config.rows;
  const pay = symbols.map((symbol) => {
    const table = config.pays[symbol];
    const bySize = new Int32Array(cells + 1);
    if (table !== undefined) {
      for (let size = config.minCluster; size <= cells; size++) bySize[size] = lookupPay(table, size);
    }
    return bySize;
  });

  const result: CompiledCascade = {
    config,
    symbols,
    scatterIndex: config.scatter === null ? -1 : indexOf.get(config.scatter)!,
    columnPieces,
    columnCumulative,
    pay,
    cells,
    work: {
      grid: new Uint8Array(cells),
      visited: new Uint8Array(cells),
      stack: new Int32Array(cells),
      members: new Int32Array(cells),
      removed: new Uint8Array(cells),
    },
  };
  compiled.set(config, result);
  return result;
}

/** Draws one piece for `column`, by weight. */
export function drawPiece(game: CompiledCascade, rng: Rng, column: number): number {
  const cumulative = game.columnCumulative[column]!;
  const target = nextInt(rng, cumulative[cumulative.length - 1]!);
  let entry = 0;
  while (target >= cumulative[entry]!) entry++;
  return game.columnPieces[column]![entry]!;
}

/** Fills the whole grid: columns left to right, and within a column from the top down. */
export function fillGrid(game: CompiledCascade, rng: Rng, grid: Uint8Array): void {
  const { columns, rows } = game.config;
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) grid[column * rows + row] = drawPiece(game, rng, column);
  }
}

export function countPiece(grid: Uint8Array, piece: number): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === piece) count++;
  return count;
}

/**
 * Every connected group (up, down, left, right) of the same piece with at least `minCluster`
 * cells. The scatter never forms a group. Groups come back in order of their first cell.
 */
export function findClusters(game: CompiledCascade, grid: Uint8Array): RawCluster[] {
  const { columns, rows, minCluster } = game.config;
  const { visited, stack, members } = game.work;
  visited.fill(0);
  const clusters: RawCluster[] = [];

  for (let start = 0; start < game.cells; start++) {
    if (visited[start] === 1) continue;
    const piece = grid[start]!;
    visited[start] = 1;
    if (piece === game.scatterIndex) continue;

    let top = 0;
    let size = 0;
    stack[top++] = start;
    while (top > 0) {
      const cell = stack[--top]!;
      members[size++] = cell;
      const row = cell % rows;
      const column = (cell - row) / rows;
      // Up, down, left, right. A neighbour joins the group if it is the same piece and unseen.
      if (row > 0 && visited[cell - 1] === 0 && grid[cell - 1] === piece) {
        visited[cell - 1] = 1;
        stack[top++] = cell - 1;
      }
      if (row < rows - 1 && visited[cell + 1] === 0 && grid[cell + 1] === piece) {
        visited[cell + 1] = 1;
        stack[top++] = cell + 1;
      }
      if (column > 0 && visited[cell - rows] === 0 && grid[cell - rows] === piece) {
        visited[cell - rows] = 1;
        stack[top++] = cell - rows;
      }
      if (column < columns - 1 && visited[cell + rows] === 0 && grid[cell + rows] === piece) {
        visited[cell + rows] = 1;
        stack[top++] = cell + rows;
      }
    }
    if (size >= minCluster) clusters.push({ symbol: piece, cells: Array.from(members.subarray(0, size)) });
  }
  return clusters;
}

/**
 * Removes the cells of `clusters`, lets everything above fall to fill the gaps, and draws new
 * pieces for the space left at the top of each column. New pieces are drawn column by column from
 * the left, and within a column from the top down.
 */
export function removeAndRefill(game: CompiledCascade, rng: Rng, grid: Uint8Array, clusters: readonly RawCluster[]): void {
  const { columns, rows } = game.config;
  const { removed } = game.work;
  removed.fill(0);
  for (const cluster of clusters) for (const cell of cluster.cells) removed[cell] = 1;

  for (let column = 0; column < columns; column++) {
    const base = column * rows;
    let write = rows - 1;
    for (let row = rows - 1; row >= 0; row--) {
      if (removed[base + row] === 0) grid[base + write--] = grid[base + row]!;
    }
    for (let row = 0; row <= write; row++) grid[base + row] = drawPiece(game, rng, column);
  }
}

export interface ColumnFall {
  /** Surviving pieces that drop: from row `from` to row `to` (always lower down). */
  readonly moves: readonly { readonly from: number; readonly to: number }[];
  /** How many new pieces enter at the top; they fill rows 0 to spawned - 1. */
  readonly spawned: number;
}

/**
 * What happens in one column when some of its cells are removed: which survivors drop where, and
 * how many new pieces arrive. The animation uses this to move the pieces the same way the engine does.
 */
export function columnFall(removed: readonly boolean[]): ColumnFall {
  const moves: { from: number; to: number }[] = [];
  let write = removed.length - 1;
  for (let row = removed.length - 1; row >= 0; row--) {
    if (removed[row]) continue;
    if (write !== row) moves.push({ from: row, to: write });
    write--;
  }
  return { moves, spawned: write + 1 };
}

/** The grid as piece ids, grid[column][row], for results that are drawn or inspected. */
export function toSymbolGrid(game: CompiledCascade, grid: Uint8Array): SymbolId[][] {
  const { columns, rows } = game.config;
  const result: SymbolId[][] = [];
  for (let column = 0; column < columns; column++) {
    const symbols: SymbolId[] = [];
    for (let row = 0; row < rows; row++) symbols.push(game.symbols[grid[column * rows + row]!]!);
    result.push(symbols);
  }
  return result;
}
