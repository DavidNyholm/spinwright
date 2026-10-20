import { Container, Graphics, Text } from "pixi.js";
import type { Position } from "../engine/index.ts";
import type { Coin } from "../engine/hold/index.ts";
import { Animator, easeOutCubic } from "./animator.ts";
import { coinBack, coinFront, coinMetal } from "./art/mint.ts";
import { METALS, metalGradient, verticalGradient } from "./art/metal.ts";
import type { Metal } from "./art/metal.ts";
import { FONT_DISPLAY, PALETTE } from "./art/palette.ts";
import { Banner } from "./banner.ts";
import { coinLabel } from "./holdPlan.ts";
import { cellCenterX, cellCenterY, LAYOUT } from "./layout.ts";

const COIN_RADIUS = 50;
const FLIP_MS = 130;
const LAND_MS = 260;
const LAND_SCALE = 1.7;
const THUMP_MS = 320;
const VEIL_ALPHA = 0.8;
const VEIL_ALPHA_AT_REST = 0.55;
const FADE_MS = 320;
const GLOW_PERIOD_MS = 420;
const SPIN_RATE = 1 / 110;
const NUMBER_MS = 320;

const key = (reel: number, row: number): string => `${reel},${row}`;

export interface PrizePlate {
  readonly name: string;
  /** What it is worth, as a multiple of the total bet. */
  readonly multiple: number;
  /** True for the prize a full board pays. */
  readonly fullBoard: boolean;
}

export interface HoldLayerOptions {
  /** The size of the whole stage, the reels and the band under them. */
  readonly width: number;
  readonly height: number;
  /** The part of the stage the reels fill; the band under it is the rest. */
  readonly reelsHeight: number;
  readonly reels: number;
  readonly rows: number;
  /** Respins at the full count, which is how many pips there are. */
  readonly respins: number;
  readonly minCoins: number;
  readonly ladder: readonly PrizePlate[];
  readonly reduceMotion: boolean;
}

interface Socket {
  readonly container: Container;
  /** The ring that marks an empty cell; it goes when a coin takes the cell, but the dark recess stays under the coin. */
  readonly ring: Graphics;
  readonly spinner: Graphics;
}

interface PlacedCoin {
  readonly container: Container;
  readonly position: Position;
  readonly label: string;
}

interface Plate {
  readonly lit: Graphics;
  readonly name: string;
}

function text(content: string, size: number, fill: number, spacing = 2): Text {
  const label = new Text({
    text: content,
    style: { fontFamily: FONT_DISPLAY, fontSize: size, fontWeight: "800", fill, letterSpacing: spacing, stroke: { color: 0x1a0c07, width: Math.max(2, size / 8), join: "round" } },
  });
  label.anchor.set(0.5);
  return label;
}

/** What a coin's face says: its amount, and for a jackpot its name above it. */
function faceLines(coin: Coin): { text: string; size: number }[] {
  const amount = coinLabel(coin.win);
  const amountSize = amount.length <= 3 ? 38 : amount.length <= 5 ? 30 : 26;
  if (coin.jackpot === null) return [{ text: amount, size: amountSize }];
  return [
    { text: coin.jackpot.toUpperCase(), size: 20 },
    { text: amount, size: Math.min(amountSize, 24) },
  ];
}

/**
 * What hold and win adds to the picture: a veil over the reels, a socket in every cell that is still
 * empty, the coins (turned over to show their worth, and landing with a thump), and a band under the reels
 * with the respins left, the prizes and the total. The reels themselves are not touched. Everything is
 * moved by the animator it is given, so it speeds up with turbo and stop like the rest of the machine.
 */
export class HoldLayer {
  /** Veil, sockets, coins and glow: drawn over the reels, with the band under them. */
  readonly view = new Container();
  /** The banner: drawn above everything. */
  readonly banners = new Container();

  readonly #animator: Animator;
  readonly #options: HoldLayerOptions;
  readonly #veil = new Graphics();
  readonly #frame = new Graphics();
  readonly #sockets = new Map<string, Socket>();
  readonly #coins = new Map<string, PlacedCoin>();
  readonly #coinLayer = new Container();
  readonly #rings = new Container();
  readonly #banner: Banner;

