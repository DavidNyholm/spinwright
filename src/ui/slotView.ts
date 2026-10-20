import { Container, Graphics } from "pixi.js";
import type { Application, Texture, Ticker } from "pixi.js";
import { panFor } from "../audio/sfx.ts";
import type { LoopHandle, Sfx } from "../audio/sfx.ts";
import type { GameConfig, LineWin, Position, ScatterWin, SpinResult, SymbolId } from "../engine/index.ts";
import { Animator } from "./animator.ts";
import { drawReelBed, drawReelShade } from "./art/reelBed.ts";
import type { WindowRect } from "./art/reelBed.ts";
import { PALETTE } from "./art/palette.ts";
import { FeatureLayer } from "./featureLayer.ts";
import { cellCenterX, cellCenterY, LAYOUT, reelX, rowY, stageSize } from "./layout.ts";
import { ReelView } from "./reel.ts";
import { FEEL, ReelMotion } from "./reelMotion.ts";
import { planSpin } from "./spinPlan.ts";
import type { SpinPlan } from "./spinPlan.ts";

const BLUR = { max: 12, perCellSpeed: 0.35 };
/** A longer frame (background tab, hiccup) is treated as this long, so reels never lurch. */
const MAX_FRAME_MS = 50;

const GLOW_STROKES = [
  { width: 12, color: PALETTE.amber, alpha: 0.22 },
  { width: 4, color: PALETTE.amberHot, alpha: 1 },
] as const;
const DIM_ALPHA = 0.3;
const SHOW_ALL_MS = 1100;
const SHOW_STEP_MS = 1300;
const PULSE_PERIOD_MS = 180;
/** How much faster the free spins' pauses and animations run in turbo, and when the player has pressed stop. */
const TURBO_PACE = 2.5;
const QUICK_STOP_PACE = 8;
/** Pause between one locked wild seating and the next, in milliseconds. */
const LOCK_STAGGER_MS = 110;
/** Each scatter that lands chimes a little higher than the one before. */
const SCATTER_CHIME_STEP = 0.12;

/** What the win presentation is showing right now, so the page can describe it. */
export type WinStep =
  | { kind: "all" }
  | { kind: "line"; win: LineWin }
  | { kind: "scatter"; win: ScatterWin };

export interface SlotViewOptions {
  /** Skips blur and uses the short turbo timings. */
  reduceMotion: boolean;
  /** Where the reels' sounds go. */
  sfx: Sfx;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The reels, their spin animation and the win presentation, drawn on a Pixi stage.
 * All motion runs off the ticker's clock, so stepping the ticker by hand steps the animation too.
 */
export class SlotView {
  readonly #game: GameConfig;
  readonly #ticker: Ticker;
  readonly #reels: ReelView[] = [];
  readonly #motions: ReelMotion[] = [];
  /** The raw shift last applied to each reel's view, so it is only changed when the motion changes it. */
  readonly #appliedShifts: number[] = [];
  readonly #frames = new Graphics();
  readonly #path = new Graphics();
  /** The amber outline round a reel that is holding on, spinning, for a scatter. */
  readonly #holds = new Graphics();
  /** Runs the free spins' timed animations off the ticker, so stepping the ticker steps them too. */
  readonly #animator = new Animator();
  readonly #features: FeatureLayer | null;
  readonly #reduceMotion: boolean;
  readonly #sfx: Sfx;
  #spinLoop: LoopHandle | null = null;
  #turbo = false;
  #resolveSpin: (() => void) | null = null;
  #presentToken = 0;
  #plan: SpinPlan | null = null;
  #scattersLanded = 0;
  /** True once the player has pressed stop: the rest of the round runs fast, until the next one starts. */
  #skipping = false;

