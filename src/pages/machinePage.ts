import type { Ticker } from "pixi.js";
import type { Machine, RoundHooks } from "../app/machine.ts";
import { savePrefs } from "../app/prefs.ts";
import type { Prefs } from "../app/prefs.ts";
import { SETTINGS } from "../app/settings.ts";
import type { KeyValueStore } from "../app/storage.ts";
import type { Wallet } from "../app/wallet.ts";
import { winCountDuration } from "../app/winCount.ts";
import type { Sfx } from "../audio/sfx.ts";
import type { Rng } from "../engine/index.ts";
import { MACHINES } from "../machines/index.ts";
import { QA_ALLOWED } from "../app/qa.ts";
import { byId } from "../ui/dom.ts";
import { showRules } from "../ui/infoDialog.ts";
import { createDebugPanel } from "../ui/debugPanel.ts";
import type { DebugPanel } from "../ui/debugPanel.ts";
import { formatCredits, Hud } from "../ui/hud.ts";

const LEVELS = SETTINGS.betLevels;

export interface MachinePageDeps {
  readonly wallet: Wallet;
  readonly store: KeyValueStore;
  readonly prefs: Prefs;
  readonly sfx: Sfx;
  readonly rng: Rng;
  readonly seed: string;
  readonly debugMode: boolean;
  readonly reduceMotion: boolean;
}

/**
 * The slot machine page: wallet, bet, spin button and readouts around whichever machine is
 * showing. It knows nothing about how a machine plays or looks; it asks the machine to plan a
 * round and to show it.
 */
export class MachinePage {
  readonly #deps: MachinePageDeps;
  readonly #hud: Hud;
  readonly #host = byId("stage");
  readonly #title = byId("machine-title");
  readonly #number = byId("machine-number");

  /** Counts entries and exits, so work that finishes after the visitor has moved on can tell and stand down. */
  #generation = 0;
  #machine: Machine | null = null;
  #debug: DebugPanel | null = null;
  #active = false;
  #busy = false;
  #loading = true;

