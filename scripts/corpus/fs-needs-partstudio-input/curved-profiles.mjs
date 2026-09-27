// Diagnosis only (cluster fs-needs-partstudio-input, lineage A next blockers).
// Extracts every `curvedProfile(context,id+"<name>",plane(...),[curves])` call
// of a fixed-frame FS file, builds the same line/arc entities skLineSegment/skArc
// build (sketch-local mm -> SI metres), and runs them through the unchanged
// native solver (kernel/sketch-arcs.bend via src/sketch-arcs.mjs). The CLI
// message drops the reason's entity indices; this prints them, with the
// geometry of the refused pair (float64, diagnosis only).
//   node scripts/corpus/fs-needs-partstudio-input/curved-profiles.mjs <file.fs> [...]
import { readFileSync } from 'node:fs';
import { loadKernel } from '../../../src/kernel.mjs';
import { encodeSketchArcEntities } from '../../../src/sketch-arcs.mjs';

const kernel = await loadKernel();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function circle(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-300) return null;
  const s = p => p[0] * p[0] + p[1] * p[1];
  const center = [(s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d];
  return { center, radius: dist(center, a) };
}
function describe(curve) {
  if (curve.length === 2) return { type: 'line', lengthMm: dist(curve[0], curve[1]), start: curve[0], end: curve[1] };
  const c = circle(...curve);
  return { type: 'arc', chordMm: dist(curve[0], curve[2]), radiusMm: c?.radius ?? null, start: curve[0], mid: curve[1], end: curve[2] };
}
// Signed distance of point p from the segment a-b (float64).
function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1]]);
}
const out = [];
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((text, i) => {
    const m = text.match(/curvedProfile\(context,id\+"([^"]+)",plane\(.*?\),(\[\[\[.*\]\]\])\);/);
    if (!m) return;
    const curves = JSON.parse(m[2]);
    const entities = curves.map((c, index) => c.length === 2
      ? { type: 'line', index, startMeters: c[0].map(v => v / 1000), endMeters: c[1].map(v => v / 1000) }
      : { type: 'arc', index, startMeters: c[0].map(v => v / 1000), midMeters: c[1].map(v => v / 1000), endMeters: c[2].map(v => v / 1000) });
    const result = kernel.sketchArcs.solve(encodeSketchArcEntities(entities));
    const rec = { file, line: i + 1, sketch: m[1], entities: curves.length, arcs: curves.filter(c => c.length === 3).length, result: result.$ };
    if (result.$ !== 'Solved') {
      const r = result.reason ?? {};
      rec.reason = r.$;
      const first = Number(r.first), second = Number(r.second);
      if (Number.isInteger(first) && Number.isInteger(second)) {
        rec.pair = [first, second].map(k => ({ index: k, ...describe(curves[k]) }));
        const [a, b] = [curves[first], curves[second]];
        const ends = p => [p[0], p.at(-1)];
        rec.pairAdjacent = Math.abs(first - second) === 1 || Math.abs(first - second) === curves.length - 1;
        rec.minEndpointToSegmentMm = Math.min(...ends(a).flatMap(p => b.length === 2 ? [segDist(p, b[0], b[1])] : [dist(p, b[0]), dist(p, b[2])]),
          ...ends(b).flatMap(p => a.length === 2 ? [segDist(p, a[0], a[1])] : [dist(p, a[0]), dist(p, a[2])]));
      }
    }
    out.push(rec);
  });
}
for (const r of out) console.log(JSON.stringify(r));
