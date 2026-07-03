// vitest's happy-dom environment does not expose window.localStorage /
// window.sessionStorage on every Node/happy-dom combination (observed:
// present on Node 22, missing on Node 26 with happy-dom 20.8.4, while a
// bare happy-dom Window always has both). Ops-console tests drive banner
// dismissal cooldowns through Web Storage, so install a deterministic
// in-memory fallback whenever the DOM environment lacks one.
function createMemoryStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key) {
      const k = String(key);
      return store.has(k) ? store.get(k) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    }
  };
}

if (typeof window !== "undefined") {
  for (const name of ["localStorage", "sessionStorage"]) {
    let available = false;
    try {
      available = Boolean(window[name]) && typeof window[name].setItem === "function";
    } catch {
      available = false;
    }
    if (!available) {
      Object.defineProperty(window, name, {
        configurable: true,
        value: createMemoryStorage()
      });
    }
  }
}
