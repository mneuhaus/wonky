// S3 of the decision spike, adopted in K0 (docs/rust-migration.md 6): compares
// the Rust port's result of every frozen planar-Boolean call
// (fixtures/rust/planar-spike, freeze.mjs) with the Bend JS kernel's result.
// Checks: accept/refuse (status, reason, stage, detail), stats, per body the
// topology (vertex/edge/face/loop counts, every edge's endpoint ids, every
// loop's uses), face and edge origins, domains, volume, bounding box, and
// every vertex coordinate within VERTEX_TOL. The Rust binary comes only from
// the stale-checked build cache (scripts/rust/build-key.mjs openRustArtifact).
//   node scripts/rust/planar-spike/compare.mjs [--variant plant --plant-env flip|vertex] [--post-plant vertex|flip] [--threads N] [--propagate]
// --plant-env: the spike's in-code planted negatives (PLANT=..., needs the plant build);
// --post-plant: perturb the Rust output after the run (the spike's --plant).
// Exit 1 when any call differs. Writes tmp/rust/planar-spike/compare-<label>.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { openRustArtifact } from '../build-key.mjs';
import { fixtures, root, work } from './workloads.mjs';

export const VERTEX_TOL = 1e-9; // mm, absolute, per coordinate
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const list = x => { const out = []; while (x && x.$ === 'Con') { out.push(x.head); x = x.tail; } return out; };
const real = r => {
  if (!r || typeof r.hi !== 'number' || !Number.isFinite(r.hi) || typeof r.lo !== 'number' || !Number.isFinite(r.lo)) throw new Error('invalid Bend Real words');
  const value = r.hi + r.lo;
  if (!Number.isFinite(value)) throw new Error('invalid Bend Real sum');
  return value;
};
const vec = v => [real(v.x), real(v.y), real(v.z)];
const ref = r => [r.operand, r.index];

// Bend decoded reply -> the plain schema the Rust binary writes (wire.rs result_json)
export function plainBend(r) {
  const stats = ({ planes, cells, selected_cells, shared_vertices, boundary_faces, internal_interfaces }) => ({ planes, cells, selected_cells, shared_vertices, boundary_faces, internal_interfaces });
  if (r.$ === 'Unresolved') return { status: 'Unresolved', reason: r.reason.$, stage: r.stage, detail: r.detail, stats: stats(r.stats) };
  return {
    status: 'Bodies', stats: stats(r.stats),
    bodies: list(r.bodies).map(b => ({
      solid: {
        vertices: list(b.solid.vertices).map(vec),
        edges: list(b.solid.edges).map(e => ({ start: e.start, end: e.end, sense: e.same_sense, ...(e.curve.$ === 'Line' ? { origin: vec(e.curve.origin), direction: vec(e.curve.direction) } : { round: true }) })),
        faces: list(b.solid.faces).map(f => ({ surface: f.surface.$ === 'Plane' ? { origin: vec(f.surface.origin), normal: vec(f.surface.normal), x: vec(f.surface.x) } : null, sense: f.same_sense,
          loops: list(f.loops).map(l => ({ outer: l.outer, uses: list(l.uses).map(u => [u.edge, u.forward]) })) })),
      },
      domains: list(b.domains).map(d => d.$ === 'AutoDomain' ? 'auto' : d.domain.$ === 'Untrimmed' ? 'untrimmed' : [real(d.domain.first), real(d.domain.last)]),
      face_origins: list(b.face_origins).map(o => ({ owner: ref(o.owner), contributors: list(o.contributors).map(ref) })),
      edge_origins: list(b.edge_origins).map(o => o.$ === 'OriginalEdge' ? { original: [o.operand, o.index] } : o.$ === 'FaceIntersection' ? { intersection: [ref(o.first), ref(o.second)] } : { subdivision: list(o.faces).map(ref) }),
    })),
  };
}

