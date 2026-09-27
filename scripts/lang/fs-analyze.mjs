// Static facts about one parsed FeatureScript file (corpus analysis only).
//
// The central output is the classification of *geometry-synchronization
// sites*: places where the modeling program's control or data flow depends on
// a value that only the geometry kernel can produce (evaluateQuery, ev*,
// success/failure of an op). A frontend running in another language than the
// kernel must block on the kernel at each of these sites; lazy queries
// (q*) and plain op* calls do not force such a round trip.
//
// Site record: { kind, sub, line, fn, reachable, text, ...flags }
//   kind geo-branch   sub assert | emptiness-guard | measure-decision | topology-decision
//        geo-iterate  sub entities | loop-bound | while-bound
//        geo-data     sub measure-param | entity-selection   (argument of a modeling op)
//        meta-branch / meta-iterate                          (names, variables, attributes)
//        failure-branch sub try-rethrow | try-recover | try-silent-block | try-no-catch | try-result
//   flags modelingInBranch/modelingInBody  any op* incl. metadata writes
//         geomOp    geometry-changing op (setProperty/setAttribute excluded)
//         selects   body binds/returns entity values (host-side selection)
//         filter    branch body is only continue/break (a predicate of the enclosing loop)
//         inMap     inside a non-sequential loop over evaluated entities (filtered map)
//         carried   loop has break/try/while (sequential semantics)
//         pred      selection predicate vocabulary: range | direction | type | convexity | name | complex (joined by +)
// scripts/lang/corpus-report.mjs maps sites to the synchronization ladder.

const STD_EXACT = new Set(`vector plane line transform rotationAround matrix identityMatrix identityTransform size append
concatenateArrays range abs sqrt sin cos tan asin acos atan atan2 min max floor ceil round pow log exp cross dot norm normalize
squaredNorm perpendicularVector toWorld fromWorld planeToWorld worldToPlane coordSystem mapArray filter sort reverse subArray
contains keys values mergeMaps replace startsWith endsWith splitIntoCharacters length toString regenError color defineFeature
debug println print isUndefinedOrEmptyString clamp tolerantEquals mirrorAcross scaleUniformly rotationMatrix3d inverse transpose
zeroVector makeId newId unstableIdComponent resize mod stringToNumber indexOf lastIndexOf fill angleBetween project
cylinderPlaneIntersection intersection box3d circularPattern linearPattern reportFeatureInfo reportFeatureWarning
reportFeatureError instantiate addInstance newInstantiator lookupTableEvaluate xyPlane yzPlane xzPlane worldPlane
toRadians toDegrees acosh unitVector hasFeature arrayWithSize isArrayWithSize isIn setFeatureComputedParameter
isAnything isLength isAngle isInteger isReal isQuery isMap isArray isString isBoolean isUndefined isFunction isContext
isId isVector is2dPoint is3dLengthVector isUnitVector isPositive isTransform tolerantEqualsZero dissolveWires
getRemainderPatternTransform lastModifyingOperationId matchesArray isQueryEmpty sortedIndices trim toUpperCase toLowerCase
repeat isValueIn isValidId isTopLevelId`.split(/\s+/).filter(Boolean));
const STD_PREFIX = /^(op|sk|q|ev|new|get|set|is|can|has|make|to|from|try|extract|report|compute|add|remove|start|end|find|lookup|tolerant|arc|circle|ellipse|polygon|rectangle|spline)[A-Z]/;
const TOPO_SOURCE = name => name === 'evaluateQuery' || name === 'isQueryEmpty';
const MEASURE_SOURCE = name => /^ev[A-Z]/.test(name);
const GEO_SOURCE = name => TOPO_SOURCE(name) || MEASURE_SOURCE(name);
const META_SOURCE = name => ['getProperty', 'getAttribute', 'getAttributes', 'getVariable', 'getFeatureStatus', 'lastModifyingOperationId'].includes(name);
const MODEL_OP = name => /^op[A-Z]/.test(name) || /^sk[A-Z]/.test(name) || /^newSketch/.test(name) || name === 'instantiate' || name === 'setProperty' || name === 'setAttribute';
const LAZY_QUERY = name => /^q[A-Z]/.test(name);
const UNITS = new Set(['millimeter', 'meter', 'centimeter', 'inch', 'foot', 'degree', 'radian', 'kilogram', 'gram', 'second', 'newton', 'millimeter2', 'millimeter3']);

