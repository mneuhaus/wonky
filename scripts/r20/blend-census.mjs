#!/usr/bin/env node
// BL0: source-derived dynamic sites, Bend JS snapshots and independent replay.
// Run collection only with opt-in WONKY_BLEND_CENSUS_DIR on the frozen R20 input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeJob } from '../fillet/brepfmt.mjs';
import { edgeConvexity, edgeUses } from '../fillet/geom.mjs';
import { loadFilletProduction } from '../../src/fillet.mjs';
import { blendCensusStem } from '../../src/fillet-op.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'fixtures/fillet/r20-sites');
const captureDir = path.join(root, 'out/bl0');
const sourceDir = path.join(root, 'fixtures/r20-modules/studios');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const site = (module, id, op, line, blocker = null, nextBoolean = null) => ({ module, id: `model/${id}`, op, line, blocker, nextBoolean });
const tray = 'A refuses T01/blends/concave: overflow edge 144, curved neighbour face 62; no further tray body can run';
const ret = 'Interpreter stops in r20RetOnRectOutline at return.fs:902 (sqrt of units), after ARM_R/join/union1 but before seamBlend, window cuts, ARM_R/features, XBAR and RET_HUB';
const feed = 'Bend Boolean refuses RACK/holes/subtract at feed.fs:344, clearance 0.010001 mm, before PINION';
// The shared source lines deliberately occur twice: ARM_L/ARM_R and CORE_L/CORE_R.
export const expected = [
  site('tray','T01/blends/concave','fillet',1200),
  site('tray','T01/blends/rim','chamfer',1205,tray),
  site('tray','HUB_L/root','fillet',1239,tray,'HUB_L screw cuts after tray.fs:1241'),
  site('edge','E01/crest','chamfer',783,null,'E01 join at edge.fs:879'),
  site('edge','E01/seam/backer','fillet',808,null,'E01 holes at edge.fs:883'),
  site('edge','E01/seam/foot','fillet',822,null,'E01 holes at edge.fs:883'),
  site('return','ARM_L/blends/junction','fillet',1026,null,'ARM_L/features at return.fs:1141'),
  site('return','ARM_L/blends/rim','chamfer',1035,null,'ARM_L/features at return.fs:1141'),
  site('return','ARM_R/plateBlends/junction','fillet',1026,null,'ARM_R join at return.fs:1239'),
  site('return','ARM_R/plateBlends/rim','chamfer',1035,null,'ARM_R join at return.fs:1239'),
  site('return','ARM_R/blockBlends/corners','fillet',1152,null,'ARM_R join at return.fs:1239'),
  site('return','ARM_R/seamBlend/seam','fillet',1168,ret,'ARM_R window/pocket cuts at return.fs:1243-1254'),
  site('return','ARM_R/windowBlend/rim','chamfer',1182,ret,'ARM_R pocket cut at return.fs:1252'),
  site('return','XBAR/blends/rim','chamfer',1282,ret,'XBAR/features at return.fs:1338'),
  site('return','RET_HUB/blends/root','fillet',1363,ret,'RET_HUB/features at return.fs:1463'),
  site('return','RET_HUB/blends/rim','chamfer',1368,ret,'RET_HUB/features at return.fs:1463'),
  site('cores','CORE_L/blend','chamfer',1026,null,'CORE_L/features at cores.fs:1032'),
  site('cores','CORE_R/blend','chamfer',1026,null,'CORE_R/features at cores.fs:1032'),
  site('feed','PINION/blends/rim','chamfer',959,feed,'PINION bore and hybrid cuts at feed.fs:982-988'),
];
const filename = blendCensusStem;
const modules = ['tray', 'edge', 'return', 'cores', 'feed'];
const stops = {
  tray: 'T01/blends/concave: Bend A overflow (edge 144, neighbour 62)',
  return: 'return.fs:902: interpreter sqrt of units during ARM_R seam search, after ARM_R/join/union1; before seamBlend and window cuts',
  feed: 'RACK/holes/subtract: Boolean clearance 0.010001 mm, before PINION',
};