  // The band under the reels.
  readonly #idle: Container;
  readonly #active: Container;
  readonly #pips: Graphics[] = [];
  readonly #count: Text;
  readonly #total: Text;
  readonly #totalBox = new Container();
  readonly #plates: Plate[] = [];

  /** How far the veil and glow have faded in, 0 to 1, and how bright the glow's breathing has it just now. */
  #level = 0;
  #breath = 1;
  #spinning = false;
  #litPips = 0;
  #shownTotal = 0;
  #numberToken = 0;

  constructor(animator: Animator, options: HoldLayerOptions) {
    this.#animator = animator;
    this.#options = options;
    const { width, reelsHeight, reels, rows } = options;

    this.#veil.rect(0, 0, width, reelsHeight).fill(0x050403);
    this.#veil.alpha = 0;
    this.#veil.visible = false;

    this.#frame
      .roundRect(6, 6, width - 12, reelsHeight - 12, 16)
      .stroke({ width: 10, color: PALETTE.amber, alpha: 0.5 })
      .roundRect(6, 6, width - 12, reelsHeight - 12, 16)
      .stroke({ width: 3, color: PALETTE.amberHot, alpha: 1 });
    this.#frame.alpha = 0;
    this.#frame.visible = false;

    const sockets = new Container();
    for (let reel = 0; reel < reels; reel++) {
      for (let row = 0; row < rows; row++) {
        const container = new Container();
        const recess = new Graphics()
          .roundRect(-LAYOUT.cellWidth / 2 + 12, -LAYOUT.cellHeight / 2 + 12, LAYOUT.cellWidth - 24, LAYOUT.cellHeight - 24, 14)
          .fill({ color: 0x0d0a07, alpha: 0.97 })
          .stroke({ width: 2, color: PALETTE.brassDark, alpha: 0.9 });
        const ring = new Graphics().circle(0, 0, COIN_RADIUS * 0.62).stroke({ width: 2, color: PALETTE.brassDark, alpha: 0.55 });
        const spinner = new Graphics()
          .arc(0, 0, COIN_RADIUS * 0.62, 0, Math.PI * 1.25)
          .stroke({ width: 5, color: PALETTE.amberHot, alpha: 0.95, cap: "round" })
          .arc(0, 0, COIN_RADIUS * 0.4, Math.PI, Math.PI * 2.1)
          .stroke({ width: 3, color: PALETTE.amber, alpha: 0.7, cap: "round" });
        spinner.visible = false;
        container.addChild(recess, ring, spinner);
        container.position.set(cellCenterX(reel), cellCenterY(row));
        container.visible = false;
        sockets.addChild(container);
        this.#sockets.set(key(reel, row), { container, ring, spinner });
      }
    }

    // The band: respins and counts on the left, the prizes in the middle, the total on the right.
    const band = new Container();
    const top = reelsHeight + 4;
    const bandHeight = options.height - top - 4;
    band.addChild(
      new Graphics()
        .roundRect(0, top, width, bandHeight, 14)
        .fill(verticalGradient([0, 0x15110d], [1, 0x0a0806]))
        .stroke({ width: 2, color: PALETTE.brassDark, alpha: 0.85 }),
    );
    const centreY = top + bandHeight / 2;

    this.#idle = new Container();
    const idleTitle = text("HOLD & WIN", 34, PALETTE.amberHot, 5);
    idleTitle.position.set(112, centreY - 12);
    const idleHint = text(`${options.minCoins} COINS START IT`, 17, PALETTE.text, 3);
    idleHint.position.set(112, centreY + 22);
    this.#idle.addChild(idleTitle, idleHint);

    this.#active = new Container();
    const respinLabel = text("RESPINS", 17, PALETTE.text, 4);
    respinLabel.position.set(112, centreY - 28);
    this.#active.addChild(respinLabel);
    const pipGap = 34;
    for (let i = 0; i < options.respins; i++) {
      const pip = new Graphics();
      pip.position.set(112 + (i - (options.respins - 1) / 2) * pipGap, centreY - 2);
      this.#pips.push(pip);
      this.#active.addChild(pip);
    }
    this.#count = text("", 19, PALETTE.brassLight, 3);
    this.#count.position.set(112, centreY + 32);
    this.#active.addChild(this.#count);
    this.#active.visible = false;

    const ladder = new Container();
    const plateWidth = 112;
    const plateGap = 8;
    const firstX = 226;
    const metals: readonly Metal[] = [METALS.copper, METALS.steel, METALS.gold];
    options.ladder.forEach((prize, index) => {
      const metal = prize.fullBoard ? { light: PALETTE.amberHot, mid: 0xe8791a, dark: 0x8a3a05, edge: 0x3a1602 } : metals[Math.min(index, metals.length - 1)]!;
      const plate = new Container();
      plate.position.set(firstX + index * (plateWidth + plateGap), top + 12);
      const h = bandHeight - 24;
      plate.addChild(
        new Graphics().roundRect(0, 0, plateWidth, h, 9).fill(metalGradient(metal)).stroke({ width: 2.5, color: metal.edge }),
        new Graphics().roundRect(7, 7, plateWidth - 14, h - 14, 6).fill(verticalGradient([0, 0x120d08], [1, 0x1d1610])).stroke({ width: 1.5, color: metal.edge }),
      );
      const name = text(prize.name.toUpperCase(), 17, metal.light, 3);
      name.position.set(plateWidth / 2, h * 0.34);
      const multiple = text(`×${new Intl.NumberFormat("en-US").format(prize.multiple)}`, 27, PALETTE.text, 1);
      multiple.position.set(plateWidth / 2, h * 0.7);
      const lit = new Graphics().roundRect(-3, -3, plateWidth + 6, h + 6, 11).stroke({ width: 4, color: PALETTE.amberHot, alpha: 1 }).roundRect(7, 7, plateWidth - 14, h - 14, 6).fill({ color: PALETTE.amber, alpha: 0.22 });
      lit.visible = false;
      plate.addChild(name, multiple, lit);
      ladder.addChild(plate);
      this.#plates.push({ lit, name: prize.name });
    });

    const totalLabel = text("TOTAL", 17, PALETTE.text, 4);
    totalLabel.position.set(width - 96, centreY - 28);
    this.#total = text("0", 40, PALETTE.amberHot, 2);
    this.#total.position.set(width - 96, centreY + 8);
    this.#totalBox.addChild(totalLabel, this.#total);
    this.#active.addChild(this.#totalBox);

    band.addChild(this.#idle, this.#active, ladder);

    this.#coinLayer.addChild(this.#rings);
    this.view.addChild(this.#veil, sockets, this.#coinLayer, this.#frame, band);
    this.#banner = new Banner(animator, { width, height: reelsHeight, reduceMotion: options.reduceMotion });
    this.banners.addChild(this.#banner.container);
    this.#drawPips(options.respins);
  }

  // --- what is on show, for QA ----------------------------------------------------------------

  /** The cells that hold a coin, with what each says, read back from what is drawn. */
  coinCells(): { position: Position; label: string }[] {
    return [...this.#coins.values()].map((coin) => ({ position: coin.position, label: coin.label }));
  }

  /** The prizes that are lit on the ladder, by name. */
  litPrizes(): string[] {
    return this.#plates.filter((plate) => plate.lit.visible).map((plate) => plate.name);
  }

  /** How many respin pips are lit, and the count and total the band shows. */
  readouts(): { pips: number; count: string; total: string } {
    return { pips: this.#litPips, count: this.#count.text, total: this.#total.text };
  }

  // --- the feature --------------------------------------------------------------------------

  /** Brings the feature on: the veil and glow fade in, an empty socket shows in every cell, and the band switches over. */
  async begin(): Promise<void> {
    this.#idle.visible = false;
    this.#active.visible = true;
    this.#veil.visible = true;
    this.#frame.visible = true;
    for (const socket of this.#sockets.values()) socket.container.visible = true;
    this.setRespins(this.#options.respins);
    this.setTotal(0, false);
    this.#count.text = "";
    await this.#fadeTo(1);
  }

  /** Eases the veil down a little and drops the glow, once the feature is over: the final board stays on show. */
  async settle(): Promise<void> {
    this.#spinning = false;
    for (const socket of this.#sockets.values()) socket.spinner.visible = false;
    await this.#fadeTo(0, VEIL_ALPHA_AT_REST / VEIL_ALPHA);
  }

  /** Puts everything back as it was before a feature, at once: no coins, no veil, an idle band. */
  reset(): void {
    this.#numberToken++;
    for (const placed of this.#coins.values()) placed.container.destroy({ children: true });
    this.#coins.clear();
    // Rings still opening out finish and destroy themselves; they are just taken off the board.
    this.#rings.removeChildren();
    for (const socket of this.#sockets.values()) {
      socket.container.visible = false;
      socket.ring.visible = true;
      socket.spinner.visible = false;
    }
    this.#spinning = false;
    this.#level = 0;
    this.#veil.visible = false;
    this.#veil.alpha = 0;
    this.#frame.visible = false;
    this.#frame.alpha = 0;
    this.#idle.visible = true;
    this.#active.visible = false;
    for (const plate of this.#plates) plate.lit.visible = false;
    this.#banner.hide();
    this.#shownTotal = 0;
    this.#drawPips(this.#options.respins);
  }

  /** Puts the coins face-down in their cells, then turns each over to show its worth, one after another. */
  async reveal(coins: readonly Coin[], options: { stagger: number; onEach?: (coin: Coin, index: number) => void }): Promise<void> {
    await Promise.all(
      coins.map(async (coin, index) => {
        if (index > 0) await this.#animator.wait(options.stagger * index);
        options.onEach?.(coin, index);
        await this.#place(coin, false);
      }),
    );
  }

  /** Drops a coin into its cell: it arrives large and settles with a thump, already showing its worth. */
  land(coin: Coin): Promise<void> {
    return this.#place(coin, true);
  }

  /** Lets the sockets of `cells` spin for `ms`, the wait before a respin shows what filled. */
  async spinEmpty(cells: readonly Position[], ms: number): Promise<void> {
    this.#spinning = true;
    for (const [reel, row] of cells) this.#sockets.get(key(reel, row))!.spinner.visible = true;
    await this.#animator.wait(ms);
    this.#spinning = false;
    for (const socket of this.#sockets.values()) socket.spinner.visible = false;
  }

  /** Lights `count` of the respin pips. */
  setRespins(count: number): void {
    this.#drawPips(count);
  }

  /** Says how many coins are on the board. */
  setCount(coins: number, cells: number): void {
    this.#count.text = `COINS ${coins} / ${cells}`;
  }

  /** Shows the total the coins on the board are worth, rolling up to it (or at once with `animate` off). */
  async setTotal(credits: number, animate = true): Promise<void> {
    const token = ++this.#numberToken;
    const from = this.#shownTotal;
    const show = (value: number): void => {
      this.#shownTotal = value;
      this.#total.text = new Intl.NumberFormat("en-US").format(Math.round(value));
    };
    if (!animate || this.#options.reduceMotion || credits === from) {
      show(credits);
      return;
    }
    await this.#animator.tween(NUMBER_MS, (progress) => {
      if (token === this.#numberToken) show(from + (credits - from) * progress);
    });
    if (token === this.#numberToken) show(credits);
  }

  /** Lights a prize on the ladder, and keeps it lit until the next round. */
  lightPrize(name: string): void {
    for (const plate of this.#plates) if (plate.name === name) plate.lit.visible = true;
  }

  banner(title: string, subtitle: string | null, holdMs: number): Promise<void> {
    return this.#banner.show(title, subtitle, holdMs);
  }

  /** Called every frame: the glow breathes while the feature is on, and the sockets that are spinning turn. */
  update(now: number): void {
    if (this.#options.reduceMotion) return;
    if (this.#frame.visible) {
      this.#breath = 0.75 + 0.25 * Math.sin(now / GLOW_PERIOD_MS);
      this.#frame.alpha = this.#level * this.#breath;
    }
    if (this.#spinning) {
      for (const socket of this.#sockets.values()) if (socket.spinner.visible) socket.spinner.rotation = now * SPIN_RATE;
    }
  }

  // --- parts ----------------------------------------------------------------------------------

  async #fadeTo(target: number, veilFraction = 1): Promise<void> {
    const from = this.#level;
    const fromVeil = this.#veil.alpha;
    await this.#animator.tween(FADE_MS, (progress) => {
      this.#level = from + (target - from) * progress;
      this.#veil.alpha = fromVeil + (VEIL_ALPHA * veilFraction - fromVeil) * progress;
      this.#frame.alpha = this.#level * this.#breath;
    });
    if (target === 0) this.#frame.visible = false;
  }

  #drawPips(lit: number): void {
    this.#litPips = lit;
    this.#pips.forEach((pip, index) => {
      pip.clear();
      const on = index < lit;
      pip
        .circle(0, 0, 12)
        .fill(on ? verticalGradient([0, PALETTE.amberHot], [1, 0xe8791a]) : 0x120d08)
        .stroke({ width: 2.5, color: on ? 0x3a1602 : PALETTE.brassDark });
      if (on) pip.circle(-3, -4, 3.5).fill({ color: 0xffffff, alpha: 0.6 });
    });
  }

  /** Seats a coin in its cell. Face-up it lands with a thump; face-down it just appears, to be turned over. */
  async #place(coin: Coin, faceUp: boolean): Promise<void> {
    const [reel, row] = coin.position;
    const cell = key(reel, row);
    this.#coins.get(cell)?.container.destroy({ children: true });
    this.#sockets.get(cell)!.ring.visible = false;

    const metal = coinMetal(coin.jackpot === null ? null : this.#rank(coin.jackpot));
    const back = coinBack(COIN_RADIUS, metal);
    const front = coinFront(COIN_RADIUS, metal, faceLines(coin));
    front.visible = faceUp;
    back.visible = !faceUp;
    const container = new Container();
    container.addChild(back, front);
    container.position.set(cellCenterX(reel), cellCenterY(row));
    this.#coinLayer.addChild(container);
    this.#coins.set(cell, { container, position: coin.position, label: faceLines(coin).map((line) => line.text).join(" ") });

    if (this.#options.reduceMotion) {
      front.visible = true;
      back.visible = false;
      return;
    }
    if (faceUp) {
      container.alpha = 0;
      container.scale.set(LAND_SCALE);
      this.#thump(reel, row);
      await this.#animator.tween(
        LAND_MS,
        (progress) => {
          container.alpha = Math.min(1, progress * 2.5);
          container.scale.set(LAND_SCALE + (1 - LAND_SCALE) * progress);
        },
        easeOutCubic,
      );
      return;
    }
    // Turn it over: the back narrows to an edge, the front widens out of one.
    await this.#animator.tween(FLIP_MS, (progress) => {
      back.scale.x = 1 - progress;
    });
    back.visible = false;
    front.visible = true;
    front.scale.x = 0;
    await this.#animator.tween(FLIP_MS, (progress) => (front.scale.x = progress), easeOutCubic);
  }

  /** A ring that opens out from a cell and fades, as a coin lands in it. */
  #thump(reel: number, row: number): void {
    const ring = new Graphics().circle(0, 0, COIN_RADIUS * 0.7).stroke({ width: 5, color: PALETTE.amberHot, alpha: 0.9 });
    ring.position.set(cellCenterX(reel), cellCenterY(row));
    this.#rings.addChild(ring);
    void this.#animator
      .tween(THUMP_MS, (progress) => {
        ring.scale.set(1 + progress * 0.9);
        ring.alpha = 1 - progress;
      })
      .then(() => ring.destroy());
  }

  /** The rank of a jackpot among the plates (the full-board prize is the last plate and is never a coin). */
  #rank(name: string): number | null {
    const index = this.#plates.findIndex((plate) => plate.name === name);
    return index < 0 ? null : index;
  }
}
