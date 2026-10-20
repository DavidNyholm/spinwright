import { describe, expect, it } from "vitest";
import { createRng } from "../src/engine/index.ts";
import { FORGE, tierIndex, UPGRADE_IDS, upgradeCost } from "../src/forge/config.ts";
import type { UpgradeId } from "../src/forge/config.ts";
import { ForgeEngine, mergeForgeSaves, parseForgeSave } from "../src/forge/engine.ts";
import type { ForgeBank, ForgeEvent, ForgeSave } from "../src/forge/engine.ts";

interface Rig {
  forge: ForgeEngine;
  events: ForgeEvent[];
  balance(): number;
  earned(): number;
  spent(): number;
}

/** A Forge wired to a plain in-memory bank, with its events collected. */
function makeForge(options: { balance?: number; levels?: Partial<Record<UpgradeId, number>>; seed?: string; save?: Partial<ForgeSave> } = {}): Rig {
  let balance = options.balance ?? 0;
  let earned = 0;
  let spent = 0;
  const bank: ForgeBank = {
    balance: () => balance,
    earn: (n) => {
      balance += n;
      earned += n;
    },
    spend: (n) => {
      if (n > balance) throw new RangeError("not enough");
      balance -= n;
      spent += n;
    },
  };
  const events: ForgeEvent[] = [];
  const save = parseForgeSave({ levels: options.levels, ...options.save });
  const forge = new ForgeEngine({ bank, rng: createRng(options.seed ?? "forge"), onEvent: (event) => events.push(event), save });
  return { forge, events, balance: () => balance, earned: () => earned, spent: () => spent };
}

/** Moves the Forge on by `ms` in small steps, as a frame loop would. */
function advance(forge: ForgeEngine, ms: number, step = 50): void {
  for (let elapsed = 0; elapsed < ms; elapsed += step) forge.tick(Math.min(step, ms - elapsed));
}

/**
 * Runs the Forge until an ingot is on screen (they only live a few seconds, so a fixed time can miss one),
 * then lets a person's reaction time pass, since a click any sooner is ignored.
 */
function untilIngot(forge: ForgeEngine, options: { reacted?: boolean } = {}): void {
  for (let elapsed = 0; forge.state().ingot === null; elapsed += 100) {
    if (elapsed > 200_000) throw new Error("no ingot appeared");
    forge.tick(100);
  }
  if (options.reacted !== false) forge.tick(FORGE.ingot.minReactionMs);
}

const strikes = (events: readonly ForgeEvent[]) => events.filter((e): e is Extract<ForgeEvent, { type: "strike" }> => e.type === "strike");
const autos = (events: readonly ForgeEvent[]) => events.filter((e) => e.type === "auto");

describe("striking", () => {
  it("pays one credit for a first strike with no upgrades", () => {
    const { forge, events, earned } = makeForge();
    forge.strike();
    expect(earned()).toBe(1);
    expect(strikes(events)[0]).toMatchObject({ credits: 1, tier: 0 });
  });

  it("is worth one more credit for every hammer level", () => {
    const { forge, earned } = makeForge({ levels: { hammer: 4 } });
    forge.strike();
    expect(earned()).toBe(5);
  });

  it("multiplies a strike by the heat tier the combo has reached", () => {
    const { forge, events } = makeForge({ levels: { hammer: 1 } }); // each strike is worth 2
    for (let i = 0; i < 12; i++) forge.strike();
    const credits = strikes(events).map((s) => s.credits);
    // Heat before each strike is 0, 6, 12, 18, 24 (Cold, x1), then 30..48 (Warm, x1.5), then 54 (Hot, x2).
    expect(credits.slice(0, 5)).toEqual([2, 2, 2, 2, 2]);
    expect(credits.slice(5, 9)).toEqual([3, 3, 3, 3]);
    expect(credits[9]).toBe(4);
  });

  it("pays exactly what was earned over time, carrying part-credits instead of rounding each one", () => {
    const { forge, events, earned } = makeForge(); // base 1, so Warm strikes are worth 1.5
    for (let i = 0; i < 400; i++) forge.strike();
    const exact = strikes(events).reduce((sum, s) => sum + FORGE.heat.tiers[s.tier]!.multiplier, 0);
    expect(earned()).toBe(Math.floor(exact + 1e-9));
    expect(earned()).toBe(strikes(events).reduce((sum, s) => sum + s.credits, 0));
    // Without carrying, rounding 1.5 up or down on every strike would be off by 100 here or more.
    expect(exact - earned()).toBeLessThan(1);
  });

  it("counts strikes and lifetime credits, and remembers the best heat", () => {
    const { forge } = makeForge();
    for (let i = 0; i < 20; i++) forge.strike();
    const state = forge.state();
    expect(state.strikes).toBe(20);
    expect(state.lifetime).toBeGreaterThan(20);
    expect(state.bestHeat).toBe(Math.floor(state.heat));
  });
});

