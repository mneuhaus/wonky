// Units, tolerance-decade formatting and the seven exactness chips
// (spec section 8). Complete in the foundation; packages only use it.

export const number = (value, digits = 2) => (Number.isFinite(value)
  ? value.toLocaleString('en-US', { maximumFractionDigits: digits })
  : 'Not measured');

export const short = value => String(value ?? '').slice(0, 8);

// Check report status label (library list and report drawer).
export function reportStatus(value) {
  if (value?.accepted === false || /fail|error|blocked/i.test(value?.status ?? '')) {
    return { label: 'Needs attention', className: 'failed' };
  }
  if (value?.accepted === true || /^(pass|passed|valid|success)$/i.test(value?.status ?? '')) {
    return { label: 'Passed', className: '' };
  }
  return { label: 'Measurements', className: 'unknown' };
}

// Number of decimals for a tolerance: values print to the decade of their
// tolerance, so t = 0.0003 mm gives four decimals, t = 0.02 mm two. Never fewer:
// the viewer prints "value ±t", and a value rounded coarser than t would make that
// claim false (19.0526 ±1e-12 for 19.05255888...). A binary64 tolerance of 1e-12 mm
// therefore prints twelve decimals.
export function toleranceDecimals(tolerance) {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) return 4;
  return Math.max(0, Math.ceil(-Math.log10(tolerance) - 1e-9));
}

// A tolerance is never shown smaller than it is: it rounds up in its decade.
export function formatTolerance(tolerance, decimals = toleranceDecimals(tolerance)) {
  const scale = 10 ** decimals;
  return (Math.ceil(tolerance * scale - 1e-9) / scale).toFixed(decimals);
}

export function formatLength(valueMm, toleranceMm, { unit = 'mm', prefix = '' } = {}) {
  if (!Number.isFinite(valueMm)) return 'not evaluated';
  const decimals = toleranceDecimals(toleranceMm);
  // A true minus sign (U+2212), and no "-0.000" for values that round to 0.
  const text = valueMm.toFixed(decimals).replace(/^-(0(\.0*)?)$/, '$1').replace(/^-/, '\u2212');
  return `${prefix}${text} ${unit}`.trim();
}

// "Ø4.0000 mm ±0.0003"
export function formatWithTolerance(valueMm, toleranceMm, options) {
  const value = formatLength(valueMm, toleranceMm, options);
  if (!Number.isFinite(valueMm) || !(toleranceMm > 0)) return value;
  return `${value} ±${formatTolerance(toleranceMm)}`;
}

// Angles print to 0.001°.
export const formatAngle = (degrees, digits = 3) => (Number.isFinite(degrees)
  ? `${degrees.toFixed(digits)}°`
  : 'not evaluated');

export const radiansToDegrees = radians => radians * 180 / Math.PI;

export const EXACTNESS = Object.freeze({
  'exact-parameters': {
    chip: 'exact', tone: 'exact', tolerance: true,
    meaning: 'Closed form over stored analytic parameters',
  },
  'kernel-resolved': {
    chip: 'kernel', tone: 'kernel', tolerance: false,
    meaning: 'Decided by a Bend function with its guards',
  },
  recorded: {
    chip: 'recorded', tone: 'recorded', tolerance: false,
    meaning: 'Build-time metadata; null means not evaluated',
  },
  'design-parameter': {
    chip: 'design', tone: 'design', tolerance: false,
    meaning: 'A source call parameter: intent, not geometry',
  },
  'source-reference': {
    chip: 'reference', tone: 'reference', tolerance: false,
    meaning: 'Frozen external oracle value',
  },
  'display-approximation': {
    chip: 'display', tone: 'display', tolerance: true,
    meaning: 'From display triangles or polylines',
  },
  unsupported: {
    chip: 'unsupported', tone: 'unsupported', tolerance: false,
    meaning: 'Capability error; no value',
  },
});

export const EXACTNESS_VALUES = Object.freeze(Object.keys(EXACTNESS));

// {label, tone, title} for an API exactness value; unknown values throw so a
// new label can never render as something it is not.
export function exactnessChip(exactness, toleranceMm) {
  const entry = EXACTNESS[exactness];
  if (!entry) throw new Error(`Unknown exactness ${exactness}`);
  const withTolerance = entry.tolerance && toleranceMm > 0;
  return {
    label: withTolerance ? `${entry.chip} ±${formatTolerance(toleranceMm)}` : entry.chip,
    tone: entry.tone,
    title: entry.meaning,
  };
}

const escapeText = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export function exactnessChipMarkup(exactness, toleranceMm) {
  const chip = exactnessChip(exactness, toleranceMm);
  return `<span class="exactness-chip exactness-${chip.tone}" title="${escapeText(chip.title)}">`
    + `${escapeText(chip.label)}</span>`;
}

// A recorded value that is null reads "not evaluated", never 0.
export const recordedValue = (value, format = number) => (value === null || value === undefined
  ? 'not evaluated'
  : format(value));
