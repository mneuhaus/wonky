// wonky-graph/0 -> FeatureScript. Emits one straight-line feature in the SSA
// style of Marc's generated FS files (cad-project-028/sorter.fs, Trace):
// every graph node becomes one op* call whose id is the node's stable id, and
// every body reference is qCreatedBy(id + "<node>", EntityType.BODY).
//
// Purpose: one WPy source can reach Onshape (paste the feature) and wonky's own
// FeatureScript frontend. The emitter covers the ops wonky's FS subset
// executes; anything else is a capability error at the node's span, never a
// silently different model.

import { WpyError } from './values.mjs';

const OFFSET = { MIN: 0, CENTER: 0.5, MAX: 1, NONE: 0 };
const fsNum = x => {
  if (!Number.isFinite(x)) throw new Error(`non-finite number ${x}`);
  return Object.is(x, -0) ? '0' : String(x);
};
const vec = (v, unit = ' * millimeter') => `vector(${v.map(fsNum).join(', ')})${unit}`;
const fsId = id => id.replace(/[^A-Za-z0-9_]/g, '_');

export function emitFeatureScript(graph, { feature = 'wpyPart', title = 'WPy part', version = 3000 } = {}) {
  const lines = [];
  const query = new Map();     // node index -> FS query text for its body
  const boxes = new Map();     // node index -> {lo, hi} for box / translated box
  const profiles = new Map();  // sketch node index -> {frame, points}
  const cap = (n, what) => { throw new WpyError('capability', `FeatureScript emitter: ${what} (node ${n.id})`, n.span); };
  const q = id => `qCreatedBy(id + "${id}", EntityType.BODY)`;
  const needed = graph.cone(graph.outputs.map(o => o.node));
  const bodyNodes = new Set();
  for (const i of needed) {
    const n = graph.nodes[i], p = n.params;
    switch (n.op) {
      case 'box': {
        const lo = p.size.map((s, k) => -s * OFFSET[p.align[k]]);
        boxes.set(i, { lo, hi: lo.map((v, k) => v + p.size[k]) });
        break;
      }
      case 'move': {
        const src = n.inputs[0];
        const isT = p.rows.every((r, a) => r.every((v, b) => v === (a === b ? 1 : 0)));
        if (n.kind === 'sketch') {
          const pr = profiles.get(src) ?? cap(n, 'placement of a non-polygon sketch');
          profiles.set(i, { ...pr, frame: compose(p, pr.frame) });
        } else if (boxes.has(src) && isT) {
          const b = boxes.get(src);
          boxes.set(i, { lo: b.lo.map((v, k) => v + p.offset[k]), hi: b.hi.map((v, k) => v + p.offset[k]) });
        } else cap(n, 'rigid transform of a general body (opTransform is not in the executed FS subset)');
        break;
      }
      case 'polygon': case 'rectangle': {
        let pts;
        if (n.op === 'rectangle') {
          const [w, h] = p.size, x0 = -w * OFFSET[p.align[0]], y0 = -h * OFFSET[p.align[1]];
          pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
        } else {
          const lo = [0, 1].map(k => Math.min(...p.points.map(q => q[k]))), hi = [0, 1].map(k => Math.max(...p.points.map(q => q[k])));
          const sh = [0, 1].map(k => p.align[k] === 'NONE' ? 0 : -(lo[k] + (hi[k] - lo[k]) * OFFSET[p.align[k]]));
          pts = p.points.map(q => [q[0] + sh[0], q[1] + sh[1]]);
        }
        profiles.set(i, { points: pts, frame: { rows: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], offset: [0, 0, 0] } });
        break;
      }
      case 'extrude': {
        const pr = profiles.get(n.inputs[0]) ?? cap(n, 'extrusion of this sketch');
        if (p.both) cap(n, 'symmetric extrusion (both=True)');
        const R = pr.frame.rows, normal = [R[0][2], R[1][2], R[2][2]], x = [R[0][0], R[1][0], R[2][0]];
        const sid = `${fsId(n.id)}_sketch`;
        lines.push(`    var ${sid} = newSketchOnPlane(context, id + "${sid}", { "sketchPlane" : plane(${vec(pr.frame.offset)}, ${vec(normal, '')}, ${vec(x, '')}) });`);
        lines.push(`    skPolyline(${sid}, "profile", { "points" : [${[...pr.points, pr.points[0]].map(q => vec(q)).join(', ')}] });`);
        lines.push(`    skSolve(${sid});`);
        const dir = p.amount < 0 ? normal.map(v => -v) : normal;
        lines.push(`    opExtrude(context, id + "${fsId(n.id)}", { "entities" : qSketchRegion(id + "${sid}"), "direction" : ${vec(dir, '')}, "endBound" : BoundingType.BLIND, "endDepth" : ${fsNum(Math.abs(p.amount))} * millimeter });`);
        query.set(i, q(fsId(n.id)));
        bodyNodes.add(i);
        break;
      }
      case 'union': case 'subtract': case 'intersect': {
        const [a, b] = n.inputs.map(k => materialize(k));
        const op = { union: 'UNION', subtract: 'SUBTRACTION', intersect: 'INTERSECTION' }[n.op];
        const args = n.op === 'subtract' ? `"targets" : ${a}, "tools" : ${b}` : `"tools" : qUnion([${a}, ${b}])`;
        lines.push(`    opBoolean(context, id + "${fsId(n.id)}", { ${args}, "operationType" : BooleanOperationType.${op} });`);
        query.set(i, q(fsId(n.id)));
        bodyNodes.add(i);
        break;
      }
      default: cap(n, `operation '${n.op}'`);
    }
  }
  function materialize(i) {
    if (query.has(i)) return query.get(i);
    const n = graph.nodes[i];
    const b = boxes.get(i) ?? cap(n, 'body kind');
    lines.push(`    fCuboid(context, id + "${fsId(n.id)}", { "corner1" : ${vec(b.lo)}, "corner2" : ${vec(b.hi)} });`);
    query.set(i, q(fsId(n.id)));
    return query.get(i);
  }
  for (const o of graph.outputs) {
    materialize(o.node);
    lines.push(`    setProperty(context, { "entities" : ${query.get(o.node)}, "propertyType" : PropertyType.NAME, "value" : ${JSON.stringify(o.name)} });`);
  }
  return [
    `FeatureScript ${version};`,
    `import(path : "onshape/std/geometry.fs", version : "${version}.0");`,
    '',
    `// Generated by wonky WPy from ${graph.file} (wonky-graph/0). One op per graph node; ids are the stable node ids.`,
    `annotation { "Feature Type Name" : ${JSON.stringify(title)} }`,
    `export const ${feature} = defineFeature(function(context is Context, id is Id, definition is map)`,
    '    precondition {}',
    '    {',
    ...lines,
    '    });',
    '',
  ].join('\n');
}

function compose(p, f) {
  const R = p.rows, S = f.rows;
  const rows = [0, 1, 2].map(a => [0, 1, 2].map(b => R[a][0] * S[0][b] + R[a][1] * S[1][b] + R[a][2] * S[2][b]));
  const offset = [0, 1, 2].map(a => R[a][0] * f.offset[0] + R[a][1] * f.offset[1] + R[a][2] * f.offset[2] + p.offset[a]);
  return { rows, offset };
}
