import { CATALOG } from "../app/catalog.ts";
import type { CatalogEntry } from "../app/catalog.ts";
import { routeToHash } from "../app/router.ts";
import { byId } from "../ui/dom.ts";
import { drawEmblem } from "../ui/emblems.ts";

const KIND_LABELS: Readonly<Record<CatalogEntry["kind"], string>> = { slot: "Slot machine", clicker: "Clicker" };

function card(entry: CatalogEntry): HTMLLIElement {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.className = "card";
  link.href = routeToHash(entry.route);
  link.dataset["game"] = entry.id;

  const emblem = document.createElement("div");
  emblem.className = "card-emblem";
  emblem.append(drawEmblem(entry.emblem));

  const tag = document.createElement("div");
  tag.className = "card-tag";
  tag.textContent = entry.number === null ? KIND_LABELS[entry.kind] : `${KIND_LABELS[entry.kind]} · No. ${entry.number}`;
  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = entry.name;
  const pitch = document.createElement("p");
  pitch.className = "card-pitch";
  pitch.textContent = entry.pitch;
  const facts = document.createElement("ul");
  facts.className = "card-facts";
  for (const fact of entry.facts) {
    const line = document.createElement("li");
    line.textContent = fact;
    facts.append(line);
  }
  const play = document.createElement("span");
  play.className = "card-play";
  play.textContent = entry.kind === "clicker" ? "Open the forge" : "Play";

  link.append(emblem, tag, name, pitch, facts, play);
  item.append(link);
  return item;
}

/** Fills the lobby with a card for each game. The rest of the lobby is plain HTML in index.html. */
export function buildLobby(): void {
  byId("lobby-cards").replaceChildren(...CATALOG.map(card));
}
