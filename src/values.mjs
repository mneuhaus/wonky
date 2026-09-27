import { fail, raise, unsupported } from './errors.mjs';
import { rememberScale } from './construction-frame.mjs';

export class Quantity {
  constructor(value, dimension = 1, angle = 0) { this.value = value; this.dimension = dimension; this.angle = angle; }
}
// Every enum type seen in this process (std enums and enums in the input), so a
// type test can tell an enum name from a std type wonky does not model.
const ENUM_TYPES = new Set();
export class EnumValue {
  constructor(type, name) { this.enumType = type; this.name = name; ENUM_TYPES.add(type); }
}
export class KeyedMap {
  constructor(entries, tag = null) { this.entries = entries; this.tag = tag; }
  get(key) { return this.entries.find(([candidate]) => equal(candidate, key))?.[1]; }
}
export class Matrix {
  constructor(rows) { this.rows = rows; }
}
export class Transform {
  constructor(linear, translation) { Object.assign(this, { linear, translation }); }
}
export class Vector {
  constructor(items) { this.items = items; }
}
export class Id {
  constructor(parts) { this.parts = parts; }
  toString() { return this.parts.join('/'); }
  key() { return JSON.stringify(this.parts); }
}
export class Plane {
  constructor(origin, normal, x) { Object.assign(this, { origin, normal, x }); }
}
// std string.fs REGEX_ID_COMPONENT allows '/' inside an Id component, but
// wonky joins Id components with '/' in body ids and reports, so such an Id is
// valid FeatureScript that wonky does not implement.
function idComponent(component, loc) {
  if (component.includes('/')) unsupported(`Id components containing '/' are not implemented ('${component}')`, loc);
  return component;
}
export const isMap = x => x !== null && typeof x === 'object' && (Object.getPrototypeOf(x) === null || Object.getPrototypeOf(x) === Object.prototype);
export const map = fields => Object.assign(Object.create(null), fields);

// FeatureScript type tags on plain maps ('{ ... } as Color'). A tagged map is
// still a map; the tag is a non-enumerable symbol, so JSON export, key
// iteration and equality ignore it. KeyedMap carries its tag in a field.
const TYPE_TAG = Symbol('FeatureScript type tag');
export const tagOf = value => value instanceof KeyedMap ? value.tag : isMap(value) ? value[TYPE_TAG] ?? null : null;
export function tagged(value, type) {
  if (!isMap(value)) fail(`Only maps can carry the type tag ${type}`);
  const result = map(value);
  Object.defineProperty(result, TYPE_TAG, { value: type, enumerable: false });
  return result;
}
// Copies a map's type tag onto a modified copy (member assignment keeps the type).
export const retag = (source, copy) => tagOf(source) && isMap(copy) ? tagged(copy, tagOf(source)) : copy;
// valueBounds.fs: the four bound-spec types a feature precondition can use.
export const BOUND_SPEC_TYPES = ['LengthBoundSpec', 'AngleBoundSpec', 'IntegerBoundSpec', 'RealBoundSpec'];
export const scalar = x => typeof x === 'number' || x instanceof Quantity;
export function clone(value) {
  if (value instanceof KeyedMap) return new KeyedMap(value.entries.map(([k, v]) => [clone(k), clone(v)]), value.tag);
  if (Array.isArray(value)) return value.map(clone);
  if (isMap(value)) return retag(value, map(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))));
  // Quantities, vectors and planes are immutable; context/sketch/function
  // values intentionally represent handles or closures.
  return value;
}
export function truth(value, loc) {
  if (typeof value !== 'boolean') raise('FeatureScript conditions must be boolean', loc);
  return value;
}
export function length(value, loc) {
  if (!(value instanceof Quantity) || value.dimension !== 1 || value.angle !== 0) raise('Expected a length with units (for example 10 * millimeter)', loc);
  if (!Number.isFinite(value.value)) raise('Length is not finite', loc);
  return value.value * 1000;
}
export function vectorNumbers(value, dimension, size, loc) {
  if (!(value instanceof Vector) || value.items.length !== size) raise(`Expected a ${size}D Vector`, loc);
  return value.items.map(x => {
    if (dimension === 1) return length(x, loc);
    if (typeof x !== 'number' || !Number.isFinite(x)) raise('Expected a dimensionless vector', loc);
    return x;
  });
}
export const quantity = (value, dimension, angle = 0) => dimension === 0 && angle === 0 ? value : new Quantity(value, dimension, angle);
const raw = x => x instanceof Quantity ? x.value : x;
const dim = x => x instanceof Quantity ? x.dimension : 0;
const angleDim = x => x instanceof Quantity ? x.angle : 0;