describe("heat", () => {
  it("builds by six a strike, faster with tongs, and stops at the top", () => {
    const plain = makeForge();
    plain.forge.strike();
    expect(plain.forge.state().heat).toBe(6);
    const tongs = makeForge({ levels: { tongs: 3 } });
    tongs.forge.strike();
    expect(tongs.forge.state().heat).toBe(9);
    for (let i = 0; i < 100; i++) plain.forge.strike();
    expect(plain.forge.state().heat).toBe(FORGE.heat.max);
  });

  it("reports each tier as it is reached, once", () => {
    const { forge, events } = makeForge();
    for (let i = 0; i < 40; i++) forge.strike();
    const tiers = events.filter((e) => e.type === "tierUp").map((e) => (e as { tier: number }).tier);
    expect(tiers).toEqual([1, 2, 3]);
  });

  it("holds for a moment after a strike, then drains", () => {
    const { forge } = makeForge();
    for (let i = 0; i < 10; i++) forge.strike(); // heat 60
    advance(forge, 450);
    expect(forge.state().heat).toBe(60);
    advance(forge, 1_050); // 500 ms of grace used up, then a second of draining at 20 a second
    expect(forge.state().heat).toBeCloseTo(40, 0);
  });

  it("drains more slowly with tongs, down to a floor", () => {
    const run = (tongs: number) => {
      const { forge } = makeForge({ levels: { tongs } });
      for (let i = 0; i < 12; i++) forge.strike();
      const before = forge.state().heat;
      advance(forge, 1_500);
      return before - forge.state().heat;
    };
    expect(run(4)).toBeLessThan(run(0));
    // At the top level the rate is held at the floor of 8 a second rather than going lower or negative.
    expect(run(8)).toBeCloseTo(FORGE.heat.drainFloorPerSecond, 0);
  });

  it("says when heat cools to a lower tier, and never goes below zero", () => {
    const { forge, events } = makeForge();
    for (let i = 0; i < 20; i++) forge.strike();
    advance(forge, 20_000);
    expect(forge.state().heat).toBe(0);
    expect(events.some((e) => e.type === "cooled")).toBe(true);
  });

  it("finds the tier for any heat", () => {
    expect([0, 24.9, 25, 49.9, 50, 79.9, 80, 100].map(tierIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe("upgrades", () => {
  it("costs more at every level", () => {
    for (const id of UPGRADE_IDS) {
      for (let level = 1; level < FORGE.upgrades[id].maxLevel; level++) expect(upgradeCost(id, level)).toBeGreaterThan(upgradeCost(id, level - 1));
    }
    expect(upgradeCost("hammer", 0)).toBe(FORGE.upgrades.hammer.baseCost);
  });

  it("takes the price and gives the level", () => {
    const { forge, events, balance, spent } = makeForge({ balance: 1_000 });
    const price = upgradeCost("hammer", 0);
    expect(forge.buy("hammer")).toBe(true);
    expect(balance()).toBe(1_000 - price);
    expect(spent()).toBe(price);
    expect(forge.state().levels.hammer).toBe(1);
    expect(events.at(-1)).toEqual({ type: "bought", upgrade: "hammer", level: 1, cost: price });
  });

  it("can spend the last credit, and refuses when one short, leaving everything as it was", () => {
    const price = upgradeCost("tongs", 0);
    const exact = makeForge({ balance: price });
    expect(exact.forge.buy("tongs")).toBe(true);
    expect(exact.balance()).toBe(0);

    const short = makeForge({ balance: price - 1 });
    expect(short.forge.buy("tongs")).toBe(false);
    expect(short.balance()).toBe(price - 1);
    expect(short.forge.state().levels.tongs).toBe(0);
    expect(short.events.at(-1)).toEqual({ type: "denied", upgrade: "tongs" });
  });

  it("stops at the top level, with no price shown for it", () => {
    const max = FORGE.upgrades.luck.maxLevel;
    const { forge, events, balance } = makeForge({ balance: 1e9, levels: { luck: max } });
    expect(forge.buy("luck")).toBe(false);
    expect(balance()).toBe(1e9);
    expect(events).toEqual([]);
    expect(forge.state().costs.luck).toBeNull();
  });

  it("shows the next price for each upgrade", () => {
    const { forge } = makeForge({ levels: { hammer: 3, mainspring: 1 } });
    const costs = forge.state().costs;
    expect(costs.hammer).toBe(upgradeCost("hammer", 3));
    expect(costs.mainspring).toBe(upgradeCost("mainspring", 1));
    expect(costs.tongs).toBe(upgradeCost("tongs", 0));
  });
});

describe("the mainspring", () => {
  it("does nothing until it is bought", () => {
    const { forge, events } = makeForge();
    for (let i = 0; i < 30; i++) forge.strike();
    advance(forge, 10_000);
    expect(forge.state().wound).toBe(0);
    expect(autos(events)).toEqual([]);
  });

  it("is wound by strikes, up to its capacity", () => {
    const { forge } = makeForge({ levels: { mainspring: 1 } });
    for (let i = 0; i < 10; i++) forge.strike();
    expect(forge.state().wound).toBe(10);
    for (let i = 0; i < 40; i++) forge.strike();
    expect(forge.state().wound).toBe(FORGE.mainspring.capacityBase);
  });

  it("holds off while the player is still striking, then runs once they stop", () => {
    const { forge, events } = makeForge({ levels: { mainspring: 1 } });
    for (let i = 0; i < 12; i++) forge.strike();
    advance(forge, 700);
    expect(autos(events)).toEqual([]);
    expect(forge.state().springRunning).toBe(false);
    advance(forge, 500);
    expect(forge.state().springRunning).toBe(true);
    // At 1.5 strikes a second the first one is due two thirds of a second after it starts running.
    advance(forge, 600);
    expect(autos(events).length).toBeGreaterThan(0);
  });

  it("strikes at its own rate and spends one turn a strike", () => {
    const { forge, events } = makeForge({ levels: { mainspring: 1 } }); // 1.5 strikes a second
    for (let i = 0; i < 20; i++) forge.strike();
    advance(forge, FORGE.mainspring.idleMs); // starts running as this ends
    const before = autos(events).length;
    const woundBefore = forge.state().wound;
    advance(forge, 4_000);
    const struck = autos(events).length - before;
    expect(struck).toBeGreaterThanOrEqual(5);
    expect(struck).toBeLessThanOrEqual(7); // about 6 in 4 seconds at 1.5 a second
    expect(forge.state().wound).toBeCloseTo(woundBefore - struck, 9);
  });

  it("unwinds completely, to the last whole turn, and then stops", () => {
    const { forge, events } = makeForge({ levels: { mainspring: 1 } });
    for (let i = 0; i < 10; i++) forge.strike();
    advance(forge, 30_000);
    expect(autos(events)).toHaveLength(10);
    expect(forge.state().wound).toBe(0);
    expect(forge.state().springRunning).toBe(false);
  });

  it("is interrupted by a manual strike, which also winds it further", () => {
    const { forge } = makeForge({ levels: { mainspring: 1 } });
    for (let i = 0; i < 10; i++) forge.strike();
    advance(forge, 2_500);
    expect(forge.state().springRunning).toBe(true);
    const wound = forge.state().wound;
    forge.strike();
    expect(forge.state().springRunning).toBe(false);
    expect(forge.state().wound).toBeCloseTo(wound + 1, 9);
  });

  it("pays an automatic strike at 60% of a manual strike's base value, without losing the fractions", () => {
    const { forge, earned } = makeForge({ levels: { mainspring: 1 } });
    for (let i = 0; i < 10; i++) forge.strike();
    const afterManual = earned();
    advance(forge, 30_000);
    // Ten automatic strikes of 0.6 each: six credits in all, not ten (rounding up) or zero (rounding down).
    expect(earned() - afterManual).toBe(6);
  });

  it("gets bigger with each level", () => {
    const l1 = makeForge({ levels: { mainspring: 1 } }).forge.state();
    const l3 = makeForge({ levels: { mainspring: 3 } }).forge.state();
    expect([l1.capacity, l1.windPerStrike, l1.autoRate]).toEqual([20, 1, 1.5]);
    expect([l3.capacity, l3.windPerStrike, l3.autoRate]).toEqual([40, 2, 2.5]);
  });

  it("cannot be used to earn while away: one huge step only counts for a moment", () => {
    const { forge, events } = makeForge({ levels: { mainspring: 1 } });
    for (let i = 0; i < 20; i++) forge.strike();
    forge.tick(10 * 60 * 1000); // ten minutes in one call, as a stalled tab would deliver
    expect(autos(events).length).toBe(0);
    forge.tick(10 * 60 * 1000);
    expect(autos(events).length).toBeLessThanOrEqual(1);
  });
});

describe("ingots", () => {
  /** Runs a fresh Forge until its first ingot appears, returning the time it took in ms. */
  const firstIngot = (seed: string, luck = 0): number => {
    const { forge, events } = makeForge({ seed, levels: { luck } });
    let elapsed = 0;
    while (!events.some((e) => e.type === "ingotAppeared") && elapsed < 120_000) {
      forge.tick(100);
      elapsed += 100;
    }
    return elapsed;
  };

  it("appears somewhere in the window, and in view", () => {
    for (let n = 0; n < 40; n++) {
      const elapsed = firstIngot(`window-${n}`);
      expect(elapsed).toBeGreaterThanOrEqual(FORGE.ingot.minIntervalMs - 100);
      expect(elapsed).toBeLessThanOrEqual(FORGE.ingot.maxIntervalMs + 100);
    }
    const { forge, events } = makeForge({ seed: "position" });
    untilIngot(forge);
    const appeared = events.find((e) => e.type === "ingotAppeared") as { x: number; y: number };
    expect(appeared.x).toBeGreaterThanOrEqual(0.12);
    expect(appeared.x).toBeLessThanOrEqual(0.88);
    expect(appeared.y).toBeGreaterThanOrEqual(0.12);
    expect(appeared.y).toBeLessThanOrEqual(0.52);
    expect(forge.state().ingot).not.toBeNull();
  });

  it("goes away if not caught in time, and another comes later", () => {
    const { forge, events } = makeForge({ seed: "expire" });
    untilIngot(forge);
    advance(forge, FORGE.ingot.lifetimeMs + 500);
    expect(events.some((e) => e.type === "ingotExpired")).toBe(true);
    expect(forge.state().ingot).toBeNull();
    untilIngot(forge);
    expect(events.filter((e) => e.type === "ingotAppeared").length).toBe(2);
  });

  it("cannot be caught faster than a person can react, and can be once they could have", () => {
    const { forge, events, earned } = makeForge({ seed: "reaction" });
    untilIngot(forge, { reacted: false });
    const age = (): number => FORGE.ingot.lifetimeMs - forge.state().ingot!.msLeft;
    expect(age()).toBeLessThan(FORGE.ingot.minReactionMs);
    forge.catchIngot();
    expect(forge.state().ingot).not.toBeNull();
    expect(events.some((e) => e.type === "ingotCaught")).toBe(false);
    expect(earned()).toBe(0);

    forge.tick(FORGE.ingot.minReactionMs - age() - 1);
    forge.catchIngot();
    expect(forge.state().ingot).not.toBeNull();

    forge.tick(1);
    expect(age()).toBeGreaterThanOrEqual(FORGE.ingot.minReactionMs);
    forge.catchIngot();
    expect(forge.state().ingot).toBeNull();
    expect(events.some((e) => e.type === "ingotCaught")).toBe(true);
  });

  it("does nothing when clicked and there is none", () => {
    const { forge, events, earned } = makeForge();
    forge.catchIngot();
    expect(events).toEqual([]);
    expect(earned()).toBe(0);
  });

  it("pays a windfall or starts a frenzy, in about the proportion set", () => {
    let windfalls = 0;
    let frenzies = 0;
    for (let n = 0; n < 300; n++) {
      const { forge, events } = makeForge({ seed: `catch-${n}` });
      untilIngot(forge);
      forge.catchIngot();
      const caught = events.find((e) => e.type === "ingotCaught") as Extract<ForgeEvent, { type: "ingotCaught" }>;
      if (caught.reward.kind === "windfall") windfalls++;
      else frenzies++;
      expect(forge.state().ingot).toBeNull();
    }
    expect(windfalls + frenzies).toBe(300);
    expect(windfalls / 300).toBeGreaterThan(0.5);
    expect(windfalls / 300).toBeLessThan(0.7);
  });

  it("makes a windfall worth thirty strikes, plus a share per luck level", () => {
    const find = (levels: Partial<Record<UpgradeId, number>>) => {
      for (let n = 0; n < 200; n++) {
        const rig = makeForge({ seed: `windfall-${n}`, levels });
        untilIngot(rig.forge);
        rig.forge.catchIngot();
        const caught = rig.events.find((e) => e.type === "ingotCaught") as Extract<ForgeEvent, { type: "ingotCaught" }>;
        if (caught.reward.kind === "windfall") return { credits: caught.reward.credits, earned: rig.earned() };
      }
      throw new Error("no windfall found");
    };
    expect(find({})).toMatchObject({ credits: FORGE.ingot.windfallStrikes });
    const strong = find({ hammer: 9, luck: 2 }); // base 10: 300, plus 30% for two levels of luck
    expect(strong.credits).toBe(Math.round(300 * (1 + FORGE.ingot.windfallPerLuckLevel * 2)));
    expect(strong.earned).toBe(strong.credits);
  });

  it("makes a frenzy multiply every strike, manual or automatic, and then ends", () => {
    for (let n = 0; n < 200; n++) {
      const rig = makeForge({ seed: `frenzy-${n}`, levels: { mainspring: 1 } });
      untilIngot(rig.forge);
      rig.forge.catchIngot();
      const caught = rig.events.find((e) => e.type === "ingotCaught") as Extract<ForgeEvent, { type: "ingotCaught" }>;
      if (caught.reward.kind !== "frenzy") continue;

      expect(caught.reward.durationMs).toBe(FORGE.ingot.frenzyMs);
      expect(rig.forge.state().frenzyMsLeft).toBe(FORGE.ingot.frenzyMs);
      const before = rig.earned();
      rig.forge.strike(); // base 1 x frenzy 5
      expect(rig.earned() - before).toBe(FORGE.ingot.frenzyMultiplier);
      // The mainspring's automatic strikes are multiplied too: 0.6 x 5 = 3 credits each, not 0.6.
      const autosBefore = autos(rig.events).length;
      const earnedBefore = rig.earned();
      advance(rig.forge, FORGE.mainspring.idleMs + 1_400);
      const struck = autos(rig.events).length - autosBefore;
      expect(struck).toBeGreaterThanOrEqual(1);
      expect(rig.earned() - earnedBefore).toBe(struck * FORGE.mainspring.autoValue * FORGE.ingot.frenzyMultiplier);
      advance(rig.forge, FORGE.ingot.frenzyMs + 200);
      expect(rig.events.some((e) => e.type === "frenzyEnded")).toBe(true);
      expect(rig.forge.state().frenzyMsLeft).toBe(0);
      const afterFrenzy = rig.earned();
      rig.forge.strike();
      expect(rig.earned() - afterFrenzy).toBeLessThan(FORGE.ingot.frenzyMultiplier);
      return;
    }
    throw new Error("no frenzy found");
  });

  it("comes sooner with luck, by the factor set", () => {
    const mean = (luck: number) => {
      let total = 0;
      for (let n = 0; n < 300; n++) total += firstIngot(`luck-${n}`, luck);
      return total / 300;
    };
    const ratio = mean(5) / mean(0);
    expect(ratio).toBeGreaterThan(FORGE.ingot.intervalPerLuckLevel ** 5 * 0.92);
    expect(ratio).toBeLessThan(FORGE.ingot.intervalPerLuckLevel ** 5 * 1.08);
  });
});

describe("saving", () => {
  it("round-trips through JSON and carries on from there", () => {
    const first = makeForge({ balance: 10_000 });
    first.forge.buy("hammer");
    first.forge.buy("tongs");
    for (let i = 0; i < 25; i++) first.forge.strike();
    const saved = JSON.parse(JSON.stringify(first.forge.toSave())) as unknown;

    const second = makeForge({ save: parseForgeSave(saved) });
    const state = second.forge.state();
    expect(state.levels).toMatchObject({ hammer: 1, tongs: 1, mainspring: 0, luck: 0 });
    expect(state.strikes).toBe(25);
    expect(state.lifetime).toBe(first.forge.state().lifetime);
    // The heat meter and the spring are not kept: a fresh visit starts cold.
    expect(state.heat).toBe(0);
    expect(state.wound).toBe(0);
  });

  it.each([
    ["nothing", null],
    ["a string", "oops"],
    ["an array", []],
    ["levels of the wrong type", { levels: "high" }],
    ["negative and fractional numbers", { levels: { hammer: -3, tongs: 1.5 }, strikes: -1, lifetime: 0.5 }],
    ["text where numbers should be", { levels: { hammer: "9" }, strikes: "many" }],
  ])("starts fresh from %s", (_name, value) => {
    const save = parseForgeSave(value);
    expect(save.levels).toEqual({ hammer: 0, tongs: 0, mainspring: 0, luck: 0 });
    expect(save.strikes).toBe(0);
    expect(save.lifetime).toBe(0);
  });

  it("keeps what is valid and trims levels to their maximum", () => {
    const save = parseForgeSave({ levels: { hammer: 3, luck: 999, tongs: -2 }, strikes: 7, lifetime: 70, bestHeat: 500 });
    expect(save.levels.hammer).toBe(3);
    expect(save.levels.luck).toBe(FORGE.upgrades.luck.maxLevel);
    expect(save.levels.tongs).toBe(0);
    expect(save.strikes).toBe(7);
    expect(save.bestHeat).toBe(FORGE.heat.max);
  });
});

describe("repeatability", () => {
  const script = (seed: string): ForgeEvent[] => {
    const { forge, events } = makeForge({ seed, balance: 5_000, levels: { mainspring: 2 } });
    for (let t = 0; t < 120_000; t += 50) {
      if (t % 250 === 0) forge.strike();
      forge.tick(50);
      if (forge.state().ingot !== null) forge.catchIngot();
      if (t % 20_000 === 0) forge.buy("hammer");
    }
    return events;
  };

  it("plays the same game from the same seed and the same actions", () => {
    expect(script("same")).toEqual(script("same"));
  });

  it("plays a different game from a different seed", () => {
    expect(script("same")).not.toEqual(script("different"));
  });
});

describe("pacing", () => {
  /** A scripted player: strikes at a steady rate, clicks every ingot, and buys the cheapest affordable upgrade. */
  function playFor(seconds: number, strikesPerSecond: number, seed = "pacing") {
    const rig = makeForge({ seed });
    const stepMs = 50;
    const every = 1000 / strikesPerSecond;
    let nextStrike = 0;
    const at: Record<number, { earned: number; levels: Record<UpgradeId, number>; firstUpgradeAt: number | null }> = {};
    let firstUpgradeAt: number | null = null;
    for (let t = 0; t < seconds * 1000; t += stepMs) {
      while (nextStrike <= t) {
        rig.forge.strike();
        nextStrike += every;
      }
      rig.forge.tick(stepMs);
      if (rig.forge.state().ingot !== null) rig.forge.catchIngot();
      for (;;) {
        const costs = rig.forge.state().costs;
        let cheapest: UpgradeId | null = null;
        for (const id of UPGRADE_IDS) {
          const cost = costs[id];
          if (cost !== null && cost <= rig.balance() && (cheapest === null || cost < costs[cheapest]!)) cheapest = id;
        }
        if (cheapest === null) break;
        rig.forge.buy(cheapest);
        firstUpgradeAt ??= t / 1000;
      }
      if ((t + stepMs) % 60_000 === 0) at[(t + stepMs) / 60_000] = { earned: rig.forge.state().lifetime, levels: rig.forge.state().levels, firstUpgradeAt };
    }
    return { at, firstUpgradeAt, state: rig.forge.state() };
  }

  it("lets a steady clicker buy a first upgrade within a minute and earn a useful bankroll in the first few", () => {
    const run = playFor(600, 5);
    expect(run.firstUpgradeAt).not.toBeNull();
    expect(run.firstUpgradeAt!).toBeLessThan(45);
    expect(run.at[1]!.earned).toBeGreaterThan(600);
    expect(run.at[1]!.earned).toBeLessThan(6_000);
    expect(run.at[10]!.earned).toBeGreaterThan(40_000);
    expect(run.at[10]!.earned).toBeLessThan(250_000);
  });

  it("keeps the progression going: nothing is maxed after ten minutes", () => {
    for (const rate of [2, 5, 8]) {
      const levels = playFor(600, rate).state.levels;
      for (const id of UPGRADE_IDS) expect(levels[id], `${id} at ${rate} strikes a second`).toBeLessThan(FORGE.upgrades[id].maxLevel);
    }
  });

  it("rewards faster clicking much more than linearly, because heat needs a quick pace", () => {
    const slow = playFor(300, 2).state.lifetime;
    const fast = playFor(300, 5).state.lifetime;
    // 2.5 times the clicks should earn well over 2.5 times as much, through heat and upgrades.
    expect(fast / slow).toBeGreaterThan(3);
  });
});

describe("saving from two tabs", () => {
  const save = (levels: Partial<Record<UpgradeId, number>>, strikes: number, lifetime: number, bestHeat: number): ForgeSave => ({
    levels: { hammer: 0, tongs: 0, mainspring: 0, luck: 0, ...levels },
    strikes,
    lifetime,
    bestHeat,
  });

  it("keeps the larger of every count, so an older tab cannot undo a newer one", () => {
    const ahead = save({ hammer: 5, mainspring: 2 }, 900, 12_000, 80);
    const behind = save({ hammer: 1, tongs: 3 }, 100, 500, 95);
    expect(mergeForgeSaves(ahead, behind)).toEqual(save({ hammer: 5, tongs: 3, mainspring: 2 }, 900, 12_000, 95));
    expect(mergeForgeSaves(behind, ahead)).toEqual(mergeForgeSaves(ahead, behind));
  });

  it("changes nothing when the two are the same, and is safe to apply again", () => {
    const one = save({ hammer: 2 }, 10, 20, 30);
    expect(mergeForgeSaves(one, one)).toEqual(one);
    expect(mergeForgeSaves(mergeForgeSaves(one, one), one)).toEqual(one);
  });
});
