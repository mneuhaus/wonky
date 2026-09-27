import { existsSync } from 'node:fs';
// Boolean bake-off TEST INFRASTRUCTURE: the case catalogue.
//
// Source of truth for fixtures/bakeoff/cases.json. Run
//   node scripts/bakeoff/cases.mjs --write
// to regenerate the JSON after editing. Each case is a CSG tree whose
// leaves are primitives {prim, params, transform} and whose inner nodes are
// {op: union|subtract|intersect, children: [a, b]}. Units are millimetres.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CASES_PATH = path.join(ROOT, 'fixtures/bakeoff/cases.json');

// ---------------------------------------------------------------------------
// Builders

const T = (translate = [0, 0, 0], rotate = []) => ({ rotate, translate });
const rx = (deg) => ({ axis: 'x', deg });
const ry = (deg) => ({ axis: 'y', deg });
const rz = (deg) => ({ axis: 'z', deg });

const box = (min, max, transform = T()) => ({ prim: 'box', params: { min, max }, transform });
const cyl = (radius, height, transform = T()) => ({ prim: 'cylinder', params: { radius, height }, transform });
const cone = (r1, r2, height, transform = T()) => ({ prim: 'cone', params: { r1, r2, height }, transform });
const sphere = (radius, transform = T()) => ({ prim: 'sphere', params: { radius }, transform });
const torus = (major, minor, transform = T()) => ({ prim: 'torus', params: { major, minor }, transform });
const prism = (points, height, transform = T()) => ({ prim: 'prism', params: { points, height }, transform });
// A body of a frozen exact B-rep operand file, placed as stored.
const brep = (source, body) => ({ prim: 'brep', params: { source, body }, transform: T() });
const R10B_G10 = 'fixtures/boolean-stress/r10b-g10-operands.json.gz';

const op = (name) => (a, b) => ({ op: name, children: [a, b] });
const U = op('union');
const S = op('subtract');
const I = op('intersect');

// Balanced union tree (keeps depth logarithmic for many operands).
function unionAll(xs) {
  if (xs.length === 1) return xs[0];
  const m = Math.ceil(xs.length / 2);
  return U(unionAll(xs.slice(0, m)), unionAll(xs.slice(m)));
}

function regularPolygon(n, circumradius, phaseDeg = 0) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = ((phaseDeg + (360 * k) / n) * Math.PI) / 180;
    pts.push([circumradius * Math.cos(a), circumradius * Math.sin(a)]);
  }
  return pts;
}

// Trapezoidal-tooth gear outline: concave, 5 points per tooth
// (root, root, tip, tip, root) so each tooth adds 5 side faces.
function gearOutline(teeth, rootR, tipR) {
  const pts = [];
  const pitch = (2 * Math.PI) / teeth;
  for (let k = 0; k < teeth; k++) {
    const at = (r, f) => [r * Math.cos((k + f) * pitch), r * Math.sin((k + f) * pitch)];
    pts.push(at(rootR, 0), at(rootR, 0.2), at(tipR, 0.35), at(tipR, 0.65), at(rootR, 0.8));
  }
  return pts;
}

function plateWithHoleGrid(nx, ny, pitch, r) {
  const holes = [];
  for (let i = 1; i <= nx; i++) for (let j = 1; j <= ny; j++) holes.push(cyl(r, 5, T([i * pitch, j * pitch, -1])));
  return S(box([0, 0, 0], [(nx + 1) * pitch, (ny + 1) * pitch, 3]), unionAll(holes));
}

function enclosure() {
  const outer = box([0, 0, 0], [60, 40, 30]);
  const inner = box([2, 2, 2], [58, 38, 31]);
  const bossAt = [[6, 6], [54, 6], [54, 34], [6, 34]];
  // Bosses start inside the 2 mm floor and stay 0.5 mm clear of the walls.
  const bosses = unionAll(bossAt.map(([x, y]) => cyl(3.5, 26.5, T([x, y, 1]))));
  const screws = unionAll(bossAt.map(([x, y]) => cyl(1.25, 20, T([x, y, 11]))));
  const usb = box([-1, 16, 6], [3, 24, 10]);
  const vent = cyl(2.5, 4, T([30, 43, 15], [rx(90)]));
  return S(S(U(S(outer, inner), bosses), screws), U(usb, vent));
}

