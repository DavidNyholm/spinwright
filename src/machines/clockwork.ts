import { Application } from "pixi.js";
import type { Machine, PlannedRound, RoundHooks } from "../app/machine.ts";
import { CLOCKWORK_RTP_PERCENT } from "../app/catalog.ts";
import { lineGameRules } from "../app/rules.ts";
import type { RulesDoc } from "../app/rules.ts";
import { winSound } from "../audio/sfx.ts";
import type { Sfx } from "../audio/sfx.ts";
import { winCountDuration } from "../app/winCount.ts";
import { buildGrid, buyFeature, featurePrice, playRound, playRoundFromStops } from "../engine/index.ts";
import type { BoughtFeature, FeatureResult, GameConfig, Position, Rng, RoundResult, SpinResult } from "../engine/index.ts";
import { formatCredits } from "../ui/hud.ts";
import { LAYOUT, stageSize } from "../ui/layout.ts";
import { planSpin } from "../ui/spinPlan.ts";
import { SlotView } from "../ui/slotView.ts";
import type { WinStep } from "../ui/slotView.ts";
import { CLOCKWORK, createSymbolTextures } from "../ui/theme.ts";

const MAX_PIXEL_RATIO = 3;
/** Spacing between the reels' resting positions on first load, so the idle screen is not a flat row. */
const INITIAL_STOP_SPACING = 7;

/** How long each beat of the free spins is held, in milliseconds at normal speed. Turbo and stop shorten all of them. */
const BEAT_MS = {
  /** The scatters that started the feature, outlined before the banner. */
  trigger: 1000,
  startBanner: 1500,
  retriggerBanner: 1100,
  endBanner: 1800,
  /** A free spin's wins, outlined. */
  win: 950,
  /** A free spin that wins nothing. */
  noWin: 350,
} as const;

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

/** Every cell that takes part in a spin's wins. */
const winCells = (result: SpinResult): Position[] => [...result.lineWins.flatMap((win) => win.positions), ...(result.scatterWin?.positions ?? [])];

function cellsShowing(grid: readonly (readonly string[])[], symbol: string): Position[] {
  const cells: Position[] = [];
  grid.forEach((column, reel) => column.forEach((cell, row) => cell === symbol && cells.push([reel, row])));
  return cells;
}

/** What the feature sequence needs: the feature, what it was worth, and the opening spin that started it (none if it was bought). */
interface FeaturePlay {
  readonly base: SpinResult | null;
  readonly feature: FeatureResult;
  readonly totalBet: number;
  readonly totalWin: number;
  readonly capped: boolean;
}

/** The smallest count in a pay-table-like record: how many scatters it takes. */
const smallestKey = (table: Readonly<Record<number, number>>): number => Math.min(...Object.keys(table).map(Number));

/**
 * Machine No. 1: a five-reel, twenty-line machine with wilds and scatters, in the Clockwork theme.
 * Three scatters start free spins, in which every wild that lands locks in place.
 */
export class ClockworkMachine implements Machine {
  readonly id: string;
  readonly number = 1;
  readonly name = "Clockwork";
  readonly units: number;
  readonly unitName = "line";
  readonly forcedStopLimits: readonly number[];
  readonly idleMessage: string;
  readonly bonusName: string | null;

  readonly #game: GameConfig;
  #app: Application | null = null;
  #view: SlotView | null = null;
  #reduceMotion = false;
  #sfx: Sfx | null = null;
  #lastResult: RoundResult | BoughtFeature | null = null;

