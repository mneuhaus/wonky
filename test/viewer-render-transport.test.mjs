import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-render-transport.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFile } = await import("node:fs/promises");
const { build } = await import("../src/index.mjs");
const { reviewScene } = await import("../src/review-scene.mjs");
const { buildDrawPayload, drawQuery, loadDrawKernel } = await import("../src/viewer/draw.mjs");
const { DRAW_MAGIC, SECTIONS, decodeDrawPayload, drawLayout, drawModel, octDecode, octEncode, sceneDrawModel } = await import("../viewer/render/draw-decode.js");
const { defaultCamera, defaultLegacyCamera, depthPerPixel, fit, preset } = await import("../viewer/render/camera.js");
const { createPanes } = await import("../viewer/render/panes.js");
const { createPicker, hiddenMask, pickModel, projectModel } = await import("../viewer/render/picking.js");
const { cacheOf, createSceneCache } = await import("../viewer/render/scene-cache.js");
const { createRenderer, highlightStates } = await import("../viewer/render/renderer.js");
const { RenderCapabilityError, WEBGL2_REQUIRED } = await import("../viewer/render/gl.js");
// render-transport: draw payload encode/decode, JSON-adapter parity, the
// typed-array picker, highlight states, the scene cache LRU and the WebGL2
// renderer lifecycle (fake GL context).














const example = async name => build(
  await readFile(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8'));
const models = {};
for (const name of ['bored-spacer', 'bracket', 'conical-spacer']) {
  models[name] = await example(name);
}
await loadDrawKernel();

async function payloadOf(model, modelId = 'm') {
  const scene = await reviewScene(model, { id: modelId });
  const result = await drawQuery(model, { modelId, scene });
  return { scene, ...result };
}

const pane = (width = 800, height = 600, modelId = 'm') => ({
  x: 0, y: 0, width, height, clipX: 0, clipWidth: width, modelId, side: 'after',
});
const fitted = (bounds, view, name = 'iso') => fit(bounds, preset(name, defaultCamera(bounds)),
  view);
const REFERENCE_KEYS = ['modelId', 'bodyId', 'entityType', 'entityIndex'];

test('payload layout: magic, aligned sections, center-relative float32 positions', async () => {
  const { scene, header, buffer } = await payloadOf(models['bored-spacer']);
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), DRAW_MAGIC);
  const headerBytes = view.getUint32(4, true);
  assert.equal(headerBytes % 4, 0);
  const { sections, byteLength } = drawLayout(header.counts, headerBytes);
  assert.equal(byteLength, buffer.byteLength);
  for (const [name] of SECTIONS) assert.equal(sections[name].offset % 4, 0, name);
  const decoded = decodeDrawPayload(buffer);
  assert.deepEqual(decoded.header, JSON.parse(JSON.stringify(header)));
  const center = header.center;
  assert.deepEqual(center, [0, 1, 2].map(axis => (scene.bounds.min[axis]
    + scene.bounds.max[axis]) / 2));
  const { vertexPoints, vertexIndex } = decoded.arrays;
  scene.bodies[0].vertices.forEach((vertex, index) => {
    assert.equal(vertexIndex[index], vertex.index);
    for (let axis = 0; axis < 3; axis++) {
      assert.equal(vertexPoints[3 * index + axis], Math.fround(vertex.point[axis] - center[axis]));
    }
  });
  assert.equal(header.schema, 'wonky.draw/1');
  assert.equal(header.exactness, 'display-approximation');
  assert.equal(header.toleranceMm, 0.02);
  assert.deepEqual(header.edgeClassNames, ['sharp', 'tangent', 'seam', 'subdivision',
    'unresolved']);
  assert.ok(header.notes[0].includes('analytic B-rep remains authoritative'));
  assert.equal(buildDrawPayload(models['bored-spacer'], null, {}), null, 'lazy without a scene');
});

