import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-handedness.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createContext, runInContext } = await import("node:vm");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { toHtml } = await import("../src/preview.mjs");
const { reviewScene } = await import("../src/review-scene.mjs");
const camera = await import("../viewer/render/camera.js");
const { sceneDrawModel } = await import("../viewer/render/draw-decode.js");
const { pickDetail, projectModel } = await import("../viewer/render/picking.js");
const { launch, frames } = await import("../scripts/viewer/qa/browser.mjs");
// Rust asymmetric marker, standalone HTML, and the live renderer/picker camera.
// VM checks cover uniform uploads and CPU projection only. The browser tests
// execute the unmodified generated GLSL and inspect its actual framebuffer;
// Chromium/Playwright is required (missing WebGL or browser fails, never skips).












const source = `FeatureScript 3083;
import(path : "onshape/std/geometry.fs", version : "3083.0");
annotation { "Feature Type Name" : "Handedness marker" }
export const marker = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    fCuboid(context, id + "x", { "corner1" : vector(0, -2, 0) * millimeter,
        "corner2" : vector(40, 2, 4) * millimeter });
    fCuboid(context, id + "y", { "corner1" : vector(-2, 4, 0) * millimeter,
        "corner2" : vector(2, 24, 4) * millimeter });
    fCuboid(context, id + "block", { "corner1" : vector(-12, -12, 0) * millimeter,
        "corner2" : vector(-6, -6, 8) * millimeter });
});`;
const model = await build(source);
const html = toHtml(model);
const scene = await reviewScene(model, { id: 'marker' });
const drawModel = sceneDrawModel(scene);
const pane = { x: 0, y: 0, width: 1000, height: 700 };
const near = (a, b, note) => assert.ok(Math.abs(a - b) < 1e-6, `${note}: ${a} vs ${b}`);
const determinant = m => m[0] * (m[4] * m[8] - m[7] * m[5])
  - m[3] * (m[1] * m[8] - m[7] * m[2]) + m[6] * (m[1] * m[5] - m[4] * m[2]);
const transform = (m, p) => [0, 1, 2].map(row => m[row] * p[0] + m[row + 3] * p[1] + m[row + 6] * p[2]);

// Execute the exported module unchanged, recording the shader and GL uniforms.
// Tests replay only the shader's explicit matrix/scale operations on vertices.
function preview() {
  const uniforms = new Map(), shaders = [], listeners = new Map();
  const gl = new Proxy({
    createShader: type => { const value = { type }; shaders.push(value); return value; },
    shaderSource: (shader, text) => { shader.source = text; },
    createProgram: () => ({}), createBuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_program, name) => name,
    getAttribLocation: (_program, name) => name === 'position' ? 0 : 1,
    uniform1f: (name, value) => uniforms.set(name, value),
    uniform2f: (name, ...values) => uniforms.set(name, values),
    uniform3fv: (name, value) => uniforms.set(name, Array.from(value)),
    uniformMatrix3fv: (name, transpose, value) => {
      assert.equal(transpose, false);
      uniforms.set(name, Array.from(value));
    },
  }, { get: (target, name) => target[name] ?? (() => {}) });
  const canvas = {
    clientWidth: pane.width, clientHeight: pane.height, getContext: () => gl,
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  const buttons = { '#fit': {}, '#edges': {} };
  const context = createContext({
    document: { querySelector: selector => selector === 'canvas' ? canvas : buttons[selector] },
    ResizeObserver: class { observe() {} }, devicePixelRatio: 1,
  });
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script, 'standalone module is embedded');
  runInContext(script, context);
  const vertex = shaders.find(shader => shader.source.includes('gl_Position'))?.source;
  // Source-shape checks only: these do NOT execute GLSL or exclude additional
  // shader operations. The framebuffer regression below catches reflections
  // added after these expressions, even with a proper uploaded rotation.
  assert.match(vertex, /vec3 p = viewRotation \* \(position - center\);/);
  assert.match(vertex, /gl_Position = vec4\(p\.xy \* scale, -p\.z \/ \(extent \* 3\.0\), 1\.0\);/);
  assert.match(vertex, /shadeNormal = viewRotation \* normal;/);
  return {
    uniforms, buttons, listeners,
    orient(yaw, pitch) { runInContext(`yaw = ${yaw}; pitch = ${pitch}; draw();`, context); },
    project(point) {
      const center = uniforms.get('center');
      const [x, y, depth] = transform(uniforms.get('viewRotation'), point.map((value, axis) => value - center[axis]));
      const [sx, sy] = uniforms.get('scale');
      return { x: pane.width / 2 * (1 + x * sx), y: pane.height / 2 * (1 - y * sy), depth };
    },
  };
}

const angles = [-Math.PI, -1.5, 0, 0.7, Math.PI, 2 * Math.PI];
const pitches = [-Math.PI / 2, -1, -0.25, 0, 0.25, 1, Math.PI / 2];

