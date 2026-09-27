// Measures the cap-normal error of kernel/topology.bend extrude for the corpus foot prism
// (r22-current-guides.fs feederMounts): absolute-coordinate F32 area vector (production),
// area vector about the first point (fix variant A) and the sketch-frame normal (variant B).
// Prints angle to the exact plane normal and max vertex distance from the cap plane (mm).
// Usage: node scripts/corpus/kernel-sketch-and-ops/cap-normal-error.mjs
import { loadJsKernel, vector, list, array, coords } from '../../../src/kernel.mjs';
import { dot, sub, cross, norm, tolerance } from '../../../src/brep.mjs';
const kernel = await loadJsKernel();
const f = Math.fround;
const fsub = (a, b) => a.map((v, i) => f(v - b[i]));
const fcross = (a, b) => [f(f(a[1]*b[2]) - f(a[2]*b[1])), f(f(a[2]*b[0]) - f(a[0]*b[2])), f(f(a[0]*b[1]) - f(a[1]*b[0]))];
const fadd = (a, b) => a.map((v, i) => f(v + b[i]));
const unit = a => { const m = norm(a); return a.map(v => v / m); };
const angle = (a, b) => norm(cross(unit(a), unit(b)));
const s3 = Math.sqrt(3);
const foot = [[-31.58,-10],[31.58,-10],[32,-9.58],[32,9.58],[31.58,10],[-31.58,10],[-32,9.58],[-32,-9.58]];
for (const side of [-1, 1]) {
  const n = [side * 0.25, -s3 / 4, s3 / 2], u = [s3 / 2, side * 0.5, 0];
  const c = [77.1263837814323 + side * 100, -454.3231642470163, -320.2202765531271].map((v, i) => v + n[i] * 10);
  const frame = kernel['geometry.frame'](vector(c), vector(n), vector(u));
  const P = array(kernel['geometry.lift_points'](list(foot.map(p => vector([...p, 0]))), frame)).map(coords);
  const solid = kernel.extrude(list(P.map(vector)), vector(n.map(v => v * 6)));
  const cap = coords(array(solid.faces)[1].normal);
  let rel = [0, 0, 0];
  for (let i = 0; i < P.length; i++) rel = fadd(rel, fcross(fsub(P[i], P[0]), fsub(P[(i + 1) % P.length], P[0])));
  const fn = coords(frame.normal);
  const dev = nn => Math.max(...P.map(p => Math.abs(dot(sub(p, P[0]), unit(nn)))));
  console.log(`side ${side}: angle(cap, plane) ${angle(cap, n).toExponential(2)} rad, maxDev ${dev(cap).toExponential(2)} mm | relative area vector: angle ${angle(rel, n).toExponential(2)}, maxDev ${dev(rel).toExponential(2)} | frame normal: maxDev ${dev(fn).toExponential(2)} | eps ${tolerance([...P]).toExponential(2)}`);
}