function sourceCheck() {
  const counts = new Map();
  const checksums = fs.readFileSync(path.join(sourceDir, 'SHA256SUMS'), 'utf8');
  for (const module of modules) {
    const text = fs.readFileSync(path.join(sourceDir, `${module}.fs`), 'utf8');
    if (!checksums.split('\n').includes(`${sha(text)}  ${module}.fs`))
      throw new Error(`${module}: source no longer matches frozen R20 SHA256SUMS`);
    const lines = text.split('\n');
    const actual = lines.flatMap((line, index) => /\bop(Fillet|Chamfer)\(context,/.test(line) ? [index + 1] : []);
    const listed = [...new Set(expected.filter(s => s.module === module).map(s => s.line))].sort((a,b) => a-b);
    if (JSON.stringify(actual) !== JSON.stringify(listed)) throw new Error(`${module}: source sites ${actual} != census ${listed}`);
    for (const row of expected.filter(s => s.module === module)) {
      if (!lines[row.line-1].includes(row.op === 'fillet' ? 'opFillet(context' : 'opChamfer(context'))
        throw new Error(`${module}:${row.line} operation changed`);
      counts.set(`${module}:${row.line}`, (counts.get(`${module}:${row.line}`) ?? 0) + 1);
    }
  }
  if (counts.size !== 16 || expected.length !== 19 || new Set(expected.map(s=>s.id)).size !== 19)
    throw new Error(`expected 16 source sites/19 unique dynamic calls; got ${counts.size}/${expected.length}`);
  if (counts.get('return:1026') !== 2 || counts.get('return:1035') !== 2 || counts.get('cores:1026') !== 2)
    throw new Error('Shared ARM_L/ARM_R and CORE_L/CORE_R sites must count twice');
}

export function classify(job) {
  const { body, select } = job, uses = edgeUses(body);
  const selectedSet = new Set(select);
  const convexity = new Map(select.map(index => {
    try { return [index, edgeConvexity(body, index, uses)]; }
    catch (error) { return [index, { convexity: 'undetermined', reason: error.message }]; }
  }));
  const corners = [...new Set(select.flatMap(i => [body.edges[i].start, body.edges[i].end]))].map(vertex => {
    const incident = body.edges.flatMap((edge, index) => edge.start === vertex || edge.end === vertex ? [index] : []);
    const chosen = incident.filter(index => selectedSet.has(index));
    const shapes = [...new Set(chosen.map(index => convexity.get(index).convexity))];
    let type, capFace = null, capAngleDot = null;
    if (chosen.length === 1) {
      const edge = body.edges[chosen[0]], adjacent = incident.filter(index => index !== chosen[0]);
      const supports = new Set(uses[chosen[0]].map(use => use.face));
      const caps = adjacent.length === 2
        ? uses[adjacent[0]].filter(use => uses[adjacent[1]].some(other => other.face === use.face) && !supports.has(use.face))
        : [];
      if (caps.length === 1) {
        capFace = caps[0].face;
        const surface = body.faces[capFace].surface;
        if (surface.type !== 'plane') type = 'curved-face cap';
        else if (edge.curve.type !== 'line') type = 'planar cap on curved edge (angle unresolved)';
        else {
          const a = body.vertices[edge.start], b = body.vertices[edge.end];
          const tangent = a.map((x, i) => b[i] - x);
          capAngleDot = Math.abs(tangent.reduce((sum, x, i) => sum + x * surface.normal[i], 0)) / Math.hypot(...tangent) / Math.hypot(...surface.normal);
          type = capAngleDot >= 1 - 1e-8 ? 'perpendicular planar cap' : 'oblique planar cap (ellipse candidate)';
        }
      } else type = 'unresolved terminal cap';
    } else if (shapes.length > 1) type = 'mixed-convexity corner';
    else if (chosen.length === 3) type = job.op === 'chamfer' ? 'three-chamfer corner' : 'three-fillet sphere corner';
    else if (chosen.length === 2) type = 'two-edge chain corner (mitre/G1 subtype unresolved)';
    else type = `${chosen.length}-edge selected junction (subtype unresolved)`;
    return { vertex, selectedDegree: chosen.length, bodyDegree: incident.length, type, capFace, capAngleDot };
  });
  const byVertex = new Map(corners.map(corner => [corner.vertex, corner]));
  const selected = select.map(index => {
    const edge = body.edges[index], faces = uses[index].map(u => ({ index: u.face, surface: body.faces[u.face].surface.type }));
    const shape = convexity.get(index);
    const carrierPairCurve = `${faces.map(f => f.surface).join('/')}:${edge.curve.type}`;
    const caps = [...new Set([edge.start, edge.end].map(vertex => byVertex.get(vertex).type))];
    const baseClass = job.op === 'chamfer' && edge.curve.type === 'circle' ? 'chamfer cone on rim'
      : edge.curve.type === 'circle' && faces.some(f => f.surface === 'cylinder') ? 'hole/boss rim (torus candidate)'
      : `${faces.map(f => f.surface).join('/')} ${edge.curve.type}, ${shape.convexity}`;
    return { index, curve: edge.curve.type, supports: faces, convexity: shape.convexity,
      dihedralDeg: shape.dihedralDeg ?? null, carrierPairCurve, class: `${baseClass}; ${caps.join(' / ')}`,
      cornerTypes: caps };
  });
  // Distinct close vertices are only candidates; no missing incidence is proven.
  const gaps = [];
  for (let a = 0; a < body.vertices.length; a++) for (let b = a + 1; b < body.vertices.length; b++) {
    const d = Math.hypot(...body.vertices[a].map((v, k) => v - body.vertices[b][k]));
    if (d > 0 && d < 1e-5) gaps.push({ a, b, mm: d });
  }
  return { selected, corners, cornerTypes: [...new Set(corners.map(corner => corner.type))],
    sub10umVertexProximities: gaps,
    supportClaim: 'exact analytic job (F32x2 wire); recovered carriers not inferable from this job; no mesh support' };
}

export function booleanFlow(item, outcome) {
  const planned = item.nextBoolean;
  const joinedArmR = item.module === 'return' && /^model\/ARM_R\/(plateBlends|blockBlends)\//.test(item.id);
  const observed = joinedArmR && outcome.status === 'ok' ? ['model/ARM_R/join/union1 (return execution, before return.fs:902)'] : [];
  const reachedLater = item.module === 'edge' || item.module === 'cores' || item.id.startsWith('model/ARM_L/');
  const description = !planned ? 'no following Boolean identified before this body is returned (source inspection)'
    : observed.length
    ? `observed following union: ${observed.join(', ')}; later window/pocket cuts at return.fs:1245-1252 are planned, NOT executed (return.fs:902 before seamBlend); blend-face contact in union unverified`
    : outcome.status !== 'ok' ? `planned at ${planned}; blend refused, not executed`
      : reachedLater ? `following source path reached ${planned}; actual blend-face contact unverified`
        : `planned at ${planned}; NOT observed after this blend (module stopped before it)`;
  return { planned, observed, description };
}

export function checkInventory(rows, exists) {
  if (rows.length !== 19 || new Set(rows.map(s => s.id)).size !== 19) throw new Error('19 unique dynamic calls required');
  for (const row of rows) {
    if (row.status === 'dump') {
      if (!exists(row)) throw new Error(`${row.id}: dump missing`);
    } else if (row.status === 'OPEN') {
      if (!row.blocker) throw new Error(`${row.id}: OPEN without predecessor blocker`);
    } else throw new Error(`${row.id}: neither dump nor OPEN`);
  }
}

async function run() {
  sourceCheck();
  const collect = process.argv.includes('--collect'), negative = process.argv.includes('--self-test');
  if (collect) fs.mkdirSync(fixtureDir, { recursive: true });
  const rows = [];
  const native = await loadFilletProduction();
  for (const item of expected) {
    const stem = filename(item.id);
    const from = path.join(captureDir, item.module, 'jobs');
    const destination = path.join(fixtureDir, stem);
    if (collect && fs.existsSync(path.join(from, `${stem}.job`))) {
      for (const extension of ['job', 'outcome.json', 'json'])
        fs.copyFileSync(path.join(from, `${stem}.${extension}`), `${destination}.${extension}`);
    }
    const jobFile = `${destination}.job`, outcomeFile = `${destination}.outcome.json`;
    const row = { ...item, status: fs.existsSync(jobFile) ? 'dump' : 'OPEN' };
    if (row.status === 'OPEN') {
      if (!item.blocker) throw new Error(`${item.id} missing dump despite being reached in Bend JS`);
    } else {
      const text = fs.readFileSync(jobFile, 'utf8');
      const job = decodeJob(text);
      if (job.id !== item.id || job.op !== item.op)
        throw new Error(`${item.id}: job id/op mismatch: ${job.id}/${job.op}`);
      const outcome = JSON.parse(fs.readFileSync(outcomeFile, 'utf8'));
      const replay = native.fillet(text);
      if (replay.$ !== 'Record') throw new Error(`${item.id}: native replay not a Record`);
      const result = replay.out.$ === 'Built' ? 'ok' : replay.out.$ === 'Refused' ? 'refused' : replay.out.$;
      if (result !== outcome.status || result === 'refused' && (replay.out.cls !== outcome.class || replay.out.why !== outcome.reason))
        throw new Error(`${item.id}: replay ${result}/${replay.out.cls} != capture ${outcome.status}/${outcome.class}`);
      if (collect) fs.writeFileSync(`${destination}.result.sha256`, sha(JSON.stringify(replay)) + '\n');
      else if (fs.readFileSync(`${destination}.result.sha256`, 'utf8').trim() !== sha(JSON.stringify(replay)))
        throw new Error(`${item.id}: Bend output topology/geometry/order differs from frozen replay`);
      const analysis = classify(job);
      const capture = JSON.parse(fs.readFileSync(`${destination}.json`, 'utf8'));
      if (capture.id !== item.id || capture.geometry !== 'analytic' || capture.selected.length !== job.select.length)
        throw new Error(`${item.id}: capture does not match analytic job`);
      const supportOrigins = new Map(capture.edges.flatMap(edge => edge.supports).map(face => [face.index, face.provenance]));
      analysis.supportRepresentation = [...new Set(supportOrigins.values())];
      analysis.carrierRecoveredFaces = capture.carrier?.recoveredFaceCount ?? 0;
      analysis.validationScope = capture.carrier?.validationScope ?? null;
      analysis.meshSupport = false;
      const flow = booleanFlow(item, outcome);
      analysis.observedFollowingBooleans = flow.observed;
      analysis.plannedFollowingBoolean = flow.planned;
      analysis.blendToBoolean = flow.description;
      row.sha256 = sha(text);
      row.outcome = outcome.status === 'refused' ? { status: 'refused', class: outcome.class, reason: outcome.reason } : { status: outcome.status };
      row.analysis = analysis;
      row.abilityA = outcome.status === 'ok' ? 'A baut' : `fehlt A: ${outcome.class}`;
    }
    if (row.status === 'OPEN') row.abilityA = 'offen';
    rows.push(row);
  }
  checkInventory(rows, row => fs.existsSync(path.join(fixtureDir, `${filename(row.id)}.job`)));
  const reached = rows.filter(r => r.status === 'dump').length;
  const moduleRuns = Object.fromEntries(modules.map(module => [module, {
    sourceSha256: sha(fs.readFileSync(path.join(sourceDir, `${module}.fs`))),
    command: `WONKY_BLEND_CENSUS_DIR=out/bl0/${module}/jobs node bin/wonky.mjs fixtures/r20-modules/studios/${module}.fs --feature r20${module[0].toUpperCase()}${module.slice(1)} --param withBlends=true --format r20-check --deviation-mm 0.01 --out out/bl0/${module}/build`,
    status: stops[module] ? 'stopped' : 'built',
    blocker: stops[module] ?? null,
  }]));
  const census = { schema: 'r20/blend-census/v1', source: 'frozen fixtures/r20-modules/studios withBlends=true, Bend JS, no stubs', staticSites: 16, dynamicSites: 19, reached, moduleRuns, rows };
  if (collect) fs.writeFileSync(path.join(fixtureDir, 'census.json'), JSON.stringify(census, null, 2) + '\n');
  else {
    const frozen = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'census.json')));
    if (JSON.stringify(frozen) !== JSON.stringify(census)) throw new Error('Census differs from replay/source inventory');
  }
  if (negative) {
    const victim = rows.find(r => r.id === 'model/E01/seam/foot');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl0-missing-dump-'));
    try {
      const scratchJob = path.join(scratch, `${filename(victim.id)}.job`);
      fs.copyFileSync(path.join(fixtureDir, `${filename(victim.id)}.job`), scratchJob);
      fs.unlinkSync(scratchJob); // actual deletion, on scratch only
      try { checkInventory(rows, row => row !== victim || fs.existsSync(scratchJob)); throw new Error('deleted dump went undetected'); }
      catch (error) { if (error.message === 'deleted dump went undetected') throw error; console.log(`NEGATIVE missing dump: ${error.message}`); }
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    const collapsed = rows.filter(r => r.id !== 'model/ARM_R/plateBlends/junction');
    try { checkInventory(collapsed, () => true); throw new Error('ARM_R collapse went undetected'); }
    catch (error) { if (error.message === 'ARM_R collapse went undetected') throw error; console.log(`NEGATIVE ARM_R collapse: ${error.message}`); }
  }
  console.log(`BL0: ${reached}/19 dumps, ${19-reached} OPEN; 16 source sites; all ${reached} Bend JS replays match`);
  for (const r of rows) console.log(`${r.status.padEnd(4)} ${r.id} ${r.abilityA}${r.status === 'OPEN' ? ` (${r.blocker})` : ''}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run().catch(error => { console.error(error); process.exitCode = 1; });
