// Latest-wins request scopes. A scope counts navigations; begin() starts a
// new one (aborting the previous AbortController) and returns a token that
// stays current until the next begin(). Legacy navigation keeps the plain
// counter semantics of the pre-foundation viewer (next/current/isCurrent).
export function createRequests({ AbortController: Controller = globalThis.AbortController } = {}) {
  const scopes = new Map();
  const create = name => {
    let counter = 0;
    let controller = null;
    return {
      name,
      next: () => ++counter,
      current: () => counter,
      isCurrent: token => token === counter,
      begin() {
        controller?.abort();
        controller = Controller ? new Controller() : null;
        const token = ++counter;
        return { token, signal: controller?.signal, current: () => token === counter };
      },
      abort() {
        controller?.abort();
        controller = null;
        counter++;
      },
    };
  };
  return {
    scope(name) {
      if (!scopes.has(name)) scopes.set(name, create(name));
      return scopes.get(name);
    },
  };
}
