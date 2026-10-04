import { attachAngleWitness, degreeWitness } from './angle-witness.mjs';
import { FeatureScriptException, raise, raiseNamed, refuseNamed, unsupported } from './errors.mjs';
import { rememberCross, rememberLine } from './construction-frame.mjs';
import { binary, BOUND_SPEC_TYPES, cast, EnumValue, isMap, KeyedMap, map, Matrix, Quantity, quantity, tagged, Transform, Vector, vectorNumbers } from './values.mjs';

const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
// A std math function's dimensionless number argument. sqrt also supports
// ValueWithUnits and halves both length and angle exponents.
const number = (v, loc, name) => {
  if (v instanceof Quantity && name) unsupported(`${name} of a value with units is not implemented`, loc);
  if (typeof v !== 'number' || !Number.isFinite(v)) raise('Expected a finite dimensionless number', loc);
  return v;
};
export const identityMatrix = () => new Matrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
export const zeroLengthVector = () => new Vector([new Quantity(0), new Quantity(0), new Quantity(0)]);

// The [min, default, max] rows of a LengthBoundSpec as lengths. Per-unit number
// entries (UI defaults for other document units, valueBounds.fs) carry no bounds.
export function lengthBoundRows(bounds, loc) {
  if (!(bounds instanceof KeyedMap) || bounds.tag !== 'LengthBoundSpec' || !bounds.entries.length) raise('Expected a nonempty LengthBoundSpec', loc);
  return bounds.entries.filter(([, row]) => Array.isArray(row)).map(([unit, row]) => {
    if (unit.value <= 0 || row[0] > row[1] || row[1] > row[2]) raise('Invalid length bounds: require min <= default <= max and positive unit', loc);
    return row.map(value => binary('*', value, unit, loc));
  });
}

const meter = new Quantity(1), centimeter = new Quantity(0.01), millimeter = new Quantity(0.001);
const inch = new Quantity(0.0254), foot = new Quantity(0.3048), yard = new Quantity(0.9144);
const degree = attachAngleWitness(new Quantity(Math.PI / 180, 0, 1), degreeWitness()), radian = new Quantity(1, 0, 1);
const spec = (type, entries) => new KeyedMap(entries, type);
const lengthSpec = (row, cm, mm, inches, feet, yards) => spec('LengthBoundSpec', [[meter, row], [centimeter, cm], [millimeter, mm], [inch, inches], [foot, feet], [yard, yards]]);
const angleSpec = (row, radians) => spec('AngleBoundSpec', [[degree, row], [radian, radians]]);
const unitlessSpec = (type, row) => spec(type, [[1, row]]);
// The exported bound specs of Onshape's std valueBounds.fs, with the std values
// (onshape-std-library-mirror, valueBounds.fs). The non-@internal ones only.
export const stdBoundSpecs = () => ({
  LENGTH_BOUNDS: lengthSpec([-500, 0.025, 500], 2.5, 25.0, 1.0, 0.1, 0.025),
  NONNEGATIVE_LENGTH_BOUNDS: lengthSpec([1e-5, 0.025, 500], 2.5, 25.0, 1.0, 0.1, 0.025),
  NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS: lengthSpec([0.0, 0.025, 500], 2.5, 25.0, 1.0, 0.1, 0.025),
  NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS: lengthSpec([0.0, 0.0, 500], 0, 0, 0, 0, 0),
  NONPOSITIVE_ZERO_DEFAULT_LENGTH_BOUNDS: lengthSpec([-500.0, 0.0, 0.0], 0, 0, 0, 0, 0),
  ZERO_DEFAULT_LENGTH_BOUNDS: lengthSpec([-500, 0.0, 500], 0, 0, 0, 0, 0),
  BLEND_BOUNDS: lengthSpec([1e-5, 0.005, 500], 0.5, 5.0, 0.2, 0.015, 0.005),
  SHELL_OFFSET_BOUNDS: lengthSpec([1e-5, 0.0025, 500], 0.25, 2.5, 0.1, 0.01, 0.0025),
  ZERO_INCLUSIVE_OFFSET_BOUNDS: lengthSpec([0.0, 0.005, 500], 0.5, 5.0, 0.25, 0.025, 0.01),
  ANGLE_360_BOUNDS: angleSpec([-1e5, 30, 1e5], 1),
  ANGLE_360_REVERSE_DEFAULT_BOUNDS: angleSpec([-1e5, 330, 1e5], 2),
  ANGLE_360_ZERO_DEFAULT_BOUNDS: angleSpec([-1e5, 0, 1e5], 0),
  ANGLE_360_FULL_DEFAULT_BOUNDS: angleSpec([-1e5, 360, 1e5], 2 * Math.PI),
  ANGLE_360_90_DEFAULT_BOUNDS: angleSpec([-1e5, 90, 1e5], Math.PI / 2),
  ANGLE_STRICT_180_BOUNDS: angleSpec([0, 30, 179.9], 0.1667 * Math.PI),
  ANGLE_STRICT_90_BOUNDS: angleSpec([0, 3, 89.9], 0.01667 * Math.PI),
  ANGLE_180_MINUS_180_BOUNDS: angleSpec([-180, 0, 180], 1),
  NONPOSITIVE_ZERO_DEFAULT_ANGLE_BOUNDS: angleSpec([-1e5, 0.0, 0.0], 0.0),
  NONNEGATIVE_ZERO_DEFAULT_ANGLE_BOUNDS: angleSpec([0.0, 0.0, 1e5], 0.0),
  POSITIVE_COUNT_BOUNDS: unitlessSpec('IntegerBoundSpec', [1, 2, 1e5]),
  POSITIVE_REAL_BOUNDS: unitlessSpec('RealBoundSpec', [0, 1, 1e5]),
  SCALE_BOUNDS: unitlessSpec('RealBoundSpec', [1e-5, 1, 1e5]),
});

