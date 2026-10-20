/**
 * Every number that sets how the Forge plays. Nothing is hidden in the engine, so the pacing can be
 * tuned here (and is guarded by the balance test in test/forge.test.ts).
 */

export type UpgradeId = "hammer" | "tongs" | "mainspring" | "luck";

export interface HeatTier {
  /** Heat (0 to 100) at which this tier begins. */
  readonly at: number;
  readonly multiplier: number;
  readonly name: string;
}

export interface UpgradeRules {
  readonly name: string;
  /** Cost of the first level. */
  readonly baseCost: number;
  /** Each further level costs this many times the one before. */
  readonly growth: number;
  readonly maxLevel: number;
}

export const FORGE = {
  /** A strike is worth `base + perHammerLevel x hammer level` credits before any multiplier. */
  strike: { base: 1, perHammerLevel: 1 },

  /**
   * Heat is a combo meter: each strike adds to it, and it drains once the player pauses. Its tier
   * multiplies the value of the next strike. Tongs make it build faster and drain slower.
   */
  heat: {
    max: 100,
    gainPerStrike: 6,
    gainPerTongsLevel: 1,
    drainPerSecond: 20,
    drainPerTongsLevel: 1.5,
    drainFloorPerSecond: 8,
    /** After a manual strike, heat holds for this long before it starts to drain. */
    graceMs: 500,
    tiers: [
      { at: 0, multiplier: 1, name: "Cold" },
      { at: 25, multiplier: 1.5, name: "Warm" },
      { at: 50, multiplier: 2, name: "Hot" },
      { at: 80, multiplier: 3, name: "White-hot" },
    ] as readonly HeatTier[],
  },

  /**
   * The mainspring turns the player's effort into automatic strikes. Each manual strike winds it;
   * once the player pauses it unwinds, one turn per automatic strike. It stores effort and runs
   * down, so it cannot earn while the player is away.
   */
  mainspring: {
    /** The player must pause this long before the spring starts to run. */
    idleMs: 800,
    /** An automatic strike is worth this share of a manual strike's base value. */
    autoValue: 0.6,
    capacityBase: 20,
    capacityPerLevel: 10,
    windBase: 1,
    windPerLevel: 0.5,
    rateBase: 1.5,
    ratePerLevel: 0.5,
  },

  /** Ingots appear now and then, and clicking one in time pays out. They only appear while the Forge is open. */
  ingot: {
    minIntervalMs: 25_000,
    maxIntervalMs: 55_000,
    lifetimeMs: 9_000,
    /** A click on an ingot sooner than this after it appears is ignored: faster than a person can react, so not a hand. */
    minReactionMs: 150,
    /** Each level of luck multiplies the wait between ingots by this. */
    intervalPerLuckLevel: 0.92,
    /** The chance an ingot is a windfall rather than a frenzy. */
    windfallChance: 0.6,
    /** A windfall pays this many strikes' worth (of the base value), plus a share per luck level. */
    windfallStrikes: 30,
    windfallPerLuckLevel: 0.15,
    frenzyMs: 10_000,
    frenzyPerLuckLevelMs: 1_000,
    /** During a frenzy every strike, manual or automatic, is worth this many times as much. */
    frenzyMultiplier: 5,
  },

  upgrades: {
    hammer: { name: "Heavier hammer", baseCost: 250, growth: 1.7, maxLevel: 50 },
    tongs: { name: "Tongs", baseCost: 400, growth: 2.1, maxLevel: 8 },
    mainspring: { name: "Mainspring", baseCost: 1000, growth: 2.3, maxLevel: 6 },
    luck: { name: "Lucky ingots", baseCost: 600, growth: 2.1, maxLevel: 8 },
  } as Readonly<Record<UpgradeId, UpgradeRules>>,

  /** The longest single step the engine will take, so a stalled tab cannot be repaid with a burst of strikes. */
  maxStepMs: 250,
} as const;

export const UPGRADE_IDS: readonly UpgradeId[] = ["hammer", "tongs", "mainspring", "luck"];

/** What the next level of an upgrade costs, given the level it is at now. */
export function upgradeCost(id: UpgradeId, level: number): number {
  const rules = FORGE.upgrades[id];
  return Math.round(rules.baseCost * rules.growth ** level);
}

export function tierIndex(heat: number): number {
  let index = 0;
  FORGE.heat.tiers.forEach((tier, i) => {
    if (heat >= tier.at) index = i;
  });
  return index;
}

// What each upgrade level does, as plain functions of the level. The engine plays by these and the
// upgrade cards describe themselves with them, so what a card says is what the Forge does.

/** Credits one strike is worth before heat or frenzy. */
export const strikeBase = (hammer: number): number => FORGE.strike.base + FORGE.strike.perHammerLevel * hammer;

export const heatGain = (tongs: number): number => FORGE.heat.gainPerStrike + FORGE.heat.gainPerTongsLevel * tongs;

export const heatDrainPerSecond = (tongs: number): number =>
  Math.max(FORGE.heat.drainFloorPerSecond, FORGE.heat.drainPerSecond - FORGE.heat.drainPerTongsLevel * tongs);

export interface SpringStats {
  /** Turns it can hold. */
  readonly capacity: number;
  /** Turns each manual strike adds. */
  readonly windPerStrike: number;
  /** Automatic strikes per second while it runs. */
  readonly rate: number;
}

/** Level 0 is a Forge without a mainspring: it holds nothing, so it never strikes. */
export function springStats(level: number): SpringStats {
  if (level <= 0) return { capacity: 0, windPerStrike: 0, rate: 0 };
  const rules = FORGE.mainspring;
  const above = level - 1;
  return {
    capacity: rules.capacityBase + rules.capacityPerLevel * above,
    windPerStrike: rules.windBase + rules.windPerLevel * above,
    rate: rules.rateBase + rules.ratePerLevel * above,
  };
}

/** The base value an ingot windfall pays, in strikes' worth. */
export const windfallStrikes = (luck: number): number => FORGE.ingot.windfallStrikes * (1 + FORGE.ingot.windfallPerLuckLevel * luck);

export const frenzyDurationMs = (luck: number): number => FORGE.ingot.frenzyMs + FORGE.ingot.frenzyPerLuckLevelMs * luck;

/** How much sooner ingots come, as a share of the base wait. */
export const ingotWaitScale = (luck: number): number => FORGE.ingot.intervalPerLuckLevel ** luck;
