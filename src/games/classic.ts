import { defineGame } from "../engine/index.ts";

/**
 * Classic 5x3, 20 paylines, wild and scatter. A theme-free first game: the engine only sees symbol ids.
 *   L1-L6  low symbols     H1-H3  high symbols
 *   W      wild (reels 2-4, substitutes for everything except S)
 *   S      scatter (pays anywhere, as a multiple of the total bet)
 *
 * Line pays are multiples of the bet per line. Tuned with `npm run sim`; the reel strips
 * and paytable are the only things that decide the return, so retune them there.
 */

const strip = (symbols: string): string[] => symbols.trim().split(/\s+/);

export const classic = defineGame({
  id: "classic",
  name: "Classic 5x3",
  reels: 5,
  rows: 3,
  strips: [
    strip("L5 L4 L2 L1 L4 S L5 H3 L6 H1 L3 L2 L5 L4 H2 L3 L2 H2 L2 L1 L6 L5 L2 L6 L3 L6 L3 L1 L4 L1 H1 L1 S H1 L3 L4"),
    strip("L2 L3 H1 W L1 H3 S L1 L3 L2 H2 L5 L4 L1 L4 L1 H1 L6 L2 L3 W H1 L6 S L5 L6 L5 H2 L5 L1 L3 L2 L4 L3 L2 L4"),
    strip("L3 L1 L6 L4 L1 H1 L3 H1 L4 L1 S L4 L3 H2 L2 L3 L5 L6 L5 L6 S W L1 L3 L2 H1 L4 L2 W L1 H3 L2 H2 L5 L2 L5"),
    strip("L1 H2 L5 L3 L6 L2 H1 S L2 L4 H2 W L3 L1 W H1 L5 L2 L4 L5 L1 L3 L6 L4 L5 L3 S L1 H3 L2 L3 H1 L1 L2 L6 L4"),
    strip("L3 L1 L2 L4 L3 H2 L2 L1 H2 L5 H3 L6 L4 H1 L3 L1 L5 H1 L4 L2 L5 L3 L6 L1 L4 L6 L2 S L4 L6 S L2 L1 L5 L3 H1"),
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
    L1: { 3: 13, 4: 40, 5: 150 },
    L2: { 3: 13, 4: 40, 5: 150 },
    L3: { 3: 14, 4: 50, 5: 200 },
    L4: { 3: 20, 4: 60, 5: 250 },
    L5: { 3: 21, 4: 80, 5: 300 },
    L6: { 3: 25, 4: 100, 5: 400 },
    H1: { 3: 40, 4: 150, 5: 600 },
    H2: { 3: 60, 4: 250, 5: 1000 },
    H3: { 3: 125, 4: 600, 5: 2500 },
    W: {},
  },
  wild: "W",
  scatter: { symbol: "S", pays: { 3: 2, 4: 10, 5: 50 } },
});
