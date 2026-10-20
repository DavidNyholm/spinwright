import { defineCascadeGame } from "../engine/cascade/index.ts";

/**
 * Crucible, the second machine: a 6x5 grid of gems. Groups of five or more connected gems pay and
 * vanish, the rest fall, and new gems drop in. Every winning step in a spin heats the furnace, and
 * heat multiplies the next win: x1, x2, x3 and so on until the cascade runs dry.
 *
 *   G1-G6  gems, from common to rare      E  ember (scatter): four on the opening grid light the furnace
 *
 * In the furnace feature (10 spins), heat is not reset between spins and rises four times as fast,
 * so it climbs all the way to the last spin. Three embers on a feature spin add five more spins.
 *
 * Pays are in bet units (20 units make a bet). The gem weights set how often groups form and chain,
 * and the pay tables were tuned on top of them with `npm run sim -- --game crucible`; change either
 * and re-run it, because the weights, the cascade and the heat all feed the return.
 */

const column = { G1: 64, G2: 44, G3: 30, G4: 20, G5: 12, G6: 6, E: 5 };

export const crucible = defineCascadeGame({
  id: "crucible",
  name: "Crucible",
  columns: 6,
  rows: 5,
  weights: Array.from({ length: 6 }, () => ({ ...column })),
  minCluster: 5,
  units: 20,
  pays: {
    G1: { 5: 1, 6: 3, 7: 3, 8: 5, 9: 5, 10: 7, 12: 12, 15: 30, 20: 134 },
    G2: { 5: 2, 6: 3, 7: 4, 8: 5, 9: 6, 10: 8, 12: 15, 15: 36, 20: 161 },
    G3: { 5: 2, 6: 3, 7: 4, 8: 6, 9: 8, 10: 11, 12: 19, 15: 48, 20: 215 },
    G4: { 5: 4, 6: 5, 7: 7, 8: 9, 9: 12, 10: 16, 12: 29, 15: 72, 20: 322 },
    G5: { 5: 6, 6: 8, 7: 11, 8: 15, 9: 20, 10: 27, 12: 49, 15: 120, 20: 537 },
    G6: { 5: 12, 6: 16, 7: 22, 8: 29, 9: 40, 10: 53, 12: 97, 15: 239, 20: 1073 },
  },
  scatter: "E",
  feature: { trigger: 4, spins: 10, retrigger: { count: 3, spins: 5 }, maxSpins: 30, heatStep: 4 },
  heat: { start: 1, step: 1, max: 100 },
  maxWinMultiple: 5_000,
});
