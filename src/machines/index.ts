import { SLOT_ENTRIES } from "../app/catalog.ts";
import type { Machine } from "../app/machine.ts";
import { classic } from "../games/classic.ts";
import { crucible } from "../games/crucible.ts";
import { mint } from "../games/mint.ts";
import { ClockworkMachine } from "./clockwork.ts";
import { CrucibleMachine } from "./crucible.ts";
import { MintMachine } from "./mint.ts";

export interface MachineEntry {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  create(): Machine;
}

const FACTORIES: Readonly<Record<string, () => Machine>> = {
  [classic.id]: () => new ClockworkMachine(classic),
  [crucible.id]: () => new CrucibleMachine(crucible),
  [mint.base.id]: () => new MintMachine(mint),
};

/** Every machine on the floor, in the catalog's order, which is also the order of the lobby and the menu. */
export const MACHINES: readonly MachineEntry[] = SLOT_ENTRIES.map((entry) => {
  const create = FACTORIES[entry.id];
  if (create === undefined || entry.number === null) throw new Error(`The catalog lists machine "${entry.id}" but nothing builds it`);
  return { id: entry.id, number: entry.number, name: entry.name, create };
});
