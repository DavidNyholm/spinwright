import { Application } from "pixi.js";
import { SETTINGS } from "../app/settings.ts";
import { readJson, writeJson } from "../app/storage.ts";
import type { KeyValueStore } from "../app/storage.ts";
import type { Wallet } from "../app/wallet.ts";
import { heatSemitones, semitoneRate, strikeSemitones } from "../audio/sfx.ts";
import type { Sfx } from "../audio/sfx.ts";
import type { Rng } from "../engine/index.ts";
import { FORGE, UPGRADE_IDS } from "../forge/config.ts";
import type { UpgradeId } from "../forge/config.ts";
import { describeUpgrade, formatAmount, UPGRADE_BLURBS } from "../forge/describe.ts";
import { ForgeEngine, mergeForgeSaves, parseForgeSave } from "../forge/engine.ts";
import { ClickGuard } from "../forge/guard.ts";
import type { StrikeInput } from "../forge/guard.ts";
import type { ForgeEvent, ForgeState } from "../forge/engine.ts";
import { forgeRules } from "../app/rules.ts";
import { byId, StyleCell, TextCell } from "../ui/dom.ts";
import { showRules } from "../ui/infoDialog.ts";
import { FORGE_STAGE, ForgeScene } from "../ui/forgeScene.ts";

const MAX_PIXEL_RATIO = 3;
/** Progress is written to storage at most this often while playing; buying and leaving write at once. */
const SAVE_INTERVAL_MS = 2_000;
/** Each strike's sound is varied by up to this much in speed, so a run of strikes does not sound like one recording. */
const STRIKE_PITCH_JITTER = 0.03;
/** While the anvil rests, a strike reminds the player at most this often. */
const REST_REMINDER_MS = 2_500;
const SPRING_STATES = { off: "Not fitted", spent: "Run down", wound: "Wound", running: "Striking" } as const;

export interface ForgePageDeps {
  readonly wallet: Wallet;
  readonly store: KeyValueStore;
  readonly sfx: Sfx;
  readonly rng: Rng;
  readonly reduceMotion: boolean;
}

interface UpgradeCard {
  readonly id: UpgradeId;
  readonly root: HTMLElement;
  readonly level: TextCell;
  readonly now: TextCell;
  readonly next: TextCell;
  readonly button: HTMLButtonElement;
  readonly buttonText: TextCell;
  /** The level and price the text was last written for, and whether the card was last shown as affordable. */
  shown: string;
  affordable: boolean | null;
}

/**
 * The Forge page: the anvil picture, the readouts and the upgrade cards around it. The rules live in
 * ForgeEngine and the picture in ForgeScene; this connects them to the wallet, the sound, the saved
 * progress and the buttons. Its clock is the browser's frame ticker, which stops when the tab is
 * hidden, so nothing is earned while the Forge is not on screen.
 */
export class ForgePage {
  readonly #deps: ForgePageDeps;
  readonly #host = byId("forge-stage");
  readonly #messageLine = byId("forge-message");
  readonly #strikeButton = byId<HTMLButtonElement>("forge-strike");
  readonly #ingotButton = byId<HTMLButtonElement>("forge-ingot");
  readonly #credits = new TextCell(byId("forge-credits"));
  readonly #value = new TextCell(byId("forge-value"));
  readonly #valueDetail = new TextCell(byId("forge-value-detail"));
  readonly #tier = new TextCell(byId("forge-tier"));
  readonly #heatFill = new StyleCell(byId("forge-heat-fill"), "width");
  readonly #heatDetail = new TextCell(byId("forge-heat-detail"));
  readonly #springState = new TextCell(byId("forge-spring-state"));
  readonly #springFill = new StyleCell(byId("forge-spring-fill"), "width");
  readonly #springDetail = new TextCell(byId("forge-spring-detail"));
  readonly #ingotText = new TextCell(this.#ingotButton);
  readonly #strikeLabel = new TextCell(this.#strikeButton);
  /** Judges whether a strike came from a hand. It outlives visits to the page, so leaving and returning does not end a rest. */
  readonly #guard = new ClickGuard();
  #restingShown = false;
  #lastRestNoticeAt = -Infinity;
  readonly #stats = new TextCell(byId("forge-stats"));
  readonly #cards: UpgradeCard[];

  #generation = 0;
  #app: Application | null = null;
  #scene: ForgeScene | null = null;
  #engine: ForgeEngine | null = null;
  #teardown: (() => void)[] = [];
  #sinceSaveMs = 0;
  /** What was last written, so progress is only written again when it has changed. */
  #savedSnapshot = "";

