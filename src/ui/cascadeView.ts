import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Application, Texture } from "pixi.js";
import type { RoundHooks } from "../app/machine.ts";
import { columnFall } from "../engine/cascade/index.ts";
import type { CascadeConfig, CascadeResult, CascadeStep, RoundResult } from "../engine/cascade/index.ts";
import type { SymbolId } from "../engine/index.ts";
import { Animator, easeInOutSine, easeOutCubic } from "./animator.ts";
import { verticalGradient } from "./art/metal.ts";
import { dropY, planDropIn, planRefill } from "./cascadeMotion.ts";
import type { BoardGeometry, Drop } from "./cascadeMotion.ts";
import { FONT_DISPLAY, FONT_MONO, PALETTE } from "./art/palette.ts";
import { formatCredits } from "./hud.ts";

/** Geometry of the gem board, in stage units. */
export const CASCADE_LAYOUT = { cell: 108, gap: 6, padX: 30, header: 66, padTop: 14, padBottom: 26 } as const;

export function cascadeStageSize(columns: number, rows: number): { width: number; height: number } {
  const { cell, gap, padX, header, padTop, padBottom } = CASCADE_LAYOUT;
  return {
    width: padX * 2 + columns * cell + (columns - 1) * gap,
    height: header + padTop + rows * cell + (rows - 1) * gap + padBottom,
  };
}

/** Timings in milliseconds at normal speed. The animator's speed scales all of them. */
const TIMING = {
  dropOut: 300,
  dropIn: 340,
  highlight: 560,
  burst: 240,
  popup: 700,
  settle: 110,
  banner: 1_500,
  smallBanner: 950,
  heatPop: 260,
} as const;
const TURBO_SPEED = 2.5;
/** Quick stop plays out the rest of the round this many times faster. */
const QUICK_STOP_SPEED = 14;
const SPARKS_PER_PIECE = 6;
const HEAT_PIPS = 10;

interface Piece {
  readonly sprite: Sprite;
  readonly symbol: SymbolId;
}

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export interface CascadeViewOptions {
  readonly reduceMotion: boolean;
}

/**
 * The gem board: pieces that fall in, glow, burst, and are replaced by pieces falling from above.
 * Every movement is a timed animation run by one Animator, so the whole sequence can be sped up,
 * skipped ahead or stepped by hand.
 */
export class CascadeView {
  readonly animator = new Animator();
  readonly #config: CascadeConfig;
  readonly #textures: ReadonlyMap<SymbolId, Texture>;
  readonly #symbolByTexture = new Map<Texture, SymbolId>();
  readonly #reduceMotion: boolean;
  readonly #width: number;
  readonly #geometry: BoardGeometry;
  readonly #pieces: (Piece | null)[][];
  readonly #board = new Container();
  readonly #effects = new Container();
  readonly #frames = new Graphics();
  readonly #heatValue: Text;
  readonly #heatPips = new Graphics();
  readonly #caption: Text;
  readonly #headerGlow = new Graphics();
  readonly #banner = new Container();
  readonly #bannerTitle: Text;
  readonly #bannerBody: Text;