// FsDoc relational.html: == compares values. The std maps wonky represents
// with its own classes compare by their std fields: Plane and Transform
// (stdMapView), Matrix (its rows) and a caught regenError (its error.fs map).
export function equal(a, b, loc) {
  if (a === b) return true;
  if (a instanceof Quantity && b instanceof Quantity) return a.dimension === b.dimension && a.angle === b.angle && a.value === b.value;
  if (a instanceof EnumValue && b instanceof EnumValue) return a.enumType === b.enumType && a.name === b.name;
  if (a instanceof Id && b instanceof Id) return a.key() === b.key();
  if (a instanceof Vector && b instanceof Vector) return equal(a.items, b.items, loc);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i], loc));
  if (isMap(a) && isMap(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k], loc));
  if (a instanceof KeyedMap && b instanceof KeyedMap) return a.tag === b.tag && a.entries.length === b.entries.length
    && a.entries.every(([key, value]) => b.entries.some(([other, otherValue]) => equal(key, other, loc) && equal(value, otherValue, loc)));
  if (a instanceof Matrix && b instanceof Matrix) return equal(a.rows, b.rows, loc);
  if ((a instanceof Plane && b instanceof Plane) || (a instanceof Transform && b instanceof Transform) || (isMap(a?.fields) && isMap(b?.fields) && a instanceof Error && b instanceof Error)) return equal(stdMapView(a), stdMapView(b), loc);
  if (a?.type === 'Query' && b?.type === 'Query') {
    // A Query is a std map; wonky compares the kinds whose std map it can
    // reconstruct (TopologyQuery.stdFields).
    const first = a.stdFields?.(), second = b.stdFields?.();
    if (!first || !second) unsupported('== on these Queries is not implemented (wonky does not represent them as their std query maps)', loc);
    return equal(first, second, loc);
  }
  // A caught exception wonky raised itself has no documented value.
  if (a instanceof Error && b instanceof Error) unsupported('== on two different caught exceptions that wonky raised itself is not implemented', loc);
  return false;
}

