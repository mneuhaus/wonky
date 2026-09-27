// Help, settings and focus handling (help-a11y; spec sections 4 to 6).
//
//   ?  / header "Keyboard shortcuts"  help overlay: every registered binding
//        with its scope, generated from the command registry
//        (keyboard.describe()), plus focused-control keys and mouse gestures
//   header "Settings"                 settings dialog: every slots.settings.item
//        entry, including this feature's two G settings:
//          theme               system (default) | light | dark -> <html data-theme>
//          singleKeyShortcuts  true (default); false turns off every character-key
//                              binding (keyboard.setSingleKeyShortcuts)
//   drawer   #report-drawer: focus moves in on open, Tab stays inside, Escape
//            closes only the drawer, focus returns to the opener (dom.trapFocus)
//
// Both dialogs are native <dialog> elements opened with showModal(), so the
// rest of the page is inert; Escape (via the Escape stack) and a backdrop
// click close them and focus returns to the control that opened them. The two
// settings are cached in localStorage for the first paint only; the server
// document (/api/settings) stays the source of truth (spec D19).
import { patch, raw, trapFocus } from '../../core/dom.js';
import { bindingCount, shortcutGroups, shortcutsMarkup } from './shortcuts.js';
import { parseSettingValue, settingsMarkup } from './settings-panel.js';

export const id = 'help';
export const legacy = false;

export const THEMES = Object.freeze(['light', 'dark', 'system']);
const CACHE_KEY = 'wonky.viewer.a11y';
export const SETTINGS = Object.freeze([
  { id: 'help.theme', order: 1, label: 'Theme', scope: 'G', key: 'theme', type: 'choice',
    choices: THEMES, default: 'system',
    description: 'System follows the light or dark appearance of the operating system.' },
  { id: 'help.singleKeys', order: 2, label: 'Single-key shortcuts', scope: 'G',
    key: 'singleKeyShortcuts', type: 'boolean', default: true,
    description: 'Letter, digit and symbol keys such as E, 1 or ?. When off, only ⌘/Ctrl'
      + ' shortcuts, Escape, Home and the arrow keys work.' },
]);

const svg = paths => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + `${paths}</svg>`;
const HELP_ICON = svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3'
  + 'c-.8.4-1.2 1-1.2 1.9v.5"/><path d="M12 17.2v.1"/>');
const SETTINGS_ICON = svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/>'
  + '<circle cx="9" cy="17" r="2"/>');

const BUTTONS = '<button id="help-toggle" class="icon-button" type="button"'
  + ' aria-haspopup="dialog" aria-controls="help-dialog" title="Keyboard shortcuts (?)"'
  + ` aria-label="Keyboard shortcuts">${HELP_ICON}</button><button id="settings-toggle"`
  + ' class="icon-button" type="button" aria-haspopup="dialog" aria-controls="settings-dialog"'
  + ` title="Settings" aria-label="Settings">${SETTINGS_ICON}</button>`;

const head = (name, eyebrow, title) => `<div class="help-head"><div><span class="eyebrow">`
  + `${eyebrow}</span><h2 id="${name}-title">${title}</h2><p id="${name}-summary"`
  + ` class="help-summary"></p></div><button class="icon-button help-close" type="button"`
  + ` data-close aria-label="Close ${title.toLowerCase()}" data-icon="close"></button></div>`;
const DIALOGS = '<dialog id="help-dialog" class="help-dialog" aria-modal="true"'
  + ' aria-labelledby="help-title" aria-describedby="help-summary"><div class="help-frame">'
  + head('help', 'Help', 'Keyboard shortcuts')
  + '<div class="help-tools"><input id="help-filter" class="text-input help-filter"'
  + ' type="search" placeholder="Filter shortcuts" aria-label="Filter shortcuts"'
  + ' autocomplete="off"><label class="help-switch"><input id="help-single-keys"'
  + ' type="checkbox" checked> Single-key shortcuts</label><button id="help-settings"'
  + ' class="button secondary" type="button">Settings…</button></div>'
  + '<div id="help-list" class="help-list"></div></div></dialog>'
  + '<dialog id="settings-dialog" class="help-dialog settings-dialog" aria-modal="true"'
  + ' aria-labelledby="settings-title" aria-describedby="settings-summary"><div'
  + ` class="help-frame">${head('settings', 'Viewer', 'Settings')}<form id="settings-list"`
  + ' class="settings-list" novalidate></form></div></dialog>';