  constructor(app: Application, config: CascadeConfig, textures: ReadonlyMap<SymbolId, Texture>, options: CascadeViewOptions) {
    this.#config = config;
    this.#textures = textures;
    this.#reduceMotion = options.reduceMotion;
    for (const [symbol, texture] of textures) this.#symbolByTexture.set(texture, symbol);
    this.#pieces = Array.from({ length: config.columns }, () => new Array<Piece | null>(config.rows).fill(null));

    const { cell, padX, header, padTop } = CASCADE_LAYOUT;
    const { width, height } = cascadeStageSize(config.columns, config.rows);
    this.#width = width;
    this.#geometry = { columns: config.columns, rows: config.rows, step: cell + CASCADE_LAYOUT.gap, top: this.#centreY(0) };
    const gridWidth = config.columns * cell + (config.columns - 1) * CASCADE_LAYOUT.gap;
    const gridHeight = config.rows * cell + (config.rows - 1) * CASCADE_LAYOUT.gap;

    const bed = new Graphics()
      .roundRect(0, 0, width, height, 14)
      .fill(verticalGradient([0, 0x15110d], [1, 0x0a0806]))
      .stroke({ width: 2, color: PALETTE.brassDark, alpha: 0.85 })
      .roundRect(padX - 8, header + padTop - 8, gridWidth + 16, gridHeight + 16, 10)
      .fill(0x060504)
      .stroke({ width: 2.5, color: PALETTE.brassDark });
    for (let column = 0; column < config.columns; column++) {
      for (let row = 0; row < config.rows; row++) {
        bed.roundRect(this.#cellX(column) + 2, this.#cellY(row) + 2, cell - 4, cell - 4, 12).fill({ color: 0xffffff, alpha: 0.025 });
      }
    }
    app.stage.addChild(bed, this.#headerGlow);

    const label = (text: string, size: number, fill: number, font = FONT_DISPLAY, spacing = 3): Text =>
      new Text({ text, style: { fontFamily: font, fontSize: size, fontWeight: font === FONT_MONO ? "600" : "700", fill, letterSpacing: spacing } });
    const heatLabel = label("HEAT", 16, PALETTE.brassLight);
    heatLabel.position.set(padX, 10);
    this.#heatValue = label("×1", 34, PALETTE.amber, FONT_MONO, 0);
    this.#heatValue.position.set(padX, 26);
    this.#heatValue.anchor.set(0, 0);
    this.#heatPips.position.set(padX + 118, 42);
    this.#caption = label("", 15, 0x9a8f7c);
    this.#caption.anchor.set(1, 0);
    this.#caption.position.set(width - padX, 24);
    this.#setCaption(false, "");
    app.stage.addChild(heatLabel, this.#heatValue, this.#heatPips, this.#caption);
    this.#drawPips(config.heat.start);

    const mask = new Graphics().rect(padX - 4, header + padTop - 4, gridWidth + 8, gridHeight + 8).fill(0xffffff);
    this.#board.mask = mask;
    app.stage.addChild(this.#board, mask, this.#frames, this.#effects);

    this.#bannerTitle = label("", 40, PALETTE.amberHot, FONT_DISPLAY, 6);
    this.#bannerTitle.anchor.set(0.5);
    this.#bannerBody = label("", 22, PALETTE.text, FONT_DISPLAY, 4);
    this.#bannerBody.anchor.set(0.5);
    const centreY = header + padTop + gridHeight / 2;
    this.#banner.addChild(
      new Graphics()
        .roundRect(width / 2 - 250, centreY - 56, 500, 112, 14)
        .fill({ color: 0x0b0806, alpha: 0.92 })
        .stroke({ width: 3, color: PALETTE.amber }),
      this.#bannerTitle,
      this.#bannerBody,
    );
    this.#bannerTitle.position.set(width / 2, centreY - 14);
    this.#bannerBody.position.set(width / 2, centreY + 28);
    this.#banner.visible = false;
    app.stage.addChild(this.#banner);

    app.ticker.add((ticker) => this.animator.step(ticker.deltaMS));
  }

  // --- geometry -----------------------------------------------------------------------------

  #cellX(column: number): number {
    return CASCADE_LAYOUT.padX + column * (CASCADE_LAYOUT.cell + CASCADE_LAYOUT.gap);
  }

  #cellY(row: number): number {
    return CASCADE_LAYOUT.header + CASCADE_LAYOUT.padTop + row * (CASCADE_LAYOUT.cell + CASCADE_LAYOUT.gap);
  }

  #centreX(column: number): number {
    return this.#cellX(column) + CASCADE_LAYOUT.cell / 2;
  }

  #centreY(row: number): number {
    return this.#cellY(row) + CASCADE_LAYOUT.cell / 2;
  }

  // --- public --------------------------------------------------------------------------------