test('exact per-vertex normals on cylinders and cones; winding follows the outward normal',
  async () => {
    for (const name of ['bored-spacer', 'conical-spacer']) {
      const model = models[name];
      const { header, buffer } = await payloadOf(model);
      const draw = drawModel(decodeDrawPayload(buffer));
      assert.ok(header.faces.every(face => face.normalSource === 'exact'), name);
      const { positions, normals, indices, faceOfVertex } = draw.arrays;
      const at = (array, index) => [array[3 * index], array[3 * index + 1],
        array[3 * index + 2]];
      let checked = 0;
      for (let vertex = 0; vertex < draw.counts.vertices; vertex++) {
        const face = draw.faces[faceOfVertex[vertex]];
        const brep = model.bodies[face.body].faces[face.index];
        if (brep.surface.type !== 'cylinder') continue;
        const { origin, axis } = brep.surface;
        const world = at(positions, vertex).map((value, i) => value + draw.center[i]);
        const d = world.map((value, i) => value - origin[i]);
        const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
        const radial = d.map((value, i) => value - along * axis[i]);
        const length = Math.hypot(...radial);
        const sign = brep.sameSense === false ? -1 : 1;
        const expected = radial.map(value => sign * value / length);
        const decoded = octDecode(normals[2 * vertex], normals[2 * vertex + 1]);
        const angle = Math.acos(Math.min(1, decoded.reduce((sum, value, i) => sum
          + value * expected[i], 0)));
        assert.ok(angle < 1e-4, `${name} vertex ${vertex}: ${angle} rad`);
        checked++;
      }
      if (name === 'bored-spacer') assert.ok(checked > 100, 'cylinder vertices checked');
      for (let triangle = 0; triangle < draw.counts.triangles; triangle++) {
        const [a, b, c] = [0, 1, 2].map(k => at(positions, indices[3 * triangle + k]));
        const n = octDecode(normals[2 * indices[3 * triangle]],
          normals[2 * indices[3 * triangle] + 1]);
        const u = b.map((value, i) => value - a[i]);
        const v = c.map((value, i) => value - a[i]);
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0]];
        assert.ok(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > -1e-9,
          `${name} triangle ${triangle} winds outward`);
      }
    }
  });

test('oct16 normals round-trip within 0.004 degrees', () => {
  const out = new Int16Array(2);
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const z = 2 * ((i * 0.6180339887) % 1) - 1;
    const angle = i * 2.399963;
    const r = Math.sqrt(1 - z * z);
    const n = [r * Math.cos(angle), r * Math.sin(angle), z];
    octEncode(...n, out, 0);
    const back = octDecode(out[0], out[1]);
    const dot = back.reduce((sum, value, k) => sum + value * n[k], 0);
    worst = Math.max(worst, Math.acos(Math.min(1, dot)) * 180 / Math.PI);
  }
  assert.ok(worst < 0.004, `worst ${worst} deg`);
});

test('JSON adapter and draw payload return identical references (96 points, every mode)',
  async () => {
    for (const name of ['bored-spacer', 'bracket', 'conical-spacer']) {
      const { scene, buffer } = await payloadOf(models[name], 'm');
      const fromDraw = drawModel(decodeDrawPayload(buffer), { id: 'm' });
      const fromJson = sceneDrawModel(scene);
      for (const view of ['iso', 'front', 'top']) {
        const screen = pane();
        const camera = fitted(scene.bounds, screen, view);
        const a = projectModel(fromDraw, screen, camera);
        const b = projectModel(fromJson, screen, camera);
        for (const mode of ['auto', 'face', 'edge', 'vertex', 'body']) {
          let hits = 0;
          for (let row = 0; row < 8; row++) {
            for (let column = 0; column < 12; column++) {
              const x = 200 + column * 400 / 11;
              const y = 150 + row * 300 / 7;
              const left = pickModel(fromDraw, a, x, y, mode, { modelId: 'm' });
              const right = pickModel(fromJson, b, x, y, mode, { modelId: 'm' });
              assert.equal(JSON.stringify(left), JSON.stringify(right),
                `${name} ${view} ${mode} ${x},${y}`);
              if (left) {
                hits++;
                assert.deepEqual(Object.keys(left), REFERENCE_KEYS);
              }
            }
          }
          if (mode === 'auto' || mode === 'face') assert.ok(hits > 10, `${name} ${view} ${mode}`);
        }
      }
    }
  });