const readCache = storage => {
  try {
    return JSON.parse(storage?.getItem(CACHE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
};

export const themeOf = value => (THEMES.includes(value) ? value : 'system');

export function setup(ctx) {
  const { env, slots, commands, keyboard, settings, dom: { $ } } = ctx;
  const storage = (() => {
    try {
      return env.window?.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  const cache = readCache(storage);
  const platform = env.navigator?.userAgentData?.platform ?? env.navigator?.platform ?? '';
  const mac = /Mac|iPhone|iPad/i.test(platform);
  // The settings document wins; before it loaded, the first-paint cache.
  const read = (key, fallback) => {
    const value = settings.get('G', key, undefined);
    if (value !== undefined || settings.loaded()) return value ?? fallback;
    return cache[key] ?? fallback;
  };
  const stops = [];

  slots.header.action({ id: 'help.buttons', order: 80, html: BUTTONS });
  slots.add('reviewArea', { id: 'help.dialogs', order: 95, html: DIALOGS });
  for (const item of SETTINGS) slots.settings.item(item);

  // ---- Theme and single keys ----
  let applied = {};
  function apply() {
    const theme = themeOf(read('theme', 'system'));
    const singleKeys = read('singleKeyShortcuts', true) !== false;
    const root = env.document.documentElement;
    keyboard.setSingleKeyShortcuts(singleKeys);
    // Only a change of the setting touches <html data-theme>, so other settings
    // never undo a theme set by hand (QA, devtools).
    if (applied.theme !== theme && root?.dataset) {
      root.dataset.theme = theme;
      const paper = env.window?.getComputedStyle?.(env.document.body)?.backgroundColor;
      if (paper) $('meta[name="theme-color"]')?.setAttribute?.('content', paper);
    }
    const toggle = $('#help-single-keys');
    if (toggle) toggle.checked = singleKeys;
    $('#help-toggle')?.setAttribute?.('title',
      singleKeys ? 'Keyboard shortcuts (?)' : 'Keyboard shortcuts');
    if (applied.theme !== theme || applied.singleKeys !== singleKeys) {
      try {
        storage?.setItem(CACHE_KEY, JSON.stringify({ theme, singleKeyShortcuts: singleKeys }));
      } catch {
        // Private mode: no first-paint cache.
      }
    }
    applied = { theme, singleKeys };
  }

  // ---- Dialogs ----
  function createDialog(element, { initial, render }) {
    let trap = null;
    let popEscape = null;
    const isOpen = () => !!element?.open;
    function open() {
      if (!element || isOpen()) return;
      render();
      const opener = env.document.activeElement;
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
      popEscape = keyboard.pushEscape(() => close());
      trap = trapFocus(element, { initial: initial(), opener, fallback: $('#model-canvas') });
    }
    function close() {
      if (!isOpen()) return;
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
      closed();
    }
    // Runs once per close, also for the native Escape (cancel) of <dialog>.
    function closed() {
      popEscape?.();
      popEscape = null;
      trap?.release();
      trap = null;
    }
    element?.addEventListener?.('close', closed);
    // A click on the backdrop targets the <dialog> itself (the frame fills it).
    element?.addEventListener?.('click', event => {
      if (event.target === element) close();
    });
    element?.querySelector?.('[data-close]')?.addEventListener?.('click', () => close());
    return { open, close, isOpen, toggle: () => (isOpen() ? close() : open()) };
  }

  let filter = '';
  function renderHelp() {
    const enabled = commandId => {
      const command = commands.get(commandId);
      try {
        return !command?.enabled || command.enabled() !== false;
      } catch {
        return true;
      }
    };
    const groups = shortcutGroups(keyboard.describe(), { enabled, mac });
    const commandsCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
    const summary = $('#help-summary');
    if (summary) {
      summary.textContent = `${bindingCount(groups)} key bindings of ${commandsCount} commands,`
        + ' generated from the command registry.';
    }
    const list = $('#help-list');
    if (list) {
      patch(list, raw(shortcutsMarkup(groups, {
        filter, singleKeys: keyboard.singleKeyShortcuts(),
      })));
    }
  }
  function renderSettings() {
    const summary = $('#settings-summary');
    if (summary) summary.textContent = 'Saved for every model in viewer-settings.json.';
    const list = $('#settings-list');
    if (list) patch(list, raw(settingsMarkup(slots.list('settings.item'), read)));
  }

  const help = createDialog($('#help-dialog'), { initial: () => $('#help-filter'),
    render: renderHelp });
  const settingsDialog = createDialog($('#settings-dialog'), {
    initial: () => $('#settings-list [data-setting]'), render: renderSettings,
  });

  $('#help-filter')?.addEventListener?.('input', event => {
    filter = event.target.value.trim();
    renderHelp();
  });
  $('#help-single-keys')?.addEventListener?.('change', event => {
    settings.set('G', 'singleKeyShortcuts', !!event.target.checked);
  });
  $('#help-settings')?.addEventListener?.('click', () => {
    help.close();
    settingsDialog.open();
  });
  $('#settings-list')?.addEventListener?.('change', event => {
    const control = event.target?.closest?.('[data-setting]');
    const item = slots.list('settings.item').find(entry => entry.id === control?.dataset.setting);
    if (!item || item.scope !== 'G') return;
    const parsed = parseSettingValue(item, item.type === 'boolean' ? control.checked
      : control.value);
    if (parsed.ok) settings.set('G', item.key, parsed.value);
    else renderSettings();
  });
  $('#settings-list')?.addEventListener?.('submit', event => event.preventDefault());

  stops.push(settings.onChange(() => {
    apply();
    if (help.isOpen()) renderHelp();
    if (settingsDialog.isOpen()) renderSettings();
  }));

  commands.register({
    id: 'help.shortcuts', label: 'Keyboard shortcuts (this list)', keys: ['?'],
    run: () => help.toggle(),
  });
  commands.register({
    id: 'help.close', label: 'Close the shortcut list or settings', keys: ['?'],
    scope: 'dialog', run: () => {
      help.close();
      settingsDialog.close();
    },
  });
  commands.register({ id: 'help.settings', label: 'Settings', run: () => settingsDialog.open() });
  commands.register({
    id: 'help.toggleSingleKeys', label: 'Single-key shortcuts on/off',
    run: () => settings.set('G', 'singleKeyShortcuts', !keyboard.singleKeyShortcuts()),
  });
  commands.bind('#help-toggle', 'help.shortcuts');
  commands.bind('#settings-toggle', 'help.settings');

  // ---- Drawer focus: in on open, trapped while open, back on close ----
  // While the drawer is open it is the top of the Escape stack (spec section
  // 5), so Escape closes only the drawer and the selection (with the control
  // that opened the drawer) stays; a second Escape clears the selection.
  const drawer = $('#report-drawer');
  const Observer = env.window?.MutationObserver;
  if (drawer?.nodeType === 1 && Observer) {
    let trap = null;
    let popEscape = null;
    const typingOutside = () => keyboard.typing()
      && !drawer.contains(env.document.activeElement);
    const onEscape = () => {
      // A field outside the drawer is only blurred, like the default Escape.
      if (typingOutside()) env.document.activeElement.blur();
      else ctx.drawer.close();
    };
    const sync = () => {
      const open = !drawer.hidden;
      if (open && !popEscape) popEscape = keyboard.pushEscape(onEscape);
      if (!open && popEscape) {
        popEscape();
        popEscape = null;
      }
      // Never pull focus out of a field the user is typing in.
      if (open && !trap && !typingOutside()) {
        trap = trapFocus(drawer, { initial: $('#close-report'), fallback: $('#model-canvas') });
      } else if (!open && trap) {
        trap.release();
        trap = null;
      }
    };
    const observer = new Observer(sync);
    observer.observe(drawer, { attributes: true, attributeFilter: ['hidden'] });
    stops.push(() => {
      observer.disconnect();
      popEscape?.();
      trap?.release({ restore: false });
    });
  }

  apply();
  return {
    api: {
      openHelp: () => help.open(),
      openSettings: () => settingsDialog.open(),
      closeHelp: () => help.close(),
    },
    dispose() {
      for (const stop of stops) stop?.();
      help.close();
      settingsDialog.close();
    },
  };
}
