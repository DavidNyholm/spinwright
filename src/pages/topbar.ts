import { CATALOG } from "../app/catalog.ts";
import { routeToHash, sameRoute, LOBBY } from "../app/router.ts";
import type { Route } from "../app/router.ts";
import { savePrefs } from "../app/prefs.ts";
import type { Prefs } from "../app/prefs.ts";
import { SETTINGS } from "../app/settings.ts";
import type { KeyValueStore } from "../app/storage.ts";
import type { Wallet } from "../app/wallet.ts";
import type { SoundPlayer } from "../audio/player.ts";
import { byId, TextCell } from "../ui/dom.ts";
import { formatCredits } from "../ui/hud.ts";

export interface TopbarDeps {
  readonly wallet: Wallet;
  readonly sfx: SoundPlayer;
  readonly prefs: Prefs;
  readonly store: KeyValueStore;
}

/**
 * The bar across the top of every page: the way between games, the credits (on the lobby, where
 * nothing else shows them), and the sound switch and volume, which apply everywhere.
 */
export class Topbar {
  readonly #links: { readonly route: Route; readonly link: HTMLAnchorElement }[] = [];

  constructor({ wallet, sfx, prefs, store }: TopbarDeps) {
    const nav = byId("topnav");
    const entries: { name: string; route: Route }[] = [{ name: "Lobby", route: LOBBY }, ...CATALOG.map((entry) => ({ name: entry.name, route: entry.route }))];
    for (const { name, route } of entries) {
      const link = document.createElement("a");
      link.href = routeToHash(route);
      link.textContent = name;
      nav.append(link);
      this.#links.push({ route, link });
    }

    const balance = new TextCell(byId("top-balance-value"));
    balance.set(formatCredits(wallet.balance));
    wallet.onChange((value) => balance.set(formatCredits(value)));

    const sound = byId<HTMLInputElement>("sound");
    const volume = byId<HTMLInputElement>("volume");
    sound.checked = prefs.sound;
    volume.value = String(Math.round(prefs.volume * 100));
    volume.disabled = !prefs.sound;
    sound.addEventListener("change", () => {
      volume.disabled = !sound.checked;
      prefs.sound = sound.checked;
      savePrefs(store, SETTINGS.prefsKey, prefs);
      sfx.setMuted(!sound.checked);
      // Switching sound on plays a tick, so it is clear it worked.
      if (sound.checked) sfx.play("tick");
    });
    volume.addEventListener("input", () => {
      prefs.volume = Number(volume.value) / 100;
      savePrefs(store, SETTINGS.prefsKey, prefs);
      sfx.setVolume(prefs.volume);
      sfx.play("tick");
    });
  }

  /** Marks the link for the page the visitor is on. */
  setRoute(route: Route): void {
    for (const { route: linkRoute, link } of this.#links) {
      if (sameRoute(linkRoute, route)) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
}
