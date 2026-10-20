import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { peakOf, rmsOf, SAMPLE_RATE } from "../src/audio/dsp.ts";
import { renderAll } from "../src/audio/sounds.ts";
import { encodeWav } from "../src/audio/wav.ts";

/** Writes every sound to a WAV file, so it can be listened to (or reused) outside the game. */
const outDir = process.argv[2] ?? "sounds-out";
mkdirSync(outDir, { recursive: true });
for (const [name, samples] of renderAll()) {
  const file = join(outDir, `${name}.wav`);
  writeFileSync(file, encodeWav(samples));
  console.log(
    `${file.padEnd(28)} ${(samples.length / SAMPLE_RATE).toFixed(2)} s  peak ${(20 * Math.log10(peakOf(samples))).toFixed(1)} dB  rms ${(20 * Math.log10(rmsOf(samples))).toFixed(1)} dB`,
  );
}
