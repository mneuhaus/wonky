// Axis triad (bottom left of the viewport) and origin marker (SVG overlay).
// Both are pure markup from the world camera basis (render/camera.js), so
// they always agree with the rendered view. Owner: camera-navigation (W1).
//
// The triad shows world +X, +Y, +Z as seen by the camera; an axis pointing
// at the viewer shows as a dot, one pointing away as a ring. The origin
// marker is an overlay drawn over the model (no depth test), labelled as the
// world origin; the build plate and origin axes with depth belong to fdm.
import { basis } from '../../render/camera.js';

export const AXES = Object.freeze([
  Object.freeze({ name: 'X', vector: [1, 0, 0], color: '#c0392b' }),
  Object.freeze({ name: 'Y', vector: [0, 1, 0], color: '#2f8a3e' }),
  Object.freeze({ name: 'Z', vector: [0, 0, 1], color: '#2c62b8' }),
]);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fixed = value => Number(value.toFixed(2));

// Screen direction (x right, y down) and depth (toward the viewer) of each
// world axis for this camera.
export function axisDirections(camera) {
  const { right, up, toward } = basis(camera);
  return AXES.map(axis => ({
    ...axis,
    dx: dot(axis.vector, right),
    dy: -dot(axis.vector, up),
    depth: dot(axis.vector, toward),
  }));
}

// A short description for assistive technology ("+X right, +Z up, +Y away";
// oblique axes read "+X down-right").
export function describeAxes(camera) {
  const words = axisDirections(camera).map(axis => {
    const horizontal = Math.abs(axis.dx);
    const vertical = Math.abs(axis.dy);
    if (Math.max(horizontal, vertical) < 0.35) {
      return `+${axis.name} ${axis.depth > 0 ? 'toward you' : 'away'}`;
    }
    const side = axis.dx > 0 ? 'right' : 'left';
    const height = axis.dy < 0 ? 'up' : 'down';
    if (Math.min(horizontal, vertical) >= 0.3) return `+${axis.name} ${height}-${side}`;
    return `+${axis.name} ${horizontal >= vertical ? side : height}`;
  });
  return words.join(', ');
}

export function triadMarkup(camera, { size = 76, length = 25 } = {}) {
  const center = size / 2;
  const axes = axisDirections(camera).sort((a, b) => a.depth - b.depth);
  let content = `<circle cx="${center}" cy="${center}" r="2.5" class="triad-origin"/>`;
  for (const axis of axes) {
    const x = fixed(center + axis.dx * length);
    const y = fixed(center + axis.dy * length);
    const lx = fixed(center + axis.dx * (length + 9));
    const ly = fixed(center + axis.dy * (length + 9) + 4);
    const endOn = Math.hypot(axis.dx, axis.dy) < 0.2;
    content += `<g class="triad-axis" data-axis="${axis.name}" data-x="${x}" data-y="${y}"`
      + ` data-depth="${fixed(axis.depth)}">`;
    if (endOn) {
      const fill = axis.depth > 0 ? axis.color : 'none';
      content += `<circle cx="${center}" cy="${center}" r="6" fill="${fill}"`
        + ` stroke="${axis.color}" stroke-width="2"/>`
        + `<text x="${center + 11}" y="${center - 7}" fill="${axis.color}">${axis.name}</text>`;
    } else {
      content += `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="${axis.color}"`
        + ' stroke-width="2.5" stroke-linecap="round"/>'
        + `<text x="${lx}" y="${ly}" fill="${axis.color}" text-anchor="middle">${axis.name}</text>`;
    }
    content += '</g>';
  }
  return `<svg class="view-triad-svg" viewBox="0 0 ${size} ${size}" width="${size}"`
    + ` height="${size}" aria-hidden="true">${content}</svg>`;
}

// Origin marker for every pane: a ring at the projected world origin plus
// 14 px axis stubs, clipped to the pane. `project(point, pane)` -> {x, y}.
export function originMarkup({ camera, panes, project, height }) {
  const axes = axisDirections(camera);
  let content = '';
  for (const pane of panes) {
    const origin = project([0, 0, 0], pane);
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) continue;
    if (origin.x < pane.clipX - 20 || origin.x > pane.clipX + pane.clipWidth + 20
      || origin.y < -20 || origin.y > height + 20) continue;
    const clip = `origin-${pane.side}-clip`;
    content += `<defs><clipPath id="${clip}"><rect x="${pane.clipX}" y="0"`
      + ` width="${pane.clipWidth}" height="${height}"/></clipPath></defs>`
      + `<g class="origin-marker" clip-path="url(#${clip})">`;
    for (const axis of axes) {
      if (Math.hypot(axis.dx, axis.dy) < 0.05) continue;
      content += `<line x1="${fixed(origin.x)}" y1="${fixed(origin.y)}"`
        + ` x2="${fixed(origin.x + axis.dx * 14)}" y2="${fixed(origin.y + axis.dy * 14)}"`
        + ` stroke="${axis.color}" stroke-width="1.5" stroke-linecap="round"/>`;
    }
    content += `<circle cx="${fixed(origin.x)}" cy="${fixed(origin.y)}" r="3" fill="#fffaf3"`
      + ' stroke="#24372f" stroke-width="1.2"><title>World origin (0, 0, 0)</title></circle></g>';
  }
  return content;
}
