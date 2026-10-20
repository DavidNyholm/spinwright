import type { CascadeConfig } from "../engine/cascade/index.ts";
import type { GameConfig } from "../engine/index.ts";
import { classic } from "./classic.ts";
import { crucible } from "./crucible.ts";

/** A playable game: which kind of engine runs it, and its rules. */
export type GameEntry =
  | { readonly kind: "lines"; readonly config: GameConfig }
  | { readonly kind: "cascade"; readonly config: CascadeConfig };

const entries: readonly GameEntry[] = [
  { kind: "lines", config: classic },
  { kind: "cascade", config: crucible },
];

/** Every playable game, by id. */
export const games: Readonly<Record<string, GameEntry>> = Object.fromEntries(entries.map((entry) => [entry.config.id, entry]));