// Taint bits: TOPO = entity existence/identity/count (evaluateQuery, isQueryEmpty),
// MEASURE = numeric geometry (ev*), META = names/attributes/variables read back from
// the context, FAIL = success/failure of a kernel operation.
const TOPO = 1, META = 2, FAIL = 4, MEASURE = 8, GEO = TOPO | MEASURE;

export function isStdName(name) { return STD_EXACT.has(name) || STD_PREFIX.test(name); }

// Generic child iteration over the AST produced by fs-parse.mjs.
function children(node) {
  if (!node || typeof node !== 'object') return [];
  switch (node.kind) {
    case 'block': return node.statements;
    case 'declaration': return [node.value];
    case 'throw': case 'return': case 'expression': case 'paren': case 'unary': case 'newBox': case 'unbox': case 'type': case 'tryExpression': return [node.value];
    case 'assign': return [node.target, node.value];
    case 'if': return [node.condition, node.yes, node.no];
    case 'forIn': return [node.values, node.body];
    case 'forC': return [node.initial, node.condition, node.increment, node.body];
    case 'while': return [node.condition, node.body];
    case 'try': return [node.body, node.handler];
    case 'function': return [node.precondition, node.body];
    case 'map': return node.fields.flatMap(([k, v]) => [k, v]);
    case 'array': return node.items;
    case 'call': return [node.callee, ...node.args];
    case 'access': return [node.value, node.key];
    case 'binary': return [node.left, node.right];
    case 'conditional': return [node.condition, node.yes, node.no];
    default: return [];
  }
}
function walk(node, visit, parents = []) {
  if (!node || typeof node !== 'object') return;
  if (visit(node, parents) === false) return;
  const next = [...parents, node];
  for (const child of children(node)) walk(child, visit, next);
}
const calleeName = call => call.callee.kind === 'name' ? call.callee.name : null;
const baseName = target => {
  let t = target;
  while (t && (t.kind === 'access' || t.kind === 'unbox' || t.kind === 'paren')) t = t.value;
  return t?.kind === 'name' ? t.name : null;
};
function snippet(source, line) {
  const text = source.split('\n')[line - 1] ?? '';
  return text.trim().slice(0, 160);
}

