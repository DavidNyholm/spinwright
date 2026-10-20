import { describe, expect, it } from "vitest";
import { CATALOG, CLOCKWORK_RTP_PERCENT, SLOT_ENTRIES, winFloorFact } from "../src/app/catalog.ts";
import { parseRoute, routeToHash } from "../src/app/router.ts";
import { classic } from "../src/games/classic.ts";
import { crucible } from "../src/games/crucible.ts";
import { estimateReturn } from "../src/sim/lineSim.ts";

describe("catalog", () => {
  const machineIds = SLOT_ENTRIES.map((entry) => entry.id);

  it("lists each machine once, with the id of the game it plays", () => {
    expect(machineIds).toEqual([classic.id, crucible.id]);
    expect(new Set(CATALOG.map((entry) => entry.id)).size).toBe(CATALOG.length);
  });

  it("gives every entry a route the router finds again", () => {
    for (const entry of CATALOG) expect(parseRoute(routeToHash(entry.route), machineIds)).toEqual(entry.route);
  });

  it("numbers the machines in order and nothing else", () => {
    expect(SLOT_ENTRIES.map((entry) => entry.number)).toEqual([1, 2]);
    expect(CATALOG.filter((entry) => entry.kind !== "slot").every((entry) => entry.number === null)).toBe(true);
  });

  it("shows Clockwork's return as it really is: close to what the engine plays", { timeout: 120_000 }, () => {
    // The opening spin is exact and the free spins are simulated, so the quoted figure may be off by sampling error only.
    const estimate = estimateReturn(classic, 50_000, "catalog-clockwork");
    expect(Math.abs(estimate.total * 100 - CLOCKWORK_RTP_PERCENT)).toBeLessThan(0.7);
    const clockwork = CATALOG.find((entry) => entry.id === classic.id)!;
    expect(clockwork.facts.join(" ")).toContain(`${CLOCKWORK_RTP_PERCENT}%`);
  });

  it("promises that every Clockwork win pays more than the bet only because its paytable does", () => {
    const facts = (id: string): string => CATALOG.find((entry) => entry.id === id)!.facts.join(" | ");
    expect(facts(classic.id)).toContain("Every win pays more than your bet (at least 1.1×)");
    // Crucible's smallest group pays a twentieth of the bet, so it makes no such promise.
    expect(facts(crucible.id)).not.toContain("Every win pays more");
  });

  it("makes that promise only when the smallest win really is above the bet", () => {
    expect(winFloorFact(1.1)).toEqual(["Every win pays more than your bet (at least 1.1×)"]);
    expect(winFloorFact(2.5)).toEqual(["Every win pays more than your bet (at least 2.5×)"]);
    // Exactly the bet is not "more than" it, and anything below is the opposite of the promise.
    for (const smallest of [1, 0.9, 0.05, Infinity]) expect(winFloorFact(smallest), String(smallest)).toEqual([]);
  });

  it("says what each game is made of, from its own configuration", () => {
    expect(CATALOG.find((entry) => entry.id === classic.id)!.facts[0]).toContain(`${classic.reels} reels, ${classic.paylines.length} lines`);
    expect(CATALOG.find((entry) => entry.id === crucible.id)!.facts[0]).toContain(`${crucible.columns} × ${crucible.rows}`);
  });
});
