// Which native observations (scripts/acid/native-observation.mjs) the Rust
// host answers or refuses, per body family it builds. Generic synthetic
// bodies, no zone data: each case is FeatureScript plus probe points with
// closed-form distances. For every built body it asks measureRustBody for
// topology, a bbox in a rotated frame and the probes, sourceExtentsRustBody
// for construction extents, and toStep for the export; --step-roundtrip also
// reads the STEP back with OCCT (scripts/validate-step.py). A refusal is
// recorded by name; an answered probe is compared with its closed form and
// reported WRONG outside its bound, a mapped bbox with the world bbox.
// Consumer: the probe-coverage work that implements the refused cells; delete
// with native-observation.mjs.
// Usage: WONKY_BACKEND=rust node scripts/acid/observation-audit.mjs [--out dir] [--step-roundtrip] [--only name,...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, isMain} from './common.mjs';

const mm = v => `vector(${v.join(',')})*millimeter`;
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
${statements}
});`;
const body = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const box = (id, a, b) => `fCuboid(context,id+"${id}",{"corner1":${mm(a)},"corner2":${mm(b)}});`;
const cyl = (id, bottom, top, r) => `fCylinder(context,id+"${id}",{"bottomCenter":${mm(bottom)},"topCenter":${mm(top)},"radius":${r}*millimeter});`;
const sphere = (id, c, r) => `fSphere(context,id+"${id}",{"center":${mm(c)},"radius":${r}*millimeter});`;
const cut = (target, tools) => `opBoolean(context,id+"cut",{"targets":${body(target)},"tools":qUnion([${tools.map(body).join(',')}]),"operationType":BooleanOperationType.SUBTRACTION});`;
const join = (op, ids) => `opBoolean(context,id+"join",{"tools":qUnion([${ids.map(body).join(',')}]),"operationType":BooleanOperationType.${op}});`;
const polyline = points => `skPolyline(s,"p",{"points":[${[...points, points[0]].map(p => mm(p)).join(',')}]});`;
const line = (n, a, b) => `skLineSegment(s,"${n}",{"start":${mm(a)},"end":${mm(b)}});`;
const arc = (n, a, m, b) => `skArc(s,"${n}",{"start":${mm(a)},"mid":${mm(m)},"end":${mm(b)}});`;
// Sketch on the plane z = at (normal +z), extruded `depth` along +z.
const extrude = (id, at, entities, depth) => `{var s=newSketchOnPlane(context,id+"${id}s",{"sketchPlane":plane(${mm([0, 0, at])},vector(0,0,1),vector(1,0,0))});
${entities} skSolve(s);
opExtrude(context,id+"${id}",{"entities":qSketchRegion(id+"${id}s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${depth}*millimeter});
opDeleteBodies(context,id+"${id}d",{"entities":qCreatedBy(id+"${id}s",EntityType.BODY)});}`;
// Profile (x, z) on the XZ plane revolved about +z.
const revolve = (entities, degrees) => `{const cs=coordSystem(vector(0,0,0)*millimeter,vector(1,0,0),vector(0,0,1));
var s=newSketchOnPlane(context,id+"rs",{"sketchPlane":plane(cs.origin,-cross(cs.zAxis,cs.xAxis),cs.xAxis)});
${entities} skSolve(s);
opRevolve(context,id+"rev",{"entities":qSketchRegion(id+"rs",false),"axis":line(cs.origin,cs.zAxis),"angleForward":${degrees}*degree});
opDeleteBodies(context,id+"rd",{"entities":qCreatedBy(id+"rs",EntityType.BODY)});}`;
const edges = id => `qOwnedByBody(${body(id)},EntityType.EDGE)`;
const obround = [line('l1', [2, 0], [8, 0]), arc('a1', [8, 0], [10, 2], [8, 4]), line('l2', [8, 4], [2, 4]), arc('a2', [2, 4], [0, 2], [2, 0])].join(' ');
const r2 = Math.SQRT2;

// role: inside (material, 0), void (in a cut, inside the target), outside.
// extents: construction-frame extents in mm where the frame is the world's.
export const CASES = [
  {name: 'box', extents: [10, 8, 6], fs: box('a', [0, 0, 0], [10, 8, 6]),
    probes: [['inside', [5, 4, 3], 0], ['outside', [12, 4, 3], 2], ['outside', [5, 4, 9], 3], ['outside', [13, 4, 10], 5]]},
  {name: 'box-union', extents: [14, 8, 6], fs: box('a', [0, 0, 0], [10, 8, 6]) + box('b', [10, 0, 0], [14, 4, 6]) + join('UNION', ['a', 'b']),
    probes: [['inside', [12, 2, 3], 0], ['outside', [12, 6, 3], 2], ['outside', [2, 2, 8], 2]]},
  {name: 'polygon-prism', extents: [12, 9, 5], fs: extrude('e', 0, polyline([[0, 0], [12, 0], [0, 9]]), 5),
    probes: [['inside', [2, 2, 2], 0], ['outside', [8, 6, 2.5], 2.4], ['outside', [2, 2, 8], 3], ['outside', [-3, 2, -4], 5]]},
  {name: 'arc-prism', fs: extrude('e', 0, obround, 3),
    probes: [['inside', [5, 2, 1], 0], ['outside', [13, 2, 1.5], 3], ['outside', [5, 2, 5], 2], ['outside', [5, -1, 1], 1]]},
  {name: 'planar-boolean', fs: box('a', [0, 0, 0], [8, 8, 4]) + extrude('t', -1, polyline([[-1, -1], [4, -1], [-1, 4]]), 6) + cut('a', ['t']),
    probes: [['inside', [6, 6, 2], 0], ['outside', [0.5, 0.5, 2], r2], ['outside', [6, 6, 6], 2]]},
  {name: 'loft', fs: `const cs=coordSystem(vector(0,0,0)*millimeter,vector(1,0,0),vector(0,0,1));
{var s=newSketchOnPlane(context,id+"b",{"sketchPlane":plane(cs.origin,cs.zAxis,cs.xAxis)});
skRectangle(s,"r",{"firstCorner":vector(0,0)*millimeter,"secondCorner":vector(8,8)*millimeter}); skSolve(s);}
{var s=newSketchOnPlane(context,id+"t",{"sketchPlane":plane(toWorld(cs,vector(0,0,6)*millimeter),cs.zAxis,cs.xAxis)});
skRectangle(s,"r",{"firstCorner":vector(2,2)*millimeter,"secondCorner":vector(6,6)*millimeter}); skSolve(s);}
opLoft(context,id+"loft",{"profileSubqueries":[qSketchRegion(id+"b",false),qSketchRegion(id+"t",false)]});
opDeleteBodies(context,id+"db",{"entities":qCreatedBy(id+"b",EntityType.BODY)});
opDeleteBodies(context,id+"dt",{"entities":qCreatedBy(id+"t",EntityType.BODY)});`,
    probes: [['inside', [4, 4, 3], 0], ['outside', [4, 4, -2], 2], ['outside', [4, 4, 8], 2]]},
  {name: 'chamfer', fs: box('a', [0, 0, 0], [16, 12, 8]) + `opChamfer(context,id+"c",{"entities":qClosestTo(${edges('a')},${mm([8, 0, 0])}),"chamferType":ChamferType.EQUAL_OFFSETS,"width":2*millimeter});`,
    probes: [['inside', [8, 6, 4], 0], ['outside', [18, 6, 4], 2], ['outside', [8, -1, -1], 2 * r2]]},
  {name: 'fillet-edge', fs: box('a', [0, 0, 0], [16, 12, 8]) + `opFillet(context,id+"f",{"entities":qClosestTo(${edges('a')},${mm([16, 12, 4])}),"radius":2*millimeter});`,
    probes: [['inside', [8, 6, 4], 0], ['outside', [17, 13, 4], 3 * r2 - 2], ['outside', [8, 6, 10], 2]]},
  {name: 'fillet-corner', fs: box('a', [0, 0, 0], [16, 12, 8]) + `opFillet(context,id+"f",{"entities":qClosestTo(${edges('a')},${mm([0, 0, 0])}),"radius":4*millimeter});`,
    probes: [['inside', [8, 6, 4], 0], ['outside', [-1, -1, -1], 5 * Math.sqrt(3) - 4], ['outside', [18, 6, 4], 2]]},
  {name: 'rim-fillet', fs: extrude('e', 0, obround, 3) + `opFillet(context,id+"f",{"entities":qCoincidesWithPlane(${edges('e')},plane(${mm([0, 0, 3])},vector(0,0,1))),"radius":0.5*millimeter});`,
    probes: [['inside', [5, 2, 1], 0], ['outside', [5, 2, -1], 1], ['outside', [5, -1, 1], 1]]},
  {name: 'cylinder', extents: [10, 10, 10], fs: cyl('a', [0, 0, 0], [0, 0, 10], 5),
    probes: [['inside', [1, 1, 5], 0], ['outside', [8, 0, 5], 3], ['outside', [0, 0, 13], 3], ['outside', [8, 0, 14], 5]]},
  // Dyadic metres: the rim offset of a binary64 radius must stay representable.
  {name: 'chamfered-rim', extents: [500, 500, 500], fs: extrude('e', 0, `skCircle(s,"c",{"center":vector(0,0)*millimeter,"radius":250*millimeter});`, 500)
      + `opChamfer(context,id+"c",{"entities":qClosestTo(${edges('e')},${mm([-250, 0, 500])}),"chamferType":ChamferType.EQUAL_OFFSETS,"width":62.5*millimeter});`,
    probes: [['inside', [0, 0, 250], 0], ['outside', [0, 0, 600], 100], ['outside', [350, 0, 200], 100]]},
  {name: 'holes-box-through', extents: [10, 10, 4], fs: box('a', [0, 0, 0], [10, 10, 4]) + cyl('h', [5, 5, -1], [5, 5, 5], 2) + cut('a', ['h']),
    probes: [['inside', [1, 1, 1], 0], ['void', [5, 5.5, 2], 1.5], ['outside', [12, 5, 2], 2], ['outside', [5, 5, 5], Math.sqrt(5)], ['outside', [1, 1, 6], 2]]},
  {name: 'holes-polygon-blind', extents: [12, 9, 5], fs: extrude('e', 0, polyline([[0, 0], [12, 0], [0, 9]]), 5) + cyl('h', [3, 3, 2], [3, 3, 6], 1) + cut('e', ['h']),
    probes: [['inside', [8, 1, 1], 0], ['void', [3, 3.5, 4], 0.5], ['outside', [3, 3, 6], r2], ['outside', [3, 3, -1], 1], ['outside', [8, 6, 2.5], 2.4]]},
  {name: 'holes-arc-prism', fs: extrude('e', 0, obround, 3) + cyl('h', [2, 2, -1], [2, 2, 4], 1) + cut('e', ['h']),
    probes: [['inside', [5, 2, 1], 0], ['void', [2, 2.5, 1.5], 0.5], ['outside', [13, 2, 1.5], 3], ['outside', [2, 2, 4], r2]]},
  {name: 'holes-cylinder-offaxis', extents: [10, 10, 4], fs: cyl('a', [0, 0, 0], [0, 0, 4], 5) + cyl('h', [2, 0, 2], [2, 0, 5], 1) + cut('a', ['h']),
    probes: [['inside', [-2, 0, 2], 0], ['void', [2, 0.5, 3], 0.5], ['outside', [7, 0, 2], 2], ['outside', [2, 0, 4.5], Math.sqrt(1.25)]]},
  {name: 'holes-cells', extents: [20, 12, 10], fs: box('a', [0, 0, 0], [20, 12, 10]) + box('slot', [6, -1, 4], [14, 8, 7]) + cyl('h', [10, 5, -1], [10, 5, 11], 1.5) + cut('a', ['slot', 'h']),
    probes: [['inside', [2, 2, 2], 0], ['void', [10, 5.5, 2], 1], ['outside', [10, -1, 5.5], Math.sqrt(3.25)], ['outside', [9, 2, 4.5], 0.5], ['outside', [10, 5, 11], Math.sqrt(3.25)]]},
  {name: 'holes-pocket', extents: [20, 20, 6], fs: extrude('e', 0, polyline([[0, 0], [20, 0], [0, 20]]), 6) + extrude('p', 4, polyline([[2, 2], [8, 2], [2, 8]]), 3) + cut('e', ['p']),
    probes: [['inside', [15, 2, 2], 0], ['void', [3, 3, 5], 1], ['outside', [3, 3, 8], Math.sqrt(5)], ['outside', [10, -2, 3], 2]]},
  {name: 'coaxial', extents: [12, 12, 16], fs: cyl('a', [0, 0, 0], [0, 0, 16], 6) + cyl('h', [0, 0, -4], [0, 0, 20], 2) + cut('a', ['h']),
    probes: [['inside', [4, 0, 8], 0], ['void', [0, 1, 8], 1], ['outside', [9, 0, 8], 3], ['outside', [0, 0, 18], Math.sqrt(8)]]},
  {name: 'perforated', extents: [40, 30, 10], fs: box('a', [0, 0, 0], [40, 30, 10]) + cyl('z', [8, 8, -2], [8, 8, 12], 3) + cyl('y', [24, -2, 5], [24, 32, 5], 2) + cut('a', ['z', 'y']),
    probes: [['inside', [30, 20, 2], 0], ['void', [24, 15, 5.5], 1.5], ['outside', [-2, 15, 5], 2], ['outside', [8, 8, 11], Math.sqrt(10)]]},
  {name: 'revolve-ring', fs: revolve(`skRectangle(s,"r",{"firstCorner":vector(3,0)*millimeter,"secondCorner":vector(9,5)*millimeter});`, 360),
    probes: [['inside', [6, 0, 2.5], 0], ['void', [0, 0, 2.5], 3], ['outside', [11, 0, 2.5], 2], ['outside', [6, 0, 7], 2]]},
  {name: 'revolve-stepped', fs: revolve(polyline([[0, 0], [6, 0], [6, 4], [3, 4], [3, 10], [0, 10]]), 360),
    probes: [['inside', [0, 0, 5], 0], ['outside', [8, 0, 2], 2], ['outside', [0, 0, 12], 2], ['outside', [5, 0, 5], 1]]},
  {name: 'torus', fs: revolve(`skCircle(s,"c",{"center":vector(10,0)*millimeter,"radius":2*millimeter});`, 360),
    probes: [['inside', [10, 0, 0], 0], ['void', [0, 0, 0], 8], ['outside', [13, 0, 0], 1]]},
  {name: 'revolve-sector', fs: revolve(`skRectangle(s,"r",{"firstCorner":vector(3,0)*millimeter,"secondCorner":vector(9,5)*millimeter});`, 90),
    // Only points in the start plane y = 0 have a direction-independent answer.
    probes: [['outside', [11, 0, 2.5], 2], ['outside', [6, 0, 7], 2]]},
  {name: 'sphere', fs: sphere('a', [0, 0, 0], 5), probes: [['inside', [1, 1, 1], 0], ['outside', [8, 0, 0], 3]]},
  {name: 'lens', fs: sphere('a', [0, 0, 0], 5) + sphere('b', [6, 0, 0], 5) + join('INTERSECTION', ['a', 'b']),
    probes: [['inside', [3, 0, 0], 0], ['outside', [3, 0, 5], 1], ['outside', [-1, 0, 0], 2]]},
  // Bore radius 3 meets the radius-5 sphere at the rational height 4.
  {name: 'sphere-bore', fs: sphere('a', [0, 0, 0], 5) + cyl('h', [0, 0, -6], [0, 0, 6], 3) + cut('a', ['h']),
    probes: [['inside', [4, 0, 0], 0], ['void', [0, 0, 0], 3], ['outside', [8, 0, 0], 3]]},
  {name: 'bicylinder', extents: [10, 10, 10], fs: cyl('a', [-20, 0, 0], [20, 0, 0], 5) + cyl('b', [0, -20, 0], [0, 20, 0], 5) + join('INTERSECTION', ['a', 'b']),
    probes: [['inside', [0, 0, 0], 0], ['outside', [0, 0, 7], 2]]},
];

// Rotated frame given as data, as native-observation passes a zone frame:
// local = (y, -x, z). Its bbox is the world bbox with permuted axes.
const MAP = [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0]];
const permuted = b => ({min: [b.min[1], -b.max[0], b.min[2]], max: [b.max[1], -b.min[0], b.max[2]]});
const refusal = e => e?.reason ?? String(e?.message ?? e).split('\n')[0];
const close = (a, b, slack) => Math.abs(a - b) <= slack;

export async function auditCase(c, {out, roundTrip}) {
  const {build} = await import('../../src/index.mjs');
  const {toStep} = await import('../../src/exporters.mjs');
  const {serializeModel} = await import('../../src/construction-history.mjs');
  const rust = await import('../../src/native/rust-host.mjs');
  const row = {name: c.name, family: null, cells: {}, details: {}};
  let model;
  try { model = await build(source(c.fs), {feature: 'f'}); }
  catch (e) { row.cells.build = `REFUSED ${refusal(e)}`; return row; }
  if (model.bodies.length !== 1) { row.cells.build = `BODIES ${model.bodies.length}`; return row; }
  row.cells.build = 'ok';
  const kernel = rust.rustModelKernel(model), [b] = model.bodies;
  row.family = b.validation?.certificate ?? null;
  let m;
  try { m = rust.measureRustBody(kernel, b, {map: MAP, probes: c.probes.map(p => p[1])}); }
  catch (e) { for (const k of ['topology', 'mappedBbox', 'inside', 'void', 'outside']) row.cells[k] = `REFUSED ${refusal(e)}`; }
  if (m) {
    row.family = m.certificate ?? row.family;
    const t = m.topology;
    row.cells.topology = t && Number.isInteger(t.faces) ? 'ok' : 'MISSING';
    row.details.topology = t && `F${t.faces} E${t.edges} V${t.vertices} g${t.genus}`;
    const scale = Math.max(1, ...['min', 'max'].flatMap(s => m.bboxMm[s].map(Math.abs)));
    const want = permuted(m.bboxMm), got = m.mappedBboxMm;
    row.cells.mappedBbox = !got ? 'MISSING' : ['min', 'max'].every(s => want[s].every((x, i) => close(x, got[s][i], 1e-9 * scale))) ? 'ok' : 'MISMATCH';
    const byRole = {};
    c.probes.forEach(([role, point, expected], i) => {
      const p = m.probes[i];
      let verdict;
      if (p.refused) verdict = `REFUSED ${p.refused}`;
      else if (expected === 0 ? p.inside === true && p.distanceMm === 0
        : p.inside === false && close(p.distanceMm, expected, (p.boundMm ?? 0) + 1e-9 * Math.max(1, expected))) verdict = 'ok';
      else verdict = `WRONG ${p.inside ? 'inside' : p.distanceMm} != ${expected}`;
      row.details[`${role} ${point.join(',')}`] = verdict;
      (byRole[role] ??= []).push(verdict);
    });
    for (const role of ['inside', 'void', 'outside']) {
      const v = byRole[role];
      row.cells[role] = !v ? '-' : v.find(x => x.startsWith('WRONG')) ?? v.find(x => x.startsWith('REFUSED')) ?? 'ok';
    }
  }
  try {
    const e = row.details.extentsMm = rust.sourceExtentsRustBody(kernel, b);
    row.cells.extents = !c.extents || c.extents.every((x, i) => close(e[i], x, 1e-9 * x)) ? 'ok' : `WRONG ${e} != ${c.extents}`;
  }
  catch (e) { row.cells.extents = `REFUSED ${refusal(e)}`; }
  let step;
  try { step = toStep(model, c.name); row.cells.step = 'ok'; }
  catch (e) { row.cells.step = `REFUSED ${refusal(e)}`; }
  if (roundTrip && step) {
    const prefix = path.join(out, c.name);
    fs.writeFileSync(prefix + '.step', step);
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
    const run = spawnSync('uv', ['run', path.join(ROOT, 'scripts/validate-step.py'), prefix], {cwd: ROOT, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 << 20});
    const lines = `${run.stderr ?? ''}`.trim().split('\n');
    row.cells.occt = run.status === 0 && JSON.parse(run.stdout)[0]?.valid === true ? 'ok'
      : `FAILED ${lines.findLast(l => /Error|error/.test(l)) ?? lines.at(-1) ?? run.error?.message}`;
  }
  return row;
}

const COLUMNS = ['build', 'topology', 'mappedBbox', 'extents', 'inside', 'void', 'outside', 'step', 'occt'];
export function table(rows) {
  const lines = [['case', 'family', ...COLUMNS].join(' | ')];
  for (const r of rows) lines.push([r.name, r.family ?? '-', ...COLUMNS.map(k => r.cells[k] ?? '-')].join(' | '));
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  if (process.env.WONKY_BACKEND !== 'rust') throw new Error('STRICT_RUST_REQUIRED: run with WONKY_BACKEND=rust');
  const args = process.argv.slice(2), value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const out = path.resolve(value('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-observation-audit-')));
  const only = value('--only')?.split(',');
  fs.mkdirSync(out, {recursive: true});
  const rows = [];
  for (const c of CASES.filter(c => !only || only.includes(c.name))) {
    rows.push(await auditCase(c, {out, roundTrip: args.includes('--step-roundtrip')}));
    fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(rows, null, 2) + '\n');
  }
  console.log(table(rows));
  const wrong = rows.filter(r => Object.values(r.cells).some(v => /^(WRONG|MISMATCH)/.test(v)));
  if (wrong.length) { console.error(`WRONG observations in: ${wrong.map(r => r.name).join(', ')}`); process.exitCode = 1; }
}
