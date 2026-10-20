import { Container, Graphics, Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
import type { Position } from "../engine/index.ts";
import { Animator, easeOutCubic } from "./animator.ts";
import { gearOutline, METALS, metalGradient } from "./art/metal.ts";
import { PALETTE } from "./art/palette.ts";
import { Banner } from "./banner.ts";
import { LAYOUT, reelX, rowY } from "./layout.ts";

const LOCK_IN_MS = 280;
/** A cog starts this much larger than its cell and settles into it. */
const LOCK_IN_SCALE = 1.4;
const FRAME_FADE_MS = 320;
const DIM_ALPHA = 0.3;
const GLOW_PERIOD_MS = 420;

const key = (reel: number, row: number): string => `${reel},${row}`;

interface Cog {
  readonly container: Container;
  readonly position: Position;
}

export interface FeatureLayerOptions {
  /** The size of the whole reel stage. */
  readonly width: number;
  readonly height: number;
  readonly reduceMotion: boolean;
}

/**
 * What the free spins add to the picture: wilds that stay locked in their cells, a glow around the
 * reels while the feature is on, and the banners that announce it. The reels themselves are not
 * touched; the cogs sit on top of them, so a locked cell shows a wild whatever the reel under it landed on.
 */
export class FeatureLayer {
  /** Cogs and the glow: drawn above the reels, below the win outlines. */
  readonly cogs = new Container();
  /** Banners: drawn above everything. */
  readonly banners = new Container();

  readonly #animator: Animator;
  readonly #wild: Texture;
  readonly #options: FeatureLayerOptions;
  readonly #placed = new Map<string, Cog>();
  readonly #frame = new Graphics();
  readonly #banner: Banner;
  /** How far the glow has faded in, 0 to 1, and how bright its breathing has it just now, 0.75 to 1. */
  #level = 0;
  #breath = 1;

  constructor(animator: Animator, wild: Texture, options: FeatureLayerOptions) {
    this.#animator = animator;
    this.#wild = wild;
    this.#options = options;
    const { width, height } = options;

    this.#frame
      .roundRect(6, 6, width - 12, height - 12, 16)
      .stroke({ width: 10, color: PALETTE.amber, alpha: 0.5 })
      .roundRect(6, 6, width - 12, height - 12, 16)
      .stroke({ width: 3, color: PALETTE.amberHot, alpha: 1 });
    this.#frame.alpha = 0;
    this.#frame.visible = false;
    this.cogs.addChild(this.#frame);

    this.#banner = new Banner(animator, options);
    this.banners.addChild(this.#banner.container);
  }

  /** The cells that hold a locked wild, for QA. */
  positions(): Position[] {
    return [...this.#placed.values()].map((cog) => cog.position);
  }

  /** Puts a locked wild in each cell, settling into place one after another (or all at once with no animation). */
  async lock(positions: readonly Position[], options: { onEach?: (index: number) => void; stagger?: number } = {}): Promise<void> {
    const arrivals = positions.map(async ([reel, row], index) => {
      if (options.stagger !== undefined && index > 0) await this.#animator.wait(options.stagger * index);
      options.onEach?.(index);
      return this.#seat(reel, row);
    });
    await Promise.all(arrivals);
  }

  /** Removes every locked wild. */
  clear(): void {
    for (const cog of this.#placed.values()) cog.container.destroy({ children: true });
    this.#placed.clear();
  }

  /** Puts everything back as it was before a feature, at once: no cogs, no glow, no banner. */
  reset(): void {
    this.clear();
    this.#level = 0;
    this.#frame.visible = false;
    this.#frame.alpha = 0;
    this.#banner.hide();
  }

  /** Dims the locked wilds that are not in `lit`, so a win outline stands out; null brings them all back. */
  dim(lit: ReadonlySet<string> | null): void {
    for (const [cell, cog] of this.#placed) cog.container.alpha = lit === null || lit.has(cell) ? 1 : DIM_ALPHA;
  }

  /** Fades the glow around the reels in or out. */
  async setActive(on: boolean): Promise<void> {
    const from = this.#level;
    const target = on ? 1 : 0;
    if (on) this.#frame.visible = true;
    await this.#animator.tween(FRAME_FADE_MS, (progress) => {
      this.#level = from + (target - from) * progress;
      this.#applyGlow();
    });
    if (!on) this.#frame.visible = false;
  }

  /** Shows a banner, holds it for `holdMs`, and fades it out. */
  banner(title: string, subtitle: string | null, holdMs: number): Promise<void> {
    return this.#banner.show(title, subtitle, holdMs);
  }

  /** Called every frame, to make the glow breathe while the feature is on. */
  update(now: number): void {
    if (!this.#frame.visible || this.#options.reduceMotion) return;
    this.#breath = 0.75 + 0.25 * Math.sin(now / GLOW_PERIOD_MS);
    this.#applyGlow();
  }

  #applyGlow(): void {
    this.#frame.alpha = this.#level * this.#breath;
  }

  async #seat(reel: number, row: number): Promise<void> {
    const cell = key(reel, row);
    this.#placed.get(cell)?.container.destroy({ children: true });

    const container = new Container();
    const art = new Sprite(this.#wild);
    // A brass ring around the cell with a small cog in its corner: this wild is locked, not just landed.
    const ring = new Graphics()
      .roundRect(3, 3, LAYOUT.cellWidth - 6, LAYOUT.cellHeight - 6, 12)
      .stroke({ width: 4, color: PALETTE.amberHot, alpha: 0.95 });
    const cog = new Graphics()
      .poly(gearOutline(10, 9, 14))
      .fill(metalGradient(METALS.brass))
      .stroke({ width: 1.5, color: METALS.brass.edge })
      .circle(0, 0, 4)
      .fill(METALS.brass.edge);
    cog.position.set(LAYOUT.cellWidth - 22, 22);
    container.addChild(art, ring, cog);
    container.pivot.set(LAYOUT.cellWidth / 2, LAYOUT.cellHeight / 2);
    container.position.set(reelX(reel) + LAYOUT.cellWidth / 2, rowY(row) + LAYOUT.cellHeight / 2);
    this.cogs.addChild(container);
    this.#placed.set(cell, { container, position: [reel, row] });

    if (this.#options.reduceMotion) return;
    container.alpha = 0;
    container.scale.set(LOCK_IN_SCALE);
    await this.#animator.tween(
      LOCK_IN_MS,
      (progress) => {
        container.alpha = Math.min(1, progress * 2.5);
        container.scale.set(LOCK_IN_SCALE + (1 - LOCK_IN_SCALE) * progress);
      },
      easeOutCubic,
    );
  }
}