  constructor(game: GameConfig) {
    this.#game = game;
    this.id = game.id;
    this.units = game.paylines.length;
    this.forcedStopLimits = game.strips.map((strip) => strip.length);
    this.bonusName = game.feature?.buyCost == null ? null : "free spins";
    this.idleMessage =
      game.feature === null
        ? "Press spin, or hit Space, to play."
        : `Press spin, or hit Space. ${smallestKey(game.feature.spins)} scatters start the free spins, where every wild that lands stays.`;
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
    const round = forcedStops !== null ? playRoundFromStops(game, rng, forcedStops, unitBet) : playRound(game, rng, unitBet);
    const { base, feature } = round;
    return {
      totalBet: round.totalBet,
      totalWin: round.totalWin,
      summary: {
        stops: base.stops,
        grid: base.grid,
        lineWins: base.lineWins.map(({ line, symbol, count, win }) => ({ line, symbol, count, win })),
        scatterWin: base.scatterWin && { count: base.scatterWin.count, win: base.scatterWin.win },
        feature: feature && {
          awarded: feature.awarded,
          spinsPlayed: feature.spins.length,
          retriggers: feature.spins.filter((spin) => spin.retriggered > 0).length,
          wildsLocked: feature.spins.at(-1)?.locked.length ?? 0,
          win: feature.win,
        },
        capped: round.capped,
        totalBet: round.totalBet,
        totalWin: round.totalWin,
      },
      present: (hooks, options) => this.#present(round, hooks, options.turbo),
    };
  }

