// Keyboard dispatch derived from command bindings, with the pre-foundation
// precedence:
//   1. bindings allowed while typing (Mod+S, Escape)
//   2. nothing else while an input, textarea, select or editable has focus
//   3. inside an open modal dialog ([aria-modal="true"]) only `dialog` scope
//   4. modifier bindings (Mod+Z)
//   5. no single-key binding fires with ⌘, Ctrl or Alt held
//   6. no character-key binding fires while single-key shortcuts are off
//   7. single keys in the global scope, then the canvas scope (viewport focused)
// Letters match event.key case-insensitively (Shift is ignored unless the
// binding names it). Digit and numpad bindings (`Digit1`, `Numpad1`) match
// event.code, so QWERTZ, the number row and the numpad work; arrow bindings
// match only Arrow* codes, and no named key (Home, arrows) matches a numpad
// code: a numpad key with NumLock off is not an arrow or Home.
// Escape runs the top of the Escape stack if any handler was pushed, else
// every Escape participant in order.
//
// Single-key shortcuts (WCAG 2.1.4, spec section 5): setSingleKeyShortcuts
// (false) turns off every binding typed with one character key (letters,
// digits, punctuation, also with Shift). Mod/Alt bindings, Escape, Home and
// the arrows keep working. A capture listener on window, registered when the
// keyboard is created (before any feature), also stops character keys from
// reaching listeners outside this dispatch; focus-scoped widgets (menus,
// lists, trees, [data-key-scope]) and text fields are left alone.
import { normalizeKey } from './commands.js';

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;
const CODE_KEY = /^(Digit|Numpad)[0-9]$|^Key[A-Z]$/;
const FOCUS_SCOPES = '[role="menu"],[role="menubar"],[role="listbox"],[role="tree"],'
  + '[role="treegrid"],[role="grid"],[role="application"],[data-key-scope]';
const MODAL = '[aria-modal="true"]';

export function parseKey(key) {
  const parts = normalizeKey(key).split('+');
  const name = parts.pop();
  return {
    name,
    mod: parts.includes('Mod'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift') ? true : undefined,
  };
}

// A binding typed with one character key (WCAG "character key shortcut").
export function isCharacterBinding(key) {
  const { name, mod, alt } = typeof key === 'string' ? parseKey(key) : key;
  return !mod && !alt && (name.length === 1 || CODE_KEY.test(name));
}

// A keydown that types a character (no ⌘/Ctrl/Alt; Space and Enter excluded).
export function isCharacterEvent(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const key = String(event.key ?? '');
  return key.length === 1 && key !== ' ';
}

// A binding requires the modifiers it names; extra modifiers are excluded by
// the dispatch order above (step 5), exactly like the pre-foundation checks.
export const matches = (binding, event) => {
  const key = String(event.key ?? '');
  const code = String(event.code ?? '');
  let name;
  if (CODE_KEY.test(binding.name)) name = code === binding.name;
  // A numpad key with NumLock off (key Home, code Numpad7) is no named key.
  else if (binding.name.length > 1 && code.startsWith('Numpad')) name = false;
  else if (binding.name.startsWith('Arrow') && code) name = code === binding.name;
  else if (binding.name.length === 1) name = key.toUpperCase() === binding.name;
  else name = key === binding.name;
  if (!name) return false;
  if (binding.mod && !(event.metaKey || event.ctrlKey)) return false;
  if (binding.alt && !event.altKey) return false;
  return binding.shift === undefined || binding.shift === !!event.shiftKey;
};

const NAMES = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', ' ': 'Space',
};
// Display label of one key: 'Mod+Shift+S' -> '⌘⇧S' (mac) or 'Ctrl+Shift+S'.
export function keyLabel(key, { mac = false } = {}) {
  const { name, mod, alt, shift } = parseKey(key);
  const base = /^Digit[0-9]$/.test(name) ? name.slice(5)
    : /^Numpad[0-9]$/.test(name) ? `Num ${name.slice(6)}`
      : /^Key[A-Z]$/.test(name) ? name.slice(3) : NAMES[name] ?? name;
  const modifiers = mac
    ? [mod && '⌘', alt && '⌥', shift && '⇧'].filter(Boolean).join('')
    : [mod && 'Ctrl+', alt && 'Alt+', shift && 'Shift+'].filter(Boolean).join('');
  return modifiers + base;
}