export function binary(op, a, b, loc) {
  if (op === '==' || op === '!=') return op === '==' ? equal(a, b, loc) : !equal(a, b, loc);
  if (op === '~') return display(a) + display(b);
  if (a instanceof Matrix && b instanceof Vector && op === '*') {
    if (a.rows.some(row => row.length !== b.items.length)) raise('Matrix and vector dimensions do not match', loc);
    return new Vector(a.rows.map(row => row.map((v, i) => binary('*', v, b.items[i], loc)).reduce((s, v) => binary('+', s, v, loc))));
  }
  if (a instanceof Matrix && b instanceof Matrix && op === '*') {
    if (a.rows[0].length !== b.rows.length) raise('Matrix dimensions do not match', loc);
    return new Matrix(a.rows.map(row => b.rows[0].map((_, j) => row.reduce((s, v, k) => s + v * b.rows[k][j], 0))));
  }
  if (a instanceof Matrix || b instanceof Matrix) return matrixOperation(op, a, b, loc);
  if (a instanceof Transform && b instanceof Vector && op === '*') return binary('+', binary('*', a.linear, b, loc), a.translation, loc);
  if (a instanceof Transform && b instanceof Transform && op === '*') return new Transform(binary('*', a.linear, b.linear, loc), binary('+', binary('*', a.linear, b.translation, loc), a.translation, loc));
  if (a instanceof Transform && op === '*' && (b instanceof Plane || tagOf(b) === 'Line')) return transformGeometry(a, b, loc);
  if (op === '+' && a instanceof Id && typeof b === 'string') {
    if (!b) raise('Use a nonempty ID component', loc);
    return new Id([...a.parts, idComponent(b, loc)]);
  }
  // context.fs operator+(Id, Id) concatenates; operator+(Id, number) appends
  // replace("" ~ addend, "\\.", "_"). wonky formats integers only.
  if (op === '+' && a instanceof Id && b instanceof Id) return new Id([...a.parts, ...b.parts]);
  if (op === '+' && a instanceof Id && Number.isSafeInteger(b)) return new Id([...a.parts, String(b)]);
  if (op === '+' && a instanceof Id) unsupported('Id + a value other than a string, an Id or an integer is not implemented', loc);
  if (a instanceof Vector || b instanceof Vector) {
    if (a instanceof Vector && b instanceof Vector && ['+', '-'].includes(op) && a.items.length === b.items.length) {
      return new Vector(a.items.map((v, i) => binary(op, v, b.items[i], loc)));
    }
    if (a instanceof Vector && scalar(b) && ['*', '/'].includes(op)) return rememberScale(new Vector(a.items.map(v => binary(op, v, b, loc))), a, op === '*' ? b : 1 / b);
    if (scalar(a) && b instanceof Vector && op === '*') return rememberScale(new Vector(b.items.map(v => binary(op, a, v, loc))), b, a);
    unsupported(`Vector operation '${op}' on these operands is not implemented`, loc);
  }
  if (!scalar(a) || !scalar(b)) {
    // relational.html orders strings (and arrays) too; wonky orders numbers only.
    if (['<', '<=', '>', '>='].includes(op) && ![a, b].some(v => v === undefined || typeof v === 'boolean')) unsupported(`Operator '${op}' on non-numeric values is not implemented`, loc);
    // No overload applies: an exception in Onshape, but only when wonky
    // represents both operands exactly and std has no overload for them.
    // Transform, Plane, Query, tagged std maps (Line, CoordSystem, Box3d, ...)
    // have std overloads wonky does not all implement: a capability gap.
    if (!withoutStdOverloads(a) || !withoutStdOverloads(b)) unsupported(`Operator '${op}' on these operand types is not implemented`, loc);
    raise(`Operator '${op}' expects numeric operands`, loc);
  }
  const x = raw(a), y = raw(b), da = dim(a), db = dim(b), aa = angleDim(a), ab = angleDim(b);
  // units.fs:537-555 operator<(ValueWithUnits, number) and operator<(number,
  // ValueWithUnits) exist with the precondition that the number is 0 (>, <=
  // and >= derive from <). Any other unit mismatch fails the std precondition.
  const comparesWithZero = ['<', '<=', '>', '>='].includes(op) && ((a instanceof Quantity && b === 0) || (a === 0 && b instanceof Quantity));
  if (['+', '-', '%', '<', '<=', '>', '>='].includes(op) && (da !== db || aa !== ab) && !comparesWithZero) raise('Incompatible units in expression', loc);
  if (['/', '%'].includes(op) && y === 0) raise('Division by zero', loc);
  let result;
  switch (op) {
    case '+': result = quantity(x + y, da, aa); break;
    case '-': result = quantity(x - y, da, aa); break;
    case '*': result = quantity(x * y, da + db, aa + ab); break;
    case '/': result = quantity(x / y, da - db, aa - ab); break;
    case '%': result = quantity(((x % y) + y) % y, da, aa); break;
    case '^':
      if (db !== 0 || ab !== 0 || ((da !== 0 || aa !== 0) && !Number.isInteger(y))) unsupported('Exponents of values with units other than integers are not implemented', loc);
      result = quantity(x ** y, da * y, aa * y); break;
    case '<': return x < y;
    case '<=': return x <= y;
    case '>': return x > y;
    case '>=': return x >= y;
    default: unsupported(`Operator '${op}' is not implemented`, loc);
  }
  if (!Number.isFinite(raw(result))) raise('Numeric result is not finite', loc);
  return result;
}

