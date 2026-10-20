import { nextInt } from "../engine/index.ts";
import type { Rng } from "../engine/index.ts";
import { FORGE, frenzyDurationMs, heatDrainPerSecond, heatGain, ingotWaitScale, springStats, strikeBase, tierIndex, UPGRADE_IDS, upgradeCost, windfallStrikes } from "./config.ts";
import type { SpringStats, UpgradeId } from "./config.ts";

/** Where the Forge's credits come from and go to. The page connects this to the wallet. */
export interface ForgeBank {
  balance(): number;
  earn(credits: number): void;
  /** Must throw if there are not enough credits. */
  spend(credits: number): void;
}

export type IngotReward = { readonly kind: "windfall"; readonly credits: number } | { readonly kind: "frenzy"; readonly durationMs: number };

/** Things that happen, reported so the page can draw and sound them. The engine itself draws nothing. */
export type ForgeEvent =
  | { readonly type: "strike"; readonly credits: number; readonly tier: number; readonly heat: number }
  | { readonly type: "auto"; readonly credits: number }
  | { readonly type: "tierUp"; readonly tier: number }
  | { readonly type: "cooled"; readonly tier: number }
  | { readonly type: "ingotAppeared"; readonly x: number; readonly y: number }
  | { readonly type: "ingotExpired" }
  | { readonly type: "ingotCaught"; readonly reward: IngotReward }
  | { readonly type: "frenzyEnded" }
  | { readonly type: "bought"; readonly upgrade: UpgradeId; readonly level: number; readonly cost: number }
  | { readonly type: "denied"; readonly upgrade: UpgradeId };

/** What is kept between visits. Credits themselves live in the wallet. */
export interface ForgeSave {
  readonly levels: Readonly<Record<UpgradeId, number>>;
  readonly strikes: number;
  /** Credits earned here over all time. */
  readonly lifetime: number;
  readonly bestHeat: number;
}

export interface ForgeState {
  readonly heat: number;
  readonly tier: number;
  readonly tierName: string;
  /** What the next manual strike is worth in credits, with the heat tier and any frenzy applied. */
  readonly strikeValue: number;
  readonly multiplier: number;
  readonly springOwned: boolean;
  readonly wound: number;
  readonly capacity: number;
  /** True while the spring is unwinding into automatic strikes. */
  readonly springRunning: boolean;
  readonly autoRate: number;
  readonly windPerStrike: number;
  readonly frenzyMsLeft: number;
  /** Where the ingot is, as fractions of the scene's width and height, and how long it will stay. */
  readonly ingot: { readonly x: number; readonly y: number; readonly msLeft: number } | null;
  readonly levels: Readonly<Record<UpgradeId, number>>;
  /** The price of the next level of each upgrade, or null once it is at its top level. */
  readonly costs: Readonly<Record<UpgradeId, number | null>>;
  readonly strikes: number;
  readonly lifetime: number;
  readonly bestHeat: number;
}

export interface ForgeOptions {
  readonly bank: ForgeBank;
  readonly rng: Rng;
  readonly onEvent: (event: ForgeEvent) => void;
  readonly save?: ForgeSave;
}

const emptyLevels = (): Record<UpgradeId, number> => ({ hammer: 0, tongs: 0, mainspring: 0, luck: 0 });

/** Reads a saved Forge, keeping whatever in it is valid and falling back to a fresh start for the rest. */
export function parseForgeSave(value: unknown): ForgeSave {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const savedLevels = typeof record["levels"] === "object" && record["levels"] !== null ? (record["levels"] as Record<string, unknown>) : {};
  const count = (input: unknown, max = Number.MAX_SAFE_INTEGER): number =>
    typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? Math.min(input, max) : 0;
  const levels = emptyLevels();
  for (const id of UPGRADE_IDS) levels[id] = count(savedLevels[id], FORGE.upgrades[id].maxLevel);
  return {
    levels,
    strikes: count(record["strikes"]),
    lifetime: count(record["lifetime"]),
    bestHeat: Math.min(FORGE.heat.max, count(record["bestHeat"])),
  };
}

/**
 * The Forge's rules. Time only moves when tick() is called with how much has passed, and randomness
 * only comes from the rng it is given, so a run is exactly repeatable and can be played in a test.
 */
