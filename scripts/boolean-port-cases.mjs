import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadKernel, extrudeInBend, array, list } from '../src/kernel.mjs';
import { circularFrustumInBend, importOnshapeBody, transformAnalytic } from '../src/analytic.mjs';
import { classificationInput, loadFaceClassifier } from '../src/face-classification.mjs';
import { vector } from '../src/real.mjs';

const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const plane = (origin, normal) => ({ origin, normal });
const known = (volume, components = 1) => ({ kind: volume ? 'solid' : 'empty', volume, components: volume ? components : 0 });

export async function booleanPortCases({ imported = true } = {}) {
  const k = await loadKernel(), classifier = await loadFaceClassifier();
  const prism = (name, points) => extrudeInBend(k, name, points, frame, [0, 0, 4]);
  const box = prism('box', [[0, 0], [8, 0], [8, 6], [0, 6]]);
  const l = prism('L', [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]]);
  const u = prism('U', [[0, 0], [8, 0], [8, 6], [6, 6], [6, 2], [2, 2], [2, 6], [0, 6]]);
  const c = prism('C', [[0, 0], [8, 0], [8, 2], [2, 2], [2, 4], [8, 4], [8, 6], [0, 6]]);
  const cases = [];
  const add = (id, category, body, cut, expected, options = {}) => cases.push({ id, category, body, plane: cut, expected, options });
  add('box-transverse', 'convex', box, plane([4, 0, 0], [1, 0, 0]), known(96));
  add('box-oblique', 'convex', box, plane([3, 0, 0], [1, 1, 1]), known(4.5));
  add('box-contained', 'disjoint', box, plane([10, 0, 0], [1, 0, 0]), known(192));
  add('box-empty', 'disjoint', box, plane([-1, 0, 0], [1, 0, 0]), known(0));
  add('box-face-keep', 'contact', box, plane([8, 0, 0], [1, 0, 0]), known(192));
  add('box-face-empty', 'contact', box, plane([0, 0, 0], [1, 0, 0]), known(0));
  add('box-edge', 'contact', box, plane([0, 0, 0], [1, -1, 0]), known(72));
  add('box-vertex', 'contact', box, plane([0, 0, 0], [1, 1, -1]), known(64 / 6));
  add('L-height', 'concave', l, plane([0, 0, 2], [0, 0, 1]), known(56));
  add('L-side', 'concave', l, plane([4, 0, 0], [1, 0, 0]), known(80));
  add('L-crossbar', 'concave', l, plane([0, 3, 0], [0, 1, 0]), known(76));
  add('L-upper', 'concave', l, plane([0, 3, 0], [0, -1, 0]), known(36));
  add('U-components', 'disconnected', u, plane([0, 3, 0], [0, -1, 0]), known(48, 2));
  add('C-components', 'disconnected', c, plane([3, 0, 0], [-1, 0, 0]), known(80, 2));
  add('U-height', 'concave', u, plane([0, 0, 2], [0, 0, 1]), known(64));
  for (const [i, d] of [-(2 ** -18), -1e-9, 0, 1e-9, 2 ** -18].entries()) {
    add(`contact-perturbation-${i}`, 'perturbation', box, plane([8 + d, 0, 0], [1, 0, 0]), known(Math.min(8, 8 + d) * 24));
  }
  const native = classificationInput(box, classifier).solid;
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) };
  const offset = vector([17, -31, 59]);
  add('box-rotated', 'transform', k.analytic.transform(native, rotation, offset),
    plane(k.analytic.point_transform(vector([4, 0, 0]), rotation, offset), k.precise.rotate(vector([1, 0, 0]), rotation)), known(96));
  const permuted = structuredClone(native), edges = array(permuted.edges), count = edges.length;
  permuted.edges = list(edges.toReversed().map(e => ({ ...e, start: e.end, end: e.start, same_sense: !e.same_sense })));
  permuted.faces = list(array(permuted.faces).toReversed().map(f => ({ ...f,
    loops: list(array(f.loops).map(loop => ({ ...loop, uses: list(array(loop.uses).map(use => ({ ...use, edge: count - use.edge - 1, forward: !use.forward }))) }))) })));
  add('box-permuted', 'identity', permuted, plane([4, 0, 0], [1, 0, 0]), known(96));
  const round = circularFrustumInBend(k, 'cylinder', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]);
  add('cylinder-axial', 'curved', round, plane([0, 0, 2], [0, 0, 1]), known(18 * Math.PI));
  add('cylinder-diameter', 'curved', round, plane([0, 0, 0], [1, 0, 0]), known(18 * Math.PI));
  add('cylinder-oblique', 'curved', round, plane([0, 0, 2], [0.1, 0, 1]), known(18 * Math.PI));
  const open = structuredClone(box); open.faces.pop();
  add('open-shell', 'invalid', open, plane([4, 0, 0], [1, 0, 0]), { kind: 'reject' });
  const invalid = structuredClone(box); invalid.faces[0].surface.normal = [0, 0, 1];
  add('reversed-face', 'invalid', invalid, plane([4, 0, 0], [1, 0, 0]), { kind: 'reject' });
  add('source-tolerance', 'source-tolerance', box, plane([4, 0, 0], [1, 0, 0]), { kind: 'unknown' }, { inputTolerance: 0.0003 });
  add('zero-normal', 'invalid', box, plane([4, 0, 0], [0, 0, 0]), { kind: 'reject' });
  add('zero-tolerance', 'invalid', box, plane([4, 0, 0], [1, 0, 0]), { kind: 'reject' }, { linear: 0 });
  // A closed oriented graph can still enclose no material. Two coincident
  // opposite triangular faces must fail before the halfspace Empty shortcut.
  const points = [[0, 0, 2], [2, 0, 2], [0, 2, 2]].map(vector);
  const triEdges = [0, 1, 2].map(i => ({ $: 'Edge', start: i, end: (i + 1) % 3,
    curve: { $: 'Line', origin: points[i], direction: k.precise.sub(points[(i + 1) % 3], points[i]) }, same_sense: true }));
  const triSurface = k.analytic.plane(vector([0, 0, 2]), vector([0, 0, 1]));
  const triFace = (sense, uses) => ({ $: 'Face', surface: triSurface, same_sense: sense,
    loops: list([{ $: 'Loop', outer: true, uses: list(uses.map(([edge, forward]) => ({ $: 'Use', edge, forward }))) }]) });
  const zeroVolume = { $: 'Solid', vertices: list(points), edges: list(triEdges),
    faces: list([triFace(false, [[2, false], [1, false], [0, false]]), triFace(true, [[0, true], [1, true], [2, true]])]) };
  add('zero-volume-shell', 'invalid', zeroVolume, plane([0, 0, 1], [0, 0, 1]), { kind: 'reject' });
  if (imported) {
    const path = new URL('../fixtures/r10b/modules/base/ZtoDD.body.json', import.meta.url), bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9') throw new Error('Frozen P10 input changed');
    const body = transformAnalytic(k, importOnshapeBody(k, JSON.parse(bytes).bodies[0], 'P10', { sha256 }), 'P10-transformed',
      [[1, 0, 0], [0, 0.9063077870366499, -0.42261826174069944], [0, 0.42261826174069944, 0.9063077870366499]], [0, 85.7915071334, -183.980480768]);
    const tool = extrudeInBend(k, 'box', [[-119, 4], [-92.79, 4], [-92.79, 46], [-119, 46]],
      { ...frame, origin: [0, 0, -61] }, [0, 0, 129]);
    for (const [i, face] of tool.faces.entries()) add(`r10b-plane-${i}`, 'imported', body, face.surface, { kind: 'unknown', inputSha256: sha256 });
  }
  return cases;
}