// A 20 x 20 mm wall of thickness `thickness`, seen from the front (-Y),
// with an extra edge and point lying on its back face.
function wallScene(thickness = 1) {
  const front = [[0, 0, 0], [20, 0, 0], [20, 0, 20], [0, 0, 20]];
  const back = front.map(([x, , z]) => [x, thickness, z]);
  const quad = (points, normal) => [
    { points: [points[0], points[1], points[2]], normal },
    { points: [points[0], points[2], points[3]], normal },
  ];
  return {
    id: 'wall', bounds: { min: [0, 0, 0], max: [20, thickness, 20] },
    bodies: [{
      id: 'wall', faces: [
        { index: 0, surfaceType: 'plane', edgeIndices: [0], triangles: quad(front, [0, -1, 0]) },
        { index: 1, surfaceType: 'plane', edgeIndices: [1], triangles: quad(back, [0, 1, 0]) },
      ],
      edges: [
        { index: 0, curveType: 'line', points: [front[0], front[1]] },
        { index: 1, curveType: 'line', points: [[5, thickness, 10], [15, thickness, 10]] },
      ],
      vertices: [{ index: 0, point: [10, thickness, 10] }],
    }],
  };
}

test('an edge or point behind a 1 mm wall is not pickable; the tolerance is 1.5 px of depth',
  () => {
    const scene = wallScene(1);
    const model = sceneDrawModel(scene);
    const screen = pane(800, 600, 'wall');
    const camera = fitted(scene.bounds, screen, 'front');
    const view = projectModel(model, screen, camera);
    const expected = 1.5 * depthPerPixel(camera, screen, scene.bounds);
    assert.ok(Math.abs(view.depthTolerance - expected) < 1e-12);
    assert.ok(view.depthTolerance < 1, 'fit view: 1.5 px is far less than 1 mm');
    const x = (view.edges.x[2] + view.edges.x[3]) / 2;
    const y = view.edges.y[2];
    assert.equal(pickModel(model, view, x, y, 'edge', { modelId: 'wall' }), null);
    const px = view.points.x[0];
    const py = view.points.y[0];
    assert.equal(pickModel(model, view, px, py, 'vertex', { modelId: 'wall' }), null);
    assert.equal(pickModel(model, view, x, y, 'auto', { modelId: 'wall' }).entityType, 'face');
  });

test('hidden bodies are skipped and clipped-away sides are not pickable', () => {
  const scene = wallScene(1);
  const model = sceneDrawModel(scene);
  const screen = pane(800, 600, 'wall');
  const camera = fitted(scene.bounds, screen, 'front');
  const view = projectModel(model, screen, camera);
  const hit = pickModel(model, view, 400, 300, 'face', { modelId: 'wall' });
  assert.deepEqual(hit, { modelId: 'wall', bodyId: 'wall', entityType: 'face', entityIndex: 0 });
  const hidden = hiddenMask(model, { bodies: { wall: { visible: false } } });
  assert.equal(pickModel(model, view, 400, 300, 'face', { modelId: 'wall', hidden }), null);
  const clipPlanes = [{ origin: [0, 0.5, 0], normal: [0, -1, 0] }];
  // Integration (section): the back face seen through the cut is the inside
  // of the body, so the pixel shows the section cap and no face is picked.
  assert.equal(pickModel(model, view, 400, 300, 'face', { modelId: 'wall', clipPlanes }), null,
    'the front face is clipped away; the cap under the cursor picks nothing');
  assert.equal(pickModel(model, view, 400, 300, 'face', { modelId: 'wall' }).entityIndex, 0,
    'without the plane the front face is picked again');
});

