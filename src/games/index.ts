import type { GameConfig } from "../engine/index.ts";
import { classic } from "./classic.ts";

/** Every playable game, by id. */
export const games: Readonly<Record<string, GameConfig>> = { [classic.id]: classic };
