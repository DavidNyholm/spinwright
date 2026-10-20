import "@fontsource/big-shoulders-display/latin-600";
import "@fontsource/big-shoulders-display/latin-700";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/ibm-plex-mono/latin-500";
import "@fontsource/ibm-plex-mono/latin-600";
import "./style.css";
import type { Ticker } from "pixi.js";
import { BUILT_WITH } from "./app/about.ts";
import { SoundPlayer } from "./audio/player.ts";
import type { Machine, RoundHooks } from "./app/machine.ts";
import { loadPrefs, savePrefs } from "./app/prefs.ts";
import { SETTINGS } from "./app/settings.ts";
import { browserStore } from "./app/storage.ts";
import { Wallet } from "./app/wallet.ts";
import { winCountDuration } from "./app/winCount.ts";
import { createCryptoRng, createRng, randomSeed } from "./engine/index.ts";
import { MACHINES } from "./machines/index.ts";
import { createDebugPanel } from "./ui/debugPanel.ts";
import type { DebugPanel } from "./ui/debugPanel.ts";
import { formatCredits, Hud } from "./ui/hud.ts";

/**
 * The page around the machines: wallet, bet, spin button and readouts. It knows nothing about how a
 * machine plays or looks; it asks the current machine to plan a round and to show it.
 */