test('a model offset by 1e5 mm keeps float32 positions small and near exact', async () => {
  const shifted = structuredClone(models['bored-spacer']);
  const offset = [1e5, 1e5, 0];
  const move = point => point.map((value, axis) => value + offset[axis]);
  for (const body of shifted.bodies) {
    body.vertices = body.vertices.map(move);
    for (const edge of body.edges) {
      if (edge.curve?.origin) edge.curve.origin = move(edge.curve.origin);
    }
    for (const face of body.faces) {
      if (face.surface?.origin) face.surface.origin = move(face.surface.origin);
    }
    delete body.construction;
  }
  const { scene, buffer } = await payloadOf(shifted, 'far');
  const draw = drawModel(decodeDrawPayload(buffer), { id: 'far' });
  assert.ok(draw.center[0] > 99990);
  const largest = draw.arrays.positions.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(largest < 20, `relative positions stay small (${largest})`);
  let worst = 0;
  scene.bodies[0].edges[0].points.forEach((point, index) => {
    for (let axis = 0; axis < 3; axis++) {
      const back = draw.center[axis] + draw.arrays.edgePoints[3 * index + axis];
      worst = Math.max(worst, Math.abs(back - point[axis]));
    }
  });
  assert.ok(worst < 1e-5, `worst ${worst} mm`);
});

// Replaces the logical grouping of a model (faces listed per group).
function withLogical(model, groups) {
  const logicalOf = new Uint32Array(model.counts.faces);
  const offsets = new Uint32Array(groups.length + 1);
  const fragments = new Uint32Array(model.counts.faces);
  let cursor = 0;
  groups.forEach((group, index) => {
    offsets[index] = cursor;
    for (const face of group) {
      fragments[cursor++] = face;
      logicalOf[face] = index;
    }
  });
  offsets[groups.length] = cursor;
  return { ...model, logicalOf, logicalOffsets: offsets, logicalFragments: fragments };
}

test('highlight states: logical expansion, lone fragments, multi-selection, hover outline',
  async () => {
    const { buffer } = await payloadOf(models.bracket, 'm');
    const model = drawModel(decodeDrawPayload(buffer), { id: 'm' });
    const bodyId = model.bodies[0].id;
    const face = entityIndex => ({ modelId: 'm', bodyId, entityType: 'face', entityIndex });
    const lone = withLogical(model, [...Array(model.counts.faces).keys()].map(index => [index]));
    const one = highlightStates(lone, { selection: [face(1)] }, 'm');
    assert.deepEqual([...one.faces].flatMap((value, index) => (value ? [index] : [])), [1],
      'with one fragment per logical face each fragment highlights alone');
    const merged = withLogical(model, [[0, 1], ...[...Array(model.counts.faces).keys()].slice(2)
      .map(index => [index])]);
    const both = highlightStates(merged, { selection: [face(1)] }, 'm');
    assert.equal(both.faces[0], 2);
    assert.equal(both.faces[1], 2);
    const many = highlightStates(lone, { selection: [face(0), face(3), face(5),
      { modelId: 'm', bodyId, entityType: 'edge', entityIndex: 2 },
      { modelId: 'm', bodyId, entityType: 'vertex', entityIndex: 4 }] }, 'm');
    assert.deepEqual([0, 3, 5].map(index => many.faces[index]), [2, 2, 2]);
    assert.equal(many.edges[2], 2);
    assert.deepEqual(many.points, [[4, 2]]);
    const hover = highlightStates(lone, { hover: face(2) }, 'm');
    assert.equal(hover.faces[2], 1);
    const start = model.arrays.faceEdgeOffsets[2];
    const end = model.arrays.faceEdgeOffsets[3];
    assert.ok(end > start);
    for (let item = start; item < end; item++) {
      assert.equal(hover.edges[model.arrays.faceEdges[item]], 1, 'hover outlines the face');
    }
    const other = highlightStates(model, { selection: [{ ...face(0), modelId: 'x' }] }, 'm');
    assert.ok(other.faces.every(value => value === 0), 'other models are not highlighted');
    const body = highlightStates(model, { selection: [{ modelId: 'm', bodyId,
      entityType: 'body', entityIndex: 0 }] }, 'm');
    assert.ok(body.faces.every(value => value === 2));
  });

