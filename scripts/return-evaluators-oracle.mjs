// Export the frozen revolve and local-box fixture, with actual evaluator
// observations, for independent OCCT checking. No live CAD or Onshape calls.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ModelingContext, loadModelingServices } from '../src/library.mjs';
import { loadKernel } from '../src/kernel.mjs';
import { Interpreter } from '../src/interpreter.mjs';
import { parse } from '../src/parser.mjs';
import { Id, Vector, Quantity, map, tagged, vectorNumbers } from '../src/values.mjs';
import { TopologyQuery } from '../src/queries.mjs';
import { toStep } from '../src/exporters.mjs';
import { hubSource, boxSource } from '../fixtures/return-evaluators/models.mjs';

const out = resolve(process.argv[2] ?? 'out/return-evaluators/oracle');
mkdirSync(out, { recursive: true });
const results = {};
const { version } = JSON.parse(readFileSync(new URL('../bend.lock.json', import.meta.url)));
for (const [name, source] of Object.entries({ hub: hubSource, box: boxSource })) {
  const engine = new ModelingContext(await loadKernel(), { services: await loadModelingServices() });
  const interpreter = new Interpreter(engine.builtins());
  interpreter.run(parse(source), 'main', engine.context, new Id(['oracle']), map({}));
  writeFileSync(resolve(out, `${name}.step`), toStep({ bodies: engine.bodies, backend: { version } }, name));
  const all = new TopologyQuery('allSolid');
  const call = (name, definition) => engine.builtins()[name].call([engine.context, map(definition)]);
  if (name === 'hub') {
    const rings = interpreter.call(interpreter.global.get('selectHub'), [engine.context, all], null);
    results.rings = rings.map(edge => {
      const curve = call('evCurveDefinition', { edge });
      return { center: vectorNumbers(curve.coordSystem.origin, 1, 3), radius: curve.radius.value * 1000,
        x: curve.coordSystem.xAxis.items, normal: curve.coordSystem.zAxis.items,
        samples: [0, 0.25, 0.5, 1].map(parameter => {
          const t = call('evEdgeTangentLine', { edge, parameter });
          return { parameter, point: vectorNumbers(t.origin, 1, 3), direction: t.direction.items };
        }) };
    });
  } else {
    results.boxes = [[1, 0, 0], [0, 1, 0]].map(x => {
      const origin = [10, 0, 0], z = [0, 0, 1];
      const cSys = tagged(map({ origin: new Vector(origin.map(v => new Quantity(v / 1000))), xAxis: new Vector(x), zAxis: new Vector(z) }), 'CoordSystem');
      const b = call('evBox3d', { topology: all, cSys });
      return { origin, x, z, min: vectorNumbers(b.minCorner, 1, 3), max: vectorNumbers(b.maxCorner, 1, 3) };
    });
  }
}
writeFileSync(resolve(out, 'observations.json'), JSON.stringify(results, null, 2) + '\n');
console.log(out);