  rules(): RulesDoc {
    return lineGameRules(this.#game, {
      title: this.name,
      name: CLOCKWORK.name,
      returnPercent: CLOCKWORK_RTP_PERCENT,
      returnBasis: "the opening spin worked out exactly, the free spins found by simulation",
    });
  }

  bonusPrice(unitBet: number): number | null {
    return featurePrice(this.#game, unitBet);
  }

  planBonus(unitBet: number, rng: Rng): PlannedRound {
    const bought = buyFeature(this.#game, rng, unitBet);
    const { feature } = bought;
    return {
      totalBet: bought.price,
      totalWin: bought.totalWin,
      summary: {
        bought: true,
        price: bought.price,
        feature: {
          awarded: feature.awarded,
          spinsPlayed: feature.spins.length,
          retriggers: feature.spins.filter((spin) => spin.retriggered > 0).length,
          wildsLocked: feature.spins.at(-1)?.locked.length ?? 0,
          win: feature.win,
        },
        capped: bought.capped,
        totalWin: bought.totalWin,
      },
      present: async (hooks, options) => {
        this.#lastResult = bought;
        await this.#presentFeature({ base: null, feature, totalBet: bought.totalBet, totalWin: bought.totalWin, capped: bought.capped }, hooks, options.turbo);
      },
    };
  }

  quickStop(): void {
    this.#view?.quickStop();
  }

  clear(): void {
    this.#view?.clearRound();
  }

  qa(): Record<string, unknown> {
    return {
      game: this.#game,
      lastResult: this.#lastResult,
      shownGrid: () => this.#view!.shownGrid(),
      /** The cells the screen shows a locked wild in. */
      lockedCells: () => this.#view!.lockedCells(),
      ticker: this.#app!.ticker,
    };
  }

  dispose(): void {
    this.#app?.destroy({ removeView: true }, { children: true, texture: true });
    this.#app = null;
    this.#view = null;
  }

  // --- showing a round --------------------------------------------------------------------------

  async #present(round: RoundResult, hooks: RoundHooks, turbo: boolean): Promise<void> {
    const game = this.#game;
    const view = this.#view!;
    const { base } = round;

    view.setStrips(game.strips);
    const needed = game.feature === null ? null : smallestKey(game.feature.spins);
    await view.spin(base.stops, turbo, planSpin(base.grid, game.scatter?.symbol ?? null, needed));
    this.#lastResult = round;
    this.#app!.canvas.setAttribute("aria-label", describeGrid(base.grid));

    if (round.feature !== null) {
      await this.#presentFeature({ base, feature: round.feature, totalBet: round.totalBet, totalWin: round.totalWin, capped: round.capped }, hooks, turbo);
      return;
    }
    if (round.totalWin === 0) {
      hooks.setMessage("No win this spin.");
      return;
    }
    const jingle = winSound(round.totalWin, round.totalBet);
    if (jingle !== null) this.#sfx?.play(jingle);
    hooks.setWin(round.totalWin, this.#reduceMotion ? 0 : winCountDuration(round.totalWin, round.totalBet));
    view.presentWins(base, (step) => hooks.setMessage(describeStep(step, base)));
  }

  /** The opening spin's win and its scatters (if there was an opening spin), then the banner, then each free spin in turn. */
  async #presentFeature(play: FeaturePlay, hooks: RoundHooks, turbo: boolean): Promise<void> {
    const game = this.#game;
    const view = this.#view!;
    const sfx = this.#sfx!;
    const { base, feature, totalBet } = play;
    const scatter = game.scatter!.symbol;
    const retriggerAt = smallestKey(game.feature!.retrigger);
    const countUp = (win: number): number => (this.#reduceMotion ? 0 : winCountDuration(win, totalBet));

    let running = base?.totalWin ?? 0;
    if (base !== null && base.totalWin > 0) {
      const jingle = winSound(base.totalWin, totalBet);
      if (jingle !== null) sfx.play(jingle);
      hooks.setWin(running, countUp(base.totalWin));
    }
    sfx.play("featureStart");
    hooks.setMessage(`Free spins! ${feature.awarded} of them, and every wild that lands stays.`);
    if (base !== null) await view.flashCells([...winCells(base), ...cellsShowing(base.grid, scatter)], BEAT_MS.trigger);

    view.setStrips(game.feature!.strips);
    void view.setFeatureMode(true);
    await view.banner("FREE SPINS", `${feature.awarded} spins · wilds lock in place`, BEAT_MS.startBanner);

    let granted = feature.awarded;
    for (const [index, free] of feature.spins.entries()) {
      const label = `Free spin ${index + 1} of ${granted}`;
      hooks.setMessage(label);
      await view.spin(free.spin.stops, turbo, planSpin(free.spin.grid, scatter, retriggerAt));
      this.#app!.canvas.setAttribute("aria-label", describeGrid(free.spin.grid));

      if (free.newlyLocked.length > 0) {
        await view.lockCells(free.newlyLocked, (n) => sfx.play("cogLock", { rate: 1 + 0.06 * n }));
      }
      const locked = free.locked.length === 0 ? "" : ` · ${free.locked.length} ${free.locked.length === 1 ? "wild" : "wilds"} locked`;

      if (free.win > 0) {
        running += free.win;
        const jingle = winSound(free.win, totalBet);
        if (jingle !== null) sfx.play(jingle);
        hooks.setWin(running, countUp(free.win));
        hooks.setMessage(`${label}: won ${formatCredits(free.win)}${locked}`);
        await view.flashCells(winCells(free.spin), BEAT_MS.win);
      } else {
        hooks.setMessage(`${label}: no win${locked}`);
        await view.wait(BEAT_MS.noWin);
      }

      if (free.retriggered > 0) {
        granted += free.retriggered;
        sfx.play("retrigger");
        await view.banner(`+${free.retriggered} SPINS`, `${granted} free spins in all`, BEAT_MS.retriggerBanner);
      }
    }

    const jingle = winSound(feature.win, totalBet);
    if (jingle !== null) sfx.play(jingle);
    await view.banner(formatCredits(feature.win), "FREE SPINS WIN", BEAT_MS.endBanner);
    await view.setFeatureMode(false);
    hooks.setWin(play.totalWin, 0);
    hooks.setMessage(
      play.capped
        ? `Free spins won ${formatCredits(feature.win)}, the most one bet can win (${formatCredits(game.maxWinMultiple! * totalBet)}).`
        : base === null
          ? `Free spins won ${formatCredits(feature.win)}.`
          : `Free spins won ${formatCredits(feature.win)}; ${formatCredits(play.totalWin)} in all.`,
    );
  }
}