// Six times the signed volume from the loops (fan per face about vertex 0).
export function volume(solid) {
  const v = solid.vertices, ref0 = v[0];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let total = 0;
  for (const f of solid.faces) for (const l of f.loops) {
    const ids = l.uses.map(([e, fwd]) => fwd ? solid.edges[e].start : solid.edges[e].end);
    for (let i = 1; i + 1 < ids.length; i++) total += dot(sub(v[ids[0]], ref0), cross(sub(v[ids[i]], ref0), sub(v[ids[i + 1]], ref0)));
  }
  return total / 6;
}
const bbox = vs => vs.reduce(([lo, hi], p) => [lo.map((x, i) => Math.min(x, p[i])), hi.map((x, i) => Math.max(x, p[i]))], [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// This replay supports analytic LINE edges and PLANE surfaces only. A lossy
// round:true/null carrier is not a geometry variant we can certify. Validate
// BOTH sides before any arithmetic: JSON null is how the Rust writer reports
// non-finite floats, and JS would otherwise coerce null to an innocent zero.
function validateResult(result) {
  const need = (ok, path) => { if (!ok) throw new Error(`invalid ${path}`); };
  const object = (x, keys, path) => need(x !== null && typeof x === 'object' && !Array.isArray(x)
    && same(Object.keys(x).sort(), [...keys].sort()), path);
  const array = (x, path, length) => need(Array.isArray(x) && (length === undefined || x.length === length), path);
  const number = (x, path) => need(typeof x === 'number' && Number.isFinite(x), path);
  const integer = (x, path, upper = Infinity) => need(Number.isSafeInteger(x) && x >= 0 && x < upper, path);
  const bool = (x, path) => need(typeof x === 'boolean', path);
  const vector = (x, path, nonzero = false) => {
    array(x, path, 3); x.forEach(v => number(v, path));
    if (nonzero) need(x.some(v => v !== 0), `${path} (zero axis)`);
  };
  const reference = (r, path) => { array(r,path,2); integer(r[0],path,2); integer(r[1],path); };
  need(result?.status === 'Bodies' || result?.status === 'Unresolved' || result?.status === 'Undecidable', 'status');
  const keys = result.status === 'Bodies' ? ['status','stats','bodies']
    : result.status === 'Unresolved' ? ['status','stats','reason','stage','detail'] : ['status','stats','site'];
  object(result,keys,'result');
  object(result.stats,['planes','cells','selected_cells','shared_vertices','boundary_faces','internal_interfaces'],'stats');
  for (const [key,value] of Object.entries(result.stats)) integer(value,`stats.${key}`);
  if (result.status === 'Unresolved') {
    need(typeof result.reason === 'string' && result.reason.length > 0,'reason');
    integer(result.stage,'stage'); integer(result.detail,'detail'); return;
  }
  if (result.status === 'Undecidable') { need(typeof result.site === 'string' && result.site.length > 0,'site'); return; }
  array(result.bodies,'bodies');
  result.bodies.forEach((b,i) => {
    const path=`bodies[${i}]`;
    object(b,['solid','domains','face_origins','edge_origins'],path);
    object(b.solid,['vertices','edges','faces'],`${path}.solid`);
    const {vertices,edges,faces}=b.solid;
    for (const [key,values] of Object.entries(b.solid)) { array(values,`${path}.${key}`); need(values.length>0,`${path}.${key} empty`); }
    vertices.forEach(v=>vector(v,`${path}.vertex`));
    edges.forEach(e=>{
      object(e,['start','end','sense','origin','direction'],`${path}.edge`);
      integer(e.start,`${path}.start`,vertices.length); integer(e.end,`${path}.end`,vertices.length);
      bool(e.sense,`${path}.edge.sense`); vector(e.origin,`${path}.edge.origin`); vector(e.direction,`${path}.edge.direction`,true);
    });
    faces.forEach(f=>{
      object(f,['surface','sense','loops'],`${path}.face`); bool(f.sense,`${path}.face.sense`);
      object(f.surface,['origin','normal','x'],`${path}.surface`);
      vector(f.surface.origin,`${path}.surface.origin`); vector(f.surface.normal,`${path}.surface.normal`,true); vector(f.surface.x,`${path}.surface.x`,true);
      array(f.loops,`${path}.loops`); need(f.loops.length>0,`${path}.loops empty`);
      f.loops.forEach(l=>{
        object(l,['outer','uses'],`${path}.loop`); bool(l.outer,`${path}.outer`); array(l.uses,`${path}.uses`);
        need(l.uses.length>=3,`${path}.uses too short`);
        l.uses.forEach(u=>{array(u,`${path}.use`,2); integer(u[0],`${path}.use.edge`,edges.length); bool(u[1],`${path}.use.forward`);});
      });
    });
    array(b.domains,`${path}.domains`,edges.length);
    b.domains.forEach(d=>{
      if (d === 'auto' || d === 'untrimmed') return;
      array(d,`${path}.domain`,2); d.forEach(x=>number(x,`${path}.domain`)); need(d[0]<=d[1],`${path}.domain order`);
    });
    array(b.face_origins,`${path}.face_origins`,faces.length);
    b.face_origins.forEach(o=>{
      object(o,['owner','contributors'],`${path}.face_origin`); reference(o.owner,`${path}.owner`);
      array(o.contributors,`${path}.contributors`); o.contributors.forEach(r=>reference(r,`${path}.contributor`));
    });
    array(b.edge_origins,`${path}.edge_origins`,edges.length);
    b.edge_origins.forEach(o=>{
      const kind=Object.keys(o ?? {})[0];
      need(['original','intersection','subdivision'].includes(kind),`${path}.edge_origin variant`);
      object(o,[kind],`${path}.edge_origin`);
      if (kind==='original') reference(o[kind],`${path}.original`);
      else { array(o[kind],`${path}.${kind}`,kind==='intersection'?2:undefined); o[kind].forEach(r=>reference(r,`${path}.${kind}`)); }
    });
  });
}

export function compare(bend, rust) {
  const diffs=[];
  let maxVertex=0, maxVolume=0;
  for (const [name,value] of [['Bend',bend],['Rust',rust]]) {
    try { validateResult(value); } catch (error) { diffs.push(`${name}: ${error.message}`); }
  }
  if (diffs.length) return {diffs,maxVertex,maxVolume};
  // Walk every field, require identical keys, array lengths and variants.
  // The declared tolerance applies ONLY to geometric scalars; ids, stats,
  // boolean senses, provenance and status fields compare without coercion.
  const visit=(a,b,path,geometry=false)=>{
    if (typeof a !== typeof b || Array.isArray(a)!==Array.isArray(b)) {diffs.push(`${path} type differs`); return;}
    if (typeof a==='number') {
      if (geometry) { const delta=Math.abs(a-b); maxVertex=Math.max(maxVertex,delta); }
      else if (a!==b) diffs.push(`${path} differs`);
    } else if (Array.isArray(a)) {
      if (a.length!==b.length) diffs.push(`${path} length differs`);
      a.forEach((v,i)=>{if(i<b.length) visit(v,b[i],`${path}[${i}]`,geometry);});
    } else if (a && typeof a==='object') {
      if (!same(Object.keys(a).sort(),Object.keys(b).sort())) diffs.push(`${path} keys differ`);
      for (const key of Object.keys(a)) if (Object.hasOwn(b,key)) {
        visit(a[key],b[key],`${path}.${key}`,geometry || ['vertices','origin','direction','normal','x','domains'].includes(key));
      }
    } else if (a!==b) diffs.push(`${path} differs`);
  };
  visit(bend,rust,'result');
  if (bend.status==='Bodies' && rust.status==='Bodies') bend.bodies.forEach((b,i)=>{
    const r=rust.bodies[i]; if(!r) return;
    const vb=volume(b.solid), vr=volume(r.solid);
    if(!Number.isFinite(vb)||!Number.isFinite(vr)) diffs.push(`body ${i} non-finite volume`);
    else maxVolume=Math.max(maxVolume,Math.abs(vb-vr));
    visit(bbox(b.solid.vertices),bbox(r.solid.vertices),`body ${i} bbox`,true);
  });
  if(maxVertex>VERTEX_TOL) diffs.push(`geometry differs by ${maxVertex} mm (> ${VERTEX_TOL})`);
  if(maxVolume>1e-9) diffs.push(`volume differs by ${maxVolume} mm^3`);
  return {diffs,maxVertex,maxVolume};
}

// Planted negatives on the output (the spike's --plant): perturb one Rust vertex beyond the tolerance, or flip one face sense.
function postPlanted(rust, plant) {
  const r = structuredClone(rust);
  if (plant === 'vertex' && r.status === 'Bodies') r.bodies[0].solid.vertices[3][1] += 10 * VERTEX_TOL;
  if (plant === 'flip' && r.status === 'Bodies') r.bodies[0].solid.faces[0].sense = !r.bodies[0].solid.faces[0].sense;
  return r;
}

export function runCompare({ variant = 'release', plantEnv = null, postPlant = null, extra = [], fixtureDir = fixtures } = {}) {
  const { path: bin, sourceHash } = openRustArtifact(root, { variant, artifact: 'planar-spike' });
  const index = JSON.parse(readFileSync(join(fixtureDir, 'index.json'), 'utf8'));
  const env = { ...process.env };
  delete env.PLANT;
  if (plantEnv) env.PLANT = plantEnv;
  const rows = new Map();
  const details = [];
  for (const call of index.calls) {
    const base = `${call.workload}.${call.call}`;
    const requestFile = join(fixtureDir, 'calls', `${base}.req.bin`);
    const bendFile = join(fixtureDir, 'calls', `${base}.bend.json.gz`);
    const request = readFileSync(requestFile);
    if (sha256(request) !== call.requestSha256 || request.length !== call.requestWords * 4) {
      throw new Error(`${requestFile}: request differs from index.json (requestSha256/requestWords)`);
    }
    const bendBytes = gunzipSync(readFileSync(bendFile));
    if (sha256(bendBytes) !== call.bendResultSha256) {
      throw new Error(`${bendFile}: Bend result differs from index.json (bendResultSha256)`);
    }
    const bend = plainBend(JSON.parse(bendBytes.toString('utf8')));
    const run = spawnSync(bin, ['run', call.operation, requestFile, ...extra], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0) throw new Error(`${base}: planar-spike exited ${run.status}: ${run.stderr}`);
    const stats = JSON.parse(run.stderr.trim().split('\n').pop());
    let rust = JSON.parse(run.stdout);
    if (postPlant) rust = postPlanted(rust, postPlant);
    const { diffs, maxVertex, maxVolume } = compare(bend, rust);
    const row = rows.get(call.workload) ?? { workload: call.workload, compared: 0, agree: 0, differ: 0, maxVertexMm: 0, maxVolumeMm3: 0, undecided: 0 };
    row.compared++; diffs.length ? row.differ++ : row.agree++;
    row.maxVertexMm = Math.max(row.maxVertexMm, maxVertex); row.maxVolumeMm3 = Math.max(row.maxVolumeMm3, maxVolume);
    row.undecided += stats.undecidedTotal;
    rows.set(call.workload, row);
    details.push({ call: base, operation: call.operation, bend: bend.status === 'Unresolved' ? `${bend.reason}/${bend.stage}` : `Bodies ${bend.bodies.map(b => `${b.solid.vertices.length}/${b.solid.edges.length}/${b.solid.faces.length}`).join(' ')} vol ${bend.bodies.map(b => volume(b.solid).toFixed(6)).join(' ')}`, rustUndecided: stats.undecidedTotal, diffs });
  }
  const table = [...rows.values()];
  return { vertexTolMm: VERTEX_TOL, rustSourceHash: sourceHash, variant, plantEnv, postPlant, extra, table, details, differ: table.reduce((n, r) => n + r.differ, 0), total: details.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const variant = opt('--variant', 'release'), plantEnv = opt('--plant-env', null), postPlant = opt('--post-plant', null);
  const extra = [...(args.includes('--propagate') ? ['--propagate'] : []), ...(opt('--threads', null) ? ['--threads', opt('--threads', null)] : [])];
  const result = runCompare({ variant, plantEnv, postPlant, extra });
  for (const d of result.details) console.log(JSON.stringify(d));
  for (const r of result.table) console.log(JSON.stringify(r));
  const label = [variant, plantEnv && `plant-${plantEnv}`, postPlant && `post-${postPlant}`, ...extra].filter(Boolean).join('-').replace(/[^a-z0-9-]/gi, '');
  mkdirSync(work, { recursive: true });
  const out = join(work, `compare-${label}.json`);
  writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  console.log(`differ ${result.differ} of ${result.total}; rust ${result.rustSourceHash.slice(0, 12)}; written ${out}`);
  process.exitCode = result.differ ? 1 : 0;
}
