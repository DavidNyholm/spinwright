import { smallestHoldWinMultiple } from "../engine/hold/index.ts";
import type { HoldGameConfig } from "../engine/hold/index.ts";
import { smallestWinMultiple } from "../engine/index.ts";
import { classic } from "../games/classic.ts";
import { crucible } from "../games/crucible.ts";
import { mint } from "../games/mint.ts";
import { FORGE, machineRoute } from "./router.ts";
import type { Route } from "./router.ts";

/**
 * What the lobby and the menu say about each thing there is to play. The slot machines' return
 * figures are written here rather than worked out on every page load; test/catalog.test.ts and
 * test/crucible.test.ts fail if the games are retuned and these are left behind.
 */
export const CLOCKWORK_RTP_PERCENT = 96.0;
export const CRUCIBLE_RTP_PERCENT = 95.5;
export const MINT_RTP_PERCENT = 96.0;

export type EmblemName = "gear" | "gem" | "coin" | "anvil";

export interface CatalogEntry {
  /** A machine's id, or "forge". */
  readonly id: string;
  readonly route: Route;
  readonly kind: "slot" | "clicker";
  /** The slot machines are numbered, in the order they were built; the Forge is not a machine. */
  readonly number: number | null;
  readonly name: string;
  readonly pitch: string;
  readonly facts: readonly string[];
  readonly emblem: EmblemName;
}

/** "Every win pays more than your bet", but only if the game's paytable really makes that so. */
export const winFloorFact = (smallest: number): readonly string[] =>
  smallest > 1 && Number.isFinite(smallest) ? [`Every win pays more than your bet (at least ${Number(smallest.toFixed(2))}×)`] : [];

/** What the lobby says about a hold-and-win game, from its own configuration. */
export const holdGameFacts = (game: HoldGameConfig, returnPercent: number): readonly string[] => [
  `${game.base.reels} reels, ${game.base.paylines.length} lines, hold and win`,
  ...winFloorFact(smallestHoldWinMultiple(game)),
  `${game.hold.fullBoard.name} for a full board: ${game.hold.fullBoard.value / game.base.paylines.length}× your bet`,
  `Returns about ${percent(returnPercent)} (worked out exactly)`,
  bonusBuyFact(game.hold.buyCost),
];

const bonusBuyFact = (buyCost: number | null): string => (buyCost === null ? "No bonus buy" : `Bonus buy: ${buyCost}× your bet`);
const percent = (value: number): string => `${value.toFixed(2).replace(/\.?0+$/, "")}%`;

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: classic.id,
    route: machineRoute(classic.id),
    kind: "slot",
    number: 1,
    name: "Clockwork",
    pitch: "Five reels of brass and cogwheels. Three blueprints start free spins, and every wild that lands in them locks in place, so the board fills up as you go.",
    facts: [
      `${classic.reels} reels, ${classic.paylines.length} lines, wilds and scatters`,
      ...winFloorFact(smallestWinMultiple(classic)),
      `Returns about ${percent(CLOCKWORK_RTP_PERCENT)} (opening spin exact, free spins simulated)`,
      bonusBuyFact(classic.feature?.buyCost ?? null),
    ],
    emblem: "gear",
  },
  {
    id: crucible.id,
    route: machineRoute(crucible.id),
    kind: "slot",
    number: 2,
    name: "Crucible",
    pitch: "Gems fall into a furnace. Groups pay and vanish, new gems drop in, and every win in a spin heats the furnace and multiplies the next.",
    facts: [
      `${crucible.columns} × ${crucible.rows} grid, groups of ${crucible.minCluster} or more pay`,
      `Returns about ${percent(CRUCIBLE_RTP_PERCENT)} (simulated)`,
      bonusBuyFact(crucible.feature?.buyCost ?? null),
    ],
    emblem: "gem",
  },
  {
    id: mint.base.id,
    route: machineRoute(mint.base.id),
    kind: "slot",
    number: 3,
    name: "Mint",
    pitch: `Coins drop onto the reels. Land ${mint.hold.minCoins} and they lock in place to start the hold and win, and every new coin sets the respins back to ${mint.hold.respins}. Fill the board for the ${mint.hold.fullBoard.name}.`,
    facts: holdGameFacts(mint, MINT_RTP_PERCENT),
    emblem: "coin",
  },
  {
    id: "forge",
    route: FORGE,
    kind: "clicker",
    number: null,
    name: "The Forge",
    pitch: "Strike the anvil to earn credits for the machines. Wind the mainspring and it keeps striking whenever you pause, until it runs down.",
    facts: ["Free, and the way to earn more credits", "Never earns while you are away"],
    emblem: "anvil",
  },
];

export const SLOT_ENTRIES = CATALOG.filter((entry) => entry.kind === "slot");
