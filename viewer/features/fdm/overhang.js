// Pure helpers of the fdm feature (spec 3.6): legend texts, plate relation
// texts, per-body settings keys, request keys and the display.fdm style
// entry built from printability API answers. No DOM, no requests: the
// feature module (fdm.js) wires them; test/viewer-fdm.test.mjs tests them.
//
// Conventions (cad-khana): α is the overhang angle from vertical, a face
// overhangs when α > α_max; the slicer threshold angle is β = 90° − α_max.
// Every number shown comes from the API (exact planar flags and exact
// cylinder and cone bands; body extents recorded or kernel-resolved). The
// only display-derived number is the band-edge bound of curved faces, which
// is labelled "display strips".
import { escape } from '../../core/dom.js';
import { exactnessChipMarkup, formatAngle, formatLength } from '../../core/format.js';

export const DEFAULT_ALPHA_DEG = 45;
export const DEFAULT_SMALL_BORE_MM = 12;
export const DEFAULT_PLATE_MM = Object.freeze([256, 256]);
export const BRIDGE_MAX_MM = 10;
export const DEFAULT_UP = Object.freeze([0, 0, 1]);
export const BRIDGE_NOTE = `bridge exemption (≤ ${BRIDGE_MAX_MM} mm) not applied`;
export const EXEMPT_LABEL = 'exempt: small bore';

export const UP_PRESETS = Object.freeze([
  { id: '+Z', label: '+Z', up: [0, 0, 1] },
  { id: '-Z', label: '−Z', up: [0, 0, -1] },
  { id: '+X', label: '+X', up: [1, 0, 0] },
  { id: '-X', label: '−X', up: [-1, 0, 0] },
  { id: '+Y', label: '+Y', up: [0, 1, 0] },
  { id: '-Y', label: '−Y', up: [0, -1, 0] },
]);

const finite = value => typeof value === 'number' && Number.isFinite(value);
export const isVector = value => Array.isArray(value) && value.length === 3
  && value.every(finite) && Math.hypot(...value) > 0;

// "45°", "47.5°", "30°": at most three decimals, no trailing zeros.
export const degreesText = value => `${Number(value.toFixed(3))}°`;

export const betaOf = alphaDeg => 90 - alphaDeg;

// The legend line of spec 3.6.
export const legendText = alphaDeg => `overhang α > ${degreesText(alphaDeg)} from vertical`
  + ` (slicer threshold β = ${degreesText(betaOf(alphaDeg))})`;

export const smallBoreText = smallBoreMm => (smallBoreMm === null || smallBoreMm === undefined
  ? 'small-bore exemption off'
  : `${EXEMPT_LABEL} Ø ≤ ${Number(smallBoreMm.toFixed(3))} mm (outlined)`);

// Clamped α_max setting (1..89°).
export const cleanAlpha = value => (finite(Number(value))
  ? Math.min(89, Math.max(1, Number(value))) : DEFAULT_ALPHA_DEG);

export function cleanPlate(value) {
  if (!Array.isArray(value) || value.length !== 2) return [...DEFAULT_PLATE_MM];
  const size = value.map(Number);
  return size.every(item => finite(item) && item >= 10 && item <= 2000) ? size
    : [...DEFAULT_PLATE_MM];
}

export const unitVector = value => {
  const length = Math.hypot(...value);
  return value.map(item => item / length);
};

// "+Z" for a preset axis, else "(0, 0.6, 0.8)".
export function upLabel(up) {
  const preset = UP_PRESETS.find(item => item.up.every((value, axis) => value === up[axis]));
  if (preset) return preset.label;
  return `(${up.map(value => String(Number(value.toFixed(4)))).join(', ')})`;
}

export const sameUp = (a, b) => a.every((value, axis) => value === b[axis]);

// Settings key of a body (scope SB): its name if present and unique in the
// model, else its id (spec section 6).
export function bodyKey(bodies, body) {
  const name = body?.name;
  if (typeof name === 'string' && name
    && bodies.filter(other => other.name === name).length === 1) return `name:${name}`;
  return `id:${body.id}`;
}

