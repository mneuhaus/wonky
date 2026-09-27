// Extension points (spec 10.3).
//
// DOM slots are regions marked data-slot="<name>" in index.html or in
// feature markup. slots.add(name, { id, order, html }) inserts the item's
// markup at its order without re-rendering earlier items, so handlers bound
// to them stay intact. Static children of a region may carry data-order.
// Items for a region that does not exist yet wait until it appears.
//
// List slots (inspector.section, library.row, parts.rowBadge, parts.rowAction,
// parts.rowDetail, settings.item) are data: slots.list(name) returns their
// items by order.
//
// Named helpers mirror the spec: slots.header.action(item),
// slots.viewportHud.item({ corner, ... }), slots.inspector.section(item), ...
import { hydrateIcons } from './icons.js';

const LIST_SLOTS = new Set([
  'inspector.section', 'library.row', 'parts.rowBadge', 'parts.rowAction', 'parts.rowDetail',
  'settings.item',
]);

export function createSlots({ env }) {
  const document = env.document;
  const items = new Map();
  const nodes = new Map();
  const pending = new Map();
  const canInsert = typeof document.createElement('template')?.content?.childNodes === 'object';

  const regionOf = name => document.querySelector(`[data-slot="${name}"]`);
  const orderOf = node => (node.nodeType === 1 && node.dataset?.order !== undefined
    ? Number(node.dataset.order) : null);

  function insert(name, item) {
    const region = regionOf(name);
    if (!region) {
      if (!pending.has(name)) pending.set(name, []);
      pending.get(name).push(item);
      return;
    }
    if (!canInsert || !region.childNodes) {
      // Test environments without a real DOM only need the markup string.
      region.innerHTML = (region.innerHTML ?? '') + item.html;
      return;
    }
    const template = document.createElement('template');
    template.innerHTML = item.html;
    const inserted = [...template.content.childNodes];
    const before = [...region.childNodes].find(node => {
      const owner = [...nodes.entries()].find(([, list]) => list.includes(node))?.[0];
      const order = owner ? owner.order : orderOf(node);
      return order !== null && order > item.order;
    }) ?? null;
    for (const node of inserted) region.insertBefore(node, before);
    nodes.set(item, inserted);
    for (const node of inserted) {
      if (node.nodeType !== 1) continue;
      hydrateIcons(node);
      flush(node);
    }
  }

  // Places items that were waiting for regions inside `root`.
  function flush(root) {
    for (const [name, waiting] of [...pending]) {
      const region = root.matches?.(`[data-slot="${name}"]`) ? root
        : root.querySelector?.(`[data-slot="${name}"]`);
      if (!region) continue;
      pending.delete(name);
      for (const item of waiting.sort((a, b) => a.order - b.order)) insert(name, item);
    }
  }

  const add = (name, item) => {
    const entry = { order: 50, ...item };
    if (!items.has(name)) items.set(name, []);
    const list = items.get(name);
    if (entry.id && list.some(other => other.id === entry.id)) {
      throw new Error(`Slot item ${name}/${entry.id} is registered twice`);
    }
    list.push(entry);
    list.sort((a, b) => a.order - b.order);
    if (!LIST_SLOTS.has(name) && entry.html !== undefined) insert(name, entry);
    return entry;
  };
  const helper = name => item => add(name, item);

  return {
    add,
    list: name => [...(items.get(name) ?? [])],
    pending: () => [...pending.keys()],
    header: { status: helper('header.status'), action: helper('header.action') },
    modelBar: { item: helper('modelBar.item') },
    library: {
      tab: helper('library.tab'), row: helper('library.row'), section: helper('library.section'),
    },
    parts: {
      rowBadge: helper('parts.rowBadge'), rowAction: helper('parts.rowAction'),
      rowDetail: helper('parts.rowDetail'),
    },
    viewportHud: { item: item => add(`viewportHud.${item.corner ?? 'top-left'}`, item) },
    viewportBanner: { item: helper('viewportBanner.item') },
    statusBar: { item: helper('statusBar.item') },
    viewActions: { button: helper('viewActions.button') },
    toolbar: { tool: helper('toolbar.tool') },
    inspector: { section: helper('inspector.section') },
    settings: { item: helper('settings.item') },
  };
}