async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = params.get("seed") ?? randomSeed();
  // Live play draws from the OS cryptographic source. A seeded, repeatable generator is only used
  // when QA asks for one (?seed=, or ?debug, which shows the seed so a run can be replayed).
  const debugMode = params.has("debug");
  const rng = params.has("seed") || debugMode ? createRng(seed) : createCryptoRng();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = browserStore();
  const wallet = new Wallet(store, SETTINGS.walletKey, SETTINGS.startingBalance);
  const prefs = loadPrefs(
    store,
    SETTINGS.prefsKey,
    SETTINGS.betLevels,
    MACHINES.map((entry) => entry.id),
    { unitBet: SETTINGS.defaultUnitBet, turbo: false, sound: true, volume: SETTINGS.defaultVolume, machine: MACHINES[0]!.id },
  );
  const levels = SETTINGS.betLevels;

  // Browsers only allow sound after the visitor has interacted with the page, so the player is
  // unlocked by the first click or key press; before that it is simply silent.
  const sfx = new SoundPlayer({ volume: prefs.volume, muted: !prefs.sound });
  for (const gesture of ["pointerdown", "keydown"] as const) document.addEventListener(gesture, () => sfx.unlock(), { capture: true });

  let machine: Machine | null = null;
  let debug: DebugPanel | null = null;
  let busy = false;
  let loading = true;

  document.getElementById("built-with")!.textContent = `${BUILT_WITH.name} (${BUILT_WITH.modelId})`;
  const host = document.getElementById("stage")!;

  const hud = new Hud({
    onSpin: () => handleSpin(),
    onBetStep: (direction) => {
      sfx.play(direction > 0 ? "betUp" : "betDown");
      stepBet(direction);
    },
    onTurbo: (on) => {
      sfx.play("tick");
      prefs.turbo = on;
      savePrefs(store, SETTINGS.prefsKey, prefs);
    },
    onSound: (on) => {
      prefs.sound = on;
      savePrefs(store, SETTINGS.prefsKey, prefs);
      sfx.setMuted(!on);
      // Switching sound on plays a tick, so it is clear it worked.
      if (on) sfx.play("tick");
    },
    onVolume: (volume) => {
      prefs.volume = volume;
      savePrefs(store, SETTINGS.prefsKey, prefs);
      sfx.setVolume(volume);
      sfx.play("tick");
    },
    onWinTick: () => sfx.play("coin", { gain: 0.8 }),
    onRefill: () => {
      sfx.play("winSmall");
      wallet.reset();
      hud.setBalance(wallet.balance);
      refreshBroke();
      hud.setMessage("Credits topped up. Good luck!");
    },
  });
  hud.setSound(prefs.sound, prefs.volume);
  hud.setMessage("Loading…");

  const hooks: RoundHooks = {
    setWin: (total, animateMs = 0) => hud.setWin(total, animateMs),
    setMessage: (text) => hud.setMessage(text),
  };

  // --- the machine switcher ---------------------------------------------------------------

  const nav = document.getElementById("machines")!;
  const tabs = MACHINES.map((entry) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "machine-tab";
    tab.dataset["machine"] = entry.id;
    const number = document.createElement("span");
    number.className = "no";
    number.textContent = `No. ${entry.number}`;
    tab.append(number, ` ${entry.name}`);
    tab.addEventListener("click", () => void switchTo(entry.id));
    nav.append(tab);
    return tab;
  });

  function refreshTabs(): void {
    for (const tab of tabs) {
      tab.setAttribute("aria-pressed", String(tab.dataset["machine"] === prefs.machine));
      tab.disabled = busy || loading;
    }
  }

  async function switchTo(id: string): Promise<void> {
    if (busy || loading || id === prefs.machine) return;
    prefs.machine = id;
    savePrefs(store, SETTINGS.prefsKey, prefs);
    await loadMachine(id);
  }

  async function loadMachine(id: string): Promise<void> {
    loading = true;
    document.body.dataset["state"] = "loading";
    hud.setReady(false);
    refreshTabs();
    machine?.dispose();
    debug?.dispose();
    machine = null;
    debug = null;
    host.replaceChildren();

    const entry = MACHINES.find((candidate) => candidate.id === id) ?? MACHINES[0]!;
    const next = entry.create();
    try {
      // The artwork uses the display font; draw it only once the font is ready.
      await document.fonts.load('800 48px "Big Shoulders Display"');
      const size = await next.mount(host, { reduceMotion, sfx });
      document.documentElement.style.setProperty("--aspect", String(size.width / size.height));
    } catch (error) {
      console.error(error);
      hud.setMessage("Couldn't start the graphics engine. Try another browser, or enable hardware acceleration.");
      loading = false;
      refreshTabs();
      return;
    }

    machine = next;
    document.body.dataset["machine"] = entry.id;
    debug = debugMode ? createDebugPanel({ seed, stopLimits: next.forcedStopLimits }) : null;
    loading = false;
    refreshBet();
    refreshBroke();
    hud.setBalance(wallet.balance);
    hud.setWin(0);
    hud.setMessage(next.idleMessage);
    hud.setReady(true);
    refreshTabs();
    document.body.dataset["state"] = "idle";
  }

  // --- bet and balance ----------------------------------------------------------------------

  function refreshBet(): void {
    if (machine === null) return;
    const index = levels.indexOf(prefs.unitBet);
    const { units, unitName } = machine;
    hud.setBet(
      prefs.unitBet * units,
      `${formatCredits(prefs.unitBet)} per ${unitName} × ${units} ${unitName}s`,
      index > 0,
      index < levels.length - 1,
    );
  }

  function refreshBroke(): void {
    if (machine === null) return;
    hud.setBroke(!wallet.canAfford(levels[0]! * machine.units));
  }

  function stepBet(direction: -1 | 1): void {
    if (busy || machine === null) return;
    const index = Math.min(levels.length - 1, Math.max(0, levels.indexOf(prefs.unitBet) + direction));
    prefs.unitBet = levels[index]!;
    savePrefs(store, SETTINGS.prefsKey, prefs);
    refreshBet();
  }

  /** Called when the chosen bet is more than the balance: lower it to the best affordable one. */
  function lowerBetToFit(units: number): void {
    const best = levels.filter((level) => wallet.canAfford(level * units)).at(-1);
    if (best === undefined) {
      hud.setMessage("Out of credits.");
      return;
    }
    prefs.unitBet = best;
    savePrefs(store, SETTINGS.prefsKey, prefs);
    refreshBet();
    hud.setMessage(`Not enough credits for that bet. Lowered to ${formatCredits(best * units)}; press spin to play.`);
  }

  // --- a round ------------------------------------------------------------------------------

  function handleSpin(): void {
    if (machine === null || loading) return;
    if (busy) {
      machine.quickStop();
      return;
    }
    void playRound(machine);
  }

  async function playRound(current: Machine): Promise<void> {
    busy = true;
    document.body.dataset["state"] = "spinning";
    refreshTabs();
    try {
      hud.finishCounters();
      current.clear();
      const totalBet = prefs.unitBet * current.units;
      if (!wallet.canAfford(totalBet)) {
        lowerBetToFit(current.units);
        return;
      }

      const planned = current.plan(prefs.unitBet, rng, debug?.forcedStops() ?? null);
      // The outcome is final here: bank it now, and only reveal it as the machine plays it out.
      wallet.settle(planned.totalBet, planned.totalWin);
      hud.setBalance(wallet.balance - planned.totalWin);
      hud.setWin(0);
      hud.setMessage("Spinning…");
      hud.setSpinning(true);
      await planned.present(hooks, { turbo: prefs.turbo });

      debug?.report(planned.summary);
      if (hud.win !== planned.totalWin) hud.setWin(planned.totalWin);
      hud.setBalance(wallet.balance, reduceMotion ? 0 : winCountDuration(planned.totalWin, planned.totalBet));
    } catch (error) {
      console.error(error);
      hud.setBalance(wallet.balance);
      hud.setMessage("Something went wrong. Your balance is safe; try again.");
    } finally {
      busy = false;
      hud.setSpinning(false);
      refreshBroke();
      refreshTabs();
      document.body.dataset["state"] = "idle";
    }
  }

  // --- QA -----------------------------------------------------------------------------------

  if (debugMode) {
    const qaState = (): Record<string, unknown> => machine?.qa() ?? {};
    Object.assign(window, {
      spinwright: {
        seed,
        wallet,
        get game() {
          return qaState()["game"];
        },
        get lastResult() {
          return qaState()["lastResult"];
        },
        get planned() {
          return qaState()["planned"];
        },
        get ticker() {
          return qaState()["ticker"];
        },
        shownGrid: () => (qaState()["shownGrid"] as () => unknown)(),
        readouts: () => (qaState()["readouts"] as () => unknown)(),
        worstOverlap: () => (qaState()["worstOverlap"] as () => number)(),
        pieceStates: () => (qaState()["pieceStates"] as () => { x: number; y: number; scale: number; alpha: number; symbol: string }[])(),
        finishCounters: () => hud.finishCounters(),
        switchTo,
        sound: {
          /** How many times each sound was asked for, heard or not. */
          requests: sfx.requests,
          state: () => sfx.state,
        },
        /**
         * Steps the real animation by hand, at 60 fps of simulated time, until the round is over. It
         * does not depend on the browser's frame rate, so QA scripts stay fast and repeatable even in
         * a throttled background tab. Returns the simulated milliseconds it took.
         */
        async settle(maxMs = 10_000): Promise<number> {
          const ticker = qaState()["ticker"] as Ticker;
          const frameMs = 1000 / 60;
          let simulated = 0;
          ticker.stop();
          // The animation runs faster than real time here, so its sounds would pile up; hold them back.
          sfx.setSuspended(true);
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
            sfx.setSuspended(false);
            ticker.start();
          }
          return simulated;
        },
      },
    });
  }

  await loadMachine(prefs.machine);
}

main().catch((error: unknown) => {
  console.error(error);
  document.getElementById("message")!.textContent = "Something went wrong while loading the game.";
});