// Cache key of one body's printability answer: everything the server
// classification depends on.
export const resultKey = ({ alphaDeg, smallBoreMm, plateMm, up }) => JSON.stringify([
  alphaDeg, smallBoreMm, plateMm, up,
]);

// Face flags of the renderer style (display.fdm) from one body answer: every
// fragment of a non-ok logical face gets its kind; curved faces carry their
// exact bands.
export function faceFlags(bodyResult) {
  const flags = {};
  for (const face of bodyResult?.faces ?? []) {
    if (face.kind === 'ok') continue;
    const entry = face.surface === 'plane' || !face.bandsDeg?.length ? face.kind
      : { kind: face.kind, bandsDeg: face.bandsDeg };
    for (const fragment of face.fragments ?? [face.alias]) flags[fragment] = entry;
  }
  return flags;
}

// display.fdm: tint only for models whose answers match the current
// settings (`entries`: [{ modelId, bodies: [{ bodyId, up, printed, result }] }]).
export function displayFdm({ enabled, alphaDeg, entries = [] }) {
  if (!enabled) return { overhang: null };
  const models = {};
  for (const entry of entries) {
    const faces = {};
    const bodies = {};
    for (const body of entry.bodies) {
      bodies[body.bodyId] = { up: [...body.up], printed: body.printed };
      if (body.printed && body.result) Object.assign(faces, faceFlags(body.result));
    }
    if (entry.bodies.some(body => body.printed && body.result)) models[entry.modelId] = {
      faces, bodies,
    };
  }
  return { overhang: { enabled: true, alphaDeg, models } };
}

// "45.000°–135.000°" for [[45, 135]]; wrapped ends print mod 360.
export function bandText(bandsDeg = []) {
  if (!bandsDeg.length) return 'none';
  return bandsDeg.map(([start, end]) => (end - start >= 360 - 1e-9 ? 'full turn'
    : `${(start % 360).toFixed(3)}°–${(end % 360).toFixed(3)}°`)).join(', ');
}

// Angular span (deg) of a display strip of a cylinder with radius r whose
// chords deviate at most e from the surface: 2 acos(1 − e/r). The band edge
// drawn from interpolated per-vertex normals is within half of it.
export function stripSpanDeg(radiusMm, chordErrorMm) {
  if (!(radiusMm > 0) || !(chordErrorMm > 0)) return null;
  return 2 * Math.acos(Math.max(-1, 1 - chordErrorMm / radiusMm)) * 180 / Math.PI;
}

// Plate relation of one body answer: { tone, text, chip, title }; chip is the
// API exactness value (recorded, kernel-resolved, unsupported) or null.
export function relationOf(bodyResult) {
  if (!bodyResult) return null;
  if (bodyResult.printed === false) {
    return { tone: 'muted', text: 'not printed', chip: null,
      title: 'Excluded from the overhang and plate checks (reference or bought part).' };
  }
  const plate = bodyResult.plate;
  if (!plate) return null;
  const chip = ['recorded', 'kernel-resolved'].includes(plate.exactness) ? plate.exactness : null;
  const tolerance = plate.toleranceMm;
  const length = value => formatLength(value, tolerance);
  const method = plate.method ? ` Method: ${plate.method}.` : '';
  const footprint = plate.footprint?.exceeds ? ' · footprint exceeds plate' : '';
  const footprintTitle = plate.footprint?.exceeds ? ' The footprint exceeds the plate.' : '';
  if (plate.relation === 'on-plate') {
    return { tone: plate.footprint?.exceeds ? 'warn' : 'ok', text: `on plate${footprint}`, chip,
      title: `Lowest point at Z = 0 within ±${tolerance} mm.${footprintTitle}${method}` };
  }
  const lowest = `Lowest point at Z = ${length(plate.minAlongUpMm)}; the model is not moved.`
    + `${footprintTitle}${method}`;
  if (plate.relation === 'floats') {
    const distance = length(plate.distanceMm);
    return { tone: 'warn', text: `floats ${distance} above the plate${footprint}`,
      short: `floats ${distance}`, chip, title: lowest };
  }
  if (plate.relation === 'cuts') {
    const distance = length(plate.distanceMm);
    return { tone: 'warn', text: `cuts ${distance} into the plate${footprint}`,
      short: `cuts ${distance}`, chip, title: lowest };
  }
  if (plate.relation === 'bed-faces') {
    return { tone: 'ok', text: `bed faces: ${plate.bedFaces.join(', ')}`, chip,
      title: `Planar faces at the body minimum along up ${upLabel(bodyResult.up)};`
        + ` the geometry is not moved.${method}` };
  }
  if (plate.relation === 'no-bed-face') {
    return { tone: 'warn', text: 'no bed face', chip,
      title: `No planar face lies at the body minimum along up ${upLabel(bodyResult.up)}`
        + ` (${length(plate.minAlongUpMm)}): the body rests on an edge, a point or a curved`
        + ` face.${method}` };
  }
  return { tone: 'error', text: 'plate relation unresolved', chip: 'unsupported',
    title: plate.reason ?? 'The body minimum along up could not be resolved.' };
}

