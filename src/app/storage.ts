export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function memoryStore(): KeyValueStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

/**
 * localStorage when it works, otherwise memory. Browsers can throw on access (private windows,
 * blocked site data) or on write (quota), and the game must still run, just without saving.
 */
export function browserStore(): KeyValueStore {
  try {
    const probeKey = "spinwright.probe";
    globalThis.localStorage.setItem(probeKey, "1");
    globalThis.localStorage.removeItem(probeKey);
  } catch {
    return memoryStore();
  }
  const storage = globalThis.localStorage;
  return {
    getItem: (key) => {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage.setItem(key, value);
      } catch {
        // Not saved; the session continues from memory.
      }
    },
  };
}

/** Reads JSON and runs it through `parse`, which returns the typed value or null if the data is not valid. */
export function readJson<T>(store: KeyValueStore, key: string, parse: (value: unknown) => T | null): T | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  store.setItem(key, JSON.stringify(value));
}