function pinArray() {
  let acc = box([0, 0, 0], [50, 20, 3]);
  for (let i = 0; i < 20; i++) {
    acc = U(acc, cyl(1, 8, T([5 + (i % 10) * 4.4, i < 10 ? 5 : 15, 2])));
  }
  return acc;
}

function tiltedHoles() {
  // A +Z cylinder rotated 17 deg about X has axis (0, -sin17, cos17); start it
  // 7 mm below the plate mid-plane point so the 14 mm hole straddles the plate.
  const s = Math.sin((17 * Math.PI) / 180);
  const c = Math.cos((17 * Math.PI) / 180);
  const holes = [[10, 10], [30, 10], [30, 30], [10, 30]].map(([x, y]) => cyl(2, 14, T([x, y + 7 * s, 3 - 7 * c], [rx(17)])));
  return S(box([0, 0, 0], [40, 40, 6]), unionAll(holes));
}

// ---------------------------------------------------------------------------
// Cases

const D = 0.01; // default chordal deviation (mm): far below an FDM 0.2 mm layer / 0.4 mm nozzle

export const CASES = [
  {
    id: 'leaf-cylinder', category: 'identity', deviationMm: D,
    fdmRationale: 'A single primitive with no Boolean (a plain printed spacer): the result is the operand itself.',
    csg: cyl(6, 12),
  },
  {
    id: 'box-union-overlap', category: 'box-basics', deviationMm: D,
    fdmRationale: 'Two blocks glued into one print; generic position, no coincident faces.',
    csg: U(box([0, 0, 0], [20, 20, 20]), box([10, 5, 5], [30, 15, 25])),
  },
  {
    id: 'box-subtract-overlap', category: 'box-basics', deviationMm: D,
    fdmRationale: 'Notch cut into a block (a slot for a mating part).',
    csg: S(box([0, 0, 0], [20, 20, 20]), box([10, 5, 5], [30, 15, 25])),
  },
  {
    id: 'box-intersect-overlap', category: 'box-basics', deviationMm: D,
    fdmRationale: 'Trimming a part to a bounding block (build-volume clip).',
    csg: I(box([0, 0, 0], [20, 20, 20]), box([10, 5, 5], [30, 15, 25])),
  },
  {
    id: 'box-rotated-intersect', category: 'box-basics', deviationMm: D,
    fdmRationale: 'Oblique trim of a block; no axis alignment, every intersection edge is skew.',
    csg: I(box([0, 0, 0], [20, 20, 20]), box([-10, -10, -10], [10, 10, 10], T([12, 9, 11], [rz(30), rx(20), ry(-11)]))),
  },
  {
    id: 'box-coplanar-union', category: 'coplanar', deviationMm: D,
    fdmRationale: 'Lip added flush with the top surface; the two top faces are coplanar and overlap.',
    csg: U(box([0, 0, 0], [20, 20, 20]), box([10, 5, 10], [30, 15, 20])),
  },
  {
    id: 'box-coplanar-subtract', category: 'coplanar', deviationMm: D,
    fdmRationale: 'Rebate cut flush with the top and three sides; cutter faces coincide with stock faces.',
    csg: S(box([0, 0, 0], [20, 20, 20]), box([10, 0, 10], [20, 20, 20])),
  },
  {
    id: 'box-touching-merge', category: 'touching', deviationMm: D,
    fdmRationale: 'Two modelled halves that share one full face; the union must merge into one block with no internal wall.',
    csg: U(box([0, 0, 0], [10, 10, 10]), box([10, 0, 0], [20, 10, 10])),
  },
  {
    id: 'box-touching-partial', category: 'touching', deviationMm: D,
    fdmRationale: 'A tab welded to a wall; the contact face is a sub-rectangle of the wall face.',
    csg: U(box([0, 0, 0], [10, 10, 10]), box([10, 2, 3], [16, 8, 7])),
  },
  {
    id: 'plate-through-hole', category: 'holes', deviationMm: D,
    fdmRationale: 'M6 clearance hole through a 5 mm plate.',
    csg: S(box([0, 0, 0], [40, 30, 5]), cyl(3.2, 7, T([20, 15, -1]))),
  },
  {
    id: 'plate-blind-hole', category: 'holes', deviationMm: D,
    fdmRationale: 'Blind hole 3 mm deep for a heat-set insert: a cylinder cut ending in a flat floor inside the plate.',
    csg: S(box([0, 0, 0], [30, 30, 6]), cyl(2.5, 5, T([15, 15, 3]))),
  },
  {
    id: 'plate-blind-pocket', category: 'holes', deviationMm: D,
    fdmRationale: 'Rectangular pocket 3 mm deep for a magnet or PCB.',
    csg: S(box([0, 0, 0], [40, 30, 5]), box([10, 8, 2], [30, 22, 6])),
  },
  {
    id: 'plate-counterbore', category: 'holes', deviationMm: D,
    fdmRationale: 'M3 socket-head counterbore: coaxial hole and bore, the bore floor is an annulus.',
    csg: S(S(box([0, 0, 0], [30, 30, 8]), cyl(1.7, 10, T([15, 15, -1]))), cyl(3.1, 4, T([15, 15, 5]))),
  },
  {
    id: 'plate-countersink', category: 'holes', deviationMm: D,
    fdmRationale: 'M4 countersink (90 deg cone) meeting a coaxial hole; the cone bottom circle coincides with the hole wall.',
    csg: S(S(box([0, 0, 0], [30, 30, 6]), cyl(2.2, 8, T([15, 15, -1]))), cone(2.2, 6.2, 4, T([15, 15, 2.8]))),
  },
  {
    id: 'plate-4-holes', category: 'holes', deviationMm: D,
    fdmRationale: 'Mounting plate with four corner holes.',
    csg: S(box([0, 0, 0], [50, 40, 4]), unionAll([[6, 6], [44, 6], [44, 34], [6, 34]].map(([x, y]) => cyl(1.7, 6, T([x, y, -1]))))),
  },
  {
    id: 'plate-hole-grid-10x10', category: 'holes', deviationMm: D,
    fdmRationale: 'Perforated panel / speaker grille: 100 holes, many independent intersection loops.',
    csg: plateWithHoleGrid(10, 10, 5, 1.5),
  },
  {
    id: 'tilted-holes-17deg', category: 'holes', deviationMm: D,
    fdmRationale: 'Four holes drilled at 17 deg (angled cable pass-throughs); elliptical entry and exit loops.',
    csg: tiltedHoles(),
  },
  {
    id: 'pipe-tee', category: 'cylinders', deviationMm: D,
    fdmRationale: 'Printed pipe tee: perpendicular cylinder union, then the bores; saddle-shaped intersection curves.',
    csg: S(
      U(cyl(6, 40, T([-20, 0, 0], [ry(90)])), cyl(4, 20)),
      U(cyl(5, 42, T([-21, 0, 0], [ry(90)])), cyl(3, 22)),
    ),
  },
  {
    id: 'steinmetz-intersect', category: 'cylinders', deviationMm: D,
    fdmRationale: 'Equal-radius crossing cylinders: the intersection curves cross at singular points.',
    csg: I(cyl(5, 20, T([-10, 0, 0], [ry(90)])), cyl(5, 20, T([0, -10, 0], [rx(-90)]))),
  },
  {
    id: 'steinmetz-union', category: 'cylinders', deviationMm: D,
    fdmRationale: 'Cross-shaped pipe junction with equal radii (same singular intersection as the intersect case).',
    csg: U(cyl(5, 20, T([-10, 0, 0], [ry(90)])), cyl(5, 20, T([0, -10, 0], [rx(-90)]))),
  },
  {
    id: 'coaxial-cylinder-stack', category: 'cylinders', deviationMm: D,
    fdmRationale: 'Two coaxial equal-radius cylinders overlapping in height (stacked extrusions): coincident curved faces and coplanar facets.',
    csg: U(cyl(8, 10), cyl(8, 10, T([0, 0, 5]))),
  },
  {
    id: 'sphere-minus-box', category: 'spheres', deviationMm: D,
    fdmRationale: 'Dome: a sphere cut flat so it sits on the bed.',
    csg: S(sphere(10), box([-11, -11, -11], [11, 11, -3])),
  },
  {
    id: 'sphere-intersect-cylinder', category: 'spheres', deviationMm: D,
    fdmRationale: 'Ball knob trimmed to a cylindrical envelope.',
    csg: I(sphere(10), cyl(7, 24, T([0, 0, -12]))),
  },
  {
    id: 'box-minus-sphere-cavity', category: 'spheres', deviationMm: D,
    fdmRationale: 'Ball-joint socket: spherical cavity opening through the top face.',
    csg: S(box([-8, -8, -8], [8, 8, 6]), sphere(7, T([0, 0, 2]))),
  },
  {
    id: 'hex-nut', category: 'mechanical', deviationMm: D,
    fdmRationale: 'M8 hex nut: hex prism minus bore, intersected with a 30 deg chamfer cone whose top cap is coplanar with the nut top.',
    csg: I(
      S(prism(regularPolygon(6, 13 / Math.sqrt(3), 30), 6.5), cyl(3.4, 8.5, T([0, 0, -1]))),
      cone(6.5 + 7.5 * Math.tan(Math.PI / 3), 6.5, 7.5, T([0, 0, -1])),
    ),
  },
  {
    id: 'enclosure-shell', category: 'mechanical', deviationMm: D,
    fdmRationale: 'Open-top electronics enclosure: shell, four screw bosses with pilot holes, a USB cut-out and a round vent.',
    csg: enclosure(),
  },
  {
    id: 'gear-48-bore', category: 'mechanical', deviationMm: D,
    fdmRationale: 'Spur-gear blank: 48-tooth concave prism (240 side faces) minus a bore.',
    csg: S(prism(gearOutline(48, 22, 24.5), 8), cyl(4, 10, T([0, 0, -1]))),
  },
  {
    id: 'cylinder-tangent-box-face', category: 'tangent', deviationMm: D, expect: 'non-manifold-contact',
    fdmRationale: 'Round rod resting on a block: the cylinder touches the top face along one line (tessellation vertices lie exactly on it).',
    csg: U(box([0, 0, 0], [20, 20, 20]), cyl(5, 30, T([10, -5, 25], [rx(-90)]))),
  },
  {
    id: 'hole-tangent-edge', category: 'tangent', deviationMm: D, expect: 'non-manifold-contact',
    fdmRationale: 'Hole placed so its wall just touches the plate side face (a common layout slip); tangent along a line.',
    csg: S(box([0, 0, 0], [30, 20, 5]), cyl(3, 7, T([3, 10, -1]))),
  },
  {
    id: 'self-union', category: 'identity', deviationMm: D,
    fdmRationale: 'A union with an identical copy (duplicated body in a slicer project): A u A = A.',
    csg: U(cyl(5, 10), cyl(5, 10)),
  },
  {
    id: 'self-subtract', category: 'identity', deviationMm: D, expect: 'empty',
    fdmRationale: 'Subtracting an identical copy: A - A is empty (expected result volume 0).',
    csg: S(cyl(5, 10), cyl(5, 10)),
  },
  {
    id: 'self-intersect', category: 'identity', deviationMm: D,
    fdmRationale: 'Intersecting an identical copy: A n A = A.',
    csg: I(cyl(5, 10), cyl(5, 10)),
  },
  {
    id: 'internal-void', category: 'topology', deviationMm: D,
    fdmRationale: 'Sealed internal cavity (weight reduction / embedded magnet pocket): one solid bounded by two shells.',
    csg: S(box([0, 0, 0], [20, 20, 20]), box([5, 5, 5], [15, 15, 15])),
  },
  {
    id: 'disjoint-union', category: 'topology', deviationMm: D,
    fdmRationale: 'Two separate parts on one plate: union of disjoint bodies, two components.',
    csg: U(box([0, 0, 0], [10, 10, 10]), cyl(4, 10, T([25, 5, 0]))),
  },
  {
    id: 'pin-array-chain-20', category: 'many-operands', deviationMm: D,
    fdmRationale: 'Pin header / peg board: a left-deep chain of 20 unions, each pin sunk 1 mm into the base.',
    csg: pinArray(),
  },
  {
    id: 'fine-spheres-50k', category: 'scale', deviationMm: 0.004,
    fdmRationale: 'Two finely tessellated overlapping spheres (~50k input triangles): throughput case.',
    csg: U(sphere(10), sphere(10, T([7, 3, 2]))),
  },
  {
    id: 'torus-minus-box', category: 'tori', deviationMm: D,
    fdmRationale: 'O-ring / handle cut in half so it prints flat; the cut plane passes through a ring of tessellation vertices.',
    csg: S(torus(12, 3), box([-16, -16, -4], [16, 16, 0])),
  },
  {
    id: 'r10b-g10-union', category: 'frozen-r10b', deviationMm: D,
    fdmRationale: 'The frozen r10b UpperCore g10 UNION operands (exact B-rep, 82 planar faces vs 40 planar + 10 cylindrical faces incl. an ellipse edge) on which the exact general-fuse route stalled; a real printed part.',
    csg: U(brep(R10B_G10, 0), brep(R10B_G10, 1)),
  },
].filter(c => c.id !== 'r10b-g10-union' || existsSync(path.join(ROOT, R10B_G10)));

