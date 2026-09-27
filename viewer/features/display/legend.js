// Display legend (spec 7.3): the bottom line always states the display
// tolerance and which display-only features are active, so a picture is never
// taken for exact geometry. Pure text builder plus a small DOM binding.
//
//   legendItems({ facts: [renderer.look(id), …], style }) -> [{ id, text, title }]
import { EDGE_LOOK } from '../../render/shaders.js';
import { XRAY_OPACITY } from '../../render/style.js';

export const LEGEND_MARKUP = '<span id="display-legend" class="display-legend"'
  + ' role="status" aria-live="polite"></span>';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const percent = value => `${Math.round(value * 100)} %`;

// Tolerance as written by the producer (0.02 -> "0.02"), never rounded up
// into a finer claim.
export function toleranceText(toleranceMm) {
  if (!(typeof toleranceMm === 'number' && toleranceMm > 0)) {
    return 'display mesh (tolerance not stated)';
  }
  return `display mesh ±${Number(toleranceMm.toPrecision(3))} mm`;
}

// Items for the displayed models (facts of each, from renderer.look()).
export function legendItems({ facts = [], style = {} } = {}) {
  const shown = facts.filter(Boolean);
  if (!shown.length) return [];
  const sum = key => shown.reduce((total, item) => total + (item[key] ?? 0), 0);
  const classes = key => shown.reduce((total, item) => total + (item.edgeClasses?.[key] ?? 0), 0);
  const tolerances = shown.map(item => item.toleranceMm).filter(value => value > 0);
  const items = [{
    id: 'tolerance',
    text: toleranceText(tolerances.length ? Math.max(...tolerances) : null),
    title: 'Faces and edges are drawn from display triangles and polylines within this chord'
      + ' tolerance. Measurements use the exact B-rep, never the picture.',
  }];
  const smooth = sum('smoothFaces');
  if (smooth) {
    items.push({
      id: 'smooth-normals', text: 'smooth normals',
      title: `${plural(smooth, 'curved face')} shaded with exact per-vertex normals`
        + ' interpolated across display triangles (display only).',
    });
  }
  const seamCount = classes('seam');
  const subdivisionCount = classes('subdivision');
  const seams = seamCount + subdivisionCount;
  const seamWords = [seamCount ? 'seam' : null, subdivisionCount ? 'subdivision' : null]
    .filter(Boolean).join(' + ');
  if (!style.edges) {
    items.push({ id: 'edges', text: 'edges off', title: 'Feature edges are hidden (E).' });
  } else if (seams) {
    items.push({
      id: 'seams',
      text: `${seamWords} edges ${style.hiddenEdges ? 'dimmed' : 'hidden'}`,
      title: `${plural(seams, 'seam or subdivision edge')} (exact classes)`
        + (style.hiddenEdges ? ` drawn at ${percent(EDGE_LOOK.dimmedAlpha)}` : ' not drawn')
        + '; Shift+E toggles. They stay selectable through Browse geometry.',
    });
  }
  if (style.xray) {
    items.push({
      id: 'xray', text: `x-ray ${percent(XRAY_OPACITY)}`,
      title: `Every body is drawn ${percent(XRAY_OPACITY)} transparent; hidden edges are faint`
        + ' (T toggles).',
    });
  }
  const planes = style.clipPlanes?.length ?? 0;
  if (planes) {
    items.push({
      id: 'section', text: 'display section',
      title: `${plural(planes, 'clip plane')}: clip planes and caps from the display mesh`
        + ' (not an exact section); exact contours on demand.',
    });
  }
  const curved = sum('curvedOverhangFaces');
  if (style.overhang?.enabled && curved) {
    items.push({
      id: 'overhang-sampling', text: 'curved overhang sampled',
      title: `${plural(curved, 'curved face')} tinted where the interpolated display normal`
        + ` exceeds α ${style.overhang.alphaDeg}° from vertical; band edges follow the display`
        + ' strips.',
    });
  }
  const palette = shown.flatMap(item => (item.bodies ?? [])
    .filter(body => body.visible && body.colorSource === 'viewer-palette')
    .map(body => body.alias));
  if (palette.length) {
    const unique = [...new Set(palette)];
    items.push({
      id: 'viewer-colors', text: 'viewer colors',
      title: `${unique.join(', ')}: no appearance in the model; colors from the viewer`
        + ' palette, not model data.',
    });
  }
  return items;
}

const escape = text => String(text).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

// The tolerance item first and never shortened; the other items share one
// span that the status line may cut with an ellipsis (spec 7.3).
export function legendHtml(items) {
  const item = entry => `<span class="display-legend-item" data-legend="${escape(entry.id)}"`
    + ` title="${escape(entry.title)}">${escape(entry.text)}</span>`;
  const separator = '<span aria-hidden="true">·</span>';
  const [first, ...rest] = items;
  if (!first) return '';
  return item(first) + (rest.length ? `<span class="display-legend-rest">${separator}`
    + `${rest.map(item).join(separator)}</span>` : '');
}

// Binds the legend element. update() runs after every frame, so it returns
// at once while key() (displayed models and style version) is unchanged, and
// re-renders only when the text changes.
export function createLegend({ element, facts, style, key = () => null }) {
  let last = null;
  let lastKey = null;
  return {
    update() {
      const node = element();
      if (!node) return;
      const current = key();
      if (current !== null && current === lastKey) return;
      lastKey = current;
      const items = legendItems({ facts: facts(), style: style() });
      const html = legendHtml(items);
      if (html === last) return;
      last = html;
      node.innerHTML = html;
      node.hidden = !items.length;
      node.setAttribute('aria-label', items.map(item => item.text).join(', '));
    },
    items: () => legendItems({ facts: facts(), style: style() }),
  };
}