// Fake WebGL2 context: hands out handles and records calls, never draws.
function fakeGl({ stencil = true } = {}) {
  const calls = [];
  let handles = 0;
  return new Proxy({}, {
    get(_target, name) {
      if (typeof name !== 'string') return undefined;
      if (name === 'calls') return calls;
      if (/^[A-Z0-9_]+$/.test(name)) return name;
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (name === 'getContextAttributes') return () => ({ stencil });
      return (...args) => {
        calls.push(name);
        if (name.startsWith('create')) return { kind: name.slice(6), id: ++handles };
        if (name === 'getUniformLocation') return { uniform: args[1] };
        return null;
      };
    },
  });
}

function fakeCanvas(context) {
  const listeners = new Map();
  return {
    clientWidth: 800, clientHeight: 600, width: 0, height: 0,
    getContext: type => (type === 'webgl2' ? context : null),
    addEventListener: (name, handler) => listeners.set(name, handler),
    emit: (name, event = {}) => listeners.get(name)?.({ preventDefault() {}, ...event }),
  };
}

function rendererHarness({ context = fakeGl(), payload } = {}) {
  const cache = createSceneCache();
  const frames = [];
  const requests = [];
  const env = {
    window: { devicePixelRatio: 1 },
    document: { querySelector: () => null },
    requestAnimationFrame: callback => frames.push(callback),
    fetch: async path => {
      requests.push(path);
      if (path.endsWith('/draw')) {
        return { ok: true, arrayBuffer: async () => payload.slice(0) };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'Unknown model revision' }) };
    },
  };
  const state = {
    after: null, before: null, compare: false, mode: 'auto', camera: defaultLegacyCamera(),
    center: [0, 0, 0], extent: 10, selectionSet: [],
  };
  Object.defineProperty(state, 'scenes', { get: () => cache.scenes });
  const canvas = fakeCanvas(context);
  const panes = createPanes({ canvas, state });
  const picker = createPicker({ state, panes });
  const renderer = createRenderer({ env, canvas, state, cache, panes, picker });
  return { cache, renderer, state, canvas, context, requests, frames, picker };
}

test('WebGL2 is required: a browser without it gets the capability message', () => {
  const cache = createSceneCache();
  const state = { camera: defaultLegacyCamera(), center: [0, 0, 0], extent: 1 };
  const make = canvas => {
    const panes = createPanes({ canvas, state });
    return createRenderer({
      env: { window: {}, fetch() {} }, canvas, state, cache, panes,
      picker: createPicker({ state, panes }),
    });
  };
  const renderer = make(fakeCanvas(null));
  assert.throws(() => renderer.init(), error => error instanceof RenderCapabilityError
    && error.message === WEBGL2_REQUIRED);
  assert.equal(renderer.available(), false);
  assert.equal(renderer.unavailableReason(), WEBGL2_REQUIRED);
  assert.match(WEBGL2_REQUIRED, /WebGL2/);
  assert.match(WEBGL2_REQUIRED, /inspector/);
  assert.throws(() => make(fakeCanvas(fakeGl({ stencil: false }))).init(),
    RenderCapabilityError, 'a context without stencil fails');
});

