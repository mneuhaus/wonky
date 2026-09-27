// Viewport dimension line for the primary measurement (spec 3.3).
//
// The value and its exactness chip come from the server's closed form. The
// line's position does not: its anchor points are the display picks of the
// selected entities (selection.js), moved along the exact directions of the
// row's witness (plane normal, radial direction, axis foot), so the label
// always says "anchor: display pick". Witnesses between exact points (vertex
// to vertex, vertex to its foot on a plane) say "anchors: exact points".
// Pure vector arithmetic here only places the drawing; it never produces a
// displayed number.
import { escape } from '../../core/dom.js';
import { rowChip, valueText } from './geometry-section.js';

const add = (a, b) => a.map((value, axis) => value + b[axis]);
const sub = (a, b) => a.map((value, axis) => value - b[axis]);
const scale = (a, s) => a.map(value => value * s);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const norm = a => Math.hypot(...a);
const unit = a => (norm(a) > 1e-12 ? scale(a, 1 / norm(a)) : null);
const foot = (target, point, direction) => add(point,
  scale(direction, dot(sub(target, point), direction)));

// Any unit vector perpendicular to `direction`.
function perpendicular(direction) {
  const helper = Math.abs(direction[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = [
    direction[1] * helper[2] - direction[2] * helper[1],
    direction[2] * helper[0] - direction[0] * helper[2],
    direction[0] * helper[1] - direction[1] * helper[0],
  ];
  return unit(cross);
}

// Closest points of two lines; parallel lines are joined at the anchor.
function closestOnLines(first, second, anchor) {
  const [a, b] = [first, second];
  const w = sub(a.point, b.point);
  const aa = dot(a.direction, a.direction);
  const ab = dot(a.direction, b.direction);
  const bb = dot(b.direction, b.direction);
  const denominator = aa * bb - ab * ab;
  if (denominator < 1e-12) {
    const start = anchor ? foot(anchor, a.point, a.direction) : a.point;
    return { points: [start, foot(start, b.point, b.direction)], anchored: !!anchor };
  }
  const d = dot(a.direction, w);
  const e = dot(b.direction, w);
  const s = (ab * e - bb * d) / denominator;
  const t = (aa * e - ab * d) / denominator;
  return {
    points: [add(a.point, scale(a.direction, s)), add(b.point, scale(b.direction, t))],
    anchored: false,
  };
}

// First anchor among `indices` that is a real display pick, else the first
// anchor at all (a centroid, e.g. after Browse geometry), else null.
function preferredAnchor(anchors, indices) {
  const candidates = indices.map(index => anchors[index] ?? null).filter(Boolean);
  return candidates.find(anchor => anchor.source === 'pick') ?? candidates[0] ?? null;
}

// World endpoints of the dimension line for a row's witness, or null when
// the anchors needed to place it are missing.
//   anchors[i]: { point, source: 'pick' | 'centroid' } of selected entity i, or null
// A clicked entity's pick is preferred over the centroid of an entity chosen
// without a click. The result says where its position comes from: 'exact'
// (points of the closed form), or the source of the display anchor it used.
export function dimensionEndpoints(witness, anchors, pair = [0, 1]) {
  const use = index => anchors[index] ?? null;
  const either = preferredAnchor(anchors, pair);
  const placed = (points, anchor) => ({ points, anchor: anchor?.source ?? 'exact' });
  switch (witness?.kind) {
    case 'segment':
      return placed(witness.points, null);
    case 'offset': {
      // From the pick on the first plane along its normal to the second, or
      // from the pick on the second plane back to the first.
      const other = pair[0] === witness.from ? pair[1] : pair[0];
      const start = preferredAnchor(anchors, [witness.from, other]);
      if (!start) return null;
      const sense = start === use(witness.from) ? 1 : -1;
      const end = add(start.point, scale(witness.direction, sense * witness.lengthMm));
      return placed([start.point, end], start);
    }
    case 'radial': {
      if (!either) return null;
      const center = foot(either.point, witness.axisPoint, witness.axis);
      const direction = unit(sub(either.point, center)) ?? perpendicular(witness.axis);
      return placed(witness.radii.map(radius => add(center, scale(direction, radius))), either);
    }
    case 'axes': {
      // Parallel axes: the line runs across both axes at the height of the
      // pick. Clearance: boss surface to hole surface on the side the boss
      // is offset to; gap: surface to surface between the axes.
      const { from, to } = witness;
      const start = preferredAnchor(anchors, [from.index, to.index]);
      const q1 = start ? foot(start.point, from.point, witness.axis) : from.point;
      const q2 = foot(q1, to.point, witness.axis);
      const direction = unit(sub(q2, q1)) ?? perpendicular(witness.axis);
      const points = witness.mode === 'clearance'
        ? [add(q2, scale(direction, to.radius)), add(q1, scale(direction, from.radius))]
        : [add(q1, scale(direction, from.radius)), sub(q2, scale(direction, to.radius))];
      return placed(points, start);
    }
    case 'axis-plane': {
      const start = preferredAnchor(anchors, [witness.from, ...pair]);
      const q = start ? foot(start.point, witness.axisPoint, witness.axis) : witness.axisPoint;
      const height = dot(sub(q, witness.planePoint), witness.normal);
      const toward = scale(witness.normal, height < 0 ? 1 : -1);
      return placed([add(q, scale(toward, witness.radius)), sub(q, scale(witness.normal, height))],
        start);
    }
    case 'lines': {
      const [first, second] = witness.lines;
      const anchor = preferredAnchor(anchors, [first.index, second.index]);
      const result = closestOnLines(first, second, anchor?.point);
      return placed(result.points, result.anchored ? anchor : null);
    }
    default:
      // No witness: no line. A connector between two picks would suggest a
      // length that the row does not state.
      return null;
  }
}

export const ANCHOR_TEXT = Object.freeze({
  pick: 'anchor: display pick',
  centroid: 'anchor: display centroid',
  exact: 'anchors: exact points',
});
const round = value => Math.round(value * 10) / 10;

// SVG markup of one dimension line seen through `pane`.
export function dimensionMarkup({ row, endpoints, pane, project, height }) {
  const [a, b] = endpoints.points.map(point => project(point, pane));
  if (![a, b].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return '';
  const clip = `dimension-${pane.side}-clip`;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const [nx, ny] = length > 1e-6 ? [-dy / length, dx / length] : [0, -1];
  const tick = (point, size) => `<line class="dimension-tick" x1="${round(point.x + nx * size)}"`
    + ` y1="${round(point.y + ny * size)}" x2="${round(point.x - nx * size)}"`
    + ` y2="${round(point.y - ny * size)}"/>`;
  const value = valueText(row);
  const chip = rowChip(row).label;
  const anchor = ANCHOR_TEXT[endpoints.anchor] ?? ANCHOR_TEXT.pick;
  const first = `${value}  ${chip}`;
  const width = Math.max(first.length * 6.6, anchor.length * 5.6) + 16;
  const x = round((a.x + b.x) / 2 + 12);
  const y = round((a.y + b.y) / 2 - 20);
  return `<defs><clipPath id="${clip}"><rect x="${pane.clipX}" y="0" width="${pane.clipWidth}"`
    + ` height="${height}"/></clipPath></defs><g class="dimension" clip-path="url(#${clip})">`
    + `<line class="dimension-halo" x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}"`
    + ` y2="${round(b.y)}"/><line class="dimension-line" x1="${round(a.x)}" y1="${round(a.y)}"`
    + ` x2="${round(b.x)}" y2="${round(b.y)}"/>${tick(a, 6)}${tick(b, 6)}`
    + `<circle class="dimension-end" cx="${round(a.x)}" cy="${round(a.y)}" r="2.5"/>`
    + `<circle class="dimension-end" cx="${round(b.x)}" cy="${round(b.y)}" r="2.5"/>`
    + `<g class="dimension-label" transform="translate(${x} ${y})"><rect class="dimension-box"`
    + ` x="0" y="0" width="${round(width)}" height="36" rx="5"/><text class="dimension-value"`
    + ` x="8" y="15">${escape(value)}<tspan class="dimension-chip" dx="8">${escape(chip)}`
    + `</tspan></text><text class="dimension-anchor" x="8" y="29">${escape(anchor)}</text>`
    + '</g></g>';
}

export function createDimensionLayer(ctx, measurement) {
  const { app } = ctx;
  const remove = ctx.overlay.layer({
    id: 'measure.dimension',
    order: 60,
    render({ height }) {
      const entry = measurement.current();
      const data = entry?.status === 'ok' ? entry.data : null;
      if (!data || data.primary === null || data.primary === undefined) return '';
      const row = data.measurements[data.primary];
      const anchors = entry.set.map(reference => app.selectionAnchor?.(reference) ?? null);
      const endpoints = dimensionEndpoints(row.witness, anchors, row.pair);
      if (!endpoints) return '';
      return app.viewPanes().filter(pane => pane.modelId === data.modelId)
        .map(pane => dimensionMarkup({ row, endpoints, pane, project: app.project, height }))
        .join('');
    },
  });
  return { dispose: remove };
}
