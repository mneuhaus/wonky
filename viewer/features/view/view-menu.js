// The Views menu behind #view-presets: the seven standard views with their
// keys, the default view, fit and the projection. Owner: camera-navigation.
//
// A menu (role=menu) opened by the button; ArrowUp/ArrowDown/Home/End move
// between items, Enter/Space choose, Escape closes (Escape stack) and returns
// focus to the button, a pointer press outside closes it.
import { escape } from '../../core/dom.js';

export const MENU_ITEMS = Object.freeze([
  { id: 'view.front', label: 'Front', keys: '1 · ⇧1' },
  { id: 'view.back', label: 'Back', keys: '3 · ⇧2' },
  { id: 'view.left', label: 'Left', keys: '4 · ⇧3' },
  { id: 'view.right', label: 'Right', keys: '6 · ⇧4' },
  { id: 'view.top', label: 'Top', keys: '8 · ⇧5' },
  { id: 'view.bottom', label: 'Bottom', keys: '2 · ⇧6' },
  { id: 'view.iso', label: 'Isometric', keys: '5 · ⇧7' },
  { separator: true },
  { id: 'view.default', label: 'Default view', keys: '0 · Home' },
  { id: 'view.fit', label: 'Fit, keep orientation', keys: 'F' },
  { id: 'view.projection', label: 'Perspective', keys: 'O', checkbox: true },
]);

export function menuMarkup() {
  const items = MENU_ITEMS.map(item => {
    if (item.separator) return '<li role="separator" class="view-menu-separator"></li>';
    const role = item.checkbox ? 'menuitemcheckbox' : 'menuitem';
    const checked = item.checkbox ? ' aria-checked="false"' : '';
    return `<li role="none"><button type="button" role="${role}" class="view-menu-item"`
      + ` data-command="${escape(item.id)}" tabindex="-1"${checked}><span>`
      + `${escape(item.label)}</span><kbd>${escape(item.keys)}</kbd></button></li>`;
  }).join('');
  return '<ul id="view-menu" class="view-menu" role="menu" aria-label="Views"'
    + ` aria-labelledby="view-presets" hidden>${items}</ul>`;
}

export function createViewMenu({ env, dom, keyboard, commands, onOpen = () => {} }) {
  const { $ } = dom;
  let popEscape = null;

  const menu = () => $('#view-menu');
  const button = () => $('#view-presets');
  const items = () => [...(menu()?.querySelectorAll?.('[role^="menuitem"]') ?? [])];
  const isOpen = () => menu() && !menu().hidden;

  function close({ focusButton = false } = {}) {
    if (!menu()) return;
    menu().hidden = true;
    button()?.setAttribute('aria-expanded', 'false');
    popEscape?.();
    popEscape = null;
    if (focusButton) button()?.focus?.({ preventScroll: true });
  }

  function open({ focusFirst = false } = {}) {
    if (!menu()) return;
    onOpen();
    menu().hidden = false;
    button()?.setAttribute('aria-expanded', 'true');
    popEscape ??= keyboard.pushEscape(() => close({ focusButton: true }));
    if (focusFirst) items()[0]?.focus?.({ preventScroll: true });
  }

  function toggle(event) {
    if (isOpen()) close();
    else open({ focusFirst: event?.detail === 0 });
  }

  // Item clicks, keyboard movement, outside presses. Returns the unbind.
  function bind() {
    const element = menu();
    if (!element) return () => {};
    element.onclick = event => {
      const item = event.target?.closest?.('[data-command]');
      if (!item) return;
      close();
      commands.run(item.dataset.command);
    };
    element.onkeydown = event => {
      const list = items();
      const index = list.indexOf(env.document.activeElement);
      const moves = {
        ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1,
      };
      if (!(event.key in moves)) return;
      event.preventDefault();
      event.stopPropagation();
      list[(moves[event.key] + list.length) % list.length]?.focus?.({ preventScroll: true });
    };
    const outside = event => {
      if (!isOpen()) return;
      const target = event.target;
      if (menu().contains?.(target) || button()?.contains?.(target)) return;
      close();
    };
    env.window.addEventListener?.('pointerdown', outside, true);
    return () => env.window.removeEventListener?.('pointerdown', outside, true);
  }

  function setProjection(perspective) {
    const item = menu()?.querySelector?.('[data-command="view.projection"]');
    item?.setAttribute('aria-checked', String(perspective));
  }

  return { open, close, toggle, bind, isOpen, setProjection };
}