export class ForgeEngine {
  readonly #bank: ForgeBank;
  readonly #rng: Rng;
  readonly #emit: (event: ForgeEvent) => void;
  readonly #levels: Record<UpgradeId, number>;
  #strikes: number;
  #lifetime: number;
  #bestHeat: number;
  #heat = 0;
  #sinceStrikeMs = Infinity;
  #wound = 0;
  #autoClock = 0;
  /** Part-credits not yet paid out: a strike worth 1.5 pays 1 now and carries the half. */
  #carry = 0;
  #frenzyMs = 0;
  #ingot: { x: number; y: number; msLeft: number } | null = null;
  #nextIngotMs: number;

  constructor(options: ForgeOptions) {
    this.#bank = options.bank;
    this.#rng = options.rng;
    this.#emit = options.onEvent;
    const save = options.save ?? parseForgeSave(null);
    this.#levels = { ...save.levels };
    this.#strikes = save.strikes;
    this.#lifetime = save.lifetime;
    this.#bestHeat = save.bestHeat;
    this.#nextIngotMs = this.#ingotInterval();
  }

  // --- what the player does -----------------------------------------------------------------

  /** One manual strike of the anvil. */
  strike(): void {
    const heatBefore = this.#heat;
    const tierBefore = tierIndex(heatBefore);
    const credits = this.#pay(this.#baseValue() * this.#multiplier(tierBefore));

    this.#heat = Math.min(FORGE.heat.max, heatBefore + heatGain(this.#levels.tongs));
    this.#bestHeat = Math.max(this.#bestHeat, Math.floor(this.#heat));
    this.#sinceStrikeMs = 0;
    this.#autoClock = 0;
    if (this.#levels.mainspring > 0) this.#wound = Math.min(this.#spring().capacity, this.#wound + this.#spring().windPerStrike);
    this.#strikes++;

    this.#emit({ type: "strike", credits, tier: tierBefore, heat: this.#heat });
    const tierAfter = tierIndex(this.#heat);
    if (tierAfter > tierBefore) this.#emit({ type: "tierUp", tier: tierAfter });
  }

  /** Buys the next level of an upgrade if there are enough credits. Returns whether it did. */
  buy(id: UpgradeId): boolean {
    const level = this.#levels[id];
    if (level >= FORGE.upgrades[id].maxLevel) return false;
    const cost = upgradeCost(id, level);
    if (this.#bank.balance() < cost) {
      this.#emit({ type: "denied", upgrade: id });
      return false;
    }
    this.#bank.spend(cost);
    this.#levels[id] = level + 1;
    this.#emit({ type: "bought", upgrade: id, level: level + 1, cost });
    return true;
  }

  /** Clicks the ingot, if there is one. */
  catchIngot(): void {
    if (this.#ingot === null) return;
    const rules = FORGE.ingot;
    const luck = this.#levels.luck;
    this.#ingot = null;
    let reward: IngotReward;
    if (this.#unit() < rules.windfallChance) {
      const credits = Math.round(windfallStrikes(luck) * this.#baseValue());
      this.#bank.earn(credits);
      this.#lifetime += credits;
      reward = { kind: "windfall", credits };
    } else {
      const durationMs = frenzyDurationMs(luck);
      this.#frenzyMs = durationMs;
      reward = { kind: "frenzy", durationMs };
    }
    this.#nextIngotMs = this.#ingotInterval();
    this.#emit({ type: "ingotCaught", reward });
  }

  // --- time ---------------------------------------------------------------------------------

  /** Moves the Forge on by `dtMs` milliseconds. */
  tick(dtMs: number): void {
    const dt = Math.min(Math.max(0, dtMs), FORGE.maxStepMs);
    this.#sinceStrikeMs += dt;
    this.#coolHeat(dt);
    this.#runFrenzy(dt);
    this.#runMainspring(dt);
    this.#runIngot(dt);
  }

  #coolHeat(dt: number): void {
    const grace = FORGE.heat.graceMs;
    if (this.#heat <= 0 || this.#sinceStrikeMs <= grace) return;
    const coolingMs = Math.min(dt, this.#sinceStrikeMs - grace);
    const tierBefore = tierIndex(this.#heat);
    this.#heat = Math.max(0, this.#heat - (heatDrainPerSecond(this.#levels.tongs) * coolingMs) / 1000);
    const tierAfter = tierIndex(this.#heat);
    if (tierAfter < tierBefore) this.#emit({ type: "cooled", tier: tierAfter });
  }

  #runFrenzy(dt: number): void {
    if (this.#frenzyMs <= 0) return;
    this.#frenzyMs -= dt;
    if (this.#frenzyMs <= 0) {
      this.#frenzyMs = 0;
      this.#emit({ type: "frenzyEnded" });
    }
  }

  #runMainspring(dt: number): void {
    if (!this.#springRunning()) return;
    this.#autoClock += (this.#spring().rate * dt) / 1000;
    while (this.#autoClock >= 1 && this.#wound >= 1) {
      this.#autoClock -= 1;
      this.#wound -= 1;
      const credits = this.#pay(this.#baseValue() * FORGE.mainspring.autoValue * this.#frenzyMultiplier());
      this.#emit({ type: "auto", credits });
    }
    if (this.#wound < 1) this.#autoClock = 0;
  }

  #runIngot(dt: number): void {
    if (this.#ingot !== null) {
      this.#ingot.msLeft -= dt;
      if (this.#ingot.msLeft <= 0) {
        this.#ingot = null;
        this.#nextIngotMs = this.#ingotInterval();
        this.#emit({ type: "ingotExpired" });
      }
      return;
    }
    this.#nextIngotMs -= dt;
    if (this.#nextIngotMs <= 0) {
      this.#ingot = { x: 0.12 + 0.76 * this.#unit(), y: 0.12 + 0.4 * this.#unit(), msLeft: FORGE.ingot.lifetimeMs };
      this.#emit({ type: "ingotAppeared", x: this.#ingot.x, y: this.#ingot.y });
    }
  }

  // --- reading the state ---------------------------------------------------------------------

  state(): ForgeState {
    const tier = tierIndex(this.#heat);
    const costs = {} as Record<UpgradeId, number | null>;
    for (const id of UPGRADE_IDS) costs[id] = this.#levels[id] >= FORGE.upgrades[id].maxLevel ? null : upgradeCost(id, this.#levels[id]);
    return {
      heat: this.#heat,
      tier,
      tierName: FORGE.heat.tiers[tier]!.name,
      strikeValue: this.#baseValue() * this.#multiplier(tier),
      multiplier: this.#multiplier(tier),
      springOwned: this.#levels.mainspring > 0,
      wound: this.#wound,
      capacity: this.#spring().capacity,
      springRunning: this.#springRunning(),
      autoRate: this.#spring().rate,
      windPerStrike: this.#spring().windPerStrike,
      frenzyMsLeft: this.#frenzyMs,
      ingot: this.#ingot === null ? null : { ...this.#ingot },
      levels: { ...this.#levels },
      costs,
      strikes: this.#strikes,
      lifetime: this.#lifetime,
      bestHeat: this.#bestHeat,
    };
  }

  toSave(): ForgeSave {
    return { levels: { ...this.#levels }, strikes: this.#strikes, lifetime: this.#lifetime, bestHeat: this.#bestHeat };
  }

  // --- the rules, as small pieces ---------------------------------------------------------------

  #baseValue(): number {
    return strikeBase(this.#levels.hammer);
  }

  #frenzyMultiplier(): number {
    return this.#frenzyMs > 0 ? FORGE.ingot.frenzyMultiplier : 1;
  }

  #multiplier(tier: number): number {
    return FORGE.heat.tiers[tier]!.multiplier * this.#frenzyMultiplier();
  }

  #spring(): SpringStats {
    return springStats(this.#levels.mainspring);
  }

  #springRunning(): boolean {
    return this.#levels.mainspring > 0 && this.#wound >= 1 && this.#sinceStrikeMs >= FORGE.mainspring.idleMs;
  }

  /** Pays out the whole credits in `exact`, carrying the rest, so over time exactly what was earned is paid. */
  #pay(exact: number): number {
    this.#carry += exact;
    const whole = Math.floor(this.#carry + 1e-9);
    this.#carry -= whole;
    if (whole > 0) {
      this.#bank.earn(whole);
      this.#lifetime += whole;
    }
    return whole;
  }

  #ingotInterval(): number {
    const rules = FORGE.ingot;
    const span = rules.minIntervalMs + this.#unit() * (rules.maxIntervalMs - rules.minIntervalMs);
    return span * ingotWaitScale(this.#levels.luck);
  }

  /** A random number in [0, 1). */
  #unit(): number {
    return nextInt(this.#rng, 1_000_000) / 1_000_000;
  }
}
