import { Application } from "pixi.js";
import type { Machine, PlannedRound, RoundHooks } from "../app/machine.ts";
import { winSound } from "../audio/sfx.ts";
import type { Sfx } from "../audio/sfx.ts";
import { winCountDuration } from "../app/winCount.ts";
import { buildGrid, spin, spinFromStops } from "../engine/index.ts";
import type { GameConfig, Rng, SpinResult } from "../engine/index.ts";
import { formatCredits } from "../ui/hud.ts";
import { LAYOUT, stageSize } from "../ui/layout.ts";
import { SlotView } from "../ui/slotView.ts";
import type { WinStep } from "../ui/slotView.ts";
import { CLOCKWORK, createSymbolTextures } from "../ui/theme.ts";

const MAX_PIXEL_RATIO = 3;
/** Spacing between the reels' resting positions on first load, so the idle screen is not a flat row. */
const INITIAL_STOP_SPACING = 7;

const describeGrid = (grid: readonly (readonly string[])[]): string =>
  grid.map((column, reel) => `Reel ${reel + 1}: ${column.map(CLOCKWORK.name).join(", ")}`).join(". ");

function describeStep(step: WinStep, result: SpinResult): string {
  switch (step.kind) {
    case "all":
      return `You won ${formatCredits(result.totalWin)} credits`;
    case "line":
      return `Line ${step.win.line + 1}: ${step.win.count} × ${CLOCKWORK.name(step.win.symbol)} on reels 1-${step.win.count} pays ${formatCredits(step.win.win)}`;
    case "scatter":
      return `${step.win.count} × ${CLOCKWORK.name(step.win.symbol)} pays ${formatCredits(step.win.win)}`;
  }
}

/** Machine No. 1: a five-reel, twenty-line machine with wilds and scatters, in the Clockwork theme. */
export class ClockworkMachine implements Machine {
  readonly id: string;
  readonly number = 1;
  readonly name = "Clockwork";
  readonly units: number;
  readonly unitName = "line";
  readonly forcedStopLimits: readonly number[];
  readonly idleMessage = "Press spin, or hit Space, to play.";

  readonly #game: GameConfig;
  #app: Application | null = null;
  #view: SlotView | null = null;
  #reduceMotion = false;
  #sfx: Sfx | null = null;
  #lastResult: SpinResult | null = null;

  constructor(game: GameConfig) {
    this.#game = game;
    this.id = game.id;
    this.units = game.paylines.length;
    this.forcedStopLimits = game.strips.map((strip) => strip.length);
  }

  async mount(host: HTMLElement, options: { reduceMotion: boolean; sfx: Sfx }): Promise<{ width: number; height: number }> {
    this.#reduceMotion = options.reduceMotion;
    this.#sfx = options.sfx;
    const game = this.#game;
    const size = stageSize(game.reels, game.rows);
    const app = new Application();
    await app.init({
      ...size,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
      autoDensity: true,
    });
    app.canvas.style.width = "100%";
    app.canvas.style.height = "auto";
    app.canvas.setAttribute("role", "img");
    host.append(app.canvas);
    this.#app = app;

    const textures = createSymbolTextures(app.renderer, CLOCKWORK, new Set(game.strips.flat()), LAYOUT.cellWidth, LAYOUT.cellHeight);
    this.#view = new SlotView(app, game, textures, { reduceMotion: options.reduceMotion, sfx: options.sfx });
    const initialStops = game.strips.map((strip, reel) => (reel * INITIAL_STOP_SPACING) % strip.length);
    this.#view.showStops(initialStops);
    app.canvas.setAttribute("aria-label", describeGrid(buildGrid(game, initialStops)));
    return size;
  }

  plan(unitBet: number, rng: Rng, forcedStops: readonly number[] | null): PlannedRound {
    const game = this.#game;
    const result = forcedStops !== null ? spinFromStops(game, forcedStops, unitBet) : spin(game, rng, unitBet);
    return {
      totalBet: result.totalBet,
      totalWin: result.totalWin,
      summary: {
        stops: result.stops,
        grid: result.grid,
        lineWins: result.lineWins.map(({ line, symbol, count, win }) => ({ line, symbol, count, win })),
        scatterWin: result.scatterWin && { count: result.scatterWin.count, win: result.scatterWin.win },
        totalBet: result.totalBet,
        totalWin: result.totalWin,
      },
      present: async (hooks: RoundHooks, options: { turbo: boolean }) => {
        const view = this.#view!;
        await view.spin(result.stops, options.turbo);
        this.#lastResult = result;
        this.#app!.canvas.setAttribute("aria-label", describeGrid(result.grid));
        if (result.totalWin === 0) {
          hooks.setMessage("No win this spin.");
          return;
        }
        const jingle = winSound(result.totalWin, result.totalBet);
        if (jingle !== null) this.#sfx?.play(jingle);
        if (result.scatterWin !== null) this.#sfx?.play("scatter", { gain: 0.8 });
        hooks.setWin(result.totalWin, this.#reduceMotion ? 0 : winCountDuration(result.totalWin, result.totalBet));
        view.presentWins(result, (step) => hooks.setMessage(describeStep(step, result)));
      },
    };
  }

  quickStop(): void {
    this.#view?.quickStop();
  }

  clear(): void {
    this.#view?.clearHighlights();
  }

  qa(): Record<string, unknown> {
    return {
      game: this.#game,
      lastResult: this.#lastResult,
      shownGrid: () => this.#view!.shownGrid(),
      ticker: this.#app!.ticker,
    };
  }

  dispose(): void {
    this.#app?.destroy({ removeView: true }, { children: true, texture: true });
    this.#app = null;
    this.#view = null;
  }
}
