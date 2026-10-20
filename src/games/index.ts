import type { CascadeConfig } from "../engine/cascade/index.ts";
import type { HoldGameConfig } from "../engine/hold/index.ts";
import type { GameConfig } from "../engine/index.ts";
import { classic } from "./classic.ts";
import { crucible } from "./crucible.ts";
import { mint } from "./mint.ts";

/** A playable game: which kind of engine runs it, and its rules. */
export type GameEntry =
  | { readonly kind: "lines"; readonly config: GameConfig }
  | { readonly kind: "cascade"; readonly config: CascadeConfig }
  | { readonly kind: "hold"; readonly config: HoldGameConfig };

const entries: readonly GameEntry[] = [
  { kind: "lines", config: classic },
  { kind: "cascade", config: crucible },
  { kind: "hold", config: mint },
];

/** The id a game goes by: a hold-and-win game's is its base game's. */
export const gameId = (entry: GameEntry): string => (entry.kind === "hold" ? entry.config.base.id : entry.config.id);

/** Every playable game, by id. */
export const games: Readonly<Record<string, GameEntry>> = Object.fromEntries(entries.map((entry) => [gameId(entry), entry]));
