// Identifiers Onshape's FeatureScript compiler refuses as names.
//
// Why this exists: during the CAD-Acid Batch A capture Onshape refused to
// compile functions with a local variable named `box`; renaming it fixed it.
// wonky accepted it, so LLM-written FeatureScript could pass here and fail in
// Onshape. The parser now refuses the same class of names with the stable code
// `fs/reserved-identifier`.
//
// Sources, in order of strength:
//  1. FsDoc "Lexical conventions" (https://cad.onshape.com/FsDoc/tokens.html),
//     "Keywords are": annotation enum export function import operator
//     precondition predicate returns type typecheck typeconvert / as is new /
//     break const continue for in return var while / false inf true undefined /
//     catch throw try / reserved for future use: assert case default do switch.
//  2. Keywords the grammar uses but that list omits. The Onshape standard
//     library (tmp/research/onshape-std-3083, version 3083) uses `if`, `else`
//     and `try silent` in statement position throughout, and never as a name.
//  3. Builtin type names. FsDoc "Types and type tags" names nine standard
//     types: undefined and function (already keywords above), boolean, number,
//     string, array, map, box, builtin. `box` is the observed case (also the
//     `new box(...)` / `x[]` syntax); the standard library never binds any of
//     these names either (checked over all 276 sources of std 3083; see
//     test/fs-reserved-identifiers.test.mjs). Only `box` was confirmed by an
//     actual Onshape refusal. The others are refused on the strength of the
//     documented type-name role and zero counter-evidence: a false refusal here
//     costs one rename, a false acceptance costs a silent Onshape failure.
//
// Not reserved, deliberately: std function names (`line`, `plane`, `box3d`),
// std type names (`Query`, `Vector`), and any near miss such as `boxBody`.
// FsDoc also says only a NON-reserved identifier may be written unquoted as a
// dot operand or map key, so the keyword class (not the type-name class) is
// refused there as well.

const KEYWORDS = {
  // FsDoc tokens.html, "Top level and functions"
  annotation: 'documented keyword', enum: 'documented keyword', export: 'documented keyword',
  function: 'documented keyword', import: 'documented keyword', operator: 'documented keyword',
  precondition: 'documented keyword', predicate: 'documented keyword', returns: 'documented keyword',
  type: 'documented keyword', typecheck: 'documented keyword', typeconvert: 'documented keyword',
  // "Expressions"
  as: 'documented keyword', is: 'documented keyword', new: 'documented keyword',
  // "Statements"
  break: 'documented keyword', const: 'documented keyword', continue: 'documented keyword',
  for: 'documented keyword', in: 'documented keyword', return: 'documented keyword',
  var: 'documented keyword', while: 'documented keyword',
  // "Literals"
  false: 'documented keyword', inf: 'documented keyword', true: 'documented keyword',
  undefined: 'documented keyword',
  // "Exceptions"
  catch: 'documented keyword', throw: 'documented keyword', try: 'documented keyword',
  // "Reserved for future use"
  assert: 'keyword reserved for future use', case: 'keyword reserved for future use',
  default: 'keyword reserved for future use', do: 'keyword reserved for future use',
  switch: 'keyword reserved for future use',
  // Used by the grammar and the standard library, missing from the doc list.
  if: 'grammar keyword', else: 'grammar keyword', silent: 'grammar keyword',
};

const TYPE_NAMES = {
  box: 'builtin type name (refused by Onshape in the Batch A capture)',
  builtin: 'builtin type name', boolean: 'builtin type name', number: 'builtin type name',
  string: 'builtin type name', array: 'builtin type name', map: 'builtin type name',
};

export const RESERVED_KEYWORDS = Object.freeze(Object.keys(KEYWORDS));
export const RESERVED_TYPE_NAMES = Object.freeze(Object.keys(TYPE_NAMES));
export const RESERVED_IDENTIFIERS = Object.freeze([...RESERVED_KEYWORDS, ...RESERVED_TYPE_NAMES]);

export const RESERVED_IDENTIFIER_CODE = 'fs/reserved-identifier';

// Why `name` is refused as a binding (variable, parameter, function, loop or
// catch variable, enum, namespace), or null when it is fine.
export const reservedBindingReason = name =>
  Object.hasOwn(KEYWORDS, name) ? KEYWORDS[name] : Object.hasOwn(TYPE_NAMES, name) ? TYPE_NAMES[name] : null;

// Why `name` is refused as an unquoted dot operand or map key: only the
// keyword class, which FsDoc calls "reserved".
export const reservedMemberReason = name => (Object.hasOwn(KEYWORDS, name) ? KEYWORDS[name] : null);

export const reservedIdentifierHint = (name, member) => member
  ? `Onshape only accepts a non-reserved word unquoted here. Write the key quoted: x["${name}"] or { "${name}": value }.`
  : `Rename it, for example '${name}Value' or 'my${name[0].toUpperCase()}${name.slice(1)}'. Onshape refuses reserved FeatureScript words as names, so this source would not compile there.`;
