import { defineGame } from "../engine/index.ts";

/**
 * Classic 5x3, 20 paylines, wild and scatter, and a free-spins feature. A theme-free game: the
 * engine only sees symbol ids.
 *   L1-L6  low symbols     H1-H3  high symbols
 *   W      wild (reels 2-4, substitutes for everything except S)
 *   S      scatter (pays anywhere, as a multiple of the total bet; three or more start the free spins)
 *
 * Free spins: every wild that lands is locked in place until the feature ends, so the board fills
 * up spin by spin. The feature has its own reel strips, which carry more scatters than the base
 * game's so that a retrigger is possible, and three scatters on a free spin add four more spins.
 *
 * Line pays are multiples of the bet per line. About 60% of the return comes from the base game's
 * lines, 2% from its scatters and 34% from the free spins. Tuned with `npm run sim`; the reel
 * strips, the paytable and the feature are what decide the return, and the locked wilds make the
 * free spins depend on one another, so a change to any of them needs a new run.
 */

const strip = (symbols: string): string[] => symbols.trim().split(/\s+/);

export const classic = defineGame({
  id: "classic",
  name: "Classic 5x3",
  reels: 5,
  rows: 3,
  strips: [
    strip("L5 L4 L2 L1 L4 S L5 H3 L6 H1 L3 L2 L5 L4 H2 L3 L2 H2 L2 L1 L6 L5 L2 L6 L3 L6 L3 L1 L4 L1 H1 L1 L1 H1 L3 L4"),
    strip("L2 L3 H1 W L1 H3 S L1 L3 L2 H2 L5 L4 L1 L4 L1 H1 L6 L2 L3 W H1 L6 L2 L5 L6 L5 H2 L5 L1 L3 L2 L4 L3 L2 L4"),
    strip("L3 L1 L6 L4 L1 H1 L3 H1 L4 L1 S L4 L3 H2 L2 L3 L5 L6 L5 L6 S W L1 L3 L2 H1 L4 L2 W L1 H3 L2 H2 L5 L2 L5"),
    strip("L1 H2 L5 L3 L6 L2 H1 S L2 L4 H2 W L3 L1 W H1 L5 L2 L4 L5 L1 L3 L6 L4 L5 L3 L4 L1 H3 L2 L3 H1 L1 L2 L6 L4"),
    strip("L3 L1 L2 L4 L3 H2 L2 L1 H2 L5 H3 L6 L4 H1 L3 L1 L5 H1 L4 L2 L5 L3 L6 L1 L4 L6 L2 S L4 L6 L5 L2 L1 L5 L3 H1"),
  ],
  paylines: [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [0, 1, 0, 1, 0],
    [2, 1, 2, 1, 2],
    [1, 0, 1, 0, 1],
    [1, 2, 1, 2, 1],
    [0, 1, 1, 1, 0],
    [2, 1, 1, 1, 2],
    [1, 1, 0, 1, 1],
    [1, 1, 2, 1, 1],
    [0, 0, 2, 0, 0],
    [2, 2, 0, 2, 2],
    [0, 2, 2, 2, 0],
  ],
  pays: {
    L1: { 3: 8, 4: 29, 5: 102 },
    L2: { 3: 8, 4: 29, 5: 102 },
    L3: { 3: 9, 4: 33, 5: 134 },
    L4: { 3: 13, 4: 41, 5: 168 },
    L5: { 3: 14, 4: 54, 5: 204 },
    L6: { 3: 17, 4: 67, 5: 268 },
    H1: { 3: 28, 4: 102, 5: 412 },
    H2: { 3: 41, 4: 165, 5: 670 },
    H3: { 3: 82, 4: 410, 5: 1650 },
    W: {},
  },
  wild: "W",
  scatter: { symbol: "S", pays: { 3: 2, 4: 10, 5: 50 } },
  feature: {
    spins: { 3: 8, 4: 12, 5: 16 },
    strips: [
      strip("L5 L4 L2 L1 L4 S L5 H3 L6 H1 L3 L2 L5 L4 H2 L3 L2 H2 L2 L1 L6 S L2 L6 L3 L6 L3 L1 L4 L1 H1 L1 L1 H1 L3 L4"),
      strip("L2 L3 H1 W L1 H3 S L1 L3 L2 H2 L5 L4 L1 L4 L1 H1 L6 L2 L3 W H1 L6 S L5 L6 L5 H2 L5 L1 L3 L2 L4 L3 L2 L4"),
      strip("L3 L1 L6 L4 L1 H1 L3 H1 L4 L1 S L4 L3 H2 L2 L3 L5 L6 L5 L6 S W L1 L3 L2 H1 L4 L2 W L1 H3 L2 H2 L5 L2 L5"),
      strip("L1 H2 L5 L3 L6 L2 H1 S L2 L4 H2 W L3 L1 W H1 L5 L2 L4 L5 L1 L3 S L4 L5 L3 L4 L1 H3 L2 L3 H1 L1 L2 L6 L4"),
      strip("L3 L1 L2 L4 L3 H2 L2 L1 H2 L5 H3 L6 L4 H1 L3 L1 S H1 L4 L2 L5 L3 L6 L1 L4 L6 L2 S L4 L6 L5 L2 L1 L5 L3 H1"),
    ],
    retrigger: { 3: 4 },
    maxSpins: 40,
  },
  maxWinMultiple: 5_000,
});
