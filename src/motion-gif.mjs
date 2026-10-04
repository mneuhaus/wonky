// The motion animation: one GIF frame per pose, rendered by the viewer's own
// renderer (viewer/, WebGL, headless Chromium through Playwright), with the
// pose value printed on the frame and colliding bodies highlighted. The colours
// are a display aid; the numbers are in the report (src/motion.mjs).
//
// The browser helper provisions pinned Playwright and Chromium by default.
// Motion export also honors an explicit $WONKY_PLAYWRIGHT module override.
// Launch failure refuses by name (motion/gif-no-browser); the report needs no browser.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MotionRefusal, resolveBody } from './motion.mjs';
import { buildPalette, decodePng, encodeGif } from './gif.mjs';
import { RustBody, rustBodyWords, rustModelKernel, rustModelRecord } from './native/rust-host.mjs';

// Appearance colours (sRGB 0..1): the state of a body in a pose, worst first.
export const ROLE_COLORS = Object.freeze({
  interference: [0.90, 0.10, 0.10],
  refused: [0.55, 0.25, 0.80],
  abutment: [0.95, 0.65, 0.10],
  moving: [0.20, 0.45, 0.85],
  fixed: [0.62, 0.64, 0.68],
});
const ORDER = ['interference', 'refused', 'abutment'];

// Which state each body is in at one pose: a body in a colliding pair takes the
// worst state of its pairs; the others are moving (moved by a joint) or fixed.
export function poseRoles(model, report, index, movers) {
  const roles = new Map(model.bodies.map(body => [body.id, movers.has(body.id) ? 'moving' : 'fixed']));
  const rank = role => ORDER.indexOf(role);
  for (const pair of report.poses[index].pairs) {
    const role = pair.kind;
    if (rank(role) < 0) continue;
    for (const id of [pair.a, pair.b]) {
      const held = roles.get(id);
      if (rank(held) < 0 || rank(role) < rank(held)) roles.set(id, role);
    }
  }
  return roles;
}

const recolored = (body, role) => {
  const copy = new RustBody(body.id, rustBodyWords(body), body.validation);
  Object.assign(copy, body, { appearance: [...ROLE_COLORS[role]] });
  return copy;
};

const legend = pose => {
  const p = pose.summary;
  if (!pose.exactPlacement) return 'NOT EVALUATED: no exact placement (bodies shown at rest)';
  const parts = [];
  if (p.interference) parts.push(`${p.interference} interfere`);
  if (p.abutment) parts.push(`${p.abutment} abut`);
  if (p.refused) parts.push(`${p.refused} refused`);
  if (p.clear) parts.push(`${p.clear} clear`);
  return parts.join(', ');
};
const valueText = pose => Object.entries(pose.values).map(([id, v]) => `${id} = ${v.value} ${v.unit}`).join('   ');

// Renders one GIF: model + report + the per-pose body lists of runMotion. Returns
// { path, frames, width, height, palette }.
export async function writeMotionGif(model, report, posed, path, { width = 1280, height = 800, delayCs = 80 } = {}) {
  const kernel = rustModelKernel(model);
  const movers = new Set(report.configuration.joints.flatMap(j => j.bodies.map(ref => resolveBody(model, ref).id)));
  let browserTools;
  try { browserTools = await import('../scripts/viewer/qa/browser.mjs'); } catch (e) { throw new MotionRefusal('motion/gif-no-browser', e.message); }
  const { createReviewServer } = await import('./review-server.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'wonky-motion-gif-'));
  let browser = null;
  try {
    // One record per pose; a body that could not be placed shows at rest.
    const records = report.poses.map((pose, index) => {
      const roles = poseRoles(model, report, index, movers);
      const bodies = model.bodies.map((body, k) => recolored(posed[index][k] ?? body, roles.get(body.id)));
      return rustModelRecord(kernel, { ...model, bodies });
    });
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const record of records) for (const body of record.bodies) for (const v of body.vertices) {
      for (let axis = 0; axis < 3; axis++) { box.min[axis] = Math.min(box.min[axis], v[axis]); box.max[axis] = Math.max(box.max[axis], v[axis]); }
    }
    try { browser = await browserTools.launch({ playwright: process.env.WONKY_PLAYWRIGHT }); } catch (e) { throw new MotionRefusal('motion/gif-no-browser', `${e.message.split('\n')[0]} (set WONKY_PLAYWRIGHT to a playwright-core index.mjs)`); }
    const images = [];
    for (const [index, record] of records.entries()) {
      const file = join(dir, `pose-${index}.brep.json`);
      await writeFile(file, JSON.stringify(record));
      const server = await createReviewServer({ modelPaths: [file], port: 0, reviewDirectory: join(dir, `reviews-${index}`),
        stateDirectory: join(dir, `state-${index}`) });
      try {
        const { context, page, consoleMessages } = await browserTools.openViewer(browser, `${server.origin}/viewer/`, { width, height, hideToast: true });
        try {
          await browserTools.waitIdle(page);
          await page.evaluate(({ box, text, sub }) => {
            const viewer = window.wonkyViewer;
            const target = box.min.map((v, k) => (v + box.max[k]) / 2);
            // The box diagonal bounds every projection of the union of all poses.
            const diagonal = Math.hypot(...box.max.map((v, k) => v - box.min[k]));
            viewer.store.update('view.camera', state => { state.view.camera = { ...state.view.camera, target, height: diagonal * 1.1 }; state.view.preset = null; });
            // A store write does not redraw; without this the frame keeps the
            // viewer's per-pose automatic fit and fixed bodies jump between frames.
            viewer.app.scheduleDraw();
            document.body.classList.add('motion-frame');
            const style = document.createElement('style');
            style.textContent = '#stage > *:not(canvas):not(#motion-label){display:none!important}';
            document.head.append(style);
            const label = document.createElement('div');
            label.id = 'motion-label';
            label.style.cssText = 'position:absolute;left:12px;top:10px;font:600 20px/1.3 ui-monospace,Menlo,monospace;color:#111;text-shadow:0 0 3px #fff;z-index:9;white-space:pre';
            label.textContent = `${text}\n${sub}`;
            document.querySelector('#stage').append(label);
          }, { box, text: `pose ${index + 1}/${records.length}   ${valueText(report.poses[index])}`, sub: legend(report.poses[index]) });
          await browserTools.frames(page, 4);
          const shot = join(dir, `frame-${index}.png`);
          await browserTools.stageShot(page, shot);
          images.push(decodePng(readFileSync(shot)));
          if (!images.at(-1).rgba.some((v, k) => k % 4 === 0 && v !== images.at(-1).rgba[0])) {
            throw new MotionRefusal('motion/gif-blank-frame', `pose ${index}: the renderer produced a blank frame${consoleMessages.length ? ` (${consoleMessages[0]})` : ''}`);
          }
        } finally { await context.close(); }
      } finally { await server.close(); }
    }
    const [{ width: w, height: h }] = images;
    if (images.some(i => i.width !== w || i.height !== h)) throw new MotionRefusal('motion/gif-frame-size', 'the frames differ in size');
    const { bytes, palette } = encodeGif({ width: w, height: h, frames: images.map(i => ({ rgba: i.rgba })), delayCs,
      palette: buildPalette(images.map(i => i.rgba)) });
    await writeFile(path, bytes);
    return { path, frames: images.length, width: w, height: h, colors: palette.colors.length, exactColors: palette.exact };
  } finally {
    await browser?.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
