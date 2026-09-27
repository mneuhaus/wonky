// Application store. One mutable state object made of slices (one per
// feature id, plus display.* keys). update(reason, recipe) mutates in place
// and notifies listeners; the store never freezes, so the legacy state
// facade can hand out live objects (VS mutates them).
export function createStore(initial = {}) {
  const state = initial;
  const listeners = new Set();
  let depth = 0;
  let pending = [];

  const emit = reasons => {
    for (const listener of [...listeners]) listener(state, reasons);
  };

  return {
    get: () => state,
    // Adds a slice; a duplicate slice name is a composition error.
    define(name, value) {
      if (Object.prototype.hasOwnProperty.call(state, name)) {
        throw new Error(`Store slice ${name} is defined twice`);
      }
      state[name] = value;
    },
    update(reason, recipe) {
      const result = recipe ? recipe(state) : undefined;
      if (depth) pending.push(reason);
      else emit([reason]);
      return result;
    },
    // Runs several updates and notifies once.
    batch(reason, run) {
      depth++;
      try {
        return run();
      } finally {
        depth--;
        if (!depth) {
          const reasons = [...pending, reason];
          pending = [];
          emit(reasons);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Calls listener(value, previous) when selector(state) changes.
    select(selector, listener, equals = Object.is) {
      let current = selector(state);
      return this.subscribe(next => {
        const value = selector(next);
        if (equals(value, current)) return;
        const previous = current;
        current = value;
        listener(value, previous);
      });
    },
  };
}

// Accessor pair for the legacy state facade: store slice `slice`, key `key`.
export const field = (store, slice, key, { set } = {}) => ({
  get: () => store.get()[slice][key],
  set: set ?? (value => store.update(`${slice}.${key}`, state => {
    state[slice][key] = value;
  })),
});

// Builds the legacy `state` facade from {name: {get, set}} accessors.
export function createFacade(accessors) {
  const facade = {};
  for (const [name, accessor] of Object.entries(accessors)) {
    Object.defineProperty(facade, name, {
      get: accessor.get, set: accessor.set, enumerable: true, configurable: false,
    });
  }
  return Object.seal(facade);
}