// A FeatureScript function value: a user function, a builtin or a feature.
// Their objects are never null-prototype maps (map()), so a user map with a
// "type" key is not mistaken for one.
export const isFunctionValue = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) !== null && ['function', 'builtin', 'feature'].includes(value.type);
// Values that wonky represents exactly and for which std declares no operator
// overloads beyond the ones binary() implements: numbers, ValueWithUnits,
// strings, booleans, undefined, enum values, functions, Ids, plain arrays and
// untagged maps. An operator on them that binary() does not handle has no
// overload in Onshape either, which is an exception there.
function withoutStdOverloads(value) {
  return value === undefined || typeof value === 'boolean' || typeof value === 'string' || scalar(value) || value instanceof EnumValue
    || value instanceof Id || isFunctionValue(value) || Array.isArray(value) || (isMap(value) && !tagOf(value)) || (value instanceof KeyedMap && !value.tag);
}

// matrix.fs operators: Matrix + Matrix and Matrix - Matrix (same size), unary
// minus (here -1 * Matrix), Matrix * number, number * Matrix and Matrix / number.
// Matrix * Matrix and Matrix * Vector are handled in binary().
function matrixOperation(op, a, b, loc) {
  const entries = rows => rows.map(row => [...row]);
  let rows;
  if (a instanceof Matrix && b instanceof Matrix && (op === '+' || op === '-')) {
    if (a.rows.length !== b.rows.length || a.rows[0].length !== b.rows[0].length) raise('Matrix dimensions do not match', loc);
    rows = a.rows.map((row, i) => row.map((v, j) => op === '+' ? v + b.rows[i][j] : v - b.rows[i][j]));
  } else if (a instanceof Matrix && typeof b === 'number' && (op === '*' || op === '/')) rows = entries(a.rows).map(row => row.map(v => op === '*' ? v * b : v * (1 / b)));
  else if (typeof a === 'number' && b instanceof Matrix && op === '*') rows = entries(b.rows).map(row => row.map(v => a * v));
  else unsupported(`Operator '${op}' with a Matrix and these operands is not implemented`, loc);
  if (!rows.every(row => row.every(Number.isFinite))) raise('Numeric result is not finite', loc);
  return new Matrix(rows);
}

