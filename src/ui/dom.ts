/** The element with this id, or a clear error naming the page file that should have it. */
export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id} in index.html`);
  return element as T;
}

/** An element's text, written only when it changes, so a readout updated every frame costs nothing when it holds still. */
export class TextCell {
  readonly #element: HTMLElement;
  #shown: string | null = null;

  constructor(element: HTMLElement) {
    this.#element = element;
  }

  set(text: string): void {
    if (text === this.#shown) return;
    this.#shown = text;
    this.#element.textContent = text;
  }
}

/** A property of an element, written only when it changes. */
export class StyleCell {
  readonly #element: HTMLElement;
  readonly #property: string;
  #shown: string | null = null;

  constructor(element: HTMLElement, property: string) {
    this.#element = element;
    this.#property = property;
  }

  set(value: string): void {
    if (value === this.#shown) return;
    this.#shown = value;
    this.#element.style.setProperty(this.#property, value);
  }
}