  /** Shows `grid` at once, with no animation. */
  showGrid(grid: readonly (readonly SymbolId[])[]): void {
    for (const piece of this.#allPieces()) piece.sprite.destroy();
    for (let column = 0; column < this.#config.columns; column++) {
      for (let row = 0; row < this.#config.rows; row++) {
        const piece = this.#makePiece(grid[column]![row]!, this.#centreX(column), this.#centreY(row));
        this.#pieces[column]![row] = piece;
      }
    }
  }

  /** For QA: every piece on the board, with where it is and how it looks. */
  pieceStates(): { x: number; y: number; scale: number; alpha: number; symbol: SymbolId }[] {
    return this.#allPieces().map(({ sprite, symbol }) => ({ x: sprite.x, y: Math.round(sprite.y), scale: sprite.scale.x, alpha: sprite.alpha, symbol }));
  }

  /**
   * For QA: the deepest any piece has sunk into the piece above it in the same column, in stage
   * units (0 if none overlap). Pieces that are bursting are ignored, since they grow on purpose.
   */
  worstOverlap(): number {
    let worst = 0;
    const sprites = this.#allPieces().map((piece) => piece.sprite).filter((sprite) => sprite.scale.x === 1);
    for (let i = 0; i < sprites.length; i++) {
      for (let j = i + 1; j < sprites.length; j++) {
        const a = sprites[i]!;
        const b = sprites[j]!;
        if (a.x !== b.x) continue;
        worst = Math.max(worst, CASCADE_LAYOUT.cell - Math.abs(a.y - b.y));
      }
    }
    return worst;
  }

  /** For QA: what the banner, the header caption and the heat readout currently say. */
  readouts(): { banner: string | null; caption: string; heat: string } {
    return { banner: this.#banner.visible ? this.#bannerTitle.text : null, caption: this.#caption.text, heat: this.#heatValue.text };
  }

  /** What is drawn on the board, read back from the sprites, and whether every piece sits on its cell. */
  shownGrid(): { grid: SymbolId[][]; aligned: boolean } {
    let aligned = true;
    const grid = this.#pieces.map((column, c) =>
      column.map((piece, r) => {
        if (piece === null) {
          aligned = false;
          return "?";
        }
        if (piece.sprite.x !== this.#centreX(c) || piece.sprite.y !== this.#centreY(r) || piece.sprite.scale.x !== 1 || piece.sprite.alpha !== 1) aligned = false;
        return this.#symbolByTexture.get(piece.sprite.texture) ?? "?";
      }),
    );
    return { grid, aligned };
  }

  /** Plays a whole result: the base spin and, if there is one, the furnace feature. */
  async present(result: CascadeResult, hooks: RoundHooks, options: { turbo: boolean }): Promise<void> {
    this.animator.speed = options.turbo || this.#reduceMotion ? TURBO_SPEED : 1;
    this.clear();
    const feature = this.#config.feature;
    let running = 0;
    const credit = (amount: number): void => {
      running += amount;
      hooks.setWin(running, 260);
    };

    try {
      await this.#playRound(result.base, hooks, credit, false);

      if (result.feature !== null && feature !== null) {
        await this.#pulseEmbers();
        await this.#showBanner("FURNACE LIT", `${feature.spins} FREE SPINS · HEAT CARRIES OVER`, TIMING.banner);
        this.#setCaption(true, "");
        let totalSpins: number = feature.spins;
        const before = running;
        for (const [index, round] of result.feature.entries()) {
          this.#setCaption(true, `FURNACE  SPIN ${index + 1} / ${totalSpins}`);
          await this.#playRound(round, hooks, credit, true);
          if (feature.retrigger !== null && round.scatters >= feature.retrigger.count && !round.capped) {
            totalSpins = Math.min(totalSpins + feature.retrigger.spins, feature.maxSpins);
            await this.#showBanner(`+${feature.retrigger.spins} SPINS`, `${round.scatters} EMBERS`, TIMING.smallBanner);
          }
        }
        await this.#showBanner("FURNACE COMPLETE", `FEATURE WON ${formatCredits(running - before)}`, TIMING.banner);
        this.#setCaption(false, "");
      }
      if (result.capped) await this.#showBanner("MAXIMUM WIN", `${formatCredits(this.#config.maxWinMultiple)}× YOUR BET`, TIMING.banner);
    } finally {
      this.animator.speed = 1;
    }
  }

  /** Plays the rest of the current round much faster. */
  quickStop(): void {
    this.animator.speed = QUICK_STOP_SPEED;
  }

  /** Resets the readouts and highlights for a new round. */
  clear(): void {
    this.#frames.clear();
    this.#setHeat(this.#config.heat.start, false);
    this.#banner.visible = false;
  }

  // --- a round ------------------------------------------------------------------------------

  /**
   * Plays one spin. When `carriesHeat` is set (a feature spin) the heat shown at the end is the one
   * the next spin starts with; for a base spin it stays at the last heat that was actually paid.
   */
  async #playRound(round: RoundResult, hooks: RoundHooks, credit: (amount: number) => void, carriesHeat: boolean): Promise<void> {
    await this.#dropIn(round.openingGrid!);
    this.#setHeat(round.startHeat, false);

    for (const [index, step] of round.steps.entries()) {
      this.#setHeat(step.heat, true);
      hooks.setMessage(
        `Step ${index + 1}: ${step.clusters.length} ${step.clusters.length === 1 ? "group" : "groups"} at heat ×${step.heat} pays ${formatCredits(step.win)}`,
      );
      await this.#highlight(step);
      credit(step.win);
      await this.#burst(step);
      const last = index === round.steps.length - 1;
      if (last && round.capped) break;
      const next = last ? round.finalGrid! : round.steps[index + 1]!.grid;
      await this.#fallAndRefill(step, next);
    }
    this.#setHeat(carriesHeat ? round.endHeat : (round.steps[round.steps.length - 1]?.heat ?? round.startHeat), false);
  }

  // --- the pieces ---------------------------------------------------------------------------

  #allPieces(): Piece[] {
    return this.#pieces.flat().filter((piece): piece is Piece => piece !== null);
  }