export function analyzeFs(ast, source, { corpusUserNames = new Set() } = {}) {
  const constructs = new Map();
  const add = (key, n = 1) => constructs.set(key, (constructs.get(key) ?? 0) + n);

  // ---- Top-level inventory -------------------------------------------------
  const functions = new Map(); // name -> function node (top-level, incl. const lambdas)
  const featureRoots = [];     // { name, fn }
  const evalRoots = [];
  let consts = 0, enums = 0, types = 0, predicates = 0, operators = 0;
  for (const d of ast.declarations) {
    if (d.kind === 'enum') { enums++; add('syntax:enumDecl'); continue; }
    if (d.kind === 'type') { types++; add('syntax:typeDecl'); continue; }
    if (d.isPredicate) { predicates++; add('syntax:predicateDecl'); }
    if (d.isOperator) { operators++; add('syntax:operatorDecl'); }
    if (d.value?.kind === 'function') { functions.set(d.name, d.value); if (!d.isPredicate && !d.isOperator) add('syntax:functionDecl'); continue; }
    if (d.value?.kind === 'call' && calleeName(d.value) === 'defineFeature' && d.value.args[0]?.kind === 'function') {
      featureRoots.push({ name: d.name, fn: d.value.args[0], exported: d.exported });
      functions.set(`feature:${d.name}`, d.value.args[0]);
      add('syntax:defineFeature');
      if (d.value.args[1]) add('syntax:featureDefaults');
      continue;
    }
    consts++; add('syntax:constDecl');
    if (d.value?.kind === 'map') add('syntax:constMapTable');
  }
  for (const s of ast.statements) {
    const expr = s.kind === 'expression' ? s.value : null;
    if (expr?.kind === 'function') { evalRoots.push(expr); functions.set(`eval:${evalRoots.length}`, expr); }
  }
  const fragmentStatements = ast.statements.filter(s => !(s.kind === 'expression' && s.value?.kind === 'function'));
  const imports = { std: 0, document: 0, namespaced: 0, reExported: 0, paths: [] };
  for (const imp of ast.imports) {
    const path = String(imp.path ?? '');
    if (path.startsWith('onshape/std/')) { imports.std++; add(`import:${path.replace('onshape/std/', 'std/')}`); }
    else { imports.document++; add('syntax:documentImport'); }
    if (imp.namespace) { imports.namespaced++; add('syntax:namespacedImport'); }
    if (imp.exported) imports.reExported++;
    imports.paths.push(path);
  }

  const localUserNames = new Set([...functions.keys()].filter(n => !n.includes(':')));
  const role = featureRoots.length ? 'feature' : evalRoots.length ? 'eval' : !ast.header ? 'fragment' : 'library';

  // ---- Construct counting (whole file) ---------------------------------------
  const callCounts = new Map();
  const opParams = new Map();
  let lambdas = 0, closures = 0, recursion = 0;
  const declaredLocals = new Set();
  walk({ kind: 'block', statements: [...ast.declarations.map(d => d.value).filter(Boolean), ...ast.statements] }, node => {
    switch (node.kind) {
      case 'if': add(node.no ? 'syntax:ifElse' : 'syntax:if'); break;
      case 'forIn': add(node.keyed ? 'syntax:forInKeyed' : 'syntax:forIn'); declaredLocals.add(node.name); break;
      case 'forC': add('syntax:forC'); break;
      case 'while': add('syntax:while'); break;
      case 'break': add('syntax:break'); break;
      case 'continue': add('syntax:continue'); break;
      case 'return': add('syntax:return'); break;
      case 'throw': add('syntax:throw'); break;
      case 'try': add(node.silent ? 'syntax:trySilentBlock' : node.handler ? 'syntax:tryCatch' : 'syntax:tryNoCatch'); break;
      case 'tryExpression': add(node.silent ? 'syntax:trySilentExpr' : 'syntax:tryExpr'); break;
      case 'conditional': add('syntax:ternary'); break;
      case 'map': add('syntax:mapLiteral'); break;
      case 'array': add('syntax:arrayLiteral'); break;
      case 'newBox': add('syntax:newBox'); break;
      case 'unbox': add('syntax:unbox'); break;
      case 'type': add(node.operator === 'is' ? 'syntax:typeTest' : 'syntax:typeCast'); break;
      case 'declaration': if (!node.constant) { add(node.type ? 'syntax:typedVar' : 'syntax:var'); declaredLocals.add(node.name); } break;
      case 'assign':
        add(node.operator === '=' ? 'syntax:assign' : 'syntax:compoundAssign');
        if (node.target.kind === 'access') add('syntax:containerAssign');
        break;
      case 'binary':
        if (node.operator === '~') add('syntax:stringConcat');
        else if (node.operator === '^') add('syntax:power');
        else if (node.operator === '%') add('syntax:modulo');
        break;
      case 'function': {
        // Feature bodies (defineFeature(function ...)) and evaluation snippets are
        // entry points, not first-class function values.
        const entry = featureRoots.some(f => f.fn === node) || evalRoots.includes(node);
        if (node.lambda && !entry) { lambdas++; add('syntax:lambda'); }
        if (node.precondition) add(node.precondition.statements.length ? 'syntax:precondition' : 'syntax:emptyPrecondition');
        break;
      }
      case 'name':
        if (UNITS.has(node.name)) add(`unit:${node.name}`);
        if (node.name.includes('::')) add('syntax:namespacedName');
        break;
      case 'access':
        if (node.dot && node.value.kind === 'name' && /^[A-Z]/.test(node.value.name) && /^[A-Z0-9_]+$/.test(String(node.key.value))) add(`enum:${node.value.name}.${node.key.value}`);
        break;
      case 'call': {
        const name = calleeName(node);
        if (!name) { add('syntax:computedCall'); break; }
        if (name.includes('::')) { add('syntax:namespacedCall'); callCounts.set(`ns:${name.split('::')[1]}`, (callCounts.get(`ns:${name.split('::')[1]}`) ?? 0) + 1); break; }
        if (localUserNames.has(name) || declaredLocals.has(name)) { add('syntax:userCall'); break; }
        const key = !isStdName(name) && corpusUserNames.has(name) ? `imported:${name}` : `call:${name}`;
        if (key.startsWith('imported:')) add('syntax:importedCall');
        else add(key);
        callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
        const def = node.args.find(a => a.kind === 'map');
        if (def && (MODEL_OP(name) || GEO_SOURCE(name))) {
          const keys = opParams.get(name) ?? new Map();
          for (const [k] of def.fields) if (k.kind === 'literal') keys.set(String(k.value), (keys.get(String(k.value)) ?? 0) + 1);
          opParams.set(name, keys);
        }
        break;
      }
      default: break;
    }
  });
  if (ast.annotationsCount) add('syntax:annotation', ast.annotationsCount);
  let annotationCount = 0;
  for (const d of ast.declarations) annotationCount += d.annotations?.length ?? 0;
  walk({ kind: 'block', statements: [...ast.declarations.map(d => d.value).filter(Boolean), ...ast.statements] }, node => {
    if (node.annotations?.length) annotationCount += node.annotations.length;
  });
  if (annotationCount) add('syntax:annotation', annotationCount);

  // ---- Call graph, closures, recursion -------------------------------------
  const calls = new Map(); // function key -> Set(user function names)
  const hasModeling = new Map();
  for (const [key, fn] of functions) {
    const set = new Set(); let modeling = false;
    walk(fn.body, node => {
      if (node.kind === 'call') {
        const name = calleeName(node);
        if (name && localUserNames.has(name)) set.add(name);
        if (name && MODEL_OP(name)) modeling = true;
      }
      // function values passed around (callbacks) also count as edges
      if (node.kind === 'name' && localUserNames.has(node.name)) set.add(node.name);
    });
    if (fn.precondition) walk(fn.precondition, node => { if (node.kind === 'call' && localUserNames.has(calleeName(node))) set.add(calleeName(node)); });
    calls.set(key, set); hasModeling.set(key, modeling);
    if (!key.includes(':') && set.has(key)) { recursion++; add('syntax:recursion'); }
  }
  const hasGeomModeling = new Map();
  for (const [key, fn] of functions) { let m = false; walk(fn.body, node => { if (node.kind === 'call') { const nm = calleeName(node); if (nm && MODEL_OP(nm) && nm !== 'setProperty' && nm !== 'setAttribute') m = true; } }); hasGeomModeling.set(key, m); }
  for (let again = true; again;) { again = false; for (const [key, set] of calls) if (!hasGeomModeling.get(key) && [...set].some(n => hasGeomModeling.get(n))) { hasGeomModeling.set(key, true); again = true; } }
  // Transitive modeling flag
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, set] of calls) if (!hasModeling.get(key) && [...set].some(n => hasModeling.get(n))) { hasModeling.set(key, true); changed = true; }
  }
  // Closure capture: a lambda referencing locals of an enclosing function.
  const scanClosures = (fn, outer) => {
    const locals = new Set(fn.params.map(p => p.name));
    walk(fn.body, (node) => {
      if (node.kind === 'declaration' && !node.constant) locals.add(node.name);
      if (node.kind === 'declaration' && node.constant) locals.add(node.name);
      if (node.kind === 'forIn') { locals.add(node.name); if (node.key) locals.add(node.key); }
      if (node.kind === 'function' && node !== fn) {
        const inner = new Set(node.params.map(p => p.name));
        let captures = false;
        walk(node.body, n2 => {
          if (n2.kind === 'declaration') inner.add(n2.name);
          if (n2.kind === 'forIn') inner.add(n2.name);
          if (n2.kind === 'name' && !inner.has(n2.name) && (locals.has(n2.name) || outer.has(n2.name))) captures = true;
        });
        if (captures) { closures++; add('syntax:capturingClosure'); }
        scanClosures(node, new Set([...outer, ...locals]));
        return false;
      }
    });
  };
  for (const [, fn] of functions) scanClosures(fn, new Set());

  // Reachability from roots
  const roots = [...featureRoots.map((_, i) => `feature:${featureRoots[i].name}`), ...evalRoots.map((_, i) => `eval:${i + 1}`)];
  const fragmentCalls = new Set();
  for (const s of fragmentStatements) walk(s, node => { if (node.kind === 'call' && localUserNames.has(calleeName(node))) fragmentCalls.add(calleeName(node)); if (node.kind === 'name' && localUserNames.has(node.name)) fragmentCalls.add(node.name); });
  const reachable = new Set();
  const visit = key => { if (reachable.has(key)) return; reachable.add(key); for (const n of calls.get(key) ?? []) visit(n); };
  for (const r of roots) visit(r);
  for (const n of fragmentCalls) visit(n);
  if (role === 'library' || role === 'fragment') for (const key of functions.keys()) visit(key);
  const unusedFunctions = [...localUserNames].filter(n => !reachable.has(n)).length;

  // ---- Taint analysis --------------------------------------------------------
  const geoFns = new Map();           // function name -> taint bits returned
  const taintedParams = new Map();    // function name -> Map(index -> bits)
  const bodies = [...functions.entries()];
  if (fragmentStatements.length) bodies.push(['fragment:top', { params: [], body: { kind: 'block', statements: fragmentStatements } }]);

  const exprTaint = (expr, env) => {
    if (!expr || typeof expr !== 'object') return 0;
    switch (expr.kind) {
      case 'name': return env.get(expr.name) ?? 0;
      case 'literal': case 'function': return 0;
      case 'access': {
        // Field-sensitive for `name.field`: a tainted field does not taint siblings.
        if (expr.dot && expr.value.kind === 'name') return (env.get(expr.value.name) ?? 0) | (env.get(`${expr.value.name}.${expr.key.value}`) ?? 0);
        return exprTaint(expr.value, env) | exprTaint(expr.key, env);
      }
      case 'call': {
        const name = calleeName(expr);
        let bits = 0;
        if (name && TOPO_SOURCE(name)) bits |= TOPO;
        if (name && MEASURE_SOURCE(name)) bits |= MEASURE;
        if (name && META_SOURCE(name)) bits |= META;
        if (name && localUserNames.has(name)) bits |= geoFns.get(name) ?? 0;
        if (name && (LAZY_QUERY(name) || MODEL_OP(name))) return bits; // symbolic results
        // A measurement or metadata read yields that kind of value only; the
        // identity of the measured entities does not flow into the number.
        if (name && (MEASURE_SOURCE(name) || META_SOURCE(name))) return bits;
        for (const a of expr.args) bits |= exprTaint(a, env);
        if (!name) bits |= exprTaint(expr.callee, env);
        return bits;
      }
      case 'tryExpression': {
        let bits = exprTaint(expr.value, env);
        let modeling = false;
        walk(expr.value, n => { if (n.kind === 'call') { const nm = calleeName(n); if (nm && (MODEL_OP(nm) || GEO_SOURCE(nm) || hasModeling.get(nm))) modeling = true; } });
        if (modeling) bits |= FAIL;
        return bits;
      }
      default: {
        let bits = 0;
        for (const c of children(expr)) bits |= exprTaint(c, env);
        return bits;
      }
    }
  };

  // Loop bounds: size(x) only depends on geometry when x holds entity lists
  // (TOPO); an array of measured numbers has a program-determined length.
  const boundTaint = (expr, env) => {
    if (!expr || typeof expr !== 'object') return 0;
    if (expr.kind === 'call' && calleeName(expr) === 'size') return exprTaint(expr.args[0], env) & (TOPO | META | FAIL);
    if (expr.kind === 'call' || expr.kind === 'name' || expr.kind === 'access') return exprTaint(expr, env);
    let bits = 0;
    for (const c of children(expr)) bits |= boundTaint(c, env);
    return bits;
  };
  const runBody = (key, fn, collect) => {
    const env = new Map();
    const pt = taintedParams.get(key);
    fn.params.forEach((p, i) => { const b = pt?.get(i); if (b) env.set(p.name, b); });
    let returned = 0;
    const setTaint = (name, bits) => { if (!name || !bits) return; env.set(name, (env.get(name) ?? 0) | bits); };
    const visitStmt = (node) => {
      walk(node, (n) => {
        switch (n.kind) {
          case 'declaration': setTaint(n.name, exprTaint(n.value, env)); break;
          case 'assign': {
            const t = n.target;
            const key = t.kind === 'access' && t.dot && t.value.kind === 'name' ? `${t.value.name}.${t.key.value}` : baseName(t);
            setTaint(key, exprTaint(n.value, env));
            break;
          }
          case 'forIn': { const b = exprTaint(n.values, env); setTaint(n.name, b); if (n.key) setTaint(n.key, b); break; }
          case 'return': returned |= exprTaint(n.value, env); break;
          case 'try':
            if (n.name) { let modeling = false; walk(n.body, m => { if (m.kind === 'call' && (MODEL_OP(calleeName(m) ?? '') || hasModeling.get(calleeName(m)))) modeling = true; }); if (modeling) setTaint(n.name, FAIL); }
            break;
          case 'call': {
            const name = calleeName(n);
            if (name && localUserNames.has(name)) {
              n.args.forEach((a, i) => {
                const b = exprTaint(a, env) & (GEO | META);
                if (b) {
                  const m = taintedParams.get(name) ?? new Map();
                  if (((m.get(i) ?? 0) | b) !== (m.get(i) ?? 0)) { m.set(i, (m.get(i) ?? 0) | b); taintedParams.set(name, m); changedGlobal = true; }
                }
              });
            }
            // Lambdas handed to higher-order calls with tainted data get tainted params.
            const argBits = n.args.reduce((acc, a) => acc | (a.kind === 'function' ? 0 : exprTaint(a, env)), 0) & (GEO | META);
            if (argBits) for (const a of n.args) if (a.kind === 'function') for (const p of a.params) setTaint(p.name, argBits);
            break;
          }
          default: break;
        }
        if (n.kind === 'function' && n !== fn) { for (const p of n.params) if (!env.has(p.name)) env.set(p.name, env.get(p.name) ?? 0); }
      });
    };
    // Two passes so loop-carried taint reaches earlier conditions.
    visitStmt(fn.body); visitStmt(fn.body);
    if (collect) collect(env);
    return returned;
  };

  let changedGlobal = true, iterations = 0;
  while (changedGlobal && iterations < 12) {
    changedGlobal = false; iterations++;
    for (const [key, fn] of bodies) {
      const bits = runBody(key, fn) & (GEO | META);
      if (!key.includes(':') && bits && ((geoFns.get(key) ?? 0) | bits) !== (geoFns.get(key) ?? 0)) { geoFns.set(key, (geoFns.get(key) ?? 0) | bits); changedGlobal = true; }
    }
  }

  // ---- Site classification ---------------------------------------------------
  const sites = [];
  const onlyThrows = stmt => {
    if (!stmt) return false;
    if (stmt.kind === 'throw') return true;
    if (stmt.kind === 'block') return stmt.statements.length > 0 && stmt.statements.every(s => s.kind === 'throw' || (s.kind === 'expression' && s.value.kind === 'call' && /^(println|print|debug|reportFeature)/.test(calleeName(s.value) ?? '')));
    if (stmt.kind === 'expression' && stmt.value.kind === 'call' && /^reportFeature/.test(calleeName(stmt.value) ?? '')) return true;
    return false;
  };
  const containsModeling = node => { let m = false; walk(node, n => { if (n.kind === 'call') { const nm = calleeName(n); if (nm && (MODEL_OP(nm) || hasModeling.get(nm))) m = true; } }); return m; };
  // Geometry-changing work only: metadata writes (names, colors, attributes) excluded.
  const METADATA_OP = name => name === 'setProperty' || name === 'setAttribute';
  const containsGeomOp = node => { let m = false; walk(node, n => { if (n.kind === 'call') { const nm = calleeName(n); if (nm && ((MODEL_OP(nm) && !METADATA_OP(nm)) || hasGeomModeling.get(nm))) m = true; } }); return m; };
  const isEmptinessCheck = (cond, env) => {
    let text = false;
    walk(cond, n => {
      if (n.kind === 'call' && calleeName(n) === 'isQueryEmpty') text = true;
      if (n.kind === 'binary' && ['==', '!=', '>', '<', '>=', '<='].includes(n.operator)) {
        const sides = [n.left, n.right];
        const entityList = bits => (bits & TOPO) && !(bits & MEASURE);
        const hasSize = sides.some(s => (s.kind === 'call' && calleeName(s) === 'size' && entityList(exprTaint(s.args[0], env))) || (s.kind === 'name' && entityList(env.get(s.name) ?? 0)));
        const hasLit = sides.some(s => s.kind === 'literal' && typeof s.value === 'number' && s.value <= 1);
        if (hasSize && hasLit) text = true;
      }
    });
    return text;
  };

  // Selection-predicate vocabulary (see scripts/lang/py-facts.py PRED_*).
  const PRED_EV = {
    evBox3d: 'range', evVolume: 'range', evArea: 'range', evLength: 'range', evVertexPoint: 'range', evApproximateCentroid: 'range',
    evDistance: 'range', evLine: 'direction', evPlane: 'direction', evAxis: 'direction', evEdgeTangentLine: 'direction',
    evFaceTangentPlane: 'direction', evCurveDefinition: 'type', evSurfaceDefinition: 'type', evEdgeConvexity: 'convexity',
  };
  const predKind = (expr, env, defs, depth = 0) => {
    const kinds = new Set();
    walk(expr, m => {
      if (m.kind === 'call') {
        const nm = calleeName(m);
        if (nm && PRED_EV[nm]) kinds.add(PRED_EV[nm]);
        else if (nm === 'dot' || nm === 'angleBetween' || nm === 'cross') kinds.add('direction');
        else if (nm === 'norm' || nm === 'squaredNorm') kinds.add('range');
        else if (nm && META_SOURCE(nm)) kinds.add('name');
        else if (nm && MEASURE_SOURCE(nm)) kinds.add('complex');
        else if (nm && localUserNames.has(nm) && m.args.some(a => exprTaint(a, env) & GEO)) kinds.add('complex');
      }
      if (m.kind === 'access' && m.dot && ['direction', 'normal'].includes(String(m.key.value))) kinds.add('direction');
      if (m.kind === 'name' && depth < 3 && defs.has(m.name) && (exprTaint(m, env) & (MEASURE | META))) {
        for (const k of predKind(defs.get(m.name), env, defs, depth + 1).split('+')) if (k) kinds.add(k);
      }
    });
    if (kinds.has('complex')) return 'complex';
    return [...kinds].sort().join('+') || 'range';
  };

  for (const [key, fn] of bodies) {
    const inReach = key.startsWith('fragment:') || reachable.has(key);
    const defs = new Map();
    walk(fn.body, m => { if (m.kind === 'declaration' && m.value) defs.set(m.name, m.value); if (m.kind === 'assign' && m.target.kind === 'name' && m.operator === '=') defs.set(m.target.name, m.value); });
    const env = new Map();
    runBody(key, fn, e => { for (const [k, v] of e) env.set(k, v); });
    const record = (kind, sub, node, extra = {}) => sites.push({ kind, sub, line: node.loc, fn: key, reachable: inReach, text: snippet(source, node.loc), ...extra });
    // Sequential loop semantics: break, try, or a nested geometry decision that models.
    const carried = body => {
      let c = false;
      walk(body, m => {
        if (m.kind === 'function' && m.lambda) return false;
        if (m.kind === 'break' || m.kind === 'try' || m.kind === 'tryExpression' || m.kind === 'while') c = true;
      });
      return c;
    };
    // Does a branch/loop body bind or return entity values (a host-side selection)?
    const selects = body => {
      let found = false;
      walk(body, m => {
        if (m.kind === 'function' && m.lambda) return false;
        if (m.kind === 'declaration' && m.value && (exprTaint(m.value, env) & TOPO)) found = true;
        if (m.kind === 'assign' && (exprTaint(m.value, env) & TOPO)) found = true;
        if (m.kind === 'return' && m.value && (exprTaint(m.value, env) & TOPO)) found = true;
      });
      return found;
    };
    // A geometry decision inside a non-sequential loop over evaluated entities is a filtered map.
    const inMap = parents => parents.some(pp => pp.kind === 'forIn' && (exprTaint(pp.values, env) & GEO) && !carried(pp.body));
    walk(fn.body, (n, parents) => {
      if (n.kind === 'function' && n !== fn && !n.lambda) return false;
      if (n.kind === 'if' || n.kind === 'conditional') {
        const bits = exprTaint(n.condition, env);
        if (bits & GEO) {
          const assert = n.kind === 'if' && !n.no && onlyThrows(n.yes);
          const isJump = st => st && (st.kind === 'continue' || st.kind === 'break' || (st.kind === 'block' && st.statements.length > 0 && st.statements.every(isJump)));
          const loopFilter = n.kind === 'if' && !n.no && isJump(n.yes);
          const sub = assert ? 'assert' : (bits & MEASURE) ? 'measure-decision' : isEmptinessCheck(n.condition, env) ? 'emptiness-guard' : 'topology-decision';
          record('geo-branch', sub, n, { inMap: inMap(parents), filter: loopFilter, pred: (bits & MEASURE) ? predKind(n.condition, env, defs) : null, modelingInBranch: containsModeling(n.yes) || containsModeling(n.no), geomOp: containsGeomOp(n.yes) || containsGeomOp(n.no), measure: !!(bits & MEASURE), selects: selects(n.yes) || selects(n.no) });
        } else if (bits & FAIL) record('failure-branch', 'try-result', n, {});
        else if (bits & META) record('meta-branch', n.kind === 'if' && !n.no && onlyThrows(n.yes) ? 'assert' : 'decision', n, {});
      }
      if (n.kind === 'while' || n.kind === 'forC') {
        // size(x) of a local array literal has a program-determined length.
        let staticSize = false;
        walk(n.condition, m => { if (m.kind === 'call' && calleeName(m) === 'size' && m.args[0]?.kind === 'name' && defs.get(m.args[0].name)?.kind === 'array') staticSize = true; });
        const bits = staticSize ? 0 : boundTaint(n.condition, env);
        if (bits & GEO) record('geo-iterate', n.kind === 'while' ? 'while-bound' : 'loop-bound', n, { modelingInBody: containsModeling(n.body), geomOp: containsGeomOp(n.body), selects: selects(n.body), carried: n.kind === 'while' || carried(n.body) });
      }
      if (n.kind === 'forIn') {
        const bits = exprTaint(n.values, env);
        if (bits & GEO) record('geo-iterate', 'entities', n, { modelingInBody: containsModeling(n.body), geomOp: containsGeomOp(n.body), measure: !!(bits & MEASURE), selects: selects(n.body), carried: carried(n.body) });
        else if (bits & META) record('meta-iterate', 'entities', n, {});
      }
      if (n.kind === 'try') {
        if (containsModeling(n.body)) {
          const handlerDoesWork = n.handler && n.handler.statements.length && !n.handler.statements.every(s => s.kind === 'throw');
          record('failure-branch', n.silent ? 'try-silent-block' : handlerDoesWork ? 'try-recover' : n.handler ? 'try-rethrow' : 'try-no-catch', n, { modelingInHandler: n.handler ? containsModeling(n.handler) : false });
        }
      }
      if (n.kind === 'call') {
        const name = calleeName(n);
        if (name && MODEL_OP(name)) {
          const bits = n.args.reduce((acc, a) => acc | exprTaint(a, env), 0);
          if (bits & GEO) record('geo-data', (bits & MEASURE) ? 'measure-param' : 'entity-selection', n, { op: name, measure: !!(bits & MEASURE), geomOp: !METADATA_OP(name) });
        }
      }
    });
  }

  const geoSourceCalls = [...callCounts.entries()].filter(([k]) => k.startsWith('call:') && GEO_SOURCE(k.slice(5))).reduce((a, [, v]) => a + v, 0);
  return {
    role, header: ast.header, version: ast.version,
    counts: {
      functions: localUserNames.size, features: featureRoots.length, evalLambdas: evalRoots.length, consts, enums, types, predicates, operators,
      lambdas, closures, recursion, unusedFunctions, geoSourceCalls,
      topLevelStatements: fragmentStatements.length,
    },
    imports,
    constructs: Object.fromEntries(constructs),
    calls: Object.fromEntries(callCounts),
    opParams: Object.fromEntries([...opParams].map(([k, v]) => [k, Object.fromEntries(v)])),
    sites,
    features: featureRoots.map(f => f.name),
    functionNames: [...localUserNames],
    geoFunctions: [...geoFns].filter(([, b]) => b & GEO).map(([k]) => k),
    loops: (() => {
      let total = 0; walk({ kind: 'block', statements: [...ast.declarations.map(d => d.value).filter(Boolean), ...ast.statements] }, n => { if (['forIn', 'forC', 'while'].includes(n.kind)) total++; });
      const geo = sites.filter(x => x.kind === 'geo-iterate').length;
      return { total, geometryDependent: geo };
    })(),
  };
}
