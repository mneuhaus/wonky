// Command registry: every button and shortcut runs a command.
//
//   commands.register({ id, label, keys, scope, run, enabled, allowWhileTyping,
//                       preventDefault })
//   commands.run(id, ...args)          commands.bind('#fit-view', 'view.fit')
//
// keys: 'V', 'Mod+S' (⌘ or Ctrl), 'Escape', 'ArrowLeft', 'Shift+G'. scope:
// 'global' (default) or 'canvas' (viewport focused). A duplicate binding in
// one scope is a conflict: conflicts() lists them (tested), and at runtime
// keyboard.js keeps the first and logs the rest.
export function createCommands({ dom, log = () => {} } = {}) {
  const commands = new Map();
  const api = {
    register(command) {
      if (!command?.id || typeof command.run !== 'function') {
        throw new Error('A command needs an id and run()');
      }
      if (commands.has(command.id)) throw new Error(`Command ${command.id} is registered twice`);
      commands.set(command.id, {
        scope: 'global', keys: [], allowWhileTyping: false, preventDefault: true, ...command,
      });
      return () => commands.delete(command.id);
    },
    has: id => commands.has(id),
    get: id => commands.get(id),
    list: () => [...commands.values()],
    run(id, ...args) {
      const command = commands.get(id);
      if (!command) {
        log(`Unknown command ${id}`);
        return undefined;
      }
      if (command.enabled && !command.enabled()) return undefined;
      return command.run(...args);
    },
    // Binds an element's onclick (the element is looked up by selector).
    bind(selector, id, ...args) {
      const element = dom.$(selector);
      if (element) element.onclick = event => api.run(id, ...args, event);
      return element;
    },
    bindings() {
      return api.list().flatMap(command => command.keys.map(key => ({
        id: command.id, key: normalizeKey(key), scope: command.scope,
      })));
    },
    conflicts() {
      const seen = new Map();
      const conflicts = [];
      for (const binding of api.bindings()) {
        const slot = `${binding.scope}:${binding.key}`;
        if (seen.has(slot)) conflicts.push({ key: binding.key, scope: binding.scope,
          commands: [seen.get(slot), binding.id] });
        else seen.set(slot, binding.id);
      }
      return conflicts;
    },
  };
  return api;
}

// 'mod+shift+g' -> 'Mod+Shift+G'; single letters upper-case; named keys kept.
export function normalizeKey(key) {
  const parts = key.split('+');
  const name = parts.pop();
  const modifiers = new Set(parts.map(part => part.toLowerCase()));
  const order = [['mod', 'Mod'], ['alt', 'Alt'], ['shift', 'Shift']];
  const prefix = order.filter(([modifier]) => modifiers.has(modifier)).map(([, label]) => label);
  return [...prefix, name.length === 1 ? name.toUpperCase() : name].join('+');
}