const numbers3 = (vector, lengths, loc) => {
  if (!(vector instanceof Vector) || vector.items.length !== 3) raise('Expected a 3D Vector', loc);
  return vector.items.map(item => {
    const value = lengths ? (item instanceof Quantity && item.dimension === 1 && item.angle === 0 ? item.value : NaN) : item;
    if (typeof value !== 'number' || !Number.isFinite(value)) raise(lengths ? 'Expected a 3D length Vector' : 'Expected a dimensionless 3D Vector', loc);
    return value;
  });
};
const unit3 = (v, loc) => {
  const n = Math.hypot(...v);
  if (!(n > 0)) raise('Cannot normalize a zero vector', loc);
  return v.map(x => x / n);
};
const times3 = (matrix, v) => matrix.rows.map(row => row.reduce((s, x, i) => s + x * v[i], 0));
// surfaceGeometry.fs:198 operator*(Transform, Plane) = plane(t * origin,
// inverse(transpose(t.linear)) * normal, t.linear * x) (the normal is a
// co-vector); curveGeometry.fs:79 operator*(Transform, Line) = line(t * origin,
// t.linear * direction). plane() and line() normalize their directions and
// plane() requires x perpendicular to the normal (surfaceGeometry.fs canBePlane).
function transformGeometry(t, geometry, loc) {
  const linear = t.linear;
  if (!(linear instanceof Matrix) || linear.rows.length !== 3 || linear.rows.some(row => row.length !== 3)) raise('Expected a Transform with a 3×3 linear part', loc);
  const origin = binary('*', t, geometry.origin, loc);
  if (geometry instanceof Plane) {
    const [[a, b, c], [d, e, f], [g, h, i]] = linear.rows;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (!(Math.abs(det) > 0)) raise('Cannot invert a singular transform', loc);
    // inverse(transpose(L)) is the transpose of inverse(L): the cofactor matrix / det.
    const inverseTranspose = new Matrix([[e * i - f * h, f * g - d * i, d * h - e * g], [c * h - b * i, a * i - c * g, b * g - a * h], [b * f - c * e, c * d - a * f, a * e - b * d]].map(row => row.map(v => v / det)));
    const normal = unit3(times3(inverseTranspose, numbers3(geometry.normal, false, loc)), loc), x = unit3(times3(linear, numbers3(geometry.x, false, loc)), loc);
    numbers3(origin, true, loc);
    if (Math.abs(normal.reduce((s, v, k) => s + v * x[k], 0)) > 1e-7) raise('The plane x axis must be perpendicular to its normal', loc);
    return new Plane(origin, new Vector(normal), new Vector(x));
  }
  numbers3(origin, true, loc);
  const direction = unit3(times3(linear, numbers3(geometry.direction, false, loc)), loc);
  return tagged(map({ origin, direction: new Vector(direction) }), 'Line');
}

// FeatureScript values that are maps in Onshape and that wonky represents with
// its own classes, as the std map (FsDoc: a missing key reads as undefined):
// Plane (surfaceGeometry.fs canBePlane: origin, normal, x), Transform
// (transform.fs canBeTransform: linear, translation) and a caught regenError
// (error.fs: message, customMessage, ...). Null for every other value.
export function stdMapView(value) {
  if (value instanceof Plane) return map({ origin: value.origin, normal: value.normal, x: value.x });
  if (value instanceof Transform) return map({ linear: value.linear, translation: value.translation });
  if (value instanceof Error && isMap(value.fields)) return value.fields;
  return null;
}
// Values without members in Onshape (FsDoc exceptions.html: "a map lookup (. or
// [] operator) on undefined" raises): undefined, booleans, numbers, strings,
// enum values and functions. Member access, for-in or size on them is an
// exception; on any other value wonky does not model it is a capability gap.
export function memberless(value, what, loc) {
  if (value === undefined || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || value instanceof EnumValue || isFunctionValue(value)) raise(`${what} expects a map or an array`, loc);
  const kind = value instanceof Error ? 'a caught exception that wonky raised itself' : typeof value?.type === 'string' ? `a ${value.type}` : value?.constructor?.name ? `a ${value.constructor.name}` : 'this value';
  unsupported(`${what} of ${kind} is not implemented (in Onshape it is a map or builtin value whose fields wonky does not model)`, loc);
}