test('HTML shader and live camera submit a proper rotation for the yaw/pitch grid', () => {
  const page = preview();
  // Check startup before orient() or Reset can overwrite a wrong initial view.
  camera.normalMatrix({ yaw: camera.PRESETS.iso[0], pitch: camera.PRESETS.iso[1] })
    .forEach((value, index) => near(page.uniforms.get('viewRotation')?.[index], value, 'initial upload is Iso'));
  for (const yaw of angles) for (const pitch of pitches) {
    page.orient(yaw, pitch);
    const submitted = page.uniforms.get('viewRotation');
    assert.equal(submitted?.length, 9, 'preview uploads the shared view rotation');
    near(determinant(submitted), 1, `preview determinant at ${yaw}, ${pitch}`);
    const matrix = camera.normalMatrix({ yaw, pitch });
    near(determinant(matrix), 1, 'live determinant');
    matrix.forEach((value, index) => near(submitted[index], value, 'same live/HTML rotation'));
    const unit = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(p => transform(submitted, p));
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      near(unit[a].reduce((sum, value, axis) => sum + value * unit[b][axis], 0), a === b ? 1 : 0, 'orthonormal');
    }
  }
  page.buttons['#fit'].onclick();
  const { toward } = camera.basis({ yaw: camera.PRESETS.iso[0], pitch: camera.PRESETS.iso[1] });
  assert.ok(toward[0] > 0 && toward[1] < 0 && toward[2] > 0, 'default above-front');
  camera.normalMatrix({ yaw: camera.PRESETS.iso[0], pitch: camera.PRESETS.iso[1] })
    .forEach((value, index) => near(page.uniforms.get('viewRotation')[index], value, 'reset is Iso'));
});

test('projected Rust marker vertices in HTML Top: long +X right, short +Y up, block lower left', () => {
  const page = preview();
  page.orient(...camera.PRESETS.top);
  const origin = page.project([0, 0, 4]);
  const x = page.project([40, 0, 4]), y = page.project([0, 24, 4]), block = page.project([-12, -12, 8]);
  assert.ok(x.x > origin.x && Math.abs(x.y - origin.y) < 1e-6, '+X right');
  assert.ok(y.y < origin.y && Math.abs(y.x - origin.x) < 1e-6, '+Y up');
  assert.ok(block.x < origin.x && block.y > origin.y, 'asymmetric block lower left');
  near((x.x - origin.x) / (origin.y - y.y), 40 / 24, 'bar proportions');
  const center = page.uniforms.get('center'), extent = page.uniforms.get('extent');
  const view = { ...camera.defaultCamera(scene.bounds, pane), target: center, height: extent / 0.57 };
  const top = camera.preset('top', view);
  for (const body of scene.bodies) for (const vertex of body.vertices) {
    const standalone = page.project(vertex.point), live = camera.project(vertex.point, top, pane);
    near(standalone.x, live.x, 'same vertex X'); near(standalone.y, live.y, 'same vertex Y');
    near(standalone.depth, live.depth, 'same vertex depth');
  }
});

// This is an execution boundary, not a shader-source/CPU-projection oracle.
// Serve exactly toHtml(model), observe (never replace) the first real uniform
// upload, and read screenshots produced by Chromium's compiled WebGL shader.
async function withBrowserPreview(check) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: pane.width, height: pane.height + 76 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      const names = new WeakMap();
      const prototype = WebGLRenderingContext.prototype;
      const getLocation = prototype.getUniformLocation;
      prototype.getUniformLocation = function(program, name) {
        const location = getLocation.call(this, program, name);
        if (location) names.set(location, name);
        return location;
      };
      const upload = prototype.uniformMatrix3fv;
      prototype.uniformMatrix3fv = function(location, transpose, values) {
        const result = upload.call(this, location, transpose, values);
        if (names.get(location) === 'viewRotation' && !window.firstPreviewRotation) {
          window.firstPreviewRotation = Array.from(values);
        }
        return result;
      };
    });
    await page.route('http://wonky-preview.test/**', route => route.fulfill(
      route.request().resourceType() === 'document'
        ? { contentType: 'text/html', body: html }
        : { status: 204, body: '' },
    ));
    await page.goto('http://wonky-preview.test/');
    await frames(page, 3);
    assert.deepEqual(errors, [], 'generated HTML executes without browser errors');
    assert.ok(await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl');
      return gl && !gl.isContextLost() && gl.getError() === gl.NO_ERROR;
    }), 'real WebGL is available and error-free');
    await check(page);
    assert.deepEqual(errors, [], 'controls execute without browser errors');
  } finally {
    await browser.close();
  }
}

// Independently specified above-front Iso (+X,-Y,+Z), column-major.
// Do not use the shared camera to define the expected startup direction.
const expectedIso = [
  Math.SQRT1_2, -1 / Math.sqrt(6), 1 / Math.sqrt(3),
  Math.SQRT1_2, 1 / Math.sqrt(6), -1 / Math.sqrt(3),
  0, Math.sqrt(2 / 3), 1 / Math.sqrt(3),
];
test('standalone browser first uploaded rotation is above-front Iso before any controls', { timeout: 60000 }, async () => {
  await withBrowserPreview(async page => {
    const first = await page.evaluate(() => window.firstPreviewRotation);
    assert.equal(first?.length, 9, 'first actual WebGL rotation was observed');
    expectedIso.forEach((value, index) => near(first[index], value, 'first real upload is Iso'));
    near(determinant(first), 1, 'startup determinant');
  });
});

