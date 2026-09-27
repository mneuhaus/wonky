// PROTOTYPE of the proposed fix for cluster fs-interpreter-semantics
// (docs/corpus/cluster-fs-interpreter-semantics.md). NOT production code.
//
// The edits are applied in memory by ./hooks.mjs when Node loads the
// production modules; files under src/ are never written. Each edit names an
// exact text that must occur exactly once in the production file, so the
// prototype fails loudly instead of silently diverging when src/ changes.
//
// Semantics implemented (Onshape std valueBounds.fs / properties.fs / query.fs):
//   1. Feature parameter defaults from the precondition spec, including
//      parameters inside precondition if-blocks:
//        isLength/isAngle/isInteger/isReal(definition.x, SPEC) -> SPEC default
//          (millimeter / degree entry when present, else the first entry);
//        definition.x is boolean -> false; is string -> ""; is <enum> -> first
//        member; is Query -> qNothing().
//      Precedence, weakest first: type-implied defaults (false, "", first enum
//      member, empty query) < defineFeature defaults map < annotation "Default"
//      < bound-spec default (existing order) < --param.
//   2. Annotations are metadata: only the "Default" entry is evaluated.
//      "Filter" (query-filter notation such as EntityType.BODY && BodyType.SOLID)
//      and every other key stay unevaluated.
//   3. Bound specs: LengthBoundSpec, AngleBoundSpec, IntegerBoundSpec,
//      RealBoundSpec with the std typecheck (canBeBoundSpec: a value is a number
//      or [min, default, max]); std constants LENGTH_BOUNDS & co. as real specs;
//      isAngle, isInteger, isReal; unitless.
//   4. Type tags on plain maps: color() returns a Color-tagged map; 'is Color'
//      checks the tag, 'as Color' runs the canBeColor typecheck.
export const patches = {
  'src/values.mjs': [
    [`export const map = fields => Object.assign(Object.create(null), fields);`,
     `export const map = fields => Object.assign(Object.create(null), fields);
// FS type tags on plain maps ('as Color'); KeyedMap keeps its own tag field.
const TYPE_TAG = Symbol('FeatureScript type tag');
export const tagOf = value => value instanceof KeyedMap ? value.tag : isMap(value) ? value[TYPE_TAG] ?? null : null;
export function tagged(value, type) {
  const result = map({ ...value });
  Object.defineProperty(result, TYPE_TAG, { value: type, enumerable: false });
  return result;
}
export const BOUND_SPEC_TYPES = ['LengthBoundSpec', 'AngleBoundSpec', 'IntegerBoundSpec', 'RealBoundSpec'];`],
    [`  if (isMap(value)) return map(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])));`,
     `  if (isMap(value)) { const copy = map(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))); return value[TYPE_TAG] ? tagged(copy, value[TYPE_TAG]) : copy; }`],
    [`    case 'LengthBoundSpec': return value instanceof KeyedMap && value.tag === type;`,
     `    case 'LengthBoundSpec': case 'AngleBoundSpec': case 'IntegerBoundSpec': case 'RealBoundSpec': return value instanceof KeyedMap && value.tag === type;
    case 'Color': return isMap(value) && value[TYPE_TAG] === 'Color';`],
    [`  if (type === 'LengthBoundSpec' && value instanceof KeyedMap) {
    if (value.entries.some(([key, row]) => !(key instanceof Quantity) || key.dimension !== 1 || key.angle !== 0 || !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite))) fail('Invalid LengthBoundSpec', loc);
    return new KeyedMap(value.entries, type);
  }`,
     `  if (BOUND_SPEC_TYPES.includes(type) && value instanceof KeyedMap) {
    // valueBounds.fs canBeBoundSpec: each value is a number (a per-unit UI
    // default) or [min, default, max]; keys are units of the spec's quantity.
    const unitless = type === 'IntegerBoundSpec' || type === 'RealBoundSpec';
    const keyOk = key => unitless ? key === 1 : key instanceof Quantity && key.value > 0 && (type === 'LengthBoundSpec' ? key.dimension === 1 && key.angle === 0 : key.dimension === 0 && key.angle === 1);
    const rowOk = row => Number.isFinite(row) || (Array.isArray(row) && row.length === 3 && row.every(Number.isFinite) && row[0] <= row[1] && row[1] <= row[2]);
    if (!value.entries.length || value.entries.some(([key, row]) => !keyOk(key) || !rowOk(row)) || !value.entries.some(([, row]) => Array.isArray(row)) || (unitless && value.entries.length !== 1)) fail(\`Invalid \${type}\`, loc);
    return new KeyedMap(value.entries, type);
  }
  if (type === 'Color' && isMap(value)) {
    // properties.fs canBeColor: exactly red, green, blue, alpha in [0, 1].
    const keys = Object.keys(value);
    if (keys.length !== 4 || !['red', 'green', 'blue', 'alpha'].every(k => typeof value[k] === 'number' && value[k] >= 0 && value[k] <= 1)) fail('Invalid Color', loc);
    return tagged(value, 'Color');
  }`],
  ],
  'src/scalars.mjs': [
    [`import { binary, KeyedMap, map, Matrix, Quantity, Transform, Vector, vectorNumbers } from './values.mjs';`,
     `import { binary, BOUND_SPEC_TYPES, KeyedMap, map, Matrix, Quantity, tagged, Transform, Vector, vectorNumbers } from './values.mjs';`],
    // Keep lengthBoundRows' contract (src/lang/semcore/eval.mjs imports it); skip per-unit number entries.
    [`  return bounds.entries.map(([unit, row]) => {`,
     `  return bounds.entries.filter(([, row]) => Array.isArray(row)).map(([unit, row]) => {`],
    [`export function scalarBuiltins() {`,
     `// UI default of a bound spec. wonky's document units are millimeter and
// degree, so the millimeter/degree entry wins when present, else the first
// [min, default, max] entry (valueBounds.fs: "The default value for a unit that
// is not listed is the default value of the first unit").
export function boundDefault(bounds, loc) {
  if (!(bounds instanceof KeyedMap) || !BOUND_SPEC_TYPES.includes(bounds.tag)) fail('Expected a bound spec', loc);
  const preferred = { LengthBoundSpec: 0.001, AngleBoundSpec: Math.PI / 180 }[bounds.tag];
  const [unit, row] = bounds.entries.find(([u]) => preferred && u instanceof Quantity && Math.abs(u.value - preferred) <= 1e-12 * preferred)
    ?? bounds.entries.find(([, r]) => Array.isArray(r));
  return binary('*', Array.isArray(row) ? row[1] : row, unit, loc);
}
// valueBounds.fs verifyBounds: the first [min, default, max] entry decides.
function withinBounds(value, bounds, type, loc) {
  if (!(bounds instanceof KeyedMap) || bounds.tag !== type) fail(\`Expected \${type}\`, loc);
  const [unit, row] = bounds.entries.find(([, r]) => Array.isArray(r));
  return !binary('<', value, binary('*', row[0], unit, loc), loc) && !binary('>', value, binary('*', row[2], unit, loc), loc);
}
const spec = (type, entries) => new KeyedMap(entries, type);
const meter = new Quantity(1), cm = new Quantity(0.01), mm = new Quantity(0.001), inch = new Quantity(0.0254), foot = new Quantity(0.3048), yard = new Quantity(0.9144);
const lengthSpec = (row, c, m, i, f, y) => spec('LengthBoundSpec', [[meter, row], [cm, c], [mm, m], [inch, i], [foot, f], [yard, y]]);
const deg = new Quantity(Math.PI / 180, 0, 1), rad = new Quantity(1, 0, 1);
const angleSpec = (row, r) => spec('AngleBoundSpec', [[deg, row], [rad, r]]);
// Values from the Onshape std valueBounds.fs (tmp/lang/onshape-std mirror).
export const stdBounds = () => ({
  LENGTH_BOUNDS: lengthSpec([-500, 0.025, 500], 2.5, 25, 1, 0.1, 0.025),
  NONNEGATIVE_LENGTH_BOUNDS: lengthSpec([1e-5, 0.025, 500], 2.5, 25, 1, 0.1, 0.025),
  NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS: lengthSpec([0, 0.025, 500], 2.5, 25, 1, 0.1, 0.025),
  NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS: lengthSpec([0, 0, 500], 0, 0, 0, 0, 0),
  NONPOSITIVE_ZERO_DEFAULT_LENGTH_BOUNDS: lengthSpec([-500, 0, 0], 0, 0, 0, 0, 0),
  ZERO_DEFAULT_LENGTH_BOUNDS: lengthSpec([-500, 0, 500], 0, 0, 0, 0, 0),
  ANGLE_360_BOUNDS: angleSpec([-1e5, 30, 1e5], 1),
  ANGLE_360_ZERO_DEFAULT_BOUNDS: angleSpec([-1e5, 0, 1e5], 0),
  ANGLE_360_90_DEFAULT_BOUNDS: angleSpec([-1e5, 90, 1e5], Math.PI / 2),
  ANGLE_180_MINUS_180_BOUNDS: angleSpec([-180, 0, 180], 1),
  POSITIVE_COUNT_BOUNDS: spec('IntegerBoundSpec', [[1, [1, 2, 1e5]]]),
  POSITIVE_REAL_BOUNDS: spec('RealBoundSpec', [[1, [0, 1, 1e5]]]),
});

export function scalarBuiltins() {`],
    [`    degree: new Quantity(Math.PI / 180, 0, 1), radian: new Quantity(1, 0, 1), PI: Math.PI,`,
     `    degree: new Quantity(Math.PI / 180, 0, 1), radian: new Quantity(1, 0, 1), PI: Math.PI, unitless: 1,
    ...stdBounds(),
    isAngle: builtin('isAngle', 2, 2, ([value, bounds], loc) => value instanceof Quantity && value.dimension === 0 && value.angle === 1 && Number.isFinite(value.value) && withinBounds(value, bounds, 'AngleBoundSpec', loc)),
    isInteger: builtin('isInteger', 2, 2, ([value, bounds], loc) => Number.isInteger(value) && withinBounds(value, bounds, 'IntegerBoundSpec', loc)),
    isReal: builtin('isReal', 2, 2, ([value, bounds], loc) => typeof value === 'number' && Number.isFinite(value) && withinBounds(value, bounds, 'RealBoundSpec', loc)),`],
    [`      return map({ red: args[0], green: args[1], blue: args[2], alpha: args[3] ?? 1 });`,
     `      return tagged(map({ red: args[0], green: args[1], blue: args[2], alpha: args[3] ?? 1 }), 'Color');`],
  ],
  'src/library.mjs': [
    [`      LENGTH_BOUNDS: 'LENGTH_BOUNDS', POSITIVE_LENGTH_BOUNDS: 'POSITIVE_LENGTH_BOUNDS',`,
     `      POSITIVE_LENGTH_BOUNDS: 'POSITIVE_LENGTH_BOUNDS', // wonky alias, not in Onshape std; no UI default`],
    [`        if (!['LENGTH_BOUNDS', 'POSITIVE_LENGTH_BOUNDS'].includes(bounds)) fail('Only LENGTH_BOUNDS and POSITIVE_LENGTH_BOUNDS are supported', loc);
        return bounds === 'LENGTH_BOUNDS' || mm > 0;`,
     `        if (bounds !== 'POSITIVE_LENGTH_BOUNDS') fail('Expected a LengthBoundSpec', loc);
        return mm > 0;`],
  ],
  'src/queries.mjs': [
    [`    case 'allSolid': return bodies.filter(row => row.record.kind === 'solid');`,
     `    case 'allSolid': return bodies.filter(row => row.record.kind === 'solid');
    case 'nothing': return [];`],
    [`    qBodyType: builtin('qBodyType', 2, 2, ([query, bodyType]) => new TopologyQuery('bodyType', { query, bodyType })),`,
     `    qBodyType: builtin('qBodyType', 2, 2, ([query, bodyType]) => new TopologyQuery('bodyType', { query, bodyType })),
    qNothing: builtin('qNothing', 0, 0, () => new TopologyQuery('nothing')),`],
  ],
  'src/interpreter.mjs': [
    [`import { lengthBoundRows } from './scalars.mjs';`,
     `import { boundDefault } from './scalars.mjs';`],
    [`    const defaults = this.featureDefaults(entry);
    const supplied = typeof definition === 'function' ? definition() : definition;
    this.call(entry, [context, id, map({ ...defaults, ...supplied })], null);`,
     `    const { declared, implied } = this.featureDefaults(entry);
    const supplied = typeof definition === 'function' ? definition() : definition;
    // Weakest first: type-implied UI defaults < defineFeature defaults map
    // (merged in invoke) < declared defaults < supplied parameters.
    const fromMap = entry?.type === 'feature' ? entry.defaults : {};
    const weak = Object.fromEntries(Object.entries(implied).filter(([key]) => !Object.hasOwn(fromMap, key)));
    this.call(entry, [context, id, map({ ...weak, ...declared, ...supplied })], null);`],
    [`  featureDefaults(entry) {
    if (entry?.type !== 'feature' || !entry.fn.ast.precondition) return map({});
    const defaults = map({});
    for (const statement of entry.fn.ast.precondition.statements) {
      if (statement.kind !== 'expression') continue;
      const expression = statement.value;
      const target = expression.kind === 'type' ? expression.value : expression.kind === 'call' ? expression.args[0] : null;
      if (target?.kind !== 'access' || target.value.kind !== 'name' || target.value.name !== entry.fn.ast.params[2]?.name || target.key.kind !== 'literal') continue;
      const key = target.key.value;
      for (const annotation of statement.annotations ?? []) {
        const metadata = this.expression(annotation, entry.fn.env);
        if (Object.hasOwn(metadata, 'Default')) defaults[key] = metadata.Default;
      }
      if (expression.kind === 'call' && expression.callee.kind === 'name' && expression.callee.name === 'isLength' && expression.args.length === 2) {
        const bounds = this.expression(expression.args[1], entry.fn.env);
        if (bounds instanceof KeyedMap) defaults[key] = lengthBoundRows(bounds, expression.loc)[0][1];
      }
    }
    return defaults;
  }`,
     `  // The UI parameter spec of a feature (Onshape: the feature dialog), read
  // from its precondition, including parameters inside precondition if-blocks.
  // Annotations are metadata: only their "Default" entry is evaluated; "Filter"
  // uses a query-filter notation that is not a runtime expression.
  featureDefaults(entry) {
    const declared = map({}), implied = map({});
    if (entry?.type !== 'feature' || !entry.fn.ast.precondition) return { declared, implied };
    const env = entry.fn.env, param = entry.fn.ast.params[2]?.name;
    const visit = statement => {
      if (!statement) return;
      if (statement.kind === 'block') { statement.statements.forEach(visit); return; }
      if (statement.kind === 'if') { visit(statement.yes); visit(statement.no); return; }
      if (statement.kind !== 'expression') return;
      const expression = statement.value;
      const target = expression.kind === 'type' ? expression.value : expression.kind === 'call' ? expression.args[0] : null;
      if (target?.kind !== 'access' || target.value.kind !== 'name' || target.value.name !== param || target.key.kind !== 'literal') return;
      const key = target.key.value;
      for (const annotation of statement.annotations ?? []) {
        const field = annotation.fields.find(([k]) => k.kind === 'literal' && k.value === 'Default');
        if (field) declared[key] = this.expression(field[1], env);
      }
      if (expression.kind === 'call' && expression.callee.kind === 'name' && ['isLength', 'isAngle', 'isInteger', 'isReal'].includes(expression.callee.name) && expression.args.length === 2) {
        const bounds = this.expression(expression.args[1], env);
        if (bounds instanceof KeyedMap) declared[key] = boundDefault(bounds, expression.loc); // after "Default", as before: a bound spec's default wins
      } else if (expression.kind === 'type' && expression.operator === 'is') {
        if (expression.type === 'boolean') implied[key] = false;
        else if (expression.type === 'string') implied[key] = '';
        else if (expression.type === 'Query') implied[key] = this.call(env.get('qNothing', expression.loc), [], expression.loc);
        else {
          let scope = env; while (scope && !scope.bindings.has(expression.type)) scope = scope.parent;
          const members = scope?.bindings.get(expression.type).value;
          const first = isMap(members) ? Object.values(members)[0] : undefined;
          if (first instanceof EnumValue && first.enumType === expression.type) implied[key] = first;
        }
      }
    };
    visit(entry.fn.ast.precondition);
    return { declared, implied };
  }`],
  ],
};