export function casesDocument() {
  return {
    schema: 'wonky-bakeoff-cases/1',
    units: 'mm',
    generator: 'scripts/bakeoff/cases.mjs --write',
    conventions: {
      leaf: '{prim, params, transform: {rotate: [{axis: x|y|z|[x,y,z], deg}], translate: [x,y,z]}}; rotations apply in list order, then the translation',
      node: '{op: union|subtract|intersect, children: [a, b]}; subtract is children[0] minus children[1]',
      box: 'params {min:[x,y,z], max:[x,y,z]}',
      cylinder: 'params {radius, height}; axis +Z from z=0 to z=height',
      cone: 'params {r1 (at z=0), r2 (at z=height), height}; r1 or r2 may be 0 (apex)',
      sphere: 'params {radius}; centred on the origin',
      torus: 'params {major, minor}; axis +Z, centred on the origin',
      prism: 'params {points: [[x,y],...] simple polygon, height}; extruded +Z from z=0',
      brep: 'params {source: gzipped wonky-acceptance-operands/1 JSON, body: index}; the exact B-rep body as stored (identity transform); tessellated by scripts/bakeoff/brep-tessellate.mjs',
      deviationMm: 'stated bound on the distance between a leaf tessellation and its analytic surface',
      expect: 'solid (a valid closed 2-manifold mesh, possibly several components) | empty (valid answer is an ok mesh with 0 triangles) | non-manifold-contact (the exact result touches itself along a line or point; a closed 2-manifold mesh of it does not exist, so the expected answer is unresolved with a reason; a mesh is reported but not scored as a pass)',
    },
    cases: CASES.map(({ id, category, fdmRationale, deviationMm, expect = 'solid', csg }) => ({ id, category, fdmRationale, deviationMm, expect, csg })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(CASES_PATH), { recursive: true });
    fs.writeFileSync(CASES_PATH, JSON.stringify(casesDocument(), null, 1) + '\n');
    console.log(`wrote ${CASES_PATH} (${CASES.length} cases)`);
  } else {
    console.log(`${CASES.length} cases; pass --write to regenerate ${CASES_PATH}`);
  }
}