test('opening 12 revisions keeps at most 8 unpinned and deletes evicted GPU buffers', async () => {
  const { buffer } = await payloadOf(models['bored-spacer'], 'm');
  const { renderer, cache, state } = rendererHarness({ payload: buffer });
  renderer.init();
  const ids = Array.from({ length: 12 }, (_value, index) => index.toString(16).padStart(64, '0'));
  for (const id of ids) {
    state.after = id;
    await renderer.loadModel(id);
    renderer.draw();
  }
  const stats = renderer.stats();
  assert.equal(stats.cache.entries, 9);
  assert.equal(stats.cache.pinned, 1, 'the displayed revision is pinned');
  assert.equal(stats.cache.unpinned, 8);
  assert.equal(stats.cache.evictions, 3);
  assert.equal(stats.gpu.uploads, 12);
  assert.equal(stats.gpu.releases, 3);
  assert.equal(stats.gpu.buffersDeleted, 3 * 8, 'eight buffers per model');
  assert.equal(stats.gpu.vertexArraysDeleted, 3 * 3);
  assert.equal(stats.gpu.texturesDeleted, 3 * 2);
  assert.ok(!cache.has(ids[0]) && !cache.has(ids[2]) && cache.has(ids[3]));
  assert.ok(cache.has(ids[11]));
  cache.pin('ghost', [ids[4]]);
  state.annotations = [{ target: { modelId: ids[5] }, view: { before: ids[6], after: ids[6] } }];
  for (let index = 0; index < 3; index++) {
    const id = `f${index}`.padStart(64, 'f');
    state.after = id;
    await renderer.loadModel(id);
  }
  assert.ok(cache.has(ids[4]), 'an explicitly pinned revision stays');
  assert.ok(cache.has(ids[5]) && cache.has(ids[6]), 'annotated revisions stay pinned');
  assert.ok(cache.stats().unpinned <= 8);
});

test('context loss keeps the typed arrays; restore recompiles and re-uploads', async () => {
  const { buffer } = await payloadOf(models['bored-spacer'], 'm');
  const { renderer, cache, state, canvas } = rendererHarness({ payload: buffer });
  const lost = [];
  const restored = [];
  renderer.onContextLost(() => lost.push(1));
  renderer.onContextRestored(() => restored.push(1));
  renderer.init();
  const id = 'a'.repeat(64);
  state.after = id;
  await renderer.loadModel(id);
  renderer.draw();
  assert.equal(renderer.stats().gpu.uploads, 1);
  canvas.emit('webglcontextlost');
  assert.equal(renderer.available(), false);
  assert.equal(lost.length, 1);
  assert.ok(cache.entry(id).model, 'typed arrays retained');
  assert.equal(cache.entry(id).gpu, null);
  renderer.draw();
  assert.equal(renderer.stats().gpu.uploads, 1, 'nothing is drawn while lost');
  canvas.emit('webglcontextrestored');
  assert.equal(restored.length, 1);
  assert.equal(renderer.available(), true);
  const stats = renderer.stats().gpu;
  assert.equal(stats.programs, 2);
  assert.equal(stats.uploads, 2, 'the displayed model is uploaded again');
  assert.equal(stats.contextLosses, 1);
  assert.equal(stats.contextRestores, 1);
});

test('the legacy JSON path draws the adapter, then swaps to the draw payload', async () => {
  const { buffer, scene } = await payloadOf(models['bored-spacer'], 'm');
  const { renderer, cache, state, requests, frames } = rendererHarness({ payload: buffer });
  renderer.init();
  const id = 'b'.repeat(64);
  const json = { ...scene, id };
  state.after = id;
  cache.scenes.set(id, json);
  assert.equal(cacheOf(cache.scenes), cache);
  assert.equal(cache.model(id).source, 'json');
  renderer.prepareScene(json);
  assert.equal(renderer.stats().gpu.uploads, 1, 'the adapter is drawn at once');
  await cache.entry(id).drawLoading;
  assert.deepEqual(requests, [`/api/models/${id}/draw`]);
  assert.equal(cache.model(id).source, 'draw');
  while (frames.length) frames.shift()();
  assert.equal(renderer.stats().gpu.uploads, 2);
  assert.equal(renderer.stats().gpu.releases, 1, 'the adapter buffers are released');
});

