export const SETTINGS = {
  /** Credits a new player starts with, and what "get free credits" resets to. Play money only. */
  startingBalance: 5_000,
  /** Selectable credits per payline, ascending. */
  lineBetLevels: [1, 2, 3, 5, 10, 20] as readonly number[],
  defaultLineBet: 2,
  walletKey: "spinwright.wallet.v1",
  prefsKey: "spinwright.prefs.v1",
};