  constructor(deps: MachinePageDeps) {
    this.#deps = deps;
    const { sfx, prefs, store } = deps;
    this.#hud = new Hud({
      onSpin: () => this.#handleSpin(),
      onBetStep: (direction) => {
        sfx.play(direction > 0 ? "betUp" : "betDown");
        this.#stepBet(direction);
      },
      onTurbo: (on) => {
        sfx.play("tick");
        prefs.turbo = on;
        savePrefs(store, SETTINGS.prefsKey, prefs);
      },
      onWinTick: () => sfx.play("coin", { gain: 0.8 }),
      isActive: () => this.#active,
      onBonusRequest: () => void this.#handleBonus(),
    });
    this.#hud.setTurbo(prefs.turbo);
    this.#hud.setMessage("Loading…");
    // A change from another tab (or the Forge) while this page is idle shows at once; during a round the page is in charge of what is shown.
    deps.wallet.onChange((balance) => {
      if (!this.#active || this.#busy || this.#loading || this.#machine === null) return;
      this.#hud.setBalance(balance);
      this.#refreshMoney();
    });
    byId("machine-info").addEventListener("click", () => {
      if (this.#machine !== null) showRules(this.#machine.rules());
    });
  }

  async enter(id: string): Promise<void> {
    const generation = ++this.#generation;
    this.#active = true;
    this.#loading = true;
    this.#busy = false;
    document.body.dataset["state"] = "loading";
    this.#hud.finishCounters();
    this.#hud.setReady(false);
    this.#hud.setSpinning(false);
    this.#unload();

    const entry = MACHINES.find((candidate) => candidate.id === id) ?? MACHINES[0]!;
    this.#title.textContent = entry.name;
    this.#number.textContent = `No. ${entry.number}`;
    const next = entry.create();
    try {
      // The artwork uses the display font; draw it only once the font is ready.
      await document.fonts.load('800 48px "Big Shoulders Display"');
      if (generation !== this.#generation) return;
      const size = await next.mount(this.#host, { reduceMotion: this.#deps.reduceMotion, sfx: this.#deps.sfx });
      if (generation !== this.#generation) {
        next.dispose();
        return;
      }
      document.documentElement.style.setProperty("--aspect", String(size.width / size.height));
    } catch (error) {
      console.error(error);
      next.dispose();
      if (generation !== this.#generation) return;
      this.#hud.setMessage("Couldn't start the graphics engine. Try another browser, or enable hardware acceleration.");
      this.#loading = false;
      return;
    }

    this.#machine = next;
    document.body.dataset["machine"] = entry.id;
    this.#debug = QA_ALLOWED && this.#deps.debugMode ? createDebugPanel({ seed: this.#deps.seed, stopLimits: next.forcedStopLimits }) : null;
    this.#loading = false;
    this.#refreshBet();
    this.#refreshMoney();
    this.#hud.setBalance(this.#deps.wallet.balance);
    this.#hud.setWin(0);
    this.#hud.setMessage(next.idleMessage);
    this.#hud.setReady(true);
    document.body.dataset["state"] = "idle";
  }

  leave(): void {
    this.#generation++;
    this.#active = false;
    this.#unload();
  }

  #unload(): void {
    this.#machine?.dispose();
    this.#debug?.dispose();
    this.#machine = null;
    this.#debug = null;
    this.#host.replaceChildren();
  }

  // --- bet and balance ----------------------------------------------------------------------

  #refreshBet(): void {
    const machine = this.#machine;
    if (machine === null) return;
    const { prefs } = this.#deps;
    const index = LEVELS.indexOf(prefs.unitBet);
    const { units, unitName } = machine;
    this.#hud.setBet(
      prefs.unitBet * units,
      `${formatCredits(prefs.unitBet)} per ${unitName} × ${units} ${unitName}s`,
      index > 0,
      index < LEVELS.length - 1,
    );
    this.#refreshMoney();
  }

  /** Everything on the page that depends on the balance or the bet: the out-of-credits banner and the buy bar. */
  #refreshMoney(): void {
    const machine = this.#machine;
    if (machine === null) return;
    const { wallet, prefs } = this.#deps;
    this.#hud.setBroke(!wallet.canAfford(LEVELS[0]! * machine.units));
    const price = machine.bonusPrice(prefs.unitBet);
    this.#hud.setBonus(price, machine.bonusName, price !== null && wallet.canAfford(price));
  }

  #stepBet(direction: -1 | 1): void {
    if (this.#busy || this.#machine === null) return;
    const { prefs, store } = this.#deps;
    const index = Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(prefs.unitBet) + direction));
    prefs.unitBet = LEVELS[index]!;
    savePrefs(store, SETTINGS.prefsKey, prefs);
    this.#refreshBet();
  }

  /** Called when the chosen bet is more than the balance: lower it to the best affordable one. */
  #lowerBetToFit(units: number): void {
    const { prefs, store, wallet } = this.#deps;
    const best = LEVELS.filter((level) => wallet.canAfford(level * units)).at(-1);
    if (best === undefined) {
      this.#hud.setMessage("Out of credits.");
      return;
    }
    prefs.unitBet = best;
    savePrefs(store, SETTINGS.prefsKey, prefs);
    this.#refreshBet();
    this.#hud.setMessage(`Not enough credits for that bet. Lowered to ${formatCredits(best * units)}; press spin to play.`);
  }

  // --- a round ------------------------------------------------------------------------------

  #handleSpin(): void {
    const machine = this.#machine;
    if (machine === null || this.#loading) return;
    if (this.#busy) {
      machine.quickStop();
      return;
    }
    void this.#playRound(machine, false);
  }

  /** The buy button: ask first, because a buy costs many times a spin, then play the bonus like any other round. */
  async #handleBonus(): Promise<void> {
    const machine = this.#machine;
    if (machine === null || this.#loading || this.#busy || machine.bonusName === null) return;
    const price = machine.bonusPrice(this.#deps.prefs.unitBet);
    if (price === null) return;
    const generation = this.#generation;
    if (!this.#deps.wallet.canAfford(price)) {
      this.#hud.setMessage(`The ${machine.bonusName} cost ${formatCredits(price)}; you have ${formatCredits(this.#deps.wallet.balance)}.`);
      return;
    }
    const confirmed = await this.#hud.confirmBonus(machine.bonusName, price);
    // The visitor may have left, or started a spin, while the question was open.
    if (!confirmed || generation !== this.#generation || this.#busy) return;
    this.#deps.sfx.play("upgrade");
    void this.#playRound(machine, true);
  }

  async #playRound(current: Machine, bonus: boolean): Promise<void> {
    const { wallet, prefs, rng, reduceMotion } = this.#deps;
    const hud = this.#hud;
    const generation = this.#generation;
    const hooks: RoundHooks = {
      setWin: (total, animateMs = 0) => hud.setWin(total, animateMs),
      setMessage: (text) => hud.setMessage(text),
    };
    this.#busy = true;
    document.body.dataset["state"] = "spinning";
    try {
      hud.finishCounters();
      current.clear();
      const totalBet = bonus ? (current.bonusPrice(prefs.unitBet) ?? 0) : prefs.unitBet * current.units;
      if (!wallet.canAfford(totalBet)) {
        if (bonus) hud.setMessage("Not enough credits for the bonus.");
        else this.#lowerBetToFit(current.units);
        return;
      }

      const planned = bonus ? current.planBonus(prefs.unitBet, rng) : current.plan(prefs.unitBet, rng, this.#debug?.forcedStops() ?? null);
      // The outcome is final here: bank it now, and only reveal it as the machine plays it out.
      // (So leaving the page mid-spin loses nothing: the win is already in the wallet.)
      wallet.settle(planned.totalBet, planned.totalWin);
      hud.setBalance(wallet.balance - planned.totalWin);
      hud.setWin(0);
      hud.setMessage("Spinning…");
      hud.setSpinning(true);
      await planned.present(hooks, { turbo: prefs.turbo });
      if (generation !== this.#generation) return;

      this.#debug?.report(planned.summary);
      if (hud.win !== planned.totalWin) hud.setWin(planned.totalWin);
      hud.setBalance(wallet.balance, reduceMotion ? 0 : winCountDuration(planned.totalWin, planned.totalBet));
    } catch (error) {
      console.error(error);
      if (generation === this.#generation) {
        hud.setBalance(wallet.balance);
        hud.setMessage("Something went wrong. Your balance is safe; try again.");
      }
    } finally {
      // If the visitor has gone to another page, that page owns the controls now.
      if (generation === this.#generation) {
        this.#busy = false;
        hud.setSpinning(false);
        this.#refreshMoney();
        document.body.dataset["state"] = "idle";
      }
    }
  }

  // --- QA -----------------------------------------------------------------------------------

  qa(): Record<string, unknown> {
    const hud = this.#hud;
    const state = (): Record<string, unknown> => this.#machine?.qa() ?? {};
    return {
      get game() {
        return state()["game"];
      },
      get lastResult() {
        return state()["lastResult"];
      },
      get planned() {
        return state()["planned"];
      },
      get ticker() {
        return state()["ticker"];
      },
      shownGrid: () => (state()["shownGrid"] as () => unknown)(),
      readouts: () => (state()["readouts"] as () => unknown)(),
      worstOverlap: () => (state()["worstOverlap"] as () => number)(),
      pieceStates: () => (state()["pieceStates"] as () => { x: number; y: number; scale: number; alpha: number; symbol: string }[])(),
      lockedCells: () => (state()["lockedCells"] as () => unknown)(),
      finishCounters: () => hud.finishCounters(),
      /**
       * Steps the real animation by hand, at 60 fps of simulated time, until the round is over. It
       * does not depend on the browser's frame rate, so QA scripts stay fast and repeatable even in
       * a throttled background tab. Returns the simulated milliseconds it took. (The page holds the
       * sounds back while it runs, since the animation plays faster than real time.)
       */
      settle: async (maxMs = 10_000): Promise<number> => {
        const ticker = state()["ticker"] as Ticker;
        const frameMs = 1000 / 60;
        let simulated = 0;
        ticker.stop();
        try {
          let time = ticker.lastTime;
          while (document.body.dataset["state"] !== "idle" && simulated < maxMs) {
            time += frameMs;
            simulated += frameMs;
            ticker.update(time);
            // Let the promise chains this frame set free run before the next frame.
            for (let i = 0; i < 12; i++) await Promise.resolve();
          }
        } finally {
          ticker.start();
        }
        return simulated;
      },
    };
  }
}