// A bound spec value, or the std spec a legacy library alias string names
// (library.mjs binds LENGTH_BOUNDS as the string 'LENGTH_BOUNDS'). Anything
// else is not a bound spec: null.
const STD_BOUND_SPECS = stdBoundSpecs();
export function resolveBoundSpec(bounds) {
  if (bounds instanceof KeyedMap && BOUND_SPEC_TYPES.includes(bounds.tag)) return bounds;
  if (typeof bounds === 'string' && Object.hasOwn(STD_BOUND_SPECS, bounds)) return STD_BOUND_SPECS[bounds];
  return null;
}

// The feature-dialog default of a bound spec. wonky's document units are
// millimeter and degree, so the millimeter (degree) entry wins when the spec
// lists one; otherwise the default of the first [min, default, max] entry.
// valueBounds.fs, LengthBoundSpec: "The default value for a unit that is not
// listed is the default value of the first unit".
export function boundSpecDefault(bounds, loc) {
  const resolved = resolveBoundSpec(bounds);
  if (!resolved) raise('Expected a LengthBoundSpec, AngleBoundSpec, IntegerBoundSpec or RealBoundSpec', loc);
  const documentUnit = { LengthBoundSpec: millimeter, AngleBoundSpec: degree }[resolved.tag];
  const listed = documentUnit && resolved.entries.find(([unit]) => unit instanceof Quantity && Math.abs(unit.value - documentUnit.value) <= 1e-12 * documentUnit.value);
  const [unit, row] = listed ?? resolved.entries.find(([, r]) => Array.isArray(r));
  return binary('*', Array.isArray(row) ? row[1] : row, unit, loc);
}

// valueBounds.fs verifyBounds: the first [min, default, max] entry decides,
// and a value outside it throws regenError(ErrorStringEnum.PARAMETER_OUT_OF_RANGE)
// (a catchable modeling error; in a precondition it fails the feature).
export function verifyBounds(value, bounds, type, loc) {
  const resolved = resolveBoundSpec(bounds);
  if (resolved?.tag !== type) raise(`Expected ${type}`, loc);
  const [unit, row] = resolved.entries.find(([, r]) => Array.isArray(r));
  if (binary('<', value, binary('*', row[0], unit, loc), loc) || binary('>', value, binary('*', row[2], unit, loc), loc)) raiseNamed('fs/parameter-out-of-range',
    'Parameter is out of range (PARAMETER_OUT_OF_RANGE)',
    'Choose a parameter value between the minimum and maximum in its bound specification, using the specified units.', loc);
  return true;
}
const isAngleValue = value => value instanceof Quantity && value.dimension === 0 && value.angle === 1 && Number.isFinite(value.value);
const isRealValue = value => typeof value === 'number' && Number.isFinite(value);

