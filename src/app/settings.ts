export const SETTINGS = {
  /** Credits a new player starts with. Play money only; more are earned at the Forge. */
  startingBalance: 5_000,
  /** Selectable credits per bet unit (per payline in a line game), ascending. */
  betLevels: [1, 2, 3, 5, 10, 20] as readonly number[],
  defaultUnitBet: 2,
  /** Sound starts on, at a moderate level. It stays silent until the visitor first clicks or presses a key. */
  defaultVolume: 0.6,
  walletKey: "spinwright.wallet.v1",
  prefsKey: "spinwright.prefs.v2",
  forgeKey: "spinwright.forge.v1",
};