  constructor(app: Application, game: GameConfig, textures: ReadonlyMap<SymbolId, Texture>, options: SlotViewOptions) {
    this.#game = game;
    this.#ticker = app.ticker;
    this.#reduceMotion = options.reduceMotion;
    this.#sfx = options.sfx;
    const { width, height } = stageSize(game.reels, game.rows);

    const windows: WindowRect[] = Array.from({ length: game.reels }, (_, reel) => ({
      x: reelX(reel),
      y: LAYOUT.paddingY,
      width: LAYOUT.cellWidth,
      height: game.rows * LAYOUT.cellHeight,
    }));
    app.stage.addChild(drawReelBed(width, height, windows));

    const geometry = { cellWidth: LAYOUT.cellWidth, cellHeight: LAYOUT.cellHeight, rows: game.rows };
    game.strips.forEach((strip, index) => {
      const reel = new ReelView(strip, textures, geometry);
      reel.container.position.set(reelX(index), LAYOUT.paddingY);
      app.stage.addChild(reel.container);
      this.#reels.push(reel);
      this.#motions.push(new ReelMotion());
      this.#appliedShifts.push(0);
    });

    app.stage.addChild(drawReelShade(windows));

    // Locked wilds sit above the reels and below the win outlines; banners above everything.
    const wild = game.wild === null ? undefined : textures.get(game.wild);
    this.#features =
      game.feature === null || wild === undefined ? null : new FeatureLayer(this.#animator, wild, { width, height, reduceMotion: options.reduceMotion });
    if (this.#features !== null) app.stage.addChild(this.#features.cogs);
    app.stage.addChild(this.#holds);

    const overlay = new Container();
    overlay.addChild(this.#path, this.#frames);
    app.stage.addChild(overlay);
    if (this.#features !== null) app.stage.addChild(this.#features.banners);

    app.ticker.add((ticker) => this.#update(ticker));
  }

  get spinning(): boolean {
    return this.#resolveSpin !== null;
  }

  /** The symbols currently drawn in the window, read back from the reels (for QA), and whether all sit on their cells. */
  shownGrid(): { grid: SymbolId[][]; aligned: boolean } {
    const shown = this.#reels.map((reel) => reel.shown());
    return { grid: shown.map((s) => s.symbols), aligned: shown.every((s) => s.aligned) };
  }

  /** Puts every reel at rest showing the window for `stops`, with no animation. */
  showStops(stops: readonly number[]): void {
    stops.forEach((stop, reel) => this.#reels[reel]!.showStop(stop));
  }

  /**
   * Spins all reels and resolves once every one has come to rest on `stops`. `plan` says how long each
   * reel spins and which hold on for a scatter; without one they stop left to right, a stagger apart.
   */
  spin(stops: readonly number[], turbo: boolean, plan: SpinPlan = planSpin(this.#reels.map(() => []), null, null)): Promise<void> {
    if (this.#resolveSpin !== null) throw new Error("A spin is already in progress");
    this.clearHighlights();
    this.#turbo = turbo;
    this.#plan = plan;
    this.#scattersLanded = 0;
    this.#animator.speed = this.#pace();
    this.#sfx.play("spinStart");
    this.#spinLoop = this.#sfx.loop("reelLoop", { gain: 0.7 });
    const now = this.#ticker.lastTime;
    const timeScale = this.#timeScale();
    stops.forEach((stop, reel) => {
      this.#motions[reel]!.start({
        position: this.#reels[reel]!.position,
        stop,
        now,
        spinMs: plan.spinMs[reel]!,
        timeScale,
      });
    });
    // After a stop, the rest of the round is only shown, not played out: the reels come straight to rest.
    if (this.#skipping) for (const motion of this.#motions) motion.quickStop(now);
    return new Promise((resolve) => {
      this.#resolveSpin = resolve;
    });
  }

  /** The reels the next spin reads from. The free spins have their own; each reel switches as the spin begins. */
  setStrips(strips: readonly (readonly SymbolId[])[]): void {
    strips.forEach((strip, reel) => this.#reels[reel]!.setStrip(strip));
  }

  /**
   * Brings every reel to rest quickly. Reels already landing snap to their final position. If a
   * feature is playing out, the rest of it runs fast too, up to the next round.
   */
  quickStop(): void {
    this.#skipping = true;
    this.#animator.speed = QUICK_STOP_PACE;
    const now = this.#ticker.lastTime;
    this.#motions.forEach((motion, reel) => {
      if (motion.quickStop(now)) this.#land(reel);
    });
  }

  /** Shows the wins one at a time (all together first when there are several) until cleared or replaced. */
  presentWins(result: SpinResult, onStep: (step: WinStep) => void): void {
    const token = ++this.#presentToken;
    const steps: WinStep[] = result.lineWins.map((win) => ({ kind: "line", win }));
    if (result.scatterWin !== null) steps.push({ kind: "scatter", win: result.scatterWin });
    if (steps.length === 0) return;
    void this.#runPresentation(token, result, steps, onStep);
  }

  clearHighlights(): void {
    this.#presentToken++;
    this.#clearVisuals();
  }

  /** Starts a fresh round: win outlines, locked wilds and the feature's glow all go, and the pace returns to normal. */
  clearRound(): void {
    this.clearHighlights();
    this.#skipping = false;
    this.#animator.speed = this.#pace();
    this.#features?.reset();
  }

  /** Outlines `positions` for `ms`, then clears them. */
  async flashCells(positions: readonly Position[], ms: number): Promise<void> {
    const token = ++this.#presentToken;
    this.#showCells(positions, null);
    await this.#animator.wait(ms);
    if (token === this.#presentToken) this.clearHighlights();
  }

  /** Waits `ms` on the same clock as everything else here, so it speeds up with turbo and stop. */
  wait(ms: number): Promise<void> {
    return this.#animator.wait(ms);
  }

  /** Locks a wild into each cell, one after another, calling `onEach` as each one starts to seat. */
  lockCells(positions: readonly Position[], onEach: (index: number) => void): Promise<void> {
    return this.#featureLayer().lock(positions, { onEach, stagger: LOCK_STAGGER_MS });
  }

  /** The cells holding a locked wild, read back from what is drawn (for QA). */
  lockedCells(): Position[] {
    return this.#features?.positions() ?? [];
  }

  /** Turns the glow round the reels on or off. */
  setFeatureMode(on: boolean): Promise<void> {
    return this.#featureLayer().setActive(on);
  }

  banner(title: string, subtitle: string | null, holdMs: number): Promise<void> {
    return this.#featureLayer().banner(title, subtitle, holdMs);
  }

  #featureLayer(): FeatureLayer {
    if (this.#features === null) throw new Error("This game has no feature to show");
    return this.#features;
  }

  /** How fast the timed animations run: faster in turbo and with reduced motion, fastest after a stop. */
  #pace(): number {
    return this.#skipping ? QUICK_STOP_PACE : this.#turbo || this.#reduceMotion ? TURBO_PACE : 1;
  }

  async #runPresentation(token: number, result: SpinResult, steps: readonly WinStep[], onStep: (step: WinStep) => void): Promise<void> {
    if (steps.length > 1) {
      const everything = [...result.lineWins.flatMap((win) => win.positions), ...(result.scatterWin?.positions ?? [])];
      this.#showCells(everything, null);
      onStep({ kind: "all" });
      await sleep(SHOW_ALL_MS);
      if (token !== this.#presentToken) return;
    }
    for (let i = 0; ; i = (i + 1) % steps.length) {
      const step = steps[i]!;
      if (step.kind === "line") this.#showCells(step.win.positions, this.#game.paylines[step.win.line]!);
      else if (step.kind === "scatter") this.#showCells(step.win.positions, null);
      onStep(step);
      if (steps.length === 1) return;
      await sleep(SHOW_STEP_MS);
      if (token !== this.#presentToken) return;
    }
  }

  #showCells(positions: readonly Position[], line: readonly number[] | null): void {
    this.#clearVisuals();
    const lit = new Set(positions.map(([reel, row]) => reel * this.#game.rows + row));
    this.#features?.dim(new Set(positions.map(([reel, row]) => `${reel},${row}`)));
    this.#reels.forEach((reel, reelIndex) => {
      for (let row = 0; row < this.#game.rows; row++) {
        reel.setCellAlpha(row, lit.has(reelIndex * this.#game.rows + row) ? 1 : DIM_ALPHA);
      }
    });
    // Each outline is drawn twice: a wide faint stroke for the glow, then a crisp one on top.
    for (const stroke of GLOW_STROKES) {
      for (const [reel, row] of positions) {
        this.#frames.roundRect(reelX(reel) + 4, rowY(row) + 4, LAYOUT.cellWidth - 8, LAYOUT.cellHeight - 8, 12);
      }
      this.#frames.stroke(stroke);
    }
    if (line !== null) {
      // Trace the payline only as far as the win reaches, and change rows in the gap between two
      // reels rather than cutting diagonally across cells that are not part of the win.
      const reached = line.slice(0, positions.length);
      for (const stroke of GLOW_STROKES) {
        reached.forEach((row, reel) => {
          const x = cellCenterX(reel);
          const y = cellCenterY(row);
          if (reel === 0) {
            this.#path.moveTo(x, y);
            return;
          }
          const gapX = reelX(reel) - LAYOUT.reelGap / 2;
          this.#path.lineTo(gapX, cellCenterY(reached[reel - 1]!)).lineTo(gapX, y).lineTo(x, y);
        });
        this.#path.stroke({ ...stroke, join: "round", cap: "round" });
      }
    }
  }

  #clearVisuals(): void {
    this.#frames.clear();
    this.#path.clear();
    this.#features?.dim(null);
    for (const reel of this.#reels) reel.resetCellAlpha();
  }

  #timeScale(): number {
    return this.#turbo || this.#reduceMotion ? FEEL.turboScale : 1;
  }

  #update(ticker: Ticker): void {
    const now = ticker.lastTime;
    if (!this.#reduceMotion) this.#frames.alpha = 0.8 + 0.2 * Math.sin(now / PULSE_PERIOD_MS);
    this.#animator.step(ticker.deltaMS);
    this.#features?.update(now);
    this.#drawHolds(now);

    const dtSeconds = Math.min(ticker.deltaMS, MAX_FRAME_MS) / 1000;
    if (dtSeconds <= 0) return;
    this.#motions.forEach((motion, index) => {
      if (motion.phase === "idle") return;
      if (motion.step(now, dtSeconds)) {
        this.#land(index);
        return;
      }
      const reel = this.#reels[index]!;
      if (this.#appliedShifts[index] !== motion.shift) {
        reel.setShift(motion.shift);
        this.#appliedShifts[index] = motion.shift;
      }
      reel.setPosition(motion.position);
      reel.setBlur(this.#reduceMotion ? 0 : Math.min(BLUR.max, motion.speed * BLUR.perCellSpeed));
    });
  }

  /** Outlines the reel that is holding on for a scatter, while it spins on. */
  #drawHolds(now: number): void {
    this.#holds.clear();
    const plan = this.#plan;
    if (plan === null || this.#skipping) return;
    const alpha = this.#reduceMotion ? 1 : 0.65 + 0.35 * Math.sin(now / PULSE_PERIOD_MS);
    this.#motions.forEach((motion, reel) => {
      const waiting = this.#motions.slice(0, reel).every((earlier) => earlier.phase === "idle");
      if (!plan.anticipating[reel] || motion.phase === "idle" || !waiting) return;
      this.#holds.roundRect(reelX(reel) - 3, LAYOUT.paddingY - 3, LAYOUT.cellWidth + 6, this.#game.rows * LAYOUT.cellHeight + 6, 10);
    });
    this.#holds.stroke({ width: 5, color: PALETTE.amberHot, alpha });
  }

  #land(reelIndex: number): void {
    const reel = this.#reels[reelIndex]!;
    reel.showStop(this.#motions[reelIndex]!.stop);
    this.#appliedShifts[reelIndex] = 0;
    reel.setBlur(0);
    // Each reel thumps into place a little higher in pitch than the one before, from the left speaker to the right.
    const pan = panFor(reelIndex, this.#reels.length);
    this.#sfx.play("reelStop", { pan, rate: 1 + 0.035 * reelIndex });
    const plan = this.#plan;
    if (plan !== null) {
      if (plan.scatters[reelIndex]! > 0) {
        this.#sfx.play("scatter", { pan, rate: 1 + SCATTER_CHIME_STEP * this.#scattersLanded, gain: 0.7 });
        this.#scattersLanded += plan.scatters[reelIndex]!;
      }
      // The next reel holds on: let the player hear the wait begin.
      if (!this.#skipping && plan.anticipating[reelIndex + 1] === true) this.#sfx.play("anticipation");
    }
    if (this.#motions.every((motion) => motion.phase === "idle")) {
      this.#spinLoop?.stop(0.12);
      this.#spinLoop = null;
      const resolve = this.#resolveSpin;
      this.#resolveSpin = null;
      resolve?.();
    }
  }
}
