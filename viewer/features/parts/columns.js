// Collapsible side columns (spec 4, 5, 6; package parts-tree).
//
//   [  (or Alt+[ on layouts where [ needs Option/AltGr)  library column
//   ]  (or Alt+])                                        inspector column
//
// Each column also has a header button (slot header.action) and, while
// collapsed, a thin rail with an expand button in the column itself. A
// collapsed column shrinks to the rail; the viewport grows into the space and
// is never covered. The state is a global setting (scope G:
// libraryCollapsed, inspectorCollapsed) and is mirrored to localStorage only
// as a first-paint cache (the server settings stay the source of truth).
const svg = paths => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + `${paths}</svg>`;
const FRAME = '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/>';
export const LIBRARY_ICON = svg(`${FRAME}<path d="M9 4.5v15"/>`);
export const INSPECTOR_ICON = svg(`${FRAME}<path d="M15 4.5v15"/>`);

export const COLUMNS = Object.freeze({
  library: {
    key: 'libraryCollapsed', attribute: 'data-library-collapsed', keys: ['[', 'Alt+['],
    name: 'library', title: 'Library column', icon: LIBRARY_ICON, headerOrder: 1,
  },
  inspector: {
    key: 'inspectorCollapsed', attribute: 'data-inspector-collapsed', keys: [']', 'Alt+]'],
    name: 'inspector', title: 'Inspector column', icon: INSPECTOR_ICON, headerOrder: 95,
  },
});

const CACHE_KEY = 'wonky.viewer.columns';

// Button label and pressed state of a column toggle.
export function toggleLabel(column, collapsed) {
  const { title, keys } = COLUMNS[column];
  return `${collapsed ? 'Show' : 'Hide'} the ${title.toLowerCase()} (${keys[0]})`;
}

// { library, inspector } from a settings reader with the first-paint cache as
// fallback; anything that is not true is expanded.
export function columnState(read, cached = {}) {
  const result = {};
  for (const [column, { key }] of Object.entries(COLUMNS)) {
    const value = read(key);
    result[column] = value === undefined ? cached?.[column] === true : value === true;
  }
  return result;
}

const headerButton = column => {
  const { name, icon } = COLUMNS[column];
  const label = toggleLabel(column, false);
  return `<button id="${name}-column-toggle" class="icon-button column-toggle" type="button"`
    + ` data-column-toggle="${name}" aria-pressed="false" aria-expanded="true"`
    + ` title="${label}" aria-label="${label}">${icon}</button>`;
};

const rail = (column, text) => {
  const { name, icon } = COLUMNS[column];
  const label = toggleLabel(column, true);
  return `<div class="column-rail ${name}-rail"><button class="icon-button" type="button"`
    + ` data-column-expand="${name}" title="${label}" aria-label="${label}">${icon}</button>`
    + `<span class="column-rail-label" aria-hidden="true">${text}</span></div>`;
};

export function createColumns(ctx) {
  const { env, settings, slots, commands, app, dom: { $ } } = ctx;
  const storage = (() => {
    try {
      return ctx.legacy ? null : env.window?.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  const readCache = () => {
    try {
      return JSON.parse(storage?.getItem(CACHE_KEY) ?? '{}') ?? {};
    } catch {
      return {};
    }
  };
  const writeCache = value => {
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify(value));
    } catch {
      // Private mode: no first-paint cache.
    }
  };

  slots.header.action({
    id: 'columns.library', order: COLUMNS.library.headerOrder, html: headerButton('library'),
  });
  slots.header.action({
    id: 'columns.inspector', order: COLUMNS.inspector.headerOrder,
    html: headerButton('inspector'),
  });
  slots.library.section({
    id: 'columns.libraryRail', order: 1, html: rail('library', 'Library'),
  });
  slots.add('inspector', {
    id: 'columns.inspectorRail', order: 0, html: rail('inspector', 'Inspector'),
  });

  let state = { library: false, inspector: false };
  let settled = false;

  function apply(next) {
    state = { ...next };
    const workspace = $('.workspace');
    workspace?.setAttribute?.('data-columns', '');
    for (const [column, { attribute, name }] of Object.entries(COLUMNS)) {
      const collapsed = state[column];
      if (collapsed) workspace?.setAttribute?.(attribute, '');
      else workspace?.removeAttribute?.(attribute);
      const button = $(`#${name}-column-toggle`);
      if (button) {
        const label = toggleLabel(column, collapsed);
        button.setAttribute('aria-pressed', String(collapsed));
        button.setAttribute('aria-expanded', String(!collapsed));
        button.title = label;
        button.setAttribute('aria-label', label);
      }
    }
    app.clearHover?.();
    app.scheduleDraw?.();
  }

  function toggle(column) {
    const collapsed = !state[column];
    apply({ ...state, [column]: collapsed });
    writeCache(state);
    settings.set('G', COLUMNS[column].key, collapsed ? true : null);
    ctx.notify?.(`${COLUMNS[column].title} ${collapsed ? 'collapsed' : 'shown'} (`
      + `${COLUMNS[column].keys[0]})`);
  }

  // First paint from the cache; the server settings win once loaded.
  apply(columnState(() => undefined, readCache()));
  const restore = () => {
    if (settled || !settings.loaded()) return;
    settled = true;
    const next = columnState(key => settings.get('G', key, undefined), {});
    writeCache(next);
    if (next.library !== state.library || next.inspector !== state.inspector) apply(next);
  };
  const stopSettings = settings.onChange(restore);
  restore();

  for (const [column, { keys, title, name }] of Object.entries(COLUMNS)) {
    commands.register({
      id: `columns.${name}`, label: `Collapse or show the ${title.toLowerCase()}`, keys,
      run: () => toggle(column),
    });
    commands.bind(`#${name}-column-toggle`, `columns.${name}`);
    commands.bind(`.${name}-rail [data-column-expand]`, `columns.${name}`);
  }

  return {
    state: () => ({ ...state }),
    toggle,
    dispose: stopSettings,
  };
}
