import { Circle, Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";
import type { Application, FederatedPointerEvent, Texture } from "pixi.js";
import { FORGE } from "../forge/config.ts";
import { formatAmount } from "../forge/describe.ts";
import type { ForgeEvent, ForgeState } from "../forge/engine.ts";
import type { StrikeInput } from "../forge/guard.ts";
import { gearOutline, METALS, metalGradient, mix, verticalGradient } from "./art/metal.ts";
import type { Metal } from "./art/metal.ts";
import { FONT_DISPLAY, PALETTE } from "./art/palette.ts";
import { floaterPose, HammerSwing, heatColor, sparkAlpha, spawnSparks, stepSpark } from "./forgeMotion.ts";
import type { Spark } from "./forgeMotion.ts";

/** The forge's picture is drawn at this size and scaled to fit the page. */
export const FORGE_STAGE = { width: 900, height: 420 } as const;

// Where things stand. The anvil's face is the line everything is struck on.
const ANVIL_X = 450;
const FACE_Y = 224;
const WORK = { width: 130, height: 12 } as const;
const WORK_TOP = FACE_Y - WORK.height;
const WORK_CENTRE_Y = WORK_TOP + WORK.height / 2;
/** Where each hammer's head lands along the workpiece: the player's on the right half, the mainspring's on the left. */
const PLAYER_HIT_X = 472;
const AUTO_HIT_X = 408;

const PLAYER_HAMMER = { length: 200, headWidth: 36, headHeight: 58, metal: METALS.steel } as const;
const AUTO_HAMMER = { length: 150, headWidth: 28, headHeight: 42, metal: METALS.copper } as const;

const SPARK_POOL = 220;
const FLOATER_POOL = 16;
const SPARKS_PER_STRIKE = 6;
const SPARKS_PER_TIER = 5;
const REDUCED_MOTION_SPARKS = 3;
const FLOATER_LIFE_MS = 900;
const BANNER_LIFE_MS = 1_100;
const INGOT_RADIUS = 56;
const INGOT_POP_MS = 220;
const INGOT_BLINK_MS = 2_000;
const SHAKE_PER_TIER = 1.6;
const SHAKE_DECAY_PER_SECOND = 28;
const GEAR_TEETH = 14;
/** A fully wound spring has turned its gear back this far; unwinding turns it forward again. */
const GEAR_FULL_WIND_RAD = 3 * Math.PI;
const GEAR_EASE_PER_SECOND = 16;

export interface ForgeSceneHandlers {
  onStrike(input: StrikeInput): void;
  onIngot(input: StrikeInput): void;
}

/** What the page needs to judge a click: when it happened, whether the browser vouches for it, and where. */
const pressOf = (event: FederatedPointerEvent): StrikeInput => ({
  // The hardware's own timestamp stays accurate when the page is busy; Pixi's is when it got round to handling the event.
  atMs: "timeStamp" in event.nativeEvent ? event.nativeEvent.timeStamp : event.timeStamp,
  trusted: event.isTrusted,
  x: event.client.x,
  y: event.client.y,
});

export interface ForgeSceneOptions {
  readonly reduceMotion: boolean;
  /** Source of the sparks' randomness; only the look depends on it. */
  readonly random?: () => number;
}

interface Floater {
  readonly text: Text;
  age: number;
  life: number;
  x: number;
  y: number;
  baseScale: number;
}

const hammerBody = (spec: { length: number; headWidth: number; headHeight: number; metal: Metal }): Container => {
  const hammer = new Container();
  const handle = new Graphics()
    .roundRect(-spec.length, -6, spec.length + 34, 12, 5)
    .fill(verticalGradient([0, 0xa4743f], [0.5, 0x7a5230], [1, 0x4a2f18]))
    .stroke({ width: 1, color: 0x2a1808 });
  const head = new Graphics()
    .roundRect(-spec.length - spec.headWidth / 2, -spec.headHeight / 2, spec.headWidth, spec.headHeight, 5)
    .fill(metalGradient(spec.metal))
    .stroke({ width: 2, color: spec.metal.edge })
    .roundRect(-spec.length - spec.headWidth / 2 + 5, -spec.headHeight / 2 + 5, 5, spec.headHeight - 10, 2)
    .fill({ color: 0xffffff, alpha: 0.25 });
  const hub = new Graphics()
    .circle(0, 0, 11)
    .fill(metalGradient(METALS.brass))
    .stroke({ width: 1.5, color: METALS.brass.edge })
    .circle(0, 0, 3.5)
    .fill(METALS.brass.edge);
  hammer.addChild(handle, head, hub);
  return hammer;
};

function drawAnvil(): Container {
  const anvil = new Container();
  const shadow = new Graphics().ellipse(ANVIL_X, 338, 130, 12).fill({ color: 0x000000, alpha: 0.5 });
  const body = new Graphics()
    .poly([
      288, 240, 318, 231, 345, 226, 362, FACE_Y, 556, FACE_Y, 568, 227, 570, 246, 526, 250, 504, 258, 504, 296, 536, 301, 536, 336, 364, 336, 364, 301, 396,
      296, 396, 258, 374, 250, 338, 249, 306, 246,
    ])
    .fill(verticalGradient([0, 0x7a7266], [0.35, 0x433d34], [1, 0x1b1713]))
    .stroke({ width: 2, color: 0x0d0b09, join: "round" });
  const edge = new Graphics()
    .moveTo(318, 232)
    .lineTo(345, 227)
    .lineTo(362, FACE_Y + 1)
    .lineTo(556, FACE_Y + 1)
    .stroke({ width: 2.5, color: 0xbdb3a1, alpha: 0.7, cap: "round", join: "round" });
  const base = new Graphics().roundRect(372, 322, 156, 5, 2).fill({ color: 0xffffff, alpha: 0.07 });
  anvil.addChild(shadow, body, edge, base);
  return anvil;
}

function drawBackground(): Container {
  const back = new Container();
  const bed = new Graphics()
    .roundRect(0, 0, FORGE_STAGE.width, FORGE_STAGE.height, 14)
    .fill(verticalGradient([0, 0x15110d], [1, 0x0a0806]))
    .stroke({ width: 2, color: PALETTE.brassDark, alpha: 0.85 });
  // A back wall of brickwork, faint enough not to compete with the iron.
  const bricks = new Graphics();
  for (let row = 0; row < 11; row++) {
    const y = 20 + row * 28;
    bricks.moveTo(8, y).lineTo(FORGE_STAGE.width - 8, y);
    for (let x = 8 + (row % 2) * 30; x < FORGE_STAGE.width - 8; x += 60) bricks.moveTo(x, y).lineTo(x, y + 28);
  }
  bricks.stroke({ width: 1, color: 0xffffff, alpha: 0.035 });
  const floor = new Graphics()
    .rect(8, 336, FORGE_STAGE.width - 16, FORGE_STAGE.height - 344)
    .fill(verticalGradient([0, 0x1d1812], [1, 0x0b0907]))
    .moveTo(8, 336)
    .lineTo(FORGE_STAGE.width - 8, 336)
    .stroke({ width: 2, color: PALETTE.brassDark, alpha: 0.7 });
  // The hearth on the left: a dark arch that glows with the heat.
  const hearth = new Graphics()
    .moveTo(40, 336)
    .lineTo(40, 230)
    .arc(115, 230, 75, Math.PI, 0)
    .lineTo(190, 336)
    .closePath()
    .fill(0x0b0806)
    .stroke({ width: 5, color: 0x2a241d, join: "round" });
  back.addChild(bed, bricks, floor, hearth);
  return back;
}

/** Layered translucent circles, the cheap way to get a soft glow that can be faded with one alpha. */
function glowDisc(radius: number, color: number): Graphics {
  const glow = new Graphics();
  for (let i = 8; i >= 1; i--) glow.circle(0, 0, (radius * i) / 8).fill({ color, alpha: 0.07 });
  glow.blendMode = "add";
  return glow;
}

/**
 * The forge as a picture: an anvil under a swinging hammer, sparks, numbers floating up, the
 * mainspring's gear and its automatic hammer, and the ingot to catch. It draws what the rules
 * engine reports (events, and state each frame) and decides nothing about the game.
 */
export class ForgeScene {
  readonly #handlers: ForgeSceneHandlers;
  readonly #reduceMotion: boolean;
  readonly #random: () => number;

  readonly #world = new Container();
  readonly #hearthGlow = glowDisc(150, 0xff7a1a);
  readonly #workGlow = glowDisc(170, 0xffa040);
  readonly #work = new Graphics().roundRect(-WORK.width / 2, -WORK.height / 2, WORK.width, WORK.height, 4).fill(0xffffff);
  readonly #player = hammerBody(PLAYER_HAMMER);
  readonly #auto = hammerBody(AUTO_HAMMER);
  readonly #gear = new Container();
  readonly #gearBody = new Container();
  readonly #sparkLayer = new Container();
  readonly #floaterLayer = new Container();
  readonly #ingot = new Container();
  readonly #ingotRing = new Graphics();
  readonly #ingotGlow = glowDisc(80, 0xffd27a);
  readonly #frenzyFrame = new Graphics();
  readonly #frenzyLabel: Text;
  readonly #banner: Text;

  readonly #playerSwing = new HammerSwing();
  readonly #autoSwing = new HammerSwing();
  /** Strikes whose hammers have not yet landed, so the sparks come at the moment of impact. */
  readonly #playerImpacts: { tier: number }[] = [];
  readonly #autoImpacts: { tier: number }[] = [];

  readonly #sparkSprites: Sprite[] = [];
  readonly #sparks: (Spark | null)[] = [];
  readonly #floaters: Floater[] = [];
  #bannerAge = Infinity;

  #flash = 0;
  #shake = 0;
  #gearAngle = 0;
  #clock = 0;
  #ingotAge = 0;
  #ingotShown = false;
  #ingotPosition = { x: ANVIL_X, y: 120 };
  #heat = 0;

  constructor(app: Application, handlers: ForgeSceneHandlers, options: ForgeSceneOptions) {
    this.#handlers = handlers;
    this.#reduceMotion = options.reduceMotion;
    this.#random = options.random ?? Math.random;

    app.stage.eventMode = "static";
    app.stage.hitArea = new Rectangle(0, 0, FORGE_STAGE.width, FORGE_STAGE.height);
    app.stage.on("pointerdown", (event) => this.#handlers.onStrike(pressOf(event)));

    this.#hearthGlow.position.set(115, 290);
    this.#workGlow.position.set(ANVIL_X, WORK_CENTRE_Y);
    this.#work.position.set(ANVIL_X, WORK_CENTRE_Y);

    this.#player.position.set(PLAYER_HIT_X + PLAYER_HAMMER.length, WORK_TOP - PLAYER_HAMMER.headHeight / 2);
    this.#auto.position.set(AUTO_HIT_X - AUTO_HAMMER.length, WORK_TOP - AUTO_HAMMER.headHeight / 2);
    // The mainspring's hammer is the player's turned around, so its handle runs the other way.
    this.#auto.scale.x = -1;

    this.#buildGear();
    this.#buildIngot();

    const sparkTexture = this.#makeSparkTexture(app);
    for (let i = 0; i < SPARK_POOL; i++) {
      const sprite = new Sprite(sparkTexture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.visible = false;
      this.#sparkSprites.push(sprite);
      this.#sparks.push(null);
      this.#sparkLayer.addChild(sprite);
    }

    for (let i = 0; i < FLOATER_POOL; i++) {
      const text = new Text({
        text: "",
        style: {
          fontFamily: FONT_DISPLAY,
          fontSize: 30,
          fontWeight: "800",
          fill: PALETTE.amberHot,
          stroke: { color: 0x1a0c07, width: 5, join: "round" },
          letterSpacing: 1,
        },
      });
      text.anchor.set(0.5);
      text.visible = false;
      this.#floaters.push({ text, age: Infinity, life: FLOATER_LIFE_MS, x: 0, y: 0, baseScale: 1 });
      this.#floaterLayer.addChild(text);
    }

    this.#banner = new Text({
      text: "",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 52,
        fontWeight: "800",
        fill: PALETTE.amberHot,
        stroke: { color: 0x1a0c07, width: 7, join: "round" },
        letterSpacing: 8,
      },
    });
    this.#banner.anchor.set(0.5);
    this.#banner.position.set(ANVIL_X, 96);
    this.#banner.visible = false;

    this.#frenzyFrame.roundRect(4, 4, FORGE_STAGE.width - 8, FORGE_STAGE.height - 8, 12).stroke({ width: 8, color: PALETTE.amber, alpha: 0.9 });
    this.#frenzyFrame.visible = false;
    this.#frenzyLabel = new Text({
      text: "",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 26,
        fontWeight: "800",
        fill: PALETTE.amberHot,
        stroke: { color: 0x1a0c07, width: 5, join: "round" },
        letterSpacing: 6,
      },
    });
    this.#frenzyLabel.anchor.set(0.5, 0);
    this.#frenzyLabel.position.set(FORGE_STAGE.width / 2, 14);
    this.#frenzyLabel.visible = false;

    this.#world.addChild(
      drawBackground(),
      this.#hearthGlow,
      this.#gear,
      drawAnvil(),
      this.#workGlow,
      this.#work,
      this.#auto,
      this.#player,
      this.#sparkLayer,
      this.#floaterLayer,
      this.#banner,
      this.#ingot,
    );
    app.stage.addChild(this.#world, this.#frenzyFrame, this.#frenzyLabel);

    this.#applyPoses();
  }

  // --- what happened ---------------------------------------------------------------------------

  /** Shows an engine event. Sounds are not made here; the page does that. */
  handle(event: ForgeEvent): void {
    switch (event.type) {
      case "strike":
        this.#playerSwing.strike();
        this.#playerImpacts.push({ tier: event.tier });

        this.#floatNumber(`+${formatAmount(event.credits)}`, PLAYER_HIT_X + (this.#random() - 0.5) * 70, WORK_TOP - 70, 28 + event.tier * 5, mix(PALETTE.amberHot, 0xffffff, event.tier / 4));
        break;
      case "auto":
        this.#autoSwing.strike();
        this.#autoImpacts.push({ tier: 0 });
        if (event.credits > 0) this.#floatNumber(`+${formatAmount(event.credits)}`, AUTO_HIT_X + (this.#random() - 0.5) * 50, WORK_TOP - 60, 22, PALETTE.brassLight);
        break;
      case "tierUp":
        this.#showBanner(FORGE.heat.tiers[event.tier]!.name.toUpperCase());
        break;
      case "ingotCaught":
        this.#burst(this.#ingotPosition.x, this.#ingotPosition.y, this.#reduceMotion ? 10 : 46, 1.3, 0xffd27a);
        if (event.reward.kind === "windfall") {
          this.#floatNumber(`+${formatAmount(event.reward.credits)}`, this.#ingotPosition.x, this.#ingotPosition.y, 48, METALS.gold.light);
        } else {
          this.#showBanner(`FRENZY ×${FORGE.ingot.frenzyMultiplier}`);
        }
        break;
      default:
        break;
    }
  }

  // --- each frame --------------------------------------------------------------------------------

  update(dtMs: number, state: ForgeState): void {
    this.#clock += dtMs;
    this.#heat = state.heat;

    if (this.#playerSwing.update(dtMs)) this.#landPlayer();
    if (this.#autoSwing.update(dtMs)) this.#landAuto();
    this.#flash = Math.max(0, this.#flash - dtMs / 160);
    this.#shake = Math.max(0, this.#shake - (SHAKE_DECAY_PER_SECOND * dtMs) / 1000);

    this.#work.tint = mix(heatColor(state.heat), 0xffffff, this.#flash * 0.55);
    const heatShare = state.heat / FORGE.heat.max;
    this.#workGlow.alpha = Math.min(1, 0.05 + heatShare ** 0.8 * 0.95 + this.#flash * 0.4);
    this.#hearthGlow.alpha = 0.18 + heatShare * 0.7 + (this.#reduceMotion ? 0 : Math.sin(this.#clock / 380) * 0.04);

    this.#updateGear(dtMs, state);
    this.#updateIngot(dtMs, state);
    this.#updateFrenzy(state);
    this.#updateSparks(dtMs);
    this.#updateFloaters(dtMs);
    this.#updateBanner(dtMs);
    this.#applyPoses();
  }

  #applyPoses(): void {
    this.#player.rotation = this.#playerSwing.angle;
    this.#auto.rotation = -this.#autoSwing.angle;
    const shake = this.#reduceMotion ? 0 : this.#shake;
    if (shake > 0.01) this.#world.position.set((this.#random() - 0.5) * 2 * shake, (this.#random() - 0.5) * 2 * shake);
    else this.#world.position.set(0, 0);
  }

  #landPlayer(): void {
    const impact = this.#playerImpacts.shift();
    const tier = impact?.tier ?? 0;
    this.#flash = 1;
    this.#shake = Math.max(this.#shake, tier * SHAKE_PER_TIER);
    const count = this.#reduceMotion ? REDUCED_MOTION_SPARKS : SPARKS_PER_STRIKE + SPARKS_PER_TIER * tier;
    this.#burst(PLAYER_HIT_X - 14, WORK_TOP, count, 1 + tier * 0.12, mix(0xff9a2a, 0xfff0c0, this.#heat / FORGE.heat.max));
  }

  #landAuto(): void {
    this.#autoImpacts.shift();
    this.#flash = Math.max(this.#flash, 0.5);
    this.#burst(AUTO_HIT_X + 12, WORK_TOP, this.#reduceMotion ? 2 : 4, 0.8, 0xffb86a);
  }

  // --- sparks and numbers ---------------------------------------------------------------------------

  #makeSparkTexture(app: Application): Texture {
    const dot = new Graphics().circle(0, 0, 8).fill({ color: 0xffffff, alpha: 0.35 }).circle(0, 0, 4).fill(0xffffff);
    const texture = app.renderer.generateTexture({ target: dot, resolution: 2 });
    dot.destroy();
    return texture;
  }

  #burst(x: number, y: number, count: number, power: number, color: number): void {
    const fresh = spawnSparks(this.#random, x, y, count, power);
    for (const spark of fresh) {
      const slot = this.#sparks.findIndex((existing) => existing === null);
      if (slot === -1) return;
      this.#sparks[slot] = spark;
      const sprite = this.#sparkSprites[slot]!;
      sprite.tint = color;
      sprite.visible = true;
    }
  }

  #updateSparks(dtMs: number): void {
    for (let i = 0; i < this.#sparks.length; i++) {
      const spark = this.#sparks[i];
      if (spark === null || spark === undefined) continue;
      const sprite = this.#sparkSprites[i]!;
      if (!stepSpark(spark, dtMs)) {
        this.#sparks[i] = null;
        sprite.visible = false;
        continue;
      }
      sprite.position.set(spark.x, spark.y);
      sprite.alpha = sparkAlpha(spark);
      sprite.scale.set(spark.size / 6);
    }
  }

  #floatNumber(text: string, x: number, y: number, size: number, color: number): void {
    // The oldest floater is reused if all are busy, so a flurry of strikes never stops showing numbers.
    const floater = this.#floaters.reduce((best, candidate) => (candidate.age > best.age ? candidate : best));
    floater.age = 0;
    floater.life = FLOATER_LIFE_MS;
    floater.x = x;
    floater.y = y;
    floater.baseScale = size / 30;
    floater.text.text = text;
    floater.text.style.fill = color;
    floater.text.visible = true;
  }

  #updateFloaters(dtMs: number): void {
    for (const floater of this.#floaters) {
      if (floater.age === Infinity) continue;
      floater.age += dtMs;
      if (floater.age >= floater.life) {
        floater.age = Infinity;
        floater.text.visible = false;
        continue;
      }
      const pose = floaterPose(floater.age, floater.life);
      floater.text.position.set(floater.x, floater.y + pose.dy);
      floater.text.alpha = pose.alpha;
      floater.text.scale.set(floater.baseScale * (this.#reduceMotion ? 1 : pose.scale));
    }
  }

  #showBanner(text: string): void {
    this.#banner.text = text;
    this.#bannerAge = 0;
    this.#banner.visible = true;
  }

  #updateBanner(dtMs: number): void {
    if (this.#bannerAge === Infinity) return;
    this.#bannerAge += dtMs;
    if (this.#bannerAge >= BANNER_LIFE_MS) {
      this.#bannerAge = Infinity;
      this.#banner.visible = false;
      return;
    }
    const pose = floaterPose(this.#bannerAge, BANNER_LIFE_MS);
    this.#banner.alpha = pose.alpha;
    this.#banner.scale.set(this.#reduceMotion ? 1 : pose.scale);
  }

  // --- the mainspring gear -----------------------------------------------------------------------------

  #buildGear(): void {
    const spokes = new Graphics();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      spokes.moveTo(Math.cos(angle) * 10, Math.sin(angle) * 10).lineTo(Math.cos(angle) * 30, Math.sin(angle) * 30);
    }
    spokes.stroke({ width: 6, color: METALS.brass.mid });
    const teeth = new Graphics()
      .poly(gearOutline(GEAR_TEETH, 42, 54))
      .fill(metalGradient(METALS.brass))
      .stroke({ width: 2, color: METALS.brass.edge, join: "round" })
      .circle(0, 0, 32)
      .fill(0x16110c)
      .circle(0, 0, 32)
      .stroke({ width: 3, color: METALS.brass.dark });
    const hub = new Graphics().circle(0, 0, 13).fill(metalGradient(METALS.brass)).stroke({ width: 1.5, color: METALS.brass.edge }).circle(0, 0, 4).fill(METALS.brass.edge);
    this.#gearBody.addChild(teeth, spokes, hub);
    this.#gear.addChild(this.#gearBody);
    this.#gear.position.set(820, 270);
  }

  #updateGear(dtMs: number, state: ForgeState): void {
    // Until a mainspring is fitted the gear is only a dim outline of what is missing.
    this.#gear.alpha = state.springOwned ? 1 : 0.14;
    // The gear shows how wound the spring is: winding turns it back, and each automatic strike turns it forward.
    const target = state.capacity > 0 ? -(state.wound / state.capacity) * GEAR_FULL_WIND_RAD : 0;
    const ease = 1 - Math.exp((-GEAR_EASE_PER_SECOND * dtMs) / 1000);
    this.#gearAngle += (target - this.#gearAngle) * ease;
    this.#gearBody.rotation = this.#gearAngle;
  }

  // --- the ingot -------------------------------------------------------------------------------------------

  #buildIngot(): void {
    const bar = new Graphics()
      .poly([-36, 16, -24, -14, 24, -14, 36, 16])
      .fill(metalGradient(METALS.gold))
      .stroke({ width: 2.5, color: METALS.gold.edge, join: "round" })
      .poly([-22, -8, 22, -8, 26, -2, -26, -2])
      .fill({ color: 0xffffff, alpha: 0.4 });
    const shine = new Graphics()
      .moveTo(-12, -22)
      .lineTo(12, -22)
      .moveTo(0, -34)
      .lineTo(0, -10)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.9, cap: "round" });
    shine.position.set(26, -4);
    this.#ingot.addChild(this.#ingotGlow, this.#ingotRing, bar, shine);
    this.#ingot.visible = false;
    this.#ingot.eventMode = "static";
    this.#ingot.cursor = "pointer";
    this.#ingot.hitArea = new Circle(0, 0, INGOT_RADIUS);
    this.#ingot.on("pointerdown", (event) => {
      // The click was for the ingot, not for the anvil underneath it.
      event.stopPropagation();
      this.#handlers.onIngot(pressOf(event));
    });
  }

  #updateIngot(dtMs: number, state: ForgeState): void {
    const ingot = state.ingot;
    if (ingot === null) {
      this.#ingot.visible = false;
      this.#ingotShown = false;
      return;
    }
    if (!this.#ingotShown) {
      this.#ingotShown = true;
      this.#ingotAge = 0;
    }
    this.#ingotAge += dtMs;
    this.#ingotPosition = { x: ingot.x * FORGE_STAGE.width, y: ingot.y * FORGE_STAGE.height };
    const bob = this.#reduceMotion ? 0 : Math.sin(this.#clock / 260) * 5;
    this.#ingot.position.set(this.#ingotPosition.x, this.#ingotPosition.y + bob);
    this.#ingot.visible = true;

    const pop = this.#reduceMotion ? 1 : Math.min(1, this.#ingotAge / INGOT_POP_MS);
    this.#ingot.scale.set(0.3 + 0.7 * (1 - (1 - pop) ** 3));
    // In its last moments it blinks, so it is clear it is about to go.
    const blinking = ingot.msLeft < INGOT_BLINK_MS && Math.floor(this.#clock / 140) % 2 === 0;
    this.#ingot.alpha = blinking ? 0.45 : 1;
    this.#ingotGlow.alpha = this.#reduceMotion ? 0.6 : 0.5 + Math.sin(this.#clock / 200) * 0.2;

    const share = ingot.msLeft / FORGE.ingot.lifetimeMs;
    this.#ingotRing
      .clear()
      .arc(0, 0, 47, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * share)
      .stroke({ width: 4, color: PALETTE.amberHot, alpha: 0.85, cap: "round" });
  }

  // --- frenzy ------------------------------------------------------------------------------------------------

  #updateFrenzy(state: ForgeState): void {
    const frenzy = state.frenzyMsLeft > 0;
    this.#frenzyFrame.visible = frenzy;
    this.#frenzyLabel.visible = frenzy;
    if (!frenzy) return;
    this.#frenzyFrame.alpha = this.#reduceMotion ? 0.7 : 0.55 + Math.sin(this.#clock / 120) * 0.3;
    this.#frenzyLabel.text = `FRENZY ×${FORGE.ingot.frenzyMultiplier}  ${Math.ceil(state.frenzyMsLeft / 1000)}s`;
  }

  // --- for QA ----------------------------------------------------------------------------------------------------

  qa(): { sparks: number; floaters: number; hammer: number; autoHammer: number; ingotVisible: boolean; gearAngle: number; shake: number } {
    return {
      sparks: this.#sparks.filter((spark) => spark !== null).length,
      floaters: this.#floaters.filter((floater) => floater.age !== Infinity).length,
      hammer: this.#playerSwing.angle,
      autoHammer: this.#autoSwing.angle,
      ingotVisible: this.#ingot.visible,
      gearAngle: this.#gearAngle,
      shake: this.#shake,
    };
  }
}