export function scalarBuiltins() {
  const values = {
    degree, radian, PI: Math.PI,
    // units.fs: unitless is the number 1; it keys Integer/Real bound specs.
    unitless: 1,
    ...stdBoundSpecs(),
    // units.fs isAngle(val) / math.fs isInteger(value) take one argument;
    // valueBounds.fs adds the bound-spec overloads.
    isAngle: builtin('isAngle', 1, 2, ([value, bounds], loc) => isAngleValue(value) && (bounds === undefined || verifyBounds(value, bounds, 'AngleBoundSpec', loc))),
    isInteger: builtin('isInteger', 1, 2, ([value, bounds], loc) => Number.isInteger(value) && (bounds === undefined || verifyBounds(value, bounds, 'IntegerBoundSpec', loc))),
    isReal: builtin('isReal', 2, 2, ([value, bounds], loc) => isRealValue(value) && verifyBounds(value, bounds, 'RealBoundSpec', loc)),
    append: builtin('append', 2, 2, ([array, value], loc) => {
      if (!Array.isArray(array)) raise('append expects an array', loc);
      return [...array, value];
    }),
    // containers.fs makeArray(size [, fillValue]): size copies of fillValue, undefined
    // when omitted; its precondition asks for a non-negative integer size. Values are
    // immutable (assignment copies the changed path), so every slot can share fillValue.
    makeArray: builtin('makeArray', 1, 2, ([size, fillValue], loc) => {
      if (!Number.isInteger(size) || size < 0) raise('makeArray expects a non-negative integer size', loc);
      return Array.from({ length: size }, () => fillValue);
    }),
    // error.fs: regenError(message [, faultyParameters is array | entities is Query | options is map] [, entities is Query]),
    // the message a string or an ErrorStringEnum. The extra arguments only mark
    // the feature dialog and the viewport, which wonky does not have. The
    // result is thrown with 'throw' and is a catchable exception. It carries
    // the std map as `fields`: { message: ErrorStringEnum.CUSTOM_ERROR,
    // customMessage } for a string, { message } for an ErrorStringEnum, plus
    // faultyParameters, entities or the options map. A catch handler reads
    // those fields (e.customMessage, e is map); `~ e` gives the message text.
    regenError: builtin('regenError', 1, 3, ([message, detail, entities], loc) => {
      const text = typeof message === 'string' ? message : message instanceof EnumValue && message.enumType === 'ErrorStringEnum' ? message.name : raise('regenError expects a string or ErrorStringEnum message', loc);
      const query = value => value?.type === 'Query';
      if (detail !== undefined && !(Array.isArray(detail) || query(detail) || (isMap(detail) && entities === undefined))) raise('regenError expects faultyParameters (array), entities (Query) or options (map)', loc);
      if (entities !== undefined && !(Array.isArray(detail) && query(entities))) raise('regenError expects faultyParameters (array) before entities (Query)', loc);
      if (isMap(detail) && (detail.message !== undefined || detail.customMessage !== undefined)) raise('regenError options must not contain message or customMessage', loc); // error.fs precondition
      const fields = map(isMap(detail) ? detail : {});
      if (Array.isArray(detail)) fields.faultyParameters = detail;
      if (query(detail)) fields.entities = detail;
      if (entities !== undefined) fields.entities = entities;
      if (typeof message === 'string') Object.assign(fields, { message: new EnumValue('ErrorStringEnum', 'CUSTOM_ERROR'), customMessage: message });
      else fields.message = message;
      const error = new FeatureScriptException(text, loc);
      error.fields = fields;
      return error;
    }),
    unstableIdComponent: builtin('unstableIdComponent', 1, 1, ([index], loc) => `*${number(index, loc)}`),
    // matrix.fs matrix(value is array): precondition canBeMatrix(value), then `value as Matrix`.
    matrix: builtin('matrix', 1, 1, ([rows], loc) => {
      if (!Array.isArray(rows)) raise('matrix expects rectangular numeric rows', loc);
      return cast(rows, 'Matrix', loc);
    }),
    // vector.fs:395 delegates axis + angle to @matrixRotation3d(axis, angle.value).
    // This is a numeric Matrix, like std sin/cos, not an exact rigid-placement
    // witness. Geometry consumers must retain their exact isometry checks.
    rotationMatrix3d: builtin('rotationMatrix3d', 2, 2, ([axis, angle], loc) => {
      if (angle instanceof Vector) refuseNamed('rotationMatrix3d', 'rotation/from-to-overload',
        'the from/to vector overload is not implemented', 'Use the axis and angle overload.', loc);
      const components = vectorNumbers(axis, 0, 3, loc);
      // Match the std wrapper literally: ValueWithUnits, then angle.value;
      // unlike isAngle(), it does not check the quantity's unit dimension.
      if (!(angle instanceof Quantity) || !Number.isFinite(angle.value)) raise('rotationMatrix3d expects a finite ValueWithUnits', loc);
      // Scale first so any finite nonzero axis can be normalized without
      // overflowing its norm or underflowing all its squared components.
      const magnitude = Math.max(...components.map(Math.abs));
      if (magnitude === 0) raise('rotationMatrix3d axis must be nonzero', loc);
      const scaled = components.map(v => v / magnitude), n = Math.hypot(...scaled);
      const [x, y, z] = scaled.map(v => v / n);
      const c = Math.cos(angle.value), s = Math.sin(angle.value), t = 1 - c;
      const rows = [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
      // The input is a binary64 radian value, not an exact degree/turn
      // witness. Only zero is admitted as an exact rotation here; even PI/2
      // is rounded. Do not infer a special angle from rounded coefficients.
      return new Matrix(rows, angle.value !== 0);
    }),
    transform: builtin('transform', 1, 2, (args, loc) => {
      const [linear, translation] = args.length === 1 ? [identityMatrix(), args[0]] : args;
      if (!(linear instanceof Matrix) || linear.rows.length !== 3 || linear.rows[0].length !== 3) raise('transform expects a 3×3 Matrix', loc);
      vectorNumbers(translation, 1, 3, loc);
      return new Transform(linear, translation, loc);
    }),
    identityTransform: builtin('identityTransform', 0, 0, () => new Transform(identityMatrix(), zeroLengthVector())),
    inverse: builtin('inverse', 1, 1, ([value], loc) => {
      const input = value instanceof Transform ? value.linear : value;
      if (!(input instanceof Matrix) || input.rows.length !== 3 || input.rows[0].length !== 3) unsupported('inverse of anything but a 3×3 Matrix or a Transform is not implemented', loc);
      const [[a, b, c], [d, e, f], [g, h, i]] = input.rows;
      const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
      if (Math.abs(det) < 1e-14) raise('Cannot invert a singular transform', loc);
      const result = new Matrix([[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]].map(row => row.map(v => v / det)), input.rotationRefusal);
      return value instanceof Transform ? new Transform(result, binary('*', -1, binary('*', result, value.translation, loc), loc)) : result;
    }),
    dot: builtin('dot', 2, 2, ([a, b], loc) => {
      if (!(a instanceof Vector) || !(b instanceof Vector) || a.items.length !== b.items.length) raise('dot expects Vectors of matching sizes', loc);
      return a.items.map((v, i) => binary('*', v, b.items[i], loc)).reduce((s, v) => binary('+', s, v, loc));
    }),
    cross: builtin('cross', 2, 2, ([a, b], loc) => {
      if (!(a instanceof Vector) || !(b instanceof Vector) || a.items.length !== 3 || b.items.length !== 3) raise('cross expects two 3D Vectors', loc);
      return rememberCross(new Vector([0, 1, 2].map(i => binary('-', binary('*', a.items[(i + 1) % 3], b.items[(i + 2) % 3], loc), binary('*', a.items[(i + 2) % 3], b.items[(i + 1) % 3], loc), loc))), a, b);
    }),
    line: builtin('line', 2, 2, ([origin, direction], loc) => {
      vectorNumbers(origin, 1, 3, loc); const d = vectorNumbers(direction, 0, 3, loc), n = Math.hypot(...d);
      if (!n) raise('Line direction must be nonzero', loc);
      return rememberLine(tagged(map({ origin, direction: new Vector(d.map(v => v / n)) }), 'Line'), direction); // curveGeometry.fs: '... as Line'
    }),
    color: builtin('color', 3, 4, (args, loc) => {
      if (args.some(v => number(v, loc) < 0 || v > 1)) raise('Color components must lie between zero and one', loc);
      return tagged(map({ red: args[0], green: args[1], blue: args[2], alpha: args[3] ?? 1 }), 'Color'); // properties.fs: '... as Color'
    }),
  };
  for (const name of ['sin', 'cos', 'tan']) values[name] = builtin(name, 1, 1, ([value], loc) => {
    if (!(value instanceof Quantity) || value.dimension !== 0 || value.angle !== 1) raise(`${name} expects an angle with units`, loc);
    return Math[name](value.value);
  });
  for (const name of ['floor', 'ceil', 'round']) values[name] = builtin(name, 1, 1, ([value], loc) => {
    const result = Math[name](number(value, loc, name));
    if (!Number.isFinite(result)) raise(`${name} produced a non-finite result`, loc);
    return result;
  });
  values.sqrt = builtin('sqrt', 1, 1, ([value], loc) => {
    if (!(value instanceof Quantity) && (typeof value !== 'number' || !Number.isFinite(value))) raise('Expected a finite numeric value', loc);
    const result = Math.sqrt(value instanceof Quantity ? value.value : value);
    if (!Number.isFinite(result)) raise('sqrt produced a non-finite result', loc);
    return value instanceof Quantity ? quantity(result, value.dimension / 2, value.angle / 2) : result;
  });
  return values;
}