export function matchesType(value, type, loc) {
  if (value instanceof EnumValue && value.enumType === type) return true;
  // A caught exception wonky raised itself (not a thrown value or regenError):
  // Onshape's value for it is not documented ("usually maps", FsDoc
  // exceptions.html), so no type test can be answered.
  if (value instanceof Error && !isMap(value.fields)) unsupported(`Type tests on a caught exception that wonky raised itself are not implemented ('${value.message}')`, loc);
  // Matrix is a builtin std type (matrix.fs canBeMatrix: @isMatrix); whether it
  // is also an array or a map is not documented.
  if (value instanceof Matrix && (type === 'array' || type === 'map')) unsupported(`Whether a Matrix is ${type === 'array' ? 'an array' : 'a map'} is not implemented`, loc);
  switch (type) {
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    // FsDoc type-tags.html: an enum value is a string with a type tag ("E.A is string == true").
    case 'string': return typeof value === 'string' || value instanceof EnumValue;
    case 'array': return Array.isArray(value) || value instanceof Vector || value instanceof Id;
    // Maps in Onshape: ValueWithUnits (units.fs), Plane (surfaceGeometry.fs),
    // Transform (transform.fs canBeTransform: value is map), Query (query.fs
    // canBeQuery: value is map) and a caught regenError (error.fs returns a map).
    case 'map': return (isMap(value) && !isFunctionValue(value)) || value instanceof KeyedMap || value instanceof Quantity || value instanceof Plane
      || value instanceof Transform || value?.type === 'Query' || value instanceof Error;
    case 'Vector': return value instanceof Vector;
    case 'ValueWithUnits': return value instanceof Quantity;
    case 'Id': return value instanceof Id;
    case 'Plane': return value instanceof Plane;
    case 'Matrix': return value instanceof Matrix;
    case 'Transform': return value instanceof Transform;
    case 'LengthBoundSpec': case 'AngleBoundSpec': case 'IntegerBoundSpec': case 'RealBoundSpec': return value instanceof KeyedMap && value.tag === type;
    case 'Context': case 'Sketch': case 'Query': return value?.type === type;
    case 'function': return isFunctionValue(value);
    // A std type carried as a tag on a plain map (Color, Line, ...). wonky can
    // only answer for enums and for the tag types whose every producer tags
    // its result; for any other std type (Cylinder, Circle, ...) a map or array
    // may well be one in Onshape, so the test is a capability gap, never false.
    default:
      if (isMap(value) && value[TYPE_TAG] === type) return true;
      if (ENUM_TYPES.has(type) || Object.hasOwn(mapTypechecks, type)) return false;
      if (isMap(value) || value instanceof KeyedMap || Array.isArray(value)) unsupported(`Type '${type}' is not implemented, so wonky cannot decide whether a value is one`, loc);
      return false;
  }
}
export function checkType(value, type, loc) {
  if (type && !matchesType(value, type, loc)) raise(`Expected ${type}`, loc);
  return value;
}
// valueBounds.fs canBeBoundSpec: every value is either a number (the UI
// default for that unit) or [min, default, max] with min <= default <= max.
// The first [min, default, max] entry defines the bounds (verifyBounds). The
// keys must be units of the spec's quantity; Integer/Real specs have exactly
// one (unitless) entry, and that entry is an array.
const boundKeyOk = {
  LengthBoundSpec: key => key instanceof Quantity && key.dimension === 1 && key.angle === 0 && key.value > 0,
  AngleBoundSpec: key => key instanceof Quantity && key.dimension === 0 && key.angle === 1 && key.value > 0,
  IntegerBoundSpec: key => key === 1,
  RealBoundSpec: key => key === 1,
};
const boundRowOk = row => Number.isFinite(row) || (Array.isArray(row) && row.length === 3 && row.every(Number.isFinite) && row[0] <= row[1] && row[1] <= row[2]);
function castBoundSpec(value, type, loc) {
  const entries = value.entries;
  const unitless = type === 'IntegerBoundSpec' || type === 'RealBoundSpec';
  if (!entries.length || !entries.some(([, row]) => Array.isArray(row)) || entries.some(([key, row]) => !boundKeyOk[type](key) || !boundRowOk(row))
    || (unitless && (entries.length !== 1 || !Array.isArray(entries[0][1])))) raise(`Invalid ${type}`, loc);
  return new KeyedMap(entries, type);
}
const unitNumber = v => typeof v === 'number' && Number.isFinite(v);
const isDirection = v => v instanceof Vector && v.items.length === 3 && v.items.every(unitNumber) && Math.abs(v.items.reduce((s, x) => s + x * x, 0) - 1) < 1e-11; // vector.fs is3dDirection, TOLERANCE.zeroAngle
const isLength = v => v instanceof Quantity && v.dimension === 1 && v.angle === 0 && Number.isFinite(v.value);
const isLengthVector = v => v instanceof Vector && v.items.length === 3 && v.items.every(x => x instanceof Quantity && x.dimension === 1 && x.angle === 0 && Number.isFinite(x.value));
// Typechecks of std map types (the 'typecheck' predicate of each std type).
const mapTypechecks = {
  // properties.fs canBeColor: exactly red, green, blue and alpha, each a number in [0, 1].
  Color: value => Object.keys(value).length === 4 && ['red', 'green', 'blue', 'alpha'].every(k => unitNumber(value[k]) && value[k] >= 0 && value[k] <= 1),
  // curveGeometry.fs canBeLine: a 3D length origin and a 3D unit direction.
  Line: value => isLengthVector(value.origin) && isDirection(value.direction),
  // coordSystem.fs canBeCoordSystem: a 3D length origin, unit x and z axes,
  // abs(dot(xAxis, zAxis)) < TOLERANCE.zeroAngle.
  CoordSystem: value => isLengthVector(value.origin) && isDirection(value.xAxis) && isDirection(value.zAxis)
    && Math.abs(value.xAxis.items.reduce((s, x, i) => s + x * value.zAxis.items[i], 0)) < 1e-11,
  // curveGeometry.fs: conics carry a tagged CoordSystem and length radii.
  Circle: value => matchesType(value.coordSystem, 'CoordSystem') && isLength(value.radius),
  Ellipse: value => matchesType(value.coordSystem, 'CoordSystem') && isLength(value.majorRadius) && isLength(value.minorRadius)
    && value.majorRadius.value >= value.minorRadius.value,
  // box.fs canBeBox3d: 3D length minCorner and maxCorner, minCorner <= maxCorner per axis.
  Box3d: value => isLengthVector(value.minCorner) && isLengthVector(value.maxCorner)
    && value.minCorner.items.every((x, i) => x.value <= value.maxCorner.items[i].value),
};
// matrix.fs: "A Matrix is an array of rows, all the same size, each of which
// is an array of numbers" (canBeMatrix = @isMatrix). Shared by matrix() and
// `as Matrix`.
export const isMatrixRows = rows => Array.isArray(rows) && rows.length > 0 && rows.every(row => Array.isArray(row) && row.length === rows[0].length && row.length > 0 && row.every(unitNumber));
// The std map types wonky represents with its own classes (see stdMapView):
// surfaceGeometry.fs canBePlane and transform.fs canBeTransform (`value.linear
// is Matrix`, matrixSize 3×3, 3D length translation). A map that passes the
// typecheck but carries further keys is a valid std value the class cannot
// hold, so it is a capability gap.
const classTypechecks = {
  Plane: { keys: ['origin', 'normal', 'x'], make: v => new Plane(v.origin, v.normal, v.x),
    check: v => isLengthVector(v.origin) && isDirection(v.x) && isDirection(v.normal) && Math.abs(v.x.items.reduce((s, x, i) => s + x * v.normal.items[i], 0)) < 1e-11 },
  Transform: { keys: ['linear', 'translation'], make: v => new Transform(v.linear, v.translation),
    check: v => v.linear instanceof Matrix && v.linear.rows.length === 3 && v.linear.rows[0].length === 3 && isLengthVector(v.translation) },
};
// Type names matchesType() decides for every value (the switch cases and the
// std map types in mapTypechecks). Any other name is an enum or a std type.
const DECIDED_TYPES = new Set(['number', 'boolean', 'string', 'array', 'map', 'Vector', 'ValueWithUnits', 'Id', 'Plane', 'Matrix', 'Transform',
  ...BOUND_SPEC_TYPES, 'Context', 'Sketch', 'Query', 'function', ...Object.keys(mapTypechecks)]);