  constructor(deps: ForgePageDeps) {
    this.#deps = deps;
    this.#cards = this.#buildCards();
    this.#buildHeatTicks();
    this.#strikeButton.addEventListener("click", (event) =>
      this.#strike({
        atMs: event.timeStamp,
        trusted: event.isTrusted,
        // A click made with the keyboard has no pointer position (detail 0): do not pretend it does.
        ...(event.detail === 0 ? {} : { x: event.clientX, y: event.clientY }),
      }),
    );
    // Holding Enter would otherwise repeat the strike for free; each strike takes its own press.
    this.#strikeButton.addEventListener("keydown", (event) => {
      if (event.repeat) event.preventDefault();
    });
    this.#ingotButton.addEventListener("click", (event) => this.#catchIngot(event.isTrusted));
    byId("forge-info").addEventListener("click", () => showRules(forgeRules()));
  }

  async enter(): Promise<void> {
    this.leave();
    const generation = ++this.#generation;
    const { wallet, store, rng } = this.#deps;

    const app = new Application();
    await app.init({
      ...FORGE_STAGE,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
      autoDensity: true,
    });
    if (generation !== this.#generation) {
      // The visitor moved on while the graphics were starting.
      app.destroy({ removeView: true }, { children: true, texture: true });
      return;
    }
    app.canvas.style.width = "100%";
    app.canvas.style.height = "auto";
    app.canvas.setAttribute("role", "img");
    app.canvas.setAttribute("aria-label", "An anvil with a hammer, a forge hearth and a mainspring gear. Use the Strike button to hammer.");
    this.#host.replaceChildren(app.canvas);
    document.documentElement.style.setProperty("--aspect", String(FORGE_STAGE.width / FORGE_STAGE.height));

    this.#scene = new ForgeScene(
      app,
      { onStrike: (input) => this.#strike(input), onIngot: (input) => this.#catchIngot(input.trusted) },
      { reduceMotion: this.#deps.reduceMotion },
    );
    this.#engine = new ForgeEngine({
      bank: { balance: () => wallet.balance, earn: (credits) => wallet.earn(credits), spend: (credits) => wallet.spend(credits) },
      rng,
      onEvent: (event) => this.#onEvent(event),
      save: readJson(store, SETTINGS.forgeKey, parseForgeSave) ?? parseForgeSave(null),
    });
    this.#app = app;
    this.#savedSnapshot = JSON.stringify(this.#engine.toSave());
    this.#sinceSaveMs = 0;

    const unsubscribe = wallet.onChange(() => this.#credits.set(formatAmount(wallet.balance)));
    const saveNow = (): void => this.#save();
    const saveWhenHidden = (): void => {
      if (document.visibilityState === "hidden") this.#save();
    };
    const keyboard = (event: KeyboardEvent): void => this.#onKey(event);
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", saveWhenHidden);
    document.addEventListener("keydown", keyboard);
    this.#teardown = [
      unsubscribe,
      () => window.removeEventListener("pagehide", saveNow),
      () => document.removeEventListener("visibilitychange", saveWhenHidden),
      () => document.removeEventListener("keydown", keyboard),
    ];

    app.ticker.add((ticker) => this.#frame(ticker.deltaMS));
    this.#setMessage("Strike the anvil. Keep striking and the iron heats up.");
    this.#frame(0);
  }

  leave(): void {
    this.#generation++;
    if (this.#engine !== null) this.#save();
    for (const undo of this.#teardown) undo();
    this.#teardown = [];
    this.#app?.destroy({ removeView: true }, { children: true, texture: true });
    this.#app = null;
    this.#scene = null;
    this.#engine = null;
  }

  // --- input -----------------------------------------------------------------------------------------

  #onKey(event: KeyboardEvent): void {
    if (event.repeat || (event.code !== "Space" && event.code !== "Enter")) return;
    const target = event.target;
    // A focused control handles its own keys; anywhere else, Space or Enter strikes.
    if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    this.#strike({ atMs: event.timeStamp, trusted: event.isTrusted });
  }

  /** Every way of striking comes here: the guard decides whether it came from a hand before the anvil is touched. */
  #strike(input: StrikeInput): void {
    const engine = this.#engine;
    if (engine === null) return;
    const verdict = this.#guard.check(input);
    if (verdict.ok) {
      engine.strike();
      return;
    }
    switch (verdict.reason) {
      case "untrusted":
      case "too-fast":
        // A script's click, or faster than hands: it earns nothing, and gets no message to tune a bot against.
        return;
      case "too-regular":
        this.#deps.sfx.play("denied");
        this.#lastRestNoticeAt = input.atMs;
        this.#setMessage(`That was steadier than a hand can be. The anvil rests for ${Math.ceil(verdict.cooldownMs / 1000)} seconds; the mainspring carries on.`);
        return;
      case "cooling":
        if (input.atMs - this.#lastRestNoticeAt > REST_REMINDER_MS) {
          this.#lastRestNoticeAt = input.atMs;
          this.#setMessage(`The anvil is resting for ${Math.ceil(this.#guard.restingMs(input.atMs) / 1000)} more seconds.`);
        }
        return;
    }
  }

  /** An ingot is caught by a click the browser vouches for; one a script made does nothing. */
  #catchIngot(trusted: boolean): void {
    if (trusted) this.#engine?.catchIngot();
  }

  // --- each frame ---------------------------------------------------------------------------------------

  #frame(dtMs: number): void {
    const engine = this.#engine;
    const scene = this.#scene;
    if (engine === null || scene === null) return;
    engine.tick(dtMs);
    const state = engine.state();
    scene.update(dtMs, state);
    this.#render(state);

    this.#sinceSaveMs += dtMs;
    if (this.#sinceSaveMs >= SAVE_INTERVAL_MS) {
      this.#sinceSaveMs = 0;
      if (JSON.stringify(engine.toSave()) !== this.#savedSnapshot) this.#save();
    }
  }

  #render(state: ForgeState): void {
    this.#credits.set(formatAmount(this.#deps.wallet.balance));
    this.#value.set(formatAmount(state.strikeValue));
    this.#valueDetail.set(state.multiplier === 1 ? "no bonus" : `×${formatAmount(state.multiplier)} bonus`);
    this.#tier.set(state.tierName);
    this.#heatFill.set(`${(state.heat / FORGE.heat.max) * 100}%`);
    this.#heatDetail.set(`${Math.floor(state.heat)} of ${FORGE.heat.max}`);

    if (!state.springOwned) {
      this.#springState.set(SPRING_STATES.off);
      this.#springFill.set("0%");
      this.#springDetail.set("Buy the mainspring below");
    } else {
      const label = state.springRunning ? SPRING_STATES.running : state.wound < 1 ? SPRING_STATES.spent : SPRING_STATES.wound;
      this.#springState.set(label);
      this.#springFill.set(`${(state.wound / state.capacity) * 100}%`);
      this.#springDetail.set(`${Math.floor(state.wound)} of ${state.capacity} turns`);
    }

    const resting = this.#guard.restingMs(performance.now());
    this.#strikeLabel.set(resting > 0 ? `${Math.ceil(resting / 1000)} s` : "STRIKE");
    if ((resting > 0) !== this.#restingShown) {
      this.#restingShown = resting > 0;
      this.#strikeButton.dataset["resting"] = String(this.#restingShown);
    }

    this.#ingotButton.hidden = state.ingot === null;
    if (state.ingot !== null) this.#ingotText.set(`Grab the ingot (${Math.ceil(state.ingot.msLeft / 1000)} s)`);

    const wallet = this.#deps.wallet;
    for (const card of this.#cards) {
      const level = state.levels[card.id];
      const cost = state.costs[card.id];
      const key = `${level}:${cost}`;
      if (key !== card.shown) {
        card.shown = key;
        const text = describeUpgrade(card.id, level);
        card.level.set(`Level ${level} of ${FORGE.upgrades[card.id].maxLevel}`);
        card.now.set(text.now);
        card.next.set(text.next === null ? "Fully upgraded." : `Next level: ${text.next}`);
        card.buttonText.set(cost === null ? "Maxed out" : `Buy for ${formatAmount(cost)}`);
        card.button.disabled = cost === null;
      }
      const affordable = cost !== null && wallet.balance >= cost;
      if (affordable !== card.affordable) {
        card.affordable = affordable;
        card.root.dataset["affordable"] = String(affordable);
      }
    }
    this.#stats.set(
      `Struck ${formatAmount(state.strikes)} times. Earned ${formatAmount(state.lifetime)} credits here. Highest heat ${state.bestHeat}.`,
    );
  }

  // --- what happened ----------------------------------------------------------------------------------------

  #onEvent(event: ForgeEvent): void {
    const { sfx } = this.#deps;
    this.#scene?.handle(event);
    switch (event.type) {
      case "strike": {
        const jitter = 1 + (Math.random() - 0.5) * 2 * STRIKE_PITCH_JITTER;
        sfx.play("anvil", { rate: semitoneRate(strikeSemitones(event.tier)) * jitter, gain: 0.9 });
        break;
      }
      case "auto":
        sfx.play("autoStrike", { rate: 1 + (Math.random() - 0.5) * 0.1, gain: 0.7 });
        break;
      case "tierUp":
        sfx.play("heatUp", { rate: semitoneRate(heatSemitones(event.tier * 2)) });
        this.#setMessage(`${FORGE.heat.tiers[event.tier]!.name}! Strikes now pay ×${FORGE.heat.tiers[event.tier]!.multiplier}.`);
        break;
      case "cooled":
        this.#setMessage("The iron is cooling. Keep striking to hold the heat.");
        break;
      case "ingotAppeared":
        sfx.play("ingotAppear");
        this.#setMessage("An ingot! Click it before it cools.");
        break;
      case "ingotExpired":
        sfx.play("tick");
        this.#setMessage("The ingot cooled and was gone.");
        break;
      case "ingotCaught":
        if (event.reward.kind === "windfall") {
          sfx.play("winBig");
          this.#setMessage(`A windfall: ${formatAmount(event.reward.credits)} credits.`);
        } else {
          sfx.play("frenzy");
          this.#setMessage(`Frenzy! Every strike pays ×${FORGE.ingot.frenzyMultiplier} for ${Math.round(event.reward.durationMs / 1000)} seconds, the mainspring's too.`);
        }
        break;
      case "frenzyEnded":
        sfx.play("tick");
        this.#setMessage("The frenzy is over.");
        break;
      case "bought":
        sfx.play("upgrade");
        this.#save();
        this.#setMessage(`${FORGE.upgrades[event.upgrade].name} is now level ${event.level}.`);
        break;
      case "denied": {
        sfx.play("denied");
        const cost = this.#engine?.state().costs[event.upgrade] ?? 0;
        const missing = Math.max(0, cost - this.#deps.wallet.balance);
        this.#setMessage(`${FORGE.upgrades[event.upgrade].name} costs ${formatAmount(cost)}. ${formatAmount(missing)} more to go.`);
        break;
      }
    }
  }

  #setMessage(text: string): void {
    this.#messageLine.textContent = text;
  }

  #save(): void {
    if (this.#engine === null) return;
    const mine = this.#engine.toSave();
    // Another tab may have saved further on; never write a smaller number over it.
    const stored = readJson(this.#deps.store, SETTINGS.forgeKey, parseForgeSave);
    writeJson(this.#deps.store, SETTINGS.forgeKey, stored === null ? mine : mergeForgeSaves(stored, mine));
    this.#savedSnapshot = JSON.stringify(mine);
    this.#sinceSaveMs = 0;
  }

  // --- building the page ---------------------------------------------------------------------------------------

  #buildCards(): UpgradeCard[] {
    const list = byId("forge-upgrades");
    return UPGRADE_IDS.map((id) => {
      const root = document.createElement("article");
      root.className = "upgrade";
      root.dataset["upgrade"] = id;

      const title = document.createElement("h3");
      title.textContent = FORGE.upgrades[id].name;
      const level = document.createElement("span");
      level.className = "upgrade-level";
      const head = document.createElement("header");
      head.append(title, level);

      const blurb = document.createElement("p");
      blurb.className = "upgrade-blurb";
      blurb.textContent = UPGRADE_BLURBS[id];
      const now = document.createElement("p");
      now.className = "upgrade-now";
      const next = document.createElement("p");
      next.className = "upgrade-next";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "buy";
      button.addEventListener("click", () => this.#engine?.buy(id));

      root.append(head, blurb, now, next, button);
      list.append(root);
      return { id, root, level: new TextCell(level), now: new TextCell(now), next: new TextCell(next), button, buttonText: new TextCell(button), shown: "", affordable: null };
    });
  }

  /** Marks the heat bar where each bonus begins. */
  #buildHeatTicks(): void {
    const meter = byId("forge-heat-meter");
    for (const tier of FORGE.heat.tiers) {
      if (tier.at === 0) continue;
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.style.left = `${(tier.at / FORGE.heat.max) * 100}%`;
      meter.append(tick);
    }
  }

  // --- for QA --------------------------------------------------------------------------------------------------------

  qa(): Record<string, unknown> {
    const frameMs = 1000 / 60;
    return {
      engine: this.#engine,
      scene: () => this.#scene?.qa() ?? null,
      state: () => this.#engine?.state(),
      /** Strikes the way a hand does, through the guard, as if the event had happened at the time and place given. */
      press: (input: StrikeInput): void => this.#strike(input),
      /** How long the anvil has left to rest, in milliseconds. */
      resting: (): number => this.#guard.restingMs(performance.now()),
      /** Steps the forge by hand, at 60 fps of simulated time, so QA does not depend on the browser's frame rate. */
      advance: (ms: number): void => {
        for (let elapsed = 0; elapsed < ms; elapsed += frameMs) this.#frame(frameMs);
      },
    };
  }
}