async function assertFramebuffer(page, name, top) {
  const shot = await page.locator('canvas').screenshot();
  const evidence = new URL('../out/test-rust/viewer-handedness/', import.meta.url);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(new URL(`${name}.png`, evidence), shot);
  const pixels = await page.evaluate(async ({ png, top }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    // Known marker bounds [-12,-12,0]..[40,24,8], not captured GL uniforms
    // or the production projection. Sample interior +Z points and their
    // screen-X reflections; all three reflected locations must be empty.
    const factor = Math.min(image.width, image.height) * 0.57 / 52;
    // y=12 avoids the short bar's own opposite edge at the mirrored Iso
    // sample (y=18 would land on that edge, not on empty background).
    return [[30, 0, 4], [0, 12, 4], [-9, -9, 8]].map(point => {
      const [x, y, z] = point.map((value, axis) => value - [14, 6, 4][axis]);
      const screenX = top ? x : (x + y) / Math.sqrt(2);
      const screenY = top ? y : (y - x) / Math.sqrt(6) + z * Math.sqrt(2 / 3);
      const px = image.width / 2 + screenX * factor;
      const py = image.height / 2 - screenY * factor;
      const sample = atX => {
        const rgba = Array.from(ctx.getImageData(Math.round(atX) - 1, Math.round(py) - 1, 3, 3).data);
        let occupied = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i + 1] - rgba[i] > 20 && rgba[i + 2] - rgba[i] > 10) occupied++;
        }
        return occupied;
      };
      return { point, px, py, occupied: sample(px), reflected: sample(image.width - px) };
    });
  }, { png: shot.toString('base64'), top });
  writeFileSync(new URL(`${name}.json`, evidence), JSON.stringify(pixels, null, 2) + '\n');
  for (const sample of pixels) {
    assert.equal(sample.occupied, 9, `${name}: actual shader draws ${sample.point} at its unreflected pixel`);
    assert.equal(sample.reflected, 0, `${name}: reflected pixel for ${sample.point} stays empty`);
  }
}

test('standalone actual shader framebuffer keeps Rust marker unreflected in initial Iso and Top', { timeout: 60000 }, async () => {
  await withBrowserPreview(async page => {
    await assertFramebuffer(page, 'initial-iso', false);
    // Exercise the real pointer controls, without setting yaw/pitch in-page or
    // rewriting GLSL. Top requires +X right, +Y up, the block lower-left.
    const box = await page.locator('canvas').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (Math.PI - 3 * Math.PI / 4) / 0.008,
      y + (-Math.PI / 2 + Math.asin(1 / Math.sqrt(3))) / 0.008);
    await page.mouse.up();
    await frames(page, 3);
    await assertFramebuffer(page, 'top', true);
  });
});

// Independent screen coordinates from the renderer's submitted 4x4 clip
// matrix, not from picking.projectModel or from camera.project.
function shaderPoint(point, view) {
  const m = camera.viewProjection(view, pane, scene.bounds);
  const clip = [0, 1, 2, 3].map(row => m[row] * point[0] + m[row + 4] * point[1] + m[row + 8] * point[2] + m[row + 12]);
  return { x: pane.width / 2 * (1 + clip[0] / clip[3]), y: pane.height / 2 * (1 - clip[1] / clip[3]) };
}

test('picker hits the visible +Z face at renderer-projected pixels, not the hidden -Z face', () => {
  const base = camera.defaultCamera(scene.bounds, pane);
  for (const projection of ['orthographic', 'perspective']) for (const name of ['top', 'iso']) {
    const view = { ...camera.preset(name, base), projection };
    const projected = projectModel(drawModel, pane, view);
    for (const [index, point] of [[0, [30, 0, 4]], [1, [0, 18, 4]], [2, [-9, -9, 8]]]) {
      const body = scene.bodies[index];
      const top = body.faces.find(face => face.triangles.some(t => t.normal[2] > 0.99));
      assert.ok(top, 'actual Rust top face exists');
      const screen = shaderPoint(point, view);
      const hit = pickDetail(drawModel, projected, screen.x, screen.y, 'face');
      assert.deepEqual(hit?.reference, { modelId: 'marker', bodyId: body.id, entityType: 'face', entityIndex: top.index }, `${projection} ${name}: visible face`);
      hit.point.forEach((value, axis) => near(value, point[axis], 'display hit in world space'));
      const depth = camera.project(point, view, pane).depth;
      camera.unproject(screen.x, screen.y, depth, view, pane).forEach((value, axis) => near(value, point[axis], 'measurement anchor/ray consistency'));
    }
  }
});

}