// Std enums that wonky declares with only some of their members carry the
// names of the others under this key (queries.mjs), so a missing member is a
// capability gap and not an unknown name.
export const STD_ENUM_UNIMPLEMENTED = Symbol('std enum members wonky does not implement');
// FsDoc type-tags.html: '"A" as Example // same as Example.A'. `members` is
// the enum declaration the interpreter found for `type` in scope.
function castToEnum(value, type, members, loc) {
  if (value instanceof EnumValue && value.enumType === type) return value;
  const name = value instanceof EnumValue ? value.name : value;
  if (Object.hasOwn(members, name)) return members[name];
  if (members[STD_ENUM_UNIMPLEMENTED]?.includes(name)) unsupported(`${type}.${name} is not implemented`, loc);
  raise(`'${name}' is not a ${type}`, loc);
}
// `value as type`. `enumMembers` is the enum declaration of `type` when the
// interpreter found one in scope (only for string and enum values).
export function cast(value, type, loc, enumMembers = null) {
  if (BOUND_SPEC_TYPES.includes(type) && value instanceof KeyedMap) return castBoundSpec(value, type, loc);
  if (Object.hasOwn(mapTypechecks, type) && isMap(value)) {
    if (!mapTypechecks[type](value)) raise(`Invalid ${type}`, loc);
    return tagged(value, type);
  }
  if (Object.hasOwn(classTypechecks, type) && (isMap(value) || value instanceof KeyedMap)) {
    if (value instanceof KeyedMap) unsupported(`Casting a map with non-string keys to ${type} is not implemented`, loc);
    const { keys, check, make } = classTypechecks[type];
    if (!check(value)) raise(`Invalid ${type}`, loc);
    if (Object.keys(value).some(key => !keys.includes(key))) unsupported(`A ${type} with keys other than ${keys.join(', ')} is not implemented`, loc);
    return make(value);
  }
  // query.fs canBeQuery: a map with a QueryType queryType or a string
  // historyType. wonky's queries are its own objects, not such maps.
  if (type === 'Query' && isMap(value)) {
    if (value.queryType === undefined && typeof value.historyType !== 'string') raise('Invalid Query', loc);
    unsupported('Casting a map to Query is not implemented (wonky does not represent queries as their std maps)', loc);
  }
  if (type === 'Matrix' && Array.isArray(value)) {
    // Whether @isMatrix accepts zero rows or empty rows is not documented.
    if (!value.length || value.every(row => Array.isArray(row) && !row.length)) unsupported('Whether an array without entries is a Matrix is not implemented', loc);
    if (!isMatrixRows(value)) raise('Invalid Matrix', loc);
    return new Matrix(value.map(row => [...row]));
  }
  if ((typeof value === 'string' || value instanceof EnumValue) && !DECIDED_TYPES.has(type)) {
    if (enumMembers) return castToEnum(value, type, enumMembers, loc);
    if (!(value instanceof EnumValue && value.enumType === type)) unsupported(`Casting to '${type}' is not implemented (wonky does not declare this enum or type)`, loc);
  }
  if (type === 'Id' && Array.isArray(value) && value.length && value.every(v => typeof v === 'string' && v.length)) return new Id(value.map(v => idComponent(v, loc)));
  // vector.fs canBeVector: a non-empty array. wonky's Vector arithmetic handles numbers and ValueWithUnits.
  if (type === 'Vector' && Array.isArray(value) && value.length) {
    if (!value.every(scalar)) unsupported('A Vector whose items are not numbers or ValueWithUnits is not implemented', loc);
    return new Vector(value);
  }
  if (type === 'array' && value instanceof Vector) return clone(value.items);
  if (type === 'array' && value instanceof Id) return [...value.parts];
  return checkType(value, type, loc);
}
export function display(value) {
  if (value instanceof Error) return value.message;
  if (value instanceof EnumValue) return value.name;
  if (value instanceof Quantity) return `${value.value} meter^${value.dimension} radian^${value.angle}`;
  if (value instanceof Id) return value.toString();
  if (value instanceof Vector) return `vector(${value.items.map(display).join(', ')})`;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return String(value);
  return JSON.stringify(value);
}