// Counts of a body answer for the legend and panel.
export function countsOf(bodyResults) {
  const counts = { overhang: 0, exempt: 0, bed: 0, unsupported: 0 };
  for (const body of bodyResults) {
    counts.overhang += body?.counts?.overhang ?? 0;
    counts.exempt += body?.counts?.['exempt-small-bore'] ?? 0;
    counts.bed += body?.counts?.bed ?? 0;
    counts.unsupported += body?.counts?.unsupported ?? 0;
  }
  return counts;
}

// What the status bar shows for the displayed model: a relation for exactly
// one visible printed body, otherwise a pointer to the per-row badges.
export function statusView({ bodies, visible, results, pending }) {
  const shown = bodies.filter(body => visible.has(body.id));
  if (!shown.length) return null;
  if (shown.length > 1) {
    return { mode: 'rows', text: `${shown.length} visible bodies: plate relation per body` };
  }
  const [body] = shown;
  if (!body.printed) return { mode: 'single', alias: body.alias, relation: relationOf(body) };
  const result = results.get(body.id);
  if (!result) return { mode: 'single', alias: body.alias, pending: !!pending };
  return { mode: 'single', alias: body.alias, relation: relationOf(result) };
}

// ---- Markup (escaped; no inline styles) ----

const chipMarkup = exactness => (exactness ? exactnessChipMarkup(exactness) : '');

// A relation badge (parts-tree rows, FDM panel rows). `compact` uses the
// short text ("cuts 4.0000 mm"); the full sentence stays in the title.
export function badgeMarkup(relation, { pending = false, compact = false } = {}) {
  if (pending) {
    return '<span class="fdm-badge fdm-tone-pending" title="Waiting for the printability API">'
      + 'plate pending</span>';
  }
  if (!relation) return '';
  const text = compact && relation.short ? relation.short : relation.text;
  const title = compact && relation.short ? `${relation.text}. ${relation.title}` : relation.title;
  return `<span class="fdm-badge fdm-tone-${escape(relation.tone)}"`
    + ` title="${escape(title)}">${escape(text)}${chipMarkup(relation.chip)}`
    + '</span>';
}