test('hover is drawn in the same call as the highlight change; selection takes any count',
  async () => {
    const { buffer } = await payloadOf(models.bracket, 'm');
    const { renderer, state } = rendererHarness({ payload: buffer });
    renderer.init();
    const id = 'c'.repeat(64);
    state.after = id;
    const model = await renderer.loadModel(id);
    const bodyId = model.bodies[0].id;
    const draws = renderer.stats().frames.draws;
    const face = index => ({ modelId: id, bodyId, entityType: 'face', entityIndex: index });
    renderer.setHighlights({ hover: face(1), hoverPane: 'after' });
    assert.equal(renderer.stats().frames.draws, draws + 1);
    assert.equal(renderer.stats().frames.hoverDraws, 1);
    renderer.setHighlights({ selection: [face(0), face(2), face(4), face(6)] });
    assert.equal(renderer.stats().frames.draws, draws + 1, 'selection waits for the frame');
    assert.deepEqual(renderer.highlightState(id).selectedFaces, [0, 2, 4, 6]);
    assert.deepEqual(renderer.highlightState(id).hoverFaces, [1]);
    assert.deepEqual(renderer.highlights().selection, [face(0), face(2), face(4), face(6)]);
  });

test('the scene cache is Map-compatible and loads the JSON scene only on request', async () => {
  const cache = createSceneCache();
  const requests = [];
  cache.configure({
    fetch: async path => {
      requests.push(path);
      return { ok: true, json: async () => ({ id: 'z', bounds: null, bodies: [] }) };
    },
  });
  const scene = { id: 'y', bodies: [] };
  cache.scenes.set('y', scene);
  assert.equal(cache.scenes.get('y'), scene);
  assert.equal(cache.scenes.has('y'), true);
  assert.deepEqual([...cache.scenes.keys()], ['y']);
  cache.scenes.delete('y');
  assert.equal(cache.has('y'), false);
  const [first, second] = await Promise.all([cache.loadScene('z'), cache.loadScene('z')]);
  assert.equal(first, second);
  assert.deepEqual(requests, ['/api/models/z'], 'one request for concurrent loads');
  assert.equal(await cache.loadScene('z'), first);
  assert.equal(requests.length, 1);
  cache.scenes.clear();
  assert.equal(cache.scenes.size, 0);
});

test('the screen grid returns what a linear scan over every triangle returns', async () => {
  const { buffer } = await payloadOf(models['bored-spacer'], 'm');
  const model = drawModel(decodeDrawPayload(buffer), { id: 'm' });
  const { indices, faceOfVertex } = model.arrays;
  for (const [name, factor] of [['iso', 1], ['top', 6], ['front', 0.3]]) {
    const screen = pane(640, 480);
    const base = fitted(model.bounds, screen, name);
    const camera = base.height ? { ...base, height: base.height / factor }
      : { ...base, zoom: base.zoom * factor };
    const view = projectModel(model, screen, camera);
    const { x: sx, y: sy, depth: sd } = view.vertices;
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let sample = 0; sample < 400; sample++) {
      const x = random() * 640;
      const y = random() * 480;
      let best = -Infinity;
      let face = -1;
      for (let triangle = 0; triangle < model.counts.triangles; triangle++) {
        const [a, b, c] = [0, 1, 2].map(k => indices[3 * triangle + k]);
        const denominator = (sy[b] - sy[c]) * (sx[a] - sx[c]) + (sx[c] - sx[b]) * (sy[a] - sy[c]);
        if (Math.abs(denominator) < 1e-10) continue;
        const u = ((sy[b] - sy[c]) * (x - sx[c]) + (sx[c] - sx[b]) * (y - sy[c])) / denominator;
        const v = ((sy[c] - sy[a]) * (x - sx[c]) + (sx[a] - sx[c]) * (y - sy[c])) / denominator;
        const w = 1 - u - v;
        if (!(u >= -1e-9 && v >= -1e-9 && w >= -1e-9)) continue;
        const depth = sd[a] * u + sd[b] * v + sd[c] * w;
        if (depth > best) {
          best = depth;
          face = faceOfVertex[a];
        }
      }
      const picked = pickModel(model, view, x, y, 'face', { modelId: 'm' });
      assert.equal(picked?.entityIndex ?? -1, face < 0 ? -1 : model.faceLocal[face],
        `${name} ${x},${y}`);
    }
  }
});

}
