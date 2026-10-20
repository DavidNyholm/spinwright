import { classic } from "../games/classic.ts";
import { crucible } from "../games/crucible.ts";
import { FORGE, machineRoute } from "./router.ts";
import type { Route } from "./router.ts";

/**
 * What the lobby and the menu say about each thing there is to play. The slot machines' return
 * figures are written here rather than worked out on every page load; test/catalog.test.ts and
 * test/crucible.test.ts fail if the games are retuned and these are left behind.
 */
export const CLOCKWORK_RTP_PERCENT = 96.1;
export const CRUCIBLE_RTP_PERCENT = 95.5;

export type EmblemName = "gear" | "gem" | "anvil";

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
      `Returns about ${percent(CLOCKWORK_RTP_PERCENT)} (opening spin exact, free spins simulated)`,
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
    ],
    emblem: "gem",
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
