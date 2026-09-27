// Model overview "Size" with its provenance (spec 3.2 and section 13: the
// unlabeled size was a defect). Owner: exact-measure.
//
//   recorded  union of the recorded body bounds (validation.boundsMm), from
//             the geometry API through app.modelBounds(modelId)
//   kernel    bounds decided by a Bend function (kernel-resolved), when a
//             package supplies them
//   display   envelope of the display edges and vertices, ±display tolerance
//             (0.02 mm); shown whenever no recorded or kernel bounds exist
//
// A recorded value that is not evaluated never reads as 0: the display
// envelope is shown with its label instead, and the reason is in the title.
import { escape } from '../../core/dom.js';
import { exactnessChipMarkup, formatLength, number } from '../../core/format.js';

const extents = (min, max) => min.map((value, axis) => max[axis] - value);

export function modelSize(scene, bounds = null) {
  if (bounds?.minMm && bounds?.maxMm) {
    return {
      extents: extents(bounds.minMm, bounds.maxMm),
      exactness: bounds.exactness,
      toleranceMm: null,
      approximate: false,
      note: bounds.scope ?? '',
    };
  }
  const toleranceMm = scene.display?.toleranceMm ?? 0.02;
  const reason = bounds?.note ? `; recorded bounds ${bounds.note}` : '';
  return {
    extents: extents(scene.bounds.min, scene.bounds.max),
    exactness: 'display-approximation',
    toleranceMm,
    approximate: true,
    note: `envelope of the display edges and vertices${reason}`,
  };
}

// "50 × 40 × 8 mm" (recorded, kernel) or "≈ 20.00 × 20.00 × 20.00 mm" (display).
export function sizeText(size) {
  if (size.approximate) {
    return `≈ ${size.extents.map(value => formatLength(value, size.toleranceMm, { unit: '' }))
      .join(' × ')} mm`;
  }
  return `${size.extents.map(value => number(value, 4)).join(' × ')} mm`;
}

// <dt>/<dd> pair for the overview properties list.
export function overviewSizeMarkup(scene, bounds = null) {
  const size = modelSize(scene, bounds);
  return `<dt>Size</dt><dd class="overview-size" title="${escape(size.note)}">`
    + `${escape(sizeText(size))} ${exactnessChipMarkup(size.exactness, size.toleranceMm)}</dd>`;
}
