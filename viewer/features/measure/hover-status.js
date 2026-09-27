// Hover status line (spec 3.2): type and key parameter of the hovered entity
// with its exactness chip, e.g. "Cylinder hole Ø4.0000 mm · exact ±0.0003 ·
// B1.F3", in the viewport status bar. Values come from the geometry cache;
// an entity that is not cached yet is fetched by alias (latest wins).
import { geometryAlias } from '../../core/scene-records.js';
import { hoverText } from './geometry-section.js';

const MARKUP = '<div id="hover-status" class="hover-status" role="status" aria-live="polite"'
  + ' hidden></div>';
const LABELS = { face: 'Face', edge: 'Edge', vertex: 'Point', body: 'Body' };

// Text for a hovered reference: exact data when cached, else a pending line.
export function hoverLine({ reference, scene, entry, error, alias: known }) {
  if (!reference || !scene) return '';
  const alias = known ?? geometryAlias(scene, reference);
  if (reference.entityType === 'body') return `Body ${alias}`;
  if (entry) return hoverText(entry);
  if (error) return `${LABELS[reference.entityType]} ${alias} · exact geometry unavailable`;
  return `${LABELS[reference.entityType]} ${alias} · loading exact geometry…`;
}

export function createHoverStatus(ctx, cache) {
  const { state, store, slots, requests, dom: { $ } } = ctx;
  slots.statusBar.item({ id: 'measure.hover', order: 40, html: MARKUP });
  const scope = requests.scope('measure.hover');
  const failed = new Set();

  function update() {
    const element = $('#hover-status');
    if (!element) return;
    const reference = state.hover;
    const scene = reference ? (state.scenes.get(reference.modelId)
      ?? ctx.renderer.summary(reference.modelId)) : null;
    if (!reference || !scene) {
      element.hidden = true;
      element.textContent = '';
      element.title = '';
      return;
    }
    const alias = reference.entityType === 'body' ? null
      : ctx.renderer.alias(reference) ?? geometryAlias(scene, reference);
    const entry = alias ? cache.entity(reference.modelId, alias) : null;
    const key = `${reference.modelId}:${alias}`;
    const text = hoverLine({ reference, scene, entry, error: failed.has(key),
      alias: ctx.renderer.alias(reference) });
    element.hidden = false;
    element.textContent = text;
    element.title = text;
    element.classList.toggle('pending', !!alias && !entry);
    if (!alias || entry || failed.has(key)) return;
    const { signal, current } = scope.begin();
    cache.ensure(reference.modelId, [alias], { signal }).catch(error => {
      if (error?.name === 'AbortError' || !current()) return;
      failed.add(key);
      update();
    });
  }

  const stops = [
    store.select(current => current.selection.hover, update),
    cache.onChange(() => {
      if (state.hover) update();
    }),
  ];
  return {
    update,
    dispose() {
      for (const stop of stops) stop();
    },
  };
}