// Status bar content for statusView() (see above); revision like "r4".
export function statusMarkup(view, { revision = '', error = null } = {}) {
  if (error) {
    return `<span class="fdm-status-error" title="${escape(error)}">printability unavailable:`
      + ` ${escape(error)}</span>`;
  }
  if (!view) return '';
  if (view.mode === 'rows') {
    return `<span class="fdm-status-text" title="Each body row in Parts carries its plate`
      + ` relation (and the Print check panel lists them).">${escape(view.text)}</span>`;
  }
  const label = `<span class="fdm-status-alias">${escape(view.alias)}</span>`;
  if (view.pending) {
    return `${label}<span class="fdm-status-text fdm-tone-pending">plate relation pending`
      + `${revision ? ` · ${escape(revision)}` : ''}</span>`;
  }
  const relation = view.relation;
  if (!relation) return '';
  return `${label}<span class="fdm-status-text fdm-tone-${escape(relation.tone)}"`
    + ` title="${escape(relation.title)}">${escape(relation.text)}</span>`
    + chipMarkup(relation.chip);
}

// Overhang legend card (spec 3.6). stripDeg: widest display strip of a
// tinted curved face (band edges are within half of it).
export function legendMarkup({
  alphaDeg, smallBoreMm, pending = false, revision = '', counts = null, stripDeg = null,
  curvedWithoutBound = false, error = null,
}) {
  const rows = [
    `<p class="fdm-legend-line"><span class="fdm-swatch fdm-swatch-overhang"></span>`
      + `<span data-fdm-legend="threshold">${escape(legendText(alphaDeg))}</span></p>`,
    `<p class="fdm-legend-line"><span class="fdm-swatch fdm-swatch-exempt"></span>`
      + `<span data-fdm-legend="small-bore">${escape(smallBoreText(smallBoreMm))}</span></p>`,
    '<p class="fdm-legend-line"><span class="fdm-swatch fdm-swatch-bed"></span>'
      + '<span data-fdm-legend="bed">bed faces excluded (outlined)</span></p>',
    `<p class="fdm-legend-note" data-fdm-legend="bridge">${escape(BRIDGE_NOTE)}</p>`,
  ];
  if (stripDeg !== null) {
    rows.push('<p class="fdm-legend-note" data-fdm-legend="curved" title="Cylinder and cone bands'
      + ' are exact on the stored parameters; the tint follows exact per-vertex normals over the'
      + ` display strips.">curved band edges ±${escape((stripDeg / 2).toFixed(1))}°`
      + ' (display strips)</p>');
  } else if (curvedWithoutBound) {
    rows.push('<p class="fdm-legend-note" data-fdm-legend="curved">curved band edges follow the'
      + ' display strips</p>');
  }
  let state;
  if (error) {
    state = `<p class="fdm-legend-state fdm-tone-error" data-fdm-legend="state">overhang`
      + ` unavailable: ${escape(error)}</p>`;
  } else if (pending) {
    state = '<p class="fdm-legend-state fdm-tone-pending" data-fdm-legend="state">overhang'
      + ` pending${revision ? ` · ${escape(revision)}` : ''}: no tint until the printability API`
      + ' answers</p>';
  } else if (counts) {
    const parts = [`${counts.overhang} overhang`, `${counts.exempt} exempt`, `${counts.bed} bed`];
    if (counts.unsupported) parts.push(`${counts.unsupported} not classified`);
    state = `<p class="fdm-legend-state" data-fdm-legend="state">${escape(parts.join(' · '))}`
      + `${revision ? ` · ${escape(revision)}` : ''} (logical faces)</p>`;
  }
  return rows.join('') + (state ?? '');
}

// One printed face in the inspector ("Print check" section).
export function faceSummary(face) {
  if (!face) return null;
  if (face.kind === 'bed') return 'bed face (excluded, outlined)';
  if (face.kind === 'unsupported') return `not classified: ${face.reason}`;
  if (face.surface === 'plane') {
    return `${face.kind === 'overhang' ? 'overhang' : 'no overhang'} · α`
      + ` ${formatAngle(face.angleDeg)} from vertical`;
  }
  const band = `band ${bandText(face.bandsDeg)}`;
  if (face.kind === 'exempt-small-bore') {
    return `${EXEMPT_LABEL} (hole Ø${Number(face.diameterMm.toFixed(4))} mm) · ${band}`;
  }
  return `${face.kind === 'overhang' ? 'overhang' : 'no overhang'} · ${band}`;
}
