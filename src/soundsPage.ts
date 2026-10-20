import { SoundPlayer } from "./audio/player.ts";
import { peakOf, rmsOf, SAMPLE_RATE } from "./audio/dsp.ts";
import type { Samples } from "./audio/dsp.ts";
import { heatSemitones, panFor, semitoneRate, SFX_NAMES } from "./audio/sfx.ts";
import type { PlayOptions, SfxName } from "./audio/sfx.ts";
import { LOOPING, renderAll } from "./audio/sounds.ts";
import { encodeWav } from "./audio/wav.ts";

/** Development page: audition every sound, the pitch ladders, and whole sequences as the game plays them. */

const GROUPS: readonly { title: string; names: readonly SfxName[] }[] = [
  { title: "The page", names: ["tick", "betUp", "betDown", "coin"] },
  { title: "Reels (Clockwork)", names: ["spinStart", "reelLoop", "reelStop"] },
  { title: "Wins", names: ["winTiny", "winSmall", "winBig", "winHuge", "scatter"] },
  { title: "Cascades (Crucible)", names: ["whoosh", "gemLand", "gemBurst", "heatUp", "ember", "featureStart", "retrigger", "furnaceLoop"] },
];

const LOOP_DEMO_SECONDS = 3;
const db = (x: number): string => `${(20 * Math.log10(x)).toFixed(1)} dB`;

const player = new SoundPlayer({ volume: 0.6, muted: false });
document.addEventListener("pointerdown", () => player.unlock(), { capture: true });
const volume = document.getElementById("volume") as HTMLInputElement;
volume.addEventListener("input", () => player.setVolume(Number(volume.value) / 100));

const sounds = renderAll();
const root = document.getElementById("root")!;

function waveform(samples: Samples): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 220;
  canvas.height = 36;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#c79a45";
  const perPixel = Math.max(1, Math.floor(samples.length / canvas.width));
  for (let x = 0; x < canvas.width; x++) {
    let low = 0;
    let high = 0;
    for (let i = x * perPixel; i < Math.min(samples.length, (x + 1) * perPixel); i++) {
      low = Math.min(low, samples[i]!);
      high = Math.max(high, samples[i]!);
    }
    const top = canvas.height / 2 - high * (canvas.height / 2 - 1);
    const bottom = canvas.height / 2 - low * (canvas.height / 2 - 1);
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
  return canvas;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function heading(text: string): void {
  const element = document.createElement("h2");
  element.textContent = text;
  root.append(element);
}

function playOnce(name: SfxName, options?: PlayOptions): void {
  if (LOOPING.has(name)) {
    const handle = player.loop(name, options);
    setTimeout(() => handle.stop(0.2), LOOP_DEMO_SECONDS * 1000);
  } else {
    player.play(name, options);
  }
}

function after(ms: number, action: () => void): void {
  setTimeout(action, ms);
}

for (const group of GROUPS) {
  heading(group.title);
  const table = document.createElement("table");
  for (const name of group.names) {
    const samples = sounds.get(name)!;
    const row = table.insertRow();
    row.insertCell().append(button(LOOPING.has(name) ? `Play ${LOOP_DEMO_SECONDS}s` : "Play", () => playOnce(name)));
    const nameCell = row.insertCell();
    nameCell.className = "name";
    nameCell.textContent = name;
    row.insertCell().append(waveform(samples));
    const stats = row.insertCell();
    stats.className = "stat";
    stats.textContent = `${(samples.length / SAMPLE_RATE).toFixed(2)} s · peak ${db(peakOf(samples))} · rms ${db(rmsOf(samples))}${LOOPING.has(name) ? " · loops" : ""}`;
    const link = document.createElement("a");
    link.textContent = "WAV";
    link.download = `${name}.wav`;
    link.href = URL.createObjectURL(new Blob([encodeWav(samples)], { type: "audio/wav" }));
    row.insertCell().append(link);
  }
  root.append(table);
}

heading("Ladders");
{
  const heat = document.createElement("div");
  heat.className = "row";
  for (let level = 1; level <= 10; level++) {
    heat.append(button(`heat ×${level}`, () => player.play("heatUp", { rate: semitoneRate(heatSemitones(level)), gain: 0.8 })));
  }
  root.append(heat);
  const tiers = document.createElement("div");
  tiers.className = "row";
  for (const name of ["winTiny", "winSmall", "winBig", "winHuge"] as const) tiers.append(button(name, () => player.play(name)));
  root.append(tiers);
}

heading("Whole sequences, as the game plays them");
{
  const row = document.createElement("div");
  row.className = "row";
  row.append(
    button("Clockwork: a spin that wins", () => {
      player.play("spinStart");
      const loop = player.loop("reelLoop", { gain: 0.7 });
      for (let reel = 0; reel < 5; reel++) {
        after(900 + reel * 260, () => player.play("reelStop", { pan: panFor(reel, 5), rate: 1 + 0.035 * reel }));
      }
      after(900 + 4 * 260 + 80, () => loop.stop(0.12));
      after(900 + 4 * 260 + 250, () => player.play("winSmall"));
      for (let tick = 0; tick < 8; tick++) after(900 + 4 * 260 + 300 + tick * 70, () => player.play("coin", { gain: 0.8, rate: 1 + tick * 0.03 }));
    }),
    button("Crucible: fill, then a 4-step cascade", () => {
      const columnSemitones = [0, 2, 4, 7, 9, 12];
      player.play("whoosh", { gain: 0.8 });
      for (let column = 0; column < 6; column++) {
        after(450 + column * 32 + 380, () => player.play("gemLand", { pan: panFor(column, 6), rate: semitoneRate(columnSemitones[column]!), gain: 0.7 }));
      }
      for (let step = 0; step < 4; step++) {
        const at = 1500 + step * 1400;
        after(at, () => player.play("heatUp", { rate: semitoneRate(heatSemitones(step + 1)), gain: 0.8 }));
        after(at + 560, () => player.play("gemBurst", { gain: 0.8 }));
        after(at + 800, () => player.play("coin", { gain: 0.8 }));
        for (let column = 0; column < 6; column++) {
          after(at + 900 + column * 32 + 300, () => player.play("gemLand", { pan: panFor(column, 6), rate: semitoneRate(columnSemitones[column]!), gain: 0.7 }));
        }
      }
      after(1500 + 4 * 1400, () => player.play("winSmall"));
    }),
    button("Crucible: the furnace lights", () => {
      player.play("ember", { gain: 1 });
      after(500, () => player.play("featureStart"));
      after(1800, () => {
        const furnace = player.loop("furnaceLoop", { gain: 0.45 });
        for (let step = 0; step < 8; step++) {
          after(300 + step * 700, () => player.play("heatUp", { rate: semitoneRate(heatSemitones(1 + step * 4)), gain: 0.8 }));
          after(300 + step * 700 + 450, () => player.play("gemBurst", { gain: 0.9 }));
        }
        after(6200, () => {
          furnace.stop(0.4);
          player.play("winBig");
        });
      });
    }),
  );
  root.append(row);
}

// The sound is silent until the page has been clicked; say so rather than leave a silent button.
const note = document.createElement("p");
note.textContent = "If nothing plays, click anywhere on the page once first: browsers keep a page silent until you interact with it.";
root.append(note);
void SFX_NAMES;