  #makePiece(symbol: SymbolId, x: number, y: number): Piece {
    const texture = this.#textures.get(symbol);
    if (texture === undefined) throw new Error(`No texture for piece "${symbol}"`);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    this.#board.addChild(sprite);
    return { sprite, symbol };
  }

  /** Plays one planned drop: waits for its turn, then falls and bounces to its cell. */
  async #runDrop(sprite: Sprite, drop: Drop): Promise<void> {
    if (drop.delayMs > 0) await this.animator.wait(drop.delayMs);
    await this.animator.tween(drop.durationMs, (u) => {
      sprite.y = dropY(drop, drop.delayMs + u * drop.durationMs);
    });
    sprite.y = drop.toY;
  }

  async #dropIn(grid: readonly (readonly SymbolId[])[]): Promise<void> {
    const old = this.#allPieces();
    if (old.length > 0) {
      // Everything on the board drops out of sight, bottom pieces first and left columns first, so
      // nothing ever falls into the piece below it. Then the new fill falls in.
      const { columns, rows } = this.#config;
      const distance = (rows + 1) * (CASCADE_LAYOUT.cell + CASCADE_LAYOUT.gap);
      const exits: Promise<void>[] = [];
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          const piece = this.#pieces[column]![row];
          if (piece === null || piece === undefined) continue;
          const startY = piece.sprite.y;
          const delay = column * 14 + (rows - 1 - row) * 10;
          exits.push(
            this.animator.wait(delay).then(() =>
              this.animator.tween(TIMING.dropOut, (u) => {
                piece.sprite.y = startY + distance * u * u;
                piece.sprite.alpha = 1 - 0.3 * u;
              }),
            ),
          );
        }
      }
      await Promise.all(exits);
      for (const piece of old) piece.sprite.destroy();
    }

    const drops: Promise<void>[] = [];
    for (const drop of planDropIn(this.#geometry)) {
      const piece = this.#makePiece(grid[drop.column]![drop.toRow]!, this.#centreX(drop.column), drop.fromY);
      this.#pieces[drop.column]![drop.toRow] = piece;
      drops.push(this.#runDrop(piece.sprite, drop));
    }
    await Promise.all(drops);
  }

  async #highlight(step: CascadeStep): Promise<void> {
    const lit: Piece[] = [];
    this.#frames.clear();
    for (const cluster of step.clusters) {
      for (const [column, row] of cluster.cells) {
        lit.push(this.#pieces[column]![row]!);
        this.#frames.roundRect(this.#cellX(column) + 3, this.#cellY(row) + 3, CASCADE_LAYOUT.cell - 6, CASCADE_LAYOUT.cell - 6, 12);
      }
    }
    this.#frames.stroke({ width: 10, color: PALETTE.amber, alpha: 0.22 });
    for (const cluster of step.clusters) {
      for (const [column, row] of cluster.cells) {
        this.#frames.roundRect(this.#cellX(column) + 3, this.#cellY(row) + 3, CASCADE_LAYOUT.cell - 6, CASCADE_LAYOUT.cell - 6, 12);
      }
    }
    this.#frames.stroke({ width: 3.5, color: PALETTE.amberHot });

    // A win figure rises from the middle of each group.
    for (const cluster of step.clusters) {
      const x = cluster.cells.reduce((sum, [c]) => sum + this.#centreX(c), 0) / cluster.cells.length;
      const y = cluster.cells.reduce((sum, [, r]) => sum + this.#centreY(r), 0) / cluster.cells.length;
      void this.#popup(`+${formatCredits(cluster.win)}`, x, y);
    }

    await this.animator.tween(TIMING.highlight, (u) => {
      const scale = 1 + 0.09 * Math.sin(Math.PI * 2 * u);
      for (const piece of lit) piece.sprite.scale.set(scale);
    });
    for (const piece of lit) piece.sprite.scale.set(1);
  }

  async #popup(text: string, x: number, y: number): Promise<void> {
    const popup = new Text({
      text,
      style: { fontFamily: FONT_MONO, fontSize: 28, fontWeight: "600", fill: PALETTE.amberHot, stroke: { color: 0x1a0c07, width: 6, join: "round" } },
    });
    popup.anchor.set(0.5);
    popup.position.set(x, y);
    this.#effects.addChild(popup);
    await this.animator.tween(TIMING.popup, (u) => {
      popup.y = y - 34 * u;
      popup.alpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      popup.scale.set(1 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 2.2)));
    }, easeOutCubic);
    popup.destroy();
  }

  async #burst(step: CascadeStep): Promise<void> {
    const doomed: { piece: Piece; x: number; y: number }[] = [];
    for (const cluster of step.clusters) {
      for (const [column, row] of cluster.cells) {
        const piece = this.#pieces[column]![row]!;
        doomed.push({ piece, x: this.#centreX(column), y: this.#centreY(row) });
        this.#pieces[column]![row] = null;
      }
    }
    this.#frames.clear();

    const sparks: { shape: Graphics; dx: number; dy: number; x: number; y: number }[] = [];
    if (!this.#reduceMotion) {
      for (const { x, y } of doomed) {
        for (let i = 0; i < SPARKS_PER_PIECE; i++) {
          const angle = Math.random() * Math.PI * 2;
          const reach = 38 + Math.random() * 46;
          const shape = new Graphics().circle(0, 0, 2.5 + Math.random() * 2).fill(Math.random() < 0.5 ? PALETTE.amberHot : PALETTE.amber);
          shape.position.set(x, y);
          this.#effects.addChild(shape);
          sparks.push({ shape, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach, x, y });
        }
      }
    }

    await this.animator.tween(TIMING.burst, (u) => {
      for (const { piece } of doomed) {
        piece.sprite.scale.set(1 + 0.4 * u);
        piece.sprite.alpha = 1 - u;
      }
      for (const spark of sparks) {
        spark.shape.position.set(spark.x + spark.dx * u, spark.y + spark.dy * u);
        spark.shape.alpha = 1 - u;
      }
    }, easeOutCubic);
    for (const { piece } of doomed) piece.sprite.destroy();
    for (const spark of sparks) spark.shape.destroy();
  }

  /** Survivors fall into the gaps and new pieces drop in above, exactly as the engine laid it out. */
  async #fallAndRefill(step: CascadeStep, nextGrid: readonly (readonly SymbolId[])[]): Promise<void> {
    const { columns, rows } = this.#config;
    const removed = Array.from({ length: columns }, () => new Array<boolean>(rows).fill(false));
    for (const cluster of step.clusters) for (const [column, row] of cluster.cells) removed[column]![row] = true;

    const drops = planRefill(this.#geometry, removed);
    // Where each column's pieces will be: survivors that stay put keep their row, the rest follow their drop.
    const arranged = this.#pieces.map((column, index) =>
      column.map((piece, row) => (piece !== null && !drops.some((d) => d.column === index && d.fromRow === row) ? piece : null)),
    );
    const running: Promise<void>[] = [];
    for (const drop of drops) {
      const piece =
        drop.fromRow === null
          ? this.#makePiece(nextGrid[drop.column]![drop.toRow]!, this.#centreX(drop.column), drop.fromY)
          : this.#pieces[drop.column]![drop.fromRow]!;
      arranged[drop.column]![drop.toRow] = piece;
      running.push(this.#runDrop(piece.sprite, drop));
    }
    this.#pieces.splice(0, columns, ...arranged);
    await Promise.all(running);
    await this.animator.wait(TIMING.settle);
  }

  async #pulseEmbers(): Promise<void> {
    const embers: Piece[] = [];
    const scatter = this.#config.scatter;
    for (const column of this.#pieces) for (const piece of column) if (piece !== null && piece.symbol === scatter) embers.push(piece);
    await this.animator.tween(700, (u) => {
      const scale = 1 + 0.18 * Math.sin(Math.PI * 3 * u);
      for (const piece of embers) piece.sprite.scale.set(scale);
    });
    for (const piece of embers) piece.sprite.scale.set(1);
  }

  // --- readouts -----------------------------------------------------------------------------

  #setHeat(heat: number, pop: boolean): void {
    this.#heatValue.text = `×${heat}`;
    this.#drawPips(heat);
    if (pop && !this.#reduceMotion) {
      void this.animator.tween(
        TIMING.heatPop,
        (u) => this.#heatValue.scale.set(1 + 0.45 * (1 - u)),
        easeInOutSine,
      );
    } else {
      this.#heatValue.scale.set(1);
    }
  }

  #drawPips(heat: number): void {
    this.#heatPips.clear();
    for (let i = 0; i < HEAT_PIPS; i++) {
      const lit = i < Math.min(heat, HEAT_PIPS);
      this.#heatPips.roundRect(i * 17, 0, 13, 9, 3).fill(lit ? PALETTE.amber : 0x2a2018);
    }
  }

  #setCaption(inFeature: boolean, text: string): void {
    this.#caption.text = inFeature ? text : `GROUPS OF ${this.#config.minCluster}+ PAY`;
    this.#caption.style.fill = inFeature ? PALETTE.amberHot : 0x9a8f7c;
    this.#headerGlow.clear();
    if (inFeature) {
      this.#headerGlow
        .roundRect(6, 6, this.#width - 12, CASCADE_LAYOUT.header - 8, 10)
        .fill({ color: 0xc4482d, alpha: 0.2 })
        .stroke({ width: 2, color: 0xff7a1a, alpha: 0.7 });
    }
  }

  async #showBanner(title: string, body: string, durationMs: number): Promise<void> {
    this.#bannerTitle.text = title;
    this.#bannerBody.text = body;
    this.#banner.visible = true;
    await this.animator.tween(durationMs, (u) => {
      this.#banner.alpha = u < 0.12 ? u / 0.12 : u > 0.85 ? (1 - u) / 0.15 : 1;
    });
    this.#banner.visible = false;
  }
}
