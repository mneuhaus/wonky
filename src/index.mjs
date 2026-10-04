import { readFileSync } from 'node:fs';
import { fail } from './errors.mjs';
import { parse, parseExpression } from './parser.mjs';
import { Interpreter } from './interpreter.mjs';
import { loadKernel, precisionForBodies } from './kernel.mjs';
import { settleExactness } from './exactness.mjs';
import { backendInfo, selectBackend, withoutBend } from './native/backend.mjs';
import { ModelingContext, loadModelingServices } from './library.mjs';
import { Id, map } from './values.mjs';
import { frozenModules } from './modules.mjs';
import { sourceTracker } from './source-map.mjs';
import { fsOutput } from './fs-output.mjs';
import { bindRustModel, isRustBody, importStepReferenceBodies } from './native/rust-host.mjs';

// onWarning receives non-fatal findings about the source that leave the build
// unchanged, such as a defineFeature defaults-map value that a dialog default
// shadows (Interpreter.reportShadowedDefaults).
export async function build(source, { feature, parameters = {}, id = 'model', maxSteps, moduleManifest, sourcePath = null, trace = true, modelingPolicy, diagnosticsDirectory, onWarning } = {}) {
  if (/\.(step|stp)$/i.test(sourcePath ?? '')) {
    if (selectBackend() !== 'rust') fail('STEP reference import requires WONKY_BACKEND=rust');
    const kernel = await loadKernel();
    const model = { schema: 'wonky-brep/1', units: 'millimeter',
      backend: { language: 'Rust', ...backendInfo(kernel) },
      source: { language: 'STEP', version: null, feature: null, imports: [] },
      operationEvidence: [], bodies: importStepReferenceBodies(kernel, source) };
    bindRustModel(model, kernel);
    return model;
  }
  const program = parse(source);
  // The modeling services (Bend JS face/solid classifiers and edge-plane for
  // qContainsPoint, qCoincidesWithPlane, qClosestTo and qParallelEdges; the
  // production fillet for opFillet/opChamfer and for the coplanar-fragment
  // regions qAdjacent reads) are loaded once per process and cached by the Bend
  // loader. They are loaded only where they can be used: never on the native
  // backend, which must not load the Bend JS target (docs/native-bridge.md 5.2),
  // and only when the source names one of those builtins or frozen modules may.
  // Without them the builtins refuse with an explicit capability error.
  const wantsServices = !withoutBend(selectBackend()) && (moduleManifest !== undefined || /\b(qContainsPoint|qAdjacent|qCoincidesWithPlane|qClosestTo|qParallelEdges|evCurveDefinition|evEdgeTangentLine|evBox3d|opFillet|opChamfer)\b/.test(source));
  const kernel = await loadKernel(), services = wantsServices ? await loadModelingServices(kernel) : null;
  const engine = new ModelingContext(kernel, { modelingPolicy, services, output: fsOutput(sourcePath, diagnosticsDirectory) });
  const tracker = trace ? sourceTracker(engine, source, program, {sourcePath}) : null;
  const interpreter = new Interpreter(engine.builtins(), { maxSteps, callObserver:tracker?.observer, onWarning });
  interpreter.moduleResolver = moduleManifest ? frozenModules(moduleManifest, source,
    () => new ModelingContext(kernel, { modelingPolicy: engine.modelingPolicy, services }),
    { executionBudget: interpreter.executionBudget, onWarning }) : undefined;
  const definition = () => {
    const result = map({});
    for (const [name, expression] of Object.entries(parameters)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`Invalid parameter name '${name}'`);
      if (typeof expression !== 'string') fail('Parameter values must be FeatureScript expression strings');
      result[name] = interpreter.expression(parseExpression(expression));
    }
    return result;
  };
  let selected;
  try {
    selected = interpreter.run(program, feature, engine.context, new Id([id]), definition);
    if (!engine.bodies.length) fail('The feature produced no solid bodies');
  }
  catch (error) {
    if (tracker) error.modelTrace = tracker.report();
    error.completedOperationEvidence = [...engine.operationEvidence, ...(error.operationEvidence ?? [])];
    throw error;
  }
  // Labels that depend on metadata attached after extrusion (an F32 line-sketch
  // profile, src/exactness.mjs) are written before the model is returned.
  // A model of Rust WC0 bodies (strict rust) carries no Bend label: its
  // geometry is binary64 source-frame values, exported through the frame.
  const rust = engine.bodies.some(isRustBody);
  if (!rust) for (const body of engine.bodies) settleExactness(body);
  const { version } = JSON.parse(readFileSync(new URL('../bend.lock.json', import.meta.url), 'utf8'));
  const backend = rust ? { language: 'Rust', ...backendInfo(kernel), precision: 'binary64 source frame (E9); world coordinates correctly rounded at export' }
    : { language: 'Bend', version, ...backendInfo(kernel), precision: precisionForBodies(engine.bodies) };
  const model = {
    schema: 'wonky-brep/1', units: 'millimeter', backend,
    source: { language: 'FeatureScript', version: program.version, feature: selected, imports: program.imports },
    modelingPolicy: engine.modelingPolicy, operationEvidence: [...engine.operationEvidence],
    ...(tracker ? {sourceMap:tracker.report()} : {}),
    bodies: engine.bodies,
  };
  if (rust) {
    bindRustModel(model, kernel);
    if (engine.modelingPolicy.curvedContacts === 'tolerated-regularized') {
      const merges = engine.operationEvidence.flatMap(e => e.regularization?.merges ?? []);
      model.regularization = {mode:'tolerated-regularized', capMm:engine.modelingPolicy.contactCapMm,
        label:merges.length ? 'regularized' : 'exact', exact:merges.length === 0, merges};
    }
  }
  return model;
}
