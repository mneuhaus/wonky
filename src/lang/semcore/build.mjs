// FeatureScript -> WCore/0 -> JS reference evaluator, with the same inputs,
// kernel, modeling library, module resolver and output schema as
// src/index.mjs build(). Used to test the semantic-core claim that wonky's
// FS frontend reduces to the core IR without changing any geometry.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fail } from '../../errors.mjs';
import { parse, parseExpression } from '../../parser.mjs';
import { loadKernel, precisionForBodies } from '../../kernel.mjs';
import { ModelingContext } from '../../library.mjs';
import { Id, map } from '../../values.mjs';
import { frozenModules } from '../../modules.mjs';
import { sourceTracker } from '../../source-map.mjs';
import { desugarProgram, desugarExpression } from './desugar-fs.mjs';
import { CoreEvaluator } from './eval.mjs';

export async function buildCore(source, { feature, parameters = {}, id = 'model', maxSteps, moduleManifest, sourcePath = null,
  trace = true, modelingPolicy, transactions = true } = {}) {
  const t0 = performance.now();
  const ast = parse(source);
  const t1 = performance.now();
  const program = desugarProgram(ast);
  const t2 = performance.now();
  const kernel = await loadKernel(), engine = new ModelingContext(kernel, { modelingPolicy });
  const moduleResolver = moduleManifest ? frozenModules(moduleManifest, source,
    () => new ModelingContext(kernel, { modelingPolicy: engine.modelingPolicy })) : undefined;
  const tracker = trace ? sourceTracker(engine, source, ast, { sourcePath }) : null;
  const evaluator = new CoreEvaluator(engine.builtins(), { engine, maxSteps, moduleResolver, callObserver: tracker?.observer, transactions });
  const definition = () => {
    const result = map({});
    for (const [name, expression] of Object.entries(parameters)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`Invalid parameter name '${name}'`);
      if (typeof expression !== 'string') fail('Parameter values must be FeatureScript expression strings');
      result[name] = evaluator.evaluate(desugarExpression(parseExpression(expression), program.spans), evaluator.root);
    }
    return result;
  };
  let selected;
  const t3 = performance.now();
  try {
    selected = evaluator.run(program, feature, engine.context, new Id([id]), definition);
    if (!engine.bodies.length) fail('The feature produced no solid bodies');
  } catch (error) {
    if (tracker) error.modelTrace = tracker.report();
    error.completedOperationEvidence = [...engine.operationEvidence, ...(error.operationEvidence ?? [])];
    error.coreStats = { ...evaluator.stats, steps: evaluator.steps };
    throw error;
  }
  const t4 = performance.now();
  const { version } = JSON.parse(readFileSync(new URL('../../../bend.lock.json', import.meta.url), 'utf8'));
  return {
    schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version, target: 'JavaScript', precision: precisionForBodies(engine.bodies) },
    source: { language: 'FeatureScript', version: ast.version, feature: selected, imports: ast.imports, via: 'wonky-core/0' },
    modelingPolicy: engine.modelingPolicy, operationEvidence: [...engine.operationEvidence],
    ...(tracker ? { sourceMap: tracker.report() } : {}),
    bodies: engine.bodies,
    core: { stats: { ...evaluator.stats, steps: evaluator.steps }, timingsMs: { parse: t1 - t0, desugar: t2 - t1, evaluate: t4 - t3 } },
  };
}
