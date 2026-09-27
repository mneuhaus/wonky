import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-render-look.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFile } = await import("node:fs/promises");
const { build } = await import("../src/index.mjs");
const { reviewScene } = await import("../src/review-scene.mjs");
const { drawQuery, loadDrawKernel } = await import("../src/viewer/draw.mjs");
const { decodeDrawPayload, drawModel, sceneDrawModel } = await import("../viewer/render/draw-decode.js");
const { basis, defaultCamera, defaultLegacyCamera, preset } = await import("../viewer/render/camera.js");
const { createPanes } = await import("../viewer/render/panes.js");
const { createPicker, pickModel, projectModel } = await import("../viewer/render/picking.js");
const { createSceneCache } = await import("../viewer/render/scene-cache.js");
const { backToFront, bodyCenters, clipUniforms, createRenderer, modelFacts } = await import("../viewer/render/renderer.js");
const { COLORS, contrastRatio, EDGE_CLASS, EDGE_LOOK, FRAGMENT_SHADER, LIGHTING, LINE_VERTEX_SHADER, luminance, OVERHANG, PASS, shadeLinear, srgbToLinear, VERTEX_SHADER } = await import("../viewer/render/shaders.js");
const { appearanceColor, appearanceOpacity, bodyPasses, composeLookStates, composeStyle, facesOfAlias, mergedRanges, overhangCodes, resolveBodyStyle, VIEWER_PALETTE, XRAY_OPACITY } = await import("../viewer/render/style.js");
const { bodyOptions, lineOptions, packModelSegments, SEGMENT_WORDS, segmentsFrom } = await import("../viewer/render/layers.js");
const { legendItems, toleranceText } = await import("../viewer/features/display/legend.js");
const { createViewer } = await import("../viewer/app.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { FEATURES } = await import("../viewer/features/index.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
// render-look: lighting criteria (JS mirror of the shader), the style table,
// body colors and passes, overhang flags and edge classes in the state bits,
// line instances, layer helper options, the legend, the renderer passes on a
// recording fake WebGL2 context, and the display feature's commands.





















await loadDrawKernel();
const example = async name => build(
  await readFile(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8'));
const drawModels = {};
const payloads = {};
for (const name of ['bored-spacer', 'bracket']) {
  const model = await example(name);
  const scene = await reviewScene(model, { id: name });
  const { buffer } = await drawQuery(model, { modelId: name, scene });
  payloads[name] = buffer;
  drawModels[name] = drawModel(decodeDrawPayload(buffer.slice(0)), { id: name });
}

const EDGE_LUMINANCE = luminance(COLORS.edge.map(srgbToLinear));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const viewNormal = (camera, normal) => {
  const { right, up, toward } = basis(camera);
  return [dot(right, normal), dot(up, normal), dot(toward, normal)];
};
const BOX = { min: [0, 0, 0], max: [10, 10, 10] };

test('every lit shade of the viewer palette keeps >= 4.5:1 against the edge color', () => {
  // Deterministic sweep: 48 yaw x 13 pitch cameras, 400 normals on the sphere.
  const normals = [];
  for (let i = 0; i < 400; i++) {
    const z = 1 - 2 * (i + 0.5) / 400;
    const r = Math.sqrt(1 - z * z);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    normals.push([r * Math.cos(phi), r * Math.sin(phi), z]);
  }
  let worst = Infinity;
  for (const color of VIEWER_PALETTE) {
    for (let yawStep = 0; yawStep < 48; yawStep++) {
      for (let pitchStep = 0; pitchStep <= 12; pitchStep++) {
        const camera = { ...preset('iso', defaultCamera(BOX)), yaw: yawStep * Math.PI / 24,
          pitch: -Math.PI / 2 + pitchStep * Math.PI / 12 };
        for (const normal of normals) {
          const view = viewNormal(camera, normal);
          if (view[2] <= 0) continue;
          worst = Math.min(worst, contrastRatio(luminance(shadeLinear(color, normal, view)),
            EDGE_LUMINANCE));
        }
      }
    }
  }
  assert.ok(worst >= 4.5, `worst edge contrast ${worst.toFixed(2)}:1`);
});

test('the three principal iso faces differ by >= 1.3:1, top lightest', () => {
  const iso = preset('iso', defaultCamera(BOX));
  for (const color of VIEWER_PALETTE) {
    const [right, front, top] = [[1, 0, 0], [0, -1, 0], [0, 0, 1]]
      .map(normal => luminance(shadeLinear(color, normal, viewNormal(iso, normal))));
    assert.ok(top > front && front > right, `order for ${color}`);
    assert.ok(contrastRatio(top, front) >= 1.3, `top/front ${contrastRatio(top, front)}`);
    assert.ok(contrastRatio(front, right) >= 1.3, `front/right ${contrastRatio(front, right)}`);
  }
});

test('the shaders carry the lighting constants and the documented bits', () => {
  for (const value of [LIGHTING.sky - LIGHTING.ground, LIGHTING.ground, LIGHTING.key,
    LIGHTING.fill, LIGHTING.specular]) {
    assert.ok(FRAGMENT_SHADER.includes(String(value)), `constant ${value}`);
  }
  for (const value of [...LIGHTING.keyDirection, ...LIGHTING.fillDirection]) {
    assert.ok(FRAGMENT_SHADER.includes(String(value)), `direction ${value}`);
  }
  assert.ok(FRAGMENT_SHADER.includes('gl_FrontFacing'), 'two-sided through the winding');
  assert.ok(!/abs\(dot/.test(FRAGMENT_SHADER), 'no abs() lighting');
  assert.ok(VERTEX_SHADER.includes('rankPx') && VERTEX_SHADER.includes('% 8u'));
  assert.ok(LINE_VERTEX_SHADER.includes('biasPx * pxAt(p)'), 'depth bias in CSS px of depth');
  for (const source of [VERTEX_SHADER, FRAGMENT_SHADER, LINE_VERTEX_SHADER]) {
    assert.ok(!/\bhalf\b/.test(source.replace(/halfViewport|halfWidth|halfway/g, '')),
      'no reserved GLSL words');
  }
  assert.deepEqual(COLORS.edge.map(value => Math.round(value * 255)), [0x1d, 0x27, 0x21]);
  assert.equal(EDGE_LOOK.widthPx, 1.5);
});

test('composeStyle: defaults, clamps, clip planes, keys of every feature', () => {
  const empty = composeStyle({});
  assert.deepEqual(empty, {
    edges: true, edgeWidthPx: 1.5, hiddenEdges: false, xray: false, bodies: {}, models: {},
    clipPlanes: [], overhang: null, ghost: null,
  });
  const style = composeStyle({
    edges: { visible: false },
    look: { edgeWidthPx: 9, hiddenEdges: true },
    xray: { on: true },
    parts: { bodies: { a: { visible: false, color: [2, 0.5, 0], junk: 1 } },
      models: { m: { bodies: { b: { opacity: 0.25 } } } } },
    section: { planes: [{ origin: [1, 2, 3], normal: [0, 0, 2] },
      { origin: [0, 0, 0], normal: [0, 0, 0] }, { origin: [0, 0, 0], normal: [1, 0, 0],
        enabled: false }] },
    debug: { clipPlanes: [{ origin: [0, 0, 0], normal: [0, 1, 0] },
      { origin: [0, 0, 0], normal: [1, 0, 0] }, { origin: [0, 0, 0], normal: [1, 1, 0] }] },
    ghost: { modelId: 'g' },
  });
  assert.equal(style.edges, false);
  assert.equal(style.edgeWidthPx, 3, 'edge width is clamped to 1..3 CSS px');
  assert.equal(composeStyle({ look: { edgeWidthPx: 0.2 } }).edgeWidthPx, 1);
  assert.equal(style.hiddenEdges, true);
  assert.equal(style.xray, true);
  assert.deepEqual(style.bodies, { a: { visible: false, color: [1, 0.5, 0] } });
  assert.deepEqual(style.models, { m: { bodies: { b: { opacity: 0.25 } } } });
  assert.equal(style.clipPlanes.length, 3, 'at most three planes');
  assert.deepEqual(style.clipPlanes[0], { origin: [1, 2, 3], normal: [0, 0, 1] });
  assert.deepEqual(style.ghost, { modelId: 'g', opacity: 0.35 });
});

test('body colors: appearance (both record forms), viewer palette, override, x-ray', () => {
  assert.deepEqual(appearanceColor({ red: 0.85, green: 0.43, blue: 0.13, alpha: 1 }),
    [0.85, 0.43, 0.13]);
  assert.deepEqual(appearanceColor({ color: { red: 87, green: 117, blue: 130 }, opacity: 255 }),
    [87 / 255, 117 / 255, 130 / 255]);
  assert.equal(appearanceColor({ color: 'red' }), null);
  assert.equal(appearanceOpacity({ opacity: 255 }), 1);
  assert.equal(appearanceOpacity({ alpha: 0.5 }), 0.5);
  const plate = { id: 'p', index: 0, appearance: { red: 0.85, green: 0.43, blue: 0.13 } };
  const bare = { id: 'b', index: 2, appearance: null };
  const style = composeStyle({});
  assert.deepEqual(resolveBodyStyle(style, 'm', plate), {
    color: [0.85, 0.43, 0.13], colorSource: 'appearance', opacity: 1, visible: true,
  });
  const palette = resolveBodyStyle(style, 'm', bare);
  assert.equal(palette.colorSource, 'viewer-palette');
  assert.deepEqual(palette.color, [...VIEWER_PALETTE[2]]);
  const override = composeStyle({ parts: { bodies: { b: { color: [0.1, 0.2, 0.3] } },
    models: { m: { bodies: { p: { visible: false } } } } } });
  assert.equal(resolveBodyStyle(override, 'm', bare).colorSource, 'override');
  assert.equal(resolveBodyStyle(override, 'm', plate).visible, false, 'per revision');
  assert.equal(resolveBodyStyle(override, 'other', plate).visible, true);
  const xray = composeStyle({ xray: { on: true } });
  assert.equal(resolveBodyStyle(xray, 'm', plate).opacity, XRAY_OPACITY);
  assert.deepEqual(bodyPasses({ bodies: [plate, bare] }, override, 'm'),
    { opaque: [2], transparent: [], hidden: [0] });
  assert.deepEqual(bodyPasses({ bodies: [plate, bare] }, xray, 'm'),
    { opaque: [], transparent: [0, 2], hidden: [] });
  const bodies = [{ r: [0, 4] }, { r: [4, 9] }, { r: [9, 9] }, { r: [9, 12] }];
  assert.deepEqual(mergedRanges(bodies, [0, 1, 3], body => body.r), [[0, 12]]);
  assert.deepEqual(mergedRanges(bodies, [0, 3], body => body.r), [[0, 4], [9, 12]]);
});

test('edge classes and overhang flags go into the state bits; outlines and accents', () => {
  const model = drawModels['bored-spacer'];
  const faces = new Uint8Array(model.counts.faces);
  const edges = new Uint8Array(model.counts.edges);
  edges[0] = 2;
  const cylinder = model.faces.findIndex(face => face.surfaceType === 'cylinder');
  const plane = model.faces.findIndex(face => face.surfaceType === 'plane');
  assert.deepEqual(facesOfAlias(model, `B1.F${model.faces[plane].index + 1}`), [plane]);
  assert.deepEqual(facesOfAlias(model, 'B9.F1'), []);
  const logical = model.logicalFaces[model.logicalOf[plane]];
  assert.deepEqual(facesOfAlias(model, logical.alias), logical.fragments);
  const style = composeStyle({ fdm: { overhang: { enabled: true, alphaDeg: 45, models: {
    'bored-spacer': { faces: {
      [`B1.F${model.faces[cylinder].index + 1}`]: 'overhang',
      [`B1.F${model.faces[plane].index + 1}`]: { kind: 'bed' },
    } },
  } } } });
  const codes = overhangCodes(model, style, 'bored-spacer');
  assert.equal(codes[cylinder], OVERHANG.curved, 'a cylinder overhang is sampled per normal');
  assert.equal(codes[plane], OVERHANG.bed);
  assert.equal(overhangCodes(model, style, 'other'), null);
  assert.equal(overhangCodes(model, composeStyle({}), 'bored-spacer'), null);
  const accented = composeLookStates(model, { faces, edges }, codes);
  assert.equal(faces[cylinder] >> 2, OVERHANG.curved);
  assert.equal(faces[plane] >> 2, OVERHANG.bed);
  model.arrays.edgeClass.forEach((code, edge) => {
    assert.equal((edges[edge] >> 2) & 7, code, `class of edge ${edge}`);
  });
  const { faceEdgeOffsets, faceEdges } = model.arrays;
  const outlined = new Set();
  for (let item = faceEdgeOffsets[plane]; item < faceEdgeOffsets[plane + 1]; item++) {
    outlined.add(faceEdges[item]);
    assert.equal((edges[faceEdges[item]] >> 5) & 3, 1, 'bed outline bit');
  }
  assert.equal(accented, new Set([0, ...outlined]).size, 'selection plus outlines');
  const facts = modelFacts(model);
  assert.ok(facts.edgeClasses.seam > 0, 'the bored spacer has seam edges');
  assert.equal(facts.smoothFaces, facts.curvedFaces);
  assert.equal(EDGE_CLASS.seam, 2);
});

test('line instances: model segments and layer lines share one layout', () => {
  const model = drawModels.bracket;
  const { buffer, count } = packModelSegments(model);
  assert.equal(count, model.counts.segments);
  const floats = new Float32Array(buffer);
  const words = new Uint32Array(buffer);
  const { edgePoints, edgeSegments, edgeOfSegment } = model.arrays;
  for (let segment = 0; segment < count; segment++) {
    const at = segment * SEGMENT_WORDS;
    const a = edgeSegments[2 * segment];
    const b = edgeSegments[2 * segment + 1];
    assert.deepEqual([...floats.subarray(at, at + 3)], [...edgePoints.subarray(3 * a, 3 * a + 3)]);
    assert.deepEqual([...floats.subarray(at + 3, at + 6)],
      [...edgePoints.subarray(3 * b, 3 * b + 3)]);
    assert.equal(words[at + 6], edgeOfSegment[segment]);
  }
  const origin = [100000.5, 0, 0];
  const lines = segmentsFrom([[100001, 0, 0], [100002, 1, 0], [100003, 2, 0]],
    { origin, strip: true, closed: true });
  assert.equal(lines.count, 3);
  const lineFloats = new Float32Array(lines.buffer);
  assert.deepEqual([...lineFloats.subarray(0, 6)], [0.5, 0, 0, 1.5, 1, 0],
    'float64 subtraction before float32');
  assert.equal(new Uint32Array(lines.buffer)[6], 0xffffffff);
  assert.equal(segmentsFrom([0, 0, 0, 1, 1, 1]).count, 1);
  assert.throws(() => segmentsFrom([[0, 0, 0]]), /pairs/);
  assert.throws(() => segmentsFrom([0, 0]), /x, y, z/);
  assert.deepEqual(lineOptions({ color: [1, 0, 0] }), {
    color: [1, 0, 0, 1], widthPx: 1.5, depthBias: 1, depthTest: true, clip: false,
  });
  const options = bodyOptions({ cull: 'front', colorMask: [0, 0, 0, 0], depthFunc: 'always',
    stencil: { func: 'always', ref: 1, zpass: 'invert', writeMask: 1 } });
  assert.equal(options.cull, 'front');
  assert.deepEqual(options.colorMask, [false, false, false, false]);
  assert.equal(options.depthFunc, 'ALWAYS');
  assert.deepEqual(options.stencil, { func: 'ALWAYS', ref: 1, mask: 255, fail: 'KEEP',
    zfail: 'KEEP', zpass: 'INVERT', writeMask: 1 });
  assert.throws(() => bodyOptions({ cull: 'sideways' }), /cull/);
  assert.throws(() => bodyOptions({ stencil: { zpass: 'explode' } }), /stencil op/);
});

test('clip-plane uniforms discard the half-space the picker skips', () => {
  const model = drawModels.bracket;
  const planes = composeStyle({ debug: { clipPlanes: [{ origin: [10, 0, 0],
    normal: [1, 0, 0] }] } }).clipPlanes;
  const { count, data } = clipUniforms(planes, model.center);
  assert.equal(count, 1);
  const pane = { x: 0, y: 0, width: 800, height: 600, clipX: 0, clipWidth: 800, modelId: 'm',
    side: 'after' };
  const camera = preset('iso', defaultCamera(model.bounds));
  const view = projectModel(model, pane, camera);
  let agreed = 0;
  let skipped = 0;
  for (let y = 60; y < 560; y += 20) {
    for (let x = 60; x < 760; x += 20) {
      const hit = pickModel(model, view, x, y, 'face', { clipPlanes: planes });
      const open = pickModel(model, view, x, y, 'face');
      if (!open) continue;
      if (!hit) skipped++;
      else agreed++;
    }
  }
  assert.ok(skipped > 0 && agreed > 0, 'the plane cuts the bracket');
  // Shader rule: dot(n, p - center) > offset is discarded.
  const inside = [5 - model.center[0], 0, 0];
  const outside = [15 - model.center[0], 0, 0];
  assert.ok(dot(data.subarray(0, 3), inside) <= data[3]);
  assert.ok(dot(data.subarray(0, 3), outside) > data[3]);
});

test('transparent bodies sort back to front by bounds center', () => {
  const model = drawModels.bracket;
  const centers = bodyCenters(model);
  assert.equal(centers.length, 3);
  const three = new Float64Array([0, 0, 0, 0, 0, 5, 0, 0, -5]);
  assert.deepEqual(backToFront(three, [0, 1, 2], [0, 0, 1]), [2, 0, 1]);
  assert.deepEqual(backToFront(three, [0, 1, 2], [0, 0, -1]), [1, 0, 2]);
});

test('legend: display tolerance and the active display-only features', () => {
  assert.equal(toleranceText(0.02), 'display mesh ±0.02 mm');
  assert.equal(toleranceText(null), 'display mesh (tolerance not stated)');
  const facts = {
    ...modelFacts(drawModels['bored-spacer']), curvedOverhangFaces: 1,
    bodies: [{ alias: 'B1', visible: true, colorSource: 'viewer-palette' }],
  };
  const text = style => legendItems({ facts: [facts], style }).map(item => item.text);
  assert.deepEqual(text(composeStyle({})), ['display mesh ±0.02 mm', 'smooth normals',
    'seam edges hidden', 'viewer colors']);
  const busy = composeStyle({ look: { hiddenEdges: true }, xray: { on: true },
    debug: { clipPlanes: [{ origin: [0, 0, 0], normal: [0, 0, 1] }],
      overhang: { enabled: true, alphaDeg: 45, models: {} } } });
  assert.deepEqual(text(busy), ['display mesh ±0.02 mm', 'smooth normals',
    'seam edges dimmed', 'x-ray 50 %', 'display section',
    'curved overhang sampled', 'viewer colors']);
  assert.deepEqual(text(composeStyle({ edges: { visible: false } })).slice(2, 3), ['edges off']);
  const item = legendItems({ facts: [facts], style: composeStyle({}) })
    .find(entry => entry.id === 'viewer-colors');
  assert.match(item.title, /B1: no appearance/);
  assert.deepEqual(legendItems({ facts: [], style: {} }), []);
});

// Regression (fix round): the Settings dialog writes edgeWidthPx, hiddenEdges
// and featureEdges directly; a one-shot restore applied them only on reload.
test('display feature applies the saved look at load and on every later settings change',
  async () => {
    const { features } = await loadFeatures(FEATURES);
    let document = { schema: 'wonky.viewer-settings/1', global: { edgeWidthPx: 2 }, sources: {},
      bodies: {} };
    const fake = createFakeEnvironment({
      dispatch: (path, options = {}) => {
        if (path !== '/api/settings') return {};
        if (options.method === 'PUT') {
          const patch = JSON.parse(options.body);
          document = { ...document, global: { ...document.global, ...patch.global } };
        }
        return structuredClone(document);
      },
    });
    const viewer = createViewer(fake.env, { features, log: () => {} });
    const { renderer, settings, store } = viewer.ctx;
    await settings.load();
    assert.equal(renderer.style().edgeWidthPx, 2, 'applied at load');
    await settings.set('G', 'edgeWidthPx', 3);
    assert.equal(store.get().display.look.edgeWidthPx, 3);
    assert.equal(renderer.style().edgeWidthPx, 3, 'applied without a reload');
    await settings.set('G', 'hiddenEdges', true);
    assert.equal(renderer.style().hiddenEdges, true);
    await settings.set('G', 'hiddenEdges', false);
    assert.equal(renderer.style().hiddenEdges, false);
    await settings.set('G', 'featureEdges', false);
    assert.equal(renderer.style().edges, false);
    await settings.set('G', 'featureEdges', true);
    assert.equal(renderer.style().edges, true);
    // The feature's own key writes come back as no-ops (no toggling loop).
    viewer.ctx.commands.run('view.toggleEdges');
    assert.equal(renderer.style().edges, false);
    assert.equal(settings.get('G', 'featureEdges'), false);
    viewer.dispose();
  });

// Recording fake WebGL2 context: numbers for enums, handles for create*.
function recordingGl() {
  const calls = [];
  let handles = 0;
  const enums = new Map();
  return new Proxy({}, {
    get(_target, name) {
      if (typeof name !== 'string') return undefined;
      if (name === 'calls') return calls;
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!enums.has(name)) enums.set(name, `GL_${name}`);
        return name === 'TEXTURE0' ? 33984 : enums.get(name);
      }
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (name === 'getContextAttributes') return () => ({ stencil: true });
      if (name === 'drawingBufferWidth' || name === 'drawingBufferHeight') return 100;
      return (...args) => {
        calls.push([name, ...args]);
        if (name.startsWith('create')) return { kind: name.slice(6), id: ++handles };
        if (name === 'getUniformLocation') return { uniform: args[1] };
        return null;
      };
    },
  });
}

function rendererHarness() {
  const cache = createSceneCache();
  const gl = recordingGl();
  const listeners = new Map();
  const canvas = {
    clientWidth: 800, clientHeight: 600, width: 0, height: 0,
    getContext: type => (type === 'webgl2' ? gl : null),
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  const env = {
    window: { devicePixelRatio: 2 }, document: { querySelector: () => null },
    requestAnimationFrame: () => {},
    fetch: async () => ({ ok: true, arrayBuffer: async () => payloads['bored-spacer'].slice(0) }),
  };
  const state = {
    after: null, before: null, compare: false, mode: 'auto', camera: defaultLegacyCamera(),
    center: [0, 0, 0], extent: 10, selectionSet: [],
  };
  Object.defineProperty(state, 'scenes', { get: () => cache.scenes });
  const panes = createPanes({ canvas, state });
  const picker = createPicker({ state, panes });
  const renderer = createRenderer({ env, canvas, state, cache, panes, picker });
  return { renderer, state, gl, cache };
}

const uniformCalls = (calls, uniform) => calls.filter(([name, location]) => name.startsWith(
  'uniform') && location?.uniform === uniform);
const since = (calls, start) => calls.slice(start);

test('renderer passes: seams hidden by default, Shift+E dims them, E keeps only accents',
  async () => {
    const { renderer, state, gl } = rendererHarness();
    renderer.init();
    const id = 'a'.repeat(64);
    state.after = id;
    await renderer.loadModel(id);
    const passAlphas = start => uniformCalls(since(gl.calls, start), 'classAlpha')
      .map(call => [...call[2]]);
    let start = gl.calls.length;
    renderer.draw();
    assert.equal(modelFacts(renderer.model(id)).edgeClasses.tangent, 0);
    assert.deepEqual(passAlphas(start), [[1, 0, 0, 0, 1]],
      'base pass only (sharp, unresolved): no tangent edges, seams hidden');
    const instanced = since(gl.calls, start).filter(([name]) => name === 'drawArraysInstanced');
    assert.ok(instanced.length >= 1 && instanced.every(call => call[3] === 4), '4 strip vertices');
    const widths = uniformCalls(since(gl.calls, start), 'widthPx').map(call => call[2]);
    assert.ok(widths.includes(3), '1.5 CSS px at DPR 2 is 3 device px');
    renderer.setStyle(composeStyle({ look: { hiddenEdges: true } }));
    start = gl.calls.length;
    renderer.draw();
    assert.deepEqual(passAlphas(start), [[1, 0, 0, 0, 1], [0, 0.45, 0.3, 0.3, 0]],
      'soft pass with seams dimmed (Shift+E)');
    renderer.setStyle(composeStyle({ edges: { visible: false } }));
    start = gl.calls.length;
    renderer.draw();
    assert.deepEqual(passAlphas(start), [], 'E off: no class pass, nothing highlighted');
    const model = renderer.model(id);
    renderer.setHighlights({ selection: [{ modelId: id, bodyId: model.bodies[0].id,
      entityType: 'edge', entityIndex: 0 }] });
    start = gl.calls.length;
    renderer.draw();
    const passes = uniformCalls(since(gl.calls, start), 'pass').map(call => call[2]);
    assert.deepEqual(passes, [PASS.accent], 'a selected edge still draws');
  });

test('renderer passes: x-ray draws back faces then front faces, then a depth mark', async () => {
  const { renderer, state, gl } = rendererHarness();
  renderer.init();
  const id = 'b'.repeat(64);
  state.after = id;
  await renderer.loadModel(id);
  renderer.setStyle(composeStyle({ xray: { on: true } }));
  const start = gl.calls.length;
  renderer.draw();
  const calls = since(gl.calls, start);
  const culls = calls.filter(([name]) => name === 'cullFace').map(call => call[1]);
  assert.deepEqual(culls, ['GL_FRONT', 'GL_BACK'], 'back faces first, then front faces');
  assert.ok(calls.some(([name, flag]) => name === 'depthMask' && flag === false));
  assert.ok(calls.some(([name, ...mask]) => name === 'colorMask' && mask.every(v => !v)),
    'depth-only pass');
  assert.ok(calls.some(([name, func]) => name === 'depthFunc' && func === 'GL_GREATER'),
    'faint hidden edges');
  const passes = uniformCalls(calls, 'pass').map(call => call[2]);
  assert.ok(passes.includes(PASS.hidden));
  const texels = calls.filter(([name]) => name === 'texSubImage2D').map(call => call[9])
    .find(data => data instanceof Float32Array);
  assert.equal(texels[3], XRAY_OPACITY, 'body opacity in the style texture');
});

test('layer helpers draw fat lines and bodies with stencil, culling and colorMask', async () => {
  const { renderer, state, gl } = rendererHarness();
  renderer.init();
  const id = 'c'.repeat(64);
  state.after = id;
  await renderer.loadModel(id);
  const results = {};
  renderer.addLayer({
    id: 'probe', order: 10,
    draw(frame) {
      results.lines = frame.drawLines({ positions: [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
        strip: true, widthPx: 2, depthBias: 1, color: [1, 0, 0, 1] });
      results.bodies = frame.drawBodies({ cull: 'back', colorMask: [false, false, false, false],
        stencil: { func: 'always', ref: 1, zpass: 'invert', writeMask: 1 } });
    },
  });
  const start = gl.calls.length;
  renderer.draw();
  const calls = since(gl.calls, start);
  assert.equal(results.lines, 2);
  assert.ok(results.bodies > 0);
  assert.ok(calls.some(([name, func, ref, mask]) => name === 'stencilFunc'
    && func === 'GL_ALWAYS' && ref === 1 && mask === 255));
  assert.ok(calls.some(([name, fail, zfail, zpass]) => name === 'stencilOp'
    && fail === 'GL_KEEP' && zfail === 'GL_KEEP' && zpass === 'GL_INVERT'));
  const lineColor = uniformCalls(calls, 'lineColor').at(-1);
  assert.deepEqual([...lineColor[2]], [1, 0, 0, 1]);
  assert.ok(uniformCalls(calls, 'biasPx').some(call => call[2] === 1));
  const stats = renderer.stats().gpu;
  assert.equal(stats.lookPrograms, 1);
  assert.equal(stats.lookBuffersCreated, 2, 'segments of the model plus the layer buffer');
  assert.equal(stats.lookTexturesCreated, 2);
  assert.ok(stats.lookBytes > 0);
});

test('display feature: Shift+E and T write their keys; the composed style reaches the renderer',
  async () => {
    const { features } = await loadFeatures(FEATURES);
    const fake = createFakeEnvironment({ dispatch: () => ({}) });
    const viewer = createViewer(fake.env, { features, log: () => {} });
    await Promise.resolve();
    const { commands, renderer, store } = viewer.ctx;
    assert.equal(renderer.style().hiddenEdges, false);
    commands.run('display.hiddenEdges');
    assert.equal(store.get().display.look.hiddenEdges, true);
    assert.equal(renderer.style().hiddenEdges, true);
    commands.run('display.xray');
    assert.equal(store.get().display.xray.on, true);
    assert.equal(renderer.style().xray, true);
    commands.run('view.toggleEdges');
    assert.equal(renderer.style().edges, false, 'E comes from the view feature key');
    viewer.ctx.app.setEdgeWidth(2.25);
    assert.equal(renderer.style().edgeWidthPx, 2.25);
    viewer.ctx.app.debugStyle({ clipPlanes: [{ origin: [0, 0, 0], normal: [0, 0, 1] }] });
    assert.equal(renderer.style().clipPlanes.length, 1);
    viewer.ctx.app.debugStyle(null);
    assert.equal(renderer.style().clipPlanes.length, 0);
    const keys = commands.bindings().filter(binding => ['display.hiddenEdges', 'display.xray']
      .includes(binding.id)).map(binding => binding.key);
    assert.deepEqual(keys, ['Shift+E', 'T']);
    assert.deepEqual(commands.conflicts(), []);
    const adapter = sceneDrawModel({ id: 'x', bounds: BOX, bodies: [] });
    assert.equal(adapter.counts.faces, 0);
  });

}