export function createKeyboard({ env, dom, commands, canvas, log = () => {} }) {
  const escapeStack = [];
  const participants = [];
  const logged = new Set();
  let singleKeys = true;
  const active = () => env.document.activeElement;
  const typing = () => {
    const element = active();
    return TYPING.test(element?.tagName ?? '') || element?.isContentEditable === true;
  };
  const inModal = () => !!active()?.closest?.(MODAL);

  // Every binding in registration order; a conflicting later one is dropped.
  const collect = () => {
    const taken = new Set();
    const result = [];
    for (const command of commands.list()) {
      for (const key of command.keys) {
        const binding = { ...parseKey(key), key: normalizeKey(key), command };
        const slot = `${command.scope}:${binding.key}`;
        if (taken.has(slot)) {
          if (!logged.has(slot)) log(`Keyboard conflict: ${slot} (${command.id}) ignored`);
          logged.add(slot);
          continue;
        }
        taken.add(slot);
        result.push(binding);
      }
    }
    return result;
  };
  // A binding that names Shift wins over the same key without it.
  const bindingsFor = predicate => collect().filter(predicate)
    .sort((a, b) => (b.shift !== undefined) - (a.shift !== undefined));

  const fire = (binding, event) => {
    if (binding.command.preventDefault) event.preventDefault();
    commands.run(binding.command.id, event);
  };

  function onKeydown(event) {
    const find = predicate => bindingsFor(predicate).find(binding => matches(binding, event));
    const safe = find(binding => binding.command.allowWhileTyping);
    if (safe) {
      fire(safe, event);
      return;
    }
    if (typing()) return;
    if (inModal()) {
      const local = find(binding => binding.command.scope === 'dialog');
      if (local) fire(local, event);
      return;
    }
    const modified = find(binding => binding.mod || binding.alt);
    if (modified) {
      fire(modified, event);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const allowed = binding => singleKeys || !isCharacterBinding(binding);
    const global = find(binding => binding.command.scope === 'global' && allowed(binding));
    if (global) fire(global, event);
    if (active() === canvas) {
      const local = find(binding => binding.command.scope === 'canvas' && allowed(binding));
      if (local) fire(local, event);
    }
  }

  // Out-of-band guard (see the header). Registered now, so it runs before
  // capture listeners that features add during setup.
  env.window?.addEventListener?.('keydown', event => {
    if (singleKeys || !isCharacterEvent(event) || typing()) return;
    if (event.target?.closest?.(FOCUS_SCOPES)) return;
    event.stopImmediatePropagation?.();
  }, true);

  return {
    install() {
      env.document.addEventListener('keydown', onKeydown);
    },
    typing,
    // Single-key shortcuts on/off (help-a11y owns the G setting that drives it).
    setSingleKeyShortcuts(enabled) {
      singleKeys = enabled !== false;
    },
    singleKeyShortcuts: () => singleKeys,
    // Every binding with its command, scope and whether it fires right now.
    describe() {
      return collect().map(binding => {
        const character = isCharacterBinding(binding);
        return {
          id: binding.command.id, label: binding.command.label ?? binding.command.id,
          key: binding.key, scope: binding.command.scope, character,
          active: !character || singleKeys || binding.command.allowWhileTyping,
        };
      });
    },
    // Exclusive Escape handler (gesture, dialog, drawer, locked tool); returns pop().
    pushEscape(handler) {
      escapeStack.push(handler);
      return () => {
        const index = escapeStack.lastIndexOf(handler);
        if (index >= 0) escapeStack.splice(index, 1);
      };
    },
    // Participant of the default Escape (all run, by order).
    onEscape(handler, order = 50) {
      participants.push({ handler, order });
      participants.sort((a, b) => a.order - b.order);
    },
    escape(event) {
      const info = { typing: typing(), event };
      if (escapeStack.length) {
        escapeStack.at(-1)(info);
        return;
      }
      for (const { handler } of participants) handler(info);
    },
    // Focus-scoped arrows for a role=tablist element (list scope).
    bindTabList(list) {
      list.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...list.querySelectorAll('[role="tab"]')];
        const current = tabs.indexOf(env.document.activeElement);
        const step = event.key === 'ArrowLeft' ? -1 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (current + step + tabs.length) % tabs.length;
        tabs[next].click();
        tabs[next].focus();
      });
    },
    dom,
  };
}
