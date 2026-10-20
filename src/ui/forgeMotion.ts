/**
 * The Forge's motion, as plain maths with no drawing: the hammer's swing, sparks, floating numbers
 * and the colour of hot iron. The scene (forgeScene.ts) only places what these return, so the
 * movement can be tested without a screen.
 */

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeInQuad = (t: number): number => t * t;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export const SWING = {
  /** Where the hammer waits, raised, in radians from the anvil (0 is the head on the iron). */
  restRad: 0.95,
  fallMs: 35,
  holdMs: 40,
  riseMs: 190,
} as const;

/**
 * A hammer that drops on each strike and lifts again. A strike that arrives while it is still
 * lifting starts the next fall from where it is, so fast striking looks like fast hammering and
 * never like a jump.
 */
export class HammerSwing {
  #angle: number = SWING.restRad;
  #from: number = SWING.restRad;
  /** Time since the last strike, or null when the hammer is at rest. */
  #elapsed: number | null = null;

  get angle(): number {
    return this.#angle;
  }

  strike(): void {
    this.#from = this.#angle;
    this.#elapsed = 0;
  }

  /** Moves on by `dtMs`. Returns true on the step the head reaches the iron. */
  update(dtMs: number): boolean {
    if (this.#elapsed === null) return false;
    const before = this.#elapsed;
    this.#elapsed += dtMs;
    const t = this.#elapsed;
    const { fallMs, holdMs, riseMs, restRad } = SWING;

    if (t < fallMs) this.#angle = this.#from * (1 - easeInQuad(t / fallMs));
    else if (t < fallMs + holdMs) this.#angle = 0;
    else if (t < fallMs + holdMs + riseMs) this.#angle = restRad * easeOutCubic((t - fallMs - holdMs) / riseMs);
    else {
      this.#angle = restRad;
      this.#elapsed = null;
    }
    return before < fallMs && t >= fallMs;
  }
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Milliseconds lived. */
  age: number;
  life: number;
  size: number;
}

export const SPARKS = {
  gravity: 1100,
  /** Share of speed kept each second. */
  drag: 0.35,
  minSpeed: 140,
  maxSpeed: 460,
  minLifeMs: 350,
  maxLifeMs: 850,
  minSize: 1.4,
  maxSize: 3.4,
} as const;

/** Throws a burst of sparks up and out from a point. `random` returns [0, 1). */
export function spawnSparks(random: () => number, x: number, y: number, count: number, power = 1): Spark[] {
  const sparks: Spark[] = [];
  for (let i = 0; i < count; i++) {
    // Mostly upward: between 15 and 165 degrees above the horizontal.
    const angle = -(Math.PI * (0.083 + 0.833 * random()));
    const speed = (SPARKS.minSpeed + (SPARKS.maxSpeed - SPARKS.minSpeed) * random()) * power;
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: SPARKS.minLifeMs + (SPARKS.maxLifeMs - SPARKS.minLifeMs) * random(),
      size: SPARKS.minSize + (SPARKS.maxSize - SPARKS.minSize) * random(),
    });
  }
  return sparks;
}

/** Moves a spark on by `dtMs`. Returns false once it has burnt out. */
export function stepSpark(spark: Spark, dtMs: number): boolean {
  const dt = dtMs / 1000;
  spark.vy += SPARKS.gravity * dt;
  const keep = SPARKS.drag ** dt;
  spark.vx *= keep;
  spark.vy *= keep;
  spark.x += spark.vx * dt;
  spark.y += spark.vy * dt;
  spark.age += dtMs;
  return spark.age < spark.life;
}

/** How bright a spark is: full for most of its life, then fading to nothing. */
export const sparkAlpha = (spark: Spark): number => clamp01((1 - spark.age / spark.life) * 2.2);

export const FLOATER = { riseDistance: 74, popScale: 0.45 } as const;

/** Where a floating number is at `age` of its `life`: rising, popping in, then fading out. */
export function floaterPose(age: number, life: number): { dy: number; alpha: number; scale: number } {
  const t = clamp01(age / life);
  return {
    dy: 0 - FLOATER.riseDistance * easeOutCubic(t),
    // Solid for the first 55% of its life, then a straight fade to nothing at the end.
    alpha: Math.min(1, (1 - t) / 0.45),
    scale: 1 + FLOATER.popScale * (1 - clamp01(t * 5)),
  };
}

const HEAT_COLORS: readonly (readonly [heat: number, color: number])[] = [
  [0, 0x555049], // cold iron, darker than the dull red it warms into
  [25, 0xa63f1d], // dull red
  [50, 0xe8681f], // orange
  [80, 0xffb347], // amber
  [100, 0xfff2d2], // white-hot
];

const channel = (color: number, shift: number): number => (color >> shift) & 0xff;

/** The colour of iron at a heat from 0 to 100, as 0xRRGGBB. */
export function heatColor(heat: number): number {
  const h = Math.min(100, Math.max(0, heat));
  let index = 0;
  while (index < HEAT_COLORS.length - 2 && h > HEAT_COLORS[index + 1]![0]) index++;
  const [h0, c0] = HEAT_COLORS[index]!;
  const [h1, c1] = HEAT_COLORS[index + 1]!;
  const t = (h - h0) / (h1 - h0);
  let color = 0;
  for (const shift of [16, 8, 0]) color |= Math.round(channel(c0, shift) + (channel(c1, shift) - channel(c0, shift)) * t) << shift;
  return color;
}

/** Perceived brightness of a 0xRRGGBB colour, 0 to 255. */
export const brightness = (color: number): number => 0.299 * channel(color, 16) + 0.587 * channel(color, 8) + 0.114 * channel(color, 0);
