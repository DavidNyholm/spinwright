import type { Machine } from "../app/machine.ts";
import { classic } from "../games/classic.ts";
import { crucible } from "../games/crucible.ts";
import { ClockworkMachine } from "./clockwork.ts";
import { CrucibleMachine } from "./crucible.ts";

export interface MachineEntry {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  create(): Machine;
}

/** Every machine on the floor, in order. The first one is what a new visitor sees. */
export const MACHINES: readonly MachineEntry[] = [
  { id: classic.id, number: 1, name: "Clockwork", create: () => new ClockworkMachine(classic) },
  { id: crucible.id, number: 2, name: "Crucible", create: () => new CrucibleMachine(crucible) },
];
