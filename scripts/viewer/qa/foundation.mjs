#!/usr/bin/env node
// Browser walk of the key viewer flows for the foundation gates.
//
//   node scripts/viewer/qa/foundation.mjs --url http://127.0.0.1:4350/viewer/ \
//     --out out/viewer/foundation/after [--only flows,views,breakpoints]
//
// Drives the UI only through the DOM (clicks, keys, drags), so the same walk
// runs against the pre-foundation code (baseline) and the restructured code
// (after). Pointer targets are computed from the served scene with the
// pre-foundation projection, which the foundation keeps numerically identical.
// Writes PNGs plus results.json (inspector headings, texts, computed styles).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  computedStyles, frames, hideToasts, launch, openViewer, pageShot, stageShot, waitIdle,
} from './browser.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option('--url', 'http://127.0.0.1:4350/viewer/');
const out = resolve(option('--out', 'out/viewer/foundation/after'));
const only = option('--only', 'flows,views,breakpoints').split(',');
mkdirSync(out, { recursive: true });
const results = { schema: 'wonky.viewer-foundation-qa/1', url, startedAt: new Date(), steps: {} };
const record = (name, value) => {
  results.steps[name] = value;
  const text = typeof value === 'string' ? value : JSON.stringify(value).slice(0, 160);
  console.log(`${name}: ${text}`);
};

// Pre-foundation projection (viewer/app.js `project`), single pane.
const projectTargets = async (page, modelId) => page.evaluate(async id => {
  const scene = await (await fetch(`/api/models/${id}`)).json();
  const canvas = document.querySelector('#model-canvas');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const min = scene.bounds.min;
  const max = scene.bounds.max;
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const extent = Math.max(1e-6, ...max.map((value, axis) => value - min[axis]));
  const yaw = -0.65;
  const pitch = -0.55;
  const factor = Math.min(width, height) * 0.67 / extent;
  const project = point => {
    const [x, y, z] = point.map((value, axis) => value - center[axis]);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const a = x * c - y * s;
    const b = x * s + y * c;
    return {
      x: width / 2 + a * factor,
      y: height / 2 - (b * Math.sin(pitch) + z * Math.cos(pitch)) * factor,
      depth: b * Math.cos(pitch) - z * Math.sin(pitch),
    };
  };
  const nearest = items => items.reduce((best, item) => (!best || item.depth > best.depth
    ? item : best), null);
  const vertices = scene.bodies.flatMap(body => body.vertices.map(vertex => project(vertex.point)));
  const edges = scene.bodies.flatMap(body => body.edges.map(edge => {
    const middle = edge.points[Math.floor(edge.points.length / 2)];
    const previous = edge.points[Math.max(0, Math.floor(edge.points.length / 2) - 1)];
    return project(middle.map((value, axis) => (value + previous[axis]) / 2));
  }));
  const triangles = scene.bodies.flatMap(body => body.faces.flatMap(face => (face.triangles ?? [])
    .map(triangle => {
      const [a, b, c] = triangle.points.map(project);
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
      const x = (a.x + b.x + c.x) / 3;
      const y = (a.y + b.y + c.y) / 3;
      return { x, y, depth: (a.depth + b.depth + c.depth) / 3, area };
    })
    .filter(triangle => triangle.area > 400)));
  return { vertex: nearest(vertices), edge: nearest(edges), face: nearest(triangles) };
}, modelId);

async function canvasPoint(page, point) {
  const box = await page.locator('#model-canvas').boundingBox();
  return { x: box.x + point.x, y: box.y + point.y };
}

async function openModel(page, label) {
  await page.locator('.library-item', { hasText: label }).first().click();
  await waitIdle(page);
}

const heading = page => page.evaluate(() => {
  const content = document.querySelector('#selection-content');
  return content.querySelector('.selection-heading h2, .empty-inspector h2')?.textContent ?? '';
});
const modelIdByLabel = (page, label) => page.evaluate(async label => {
  const data = await (await fetch('/api/workspace')).json();
  return data.models.find(model => model.label === label)?.id;
}, label);

async function flows(browser) {
  const { context, page, consoleMessages } = await openViewer(browser, url, { hideToast: true });
  await waitIdle(page);
  record('load.status', await page.locator('#workspace-status').textContent());
  record('load.title', await page.locator('#model-title').textContent());
  record('load.stageLayout', await page.locator('#stage').getAttribute('data-layout'));
  await pageShot(page, join(out, 'flow-01-load.png'));

  const canvas = page.locator('#model-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 6);
  }
  await page.mouse.up();
  await stageShot(page, join(out, 'flow-02-orbit.png'));
  await page.locator('#fit-view').click();

  await page.locator('#wipe-handle').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  record('wipe.split', await page.locator('#split-value').textContent());
  await stageShot(page, join(out, 'flow-03-wipe.png'));
  await page.locator('#layout-side-by-side').click();
  const pressed = await page.locator('#layout-side-by-side').getAttribute('aria-pressed');
  record('sideBySide.pressed', pressed);
  await pageShot(page, join(out, 'flow-04-side-by-side.png'));
  await page.locator('#layout-wipe').click();

  await page.locator('#compare-toggle').click();
  await waitIdle(page);
  await openModel(page, 'bracket');
  record('single.layout', await page.locator('#stage').getAttribute('data-layout'));
  const bracketId = await modelIdByLabel(page, 'bracket');
  const targets = await projectTargets(page, bracketId);
  record('targets', targets);
  const center = await canvasPoint(page, targets.face);
  await page.mouse.move(center.x, center.y);
  await frames(page, 3);
  record('hover.class', await canvas.getAttribute('class'));
  await page.locator('#stage').screenshot({ path: join(out, 'flow-05-hover-face.png') });
  await page.mouse.click(center.x, center.y);
  await frames(page, 2);
  record('pick.face', await heading(page));
  await stageShot(page, join(out, 'flow-06-pick-face.png'));
  await page.locator('.inspector').screenshot({ path: join(out, 'flow-07-inspector-face.png') });
  const inspector = page.locator('#selection-content');
  record('inspector.sourceLines', await inspector.locator('.source-code-line').count());
  record('inspector.currentLine', await inspector.locator('.source-current').textContent()
    .catch(() => ''));
  if (await page.locator('#open-source').count()) {
    await page.locator('#open-source').click();
    await page.waitForFunction(() => !document.querySelector('#report-drawer').hidden
      && document.querySelector('#report-content .source-current'));
    record('drawer.source.title', await page.locator('#report-title').textContent());
    await pageShot(page, join(out, 'flow-08-source-drawer.png'));
    await page.locator('#close-report').click();
  }

  await page.locator('#selection-mode').selectOption('edge');
  const edge = await canvasPoint(page, targets.edge);
  await page.mouse.move(edge.x, edge.y);
  await frames(page, 3);
  await page.locator('#stage').screenshot({ path: join(out, 'flow-09-hover-edge.png') });
  await page.mouse.click(edge.x, edge.y);
  await frames(page, 2);
  record('pick.edge', await heading(page));
  await stageShot(page, join(out, 'flow-10-pick-edge.png'));
  await page.locator('#selection-mode').selectOption('vertex');
  const vertex = await canvasPoint(page, targets.vertex);
  await page.mouse.move(vertex.x, vertex.y);
  await frames(page, 3);
  await page.locator('#stage').screenshot({ path: join(out, 'flow-11-hover-point.png') });
  await page.mouse.click(vertex.x, vertex.y);
  await frames(page, 2);
  record('pick.vertex', await heading(page));
  await stageShot(page, join(out, 'flow-12-pick-point.png'));
  await page.locator('#selection-mode').selectOption('auto');

  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await page.mouse.click(center.x, center.y);
  await frames(page, 2);
  await page.keyboard.type('Baseline comment on the face');
  await canvas.focus();
  const drag = async (key, from, to, steps = 6) => {
    await page.keyboard.press(key);
    await page.mouse.move(box.x + from[0], box.y + from[1]);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(box.x + from[0] + (to[0] - from[0]) * i / steps,
        box.y + from[1] + (to[1] - from[1]) * i / steps + (key === 'p' ? Math.sin(i) * 12 : 0));
    }
    await page.mouse.up();
  };
  await drag('a', [140, 140], [260, 220]);
  await drag('r', [box.width - 320, 120], [box.width - 180, 230]);
  await drag('p', [180, box.height - 200], [420, box.height - 160], 12);
  const focusState = () => page.evaluate(() => ({
    active: document.activeElement?.tagName,
    tool: document.querySelector('.tool.active')?.dataset.tool,
  }));
  record('annotations.beforeV', await focusState());
  await page.keyboard.press('v');
  record('annotations.afterV', await focusState());
  record('annotations.count', await page.locator('#annotation-total').textContent());
  record('saveState.beforeSave', await page.locator('#save-state').textContent());
  await pageShot(page, join(out, 'flow-13-annotations.png'));
  await page.locator('#save-review').click();
  const saved = () => /Saved · WKR-/.test(document.querySelector('#save-state')?.textContent);
  await page.waitForFunction(saved);
  const reviewUrl = page.url();
  record('review.saved', /#review=WKR-[A-F0-9]{10}$/.test(reviewUrl));
  await stageShot(page, join(out, 'flow-14-saved.png'));
  record('console.flows', consoleMessages.slice());
  await context.close();

  const reopened = await openViewer(browser, reviewUrl, { hideToast: true });
  await reopened.page.waitForFunction(saved);
  await waitIdle(reopened.page);
  const again = reopened.page;
  record('review.reopened.annotations', await again.locator('#annotation-total').textContent());
  record('review.reopened.panel', await again.locator('#review-tab').getAttribute('aria-selected'));
  record('review.reopened.title', await reopened.page.locator('#review-title').inputValue());
  await stageShot(reopened.page, join(out, 'flow-15-reopened.png'));
  await reopened.page.locator('#checks-tab').click();
  record('checks.count', await reopened.page.locator('#report-count').textContent());
  record('checks.items', await again.locator('#library-content .library-item').allTextContents());
  await reopened.page.locator('.library').screenshot({ path: join(out, 'flow-16-checks.png') });
  const firstReport = reopened.page.locator('[data-report]').first();
  if (await firstReport.count()) {
    await firstReport.click();
    await again.waitForFunction(() => document.querySelector('#report-content .report-summary')
      && [...document.querySelectorAll('#report-content img')].every(image => image.complete));
    record('checks.drawer.title', await reopened.page.locator('#report-title').textContent());
    await pageShot(reopened.page, join(out, 'flow-17-check-drawer.png'));
    await reopened.page.keyboard.press('Escape');
    record('checks.drawer.hiddenAfterEscape', await again.locator('#report-drawer').isHidden());
  }
  record('console.reopened', reopened.consoleMessages.slice());
  await reopened.context.close();
}

async function views(browser) {
  const { context, page, consoleMessages } = await openViewer(browser, url, { hideToast: true });
  await waitIdle(page);
  await page.locator('#compare-toggle').click();
  await waitIdle(page);
  const labels = ['bracket', 'bored-spacer', 'compare-before', 'compare-after', 'pocket-plate',
    'r10b-retained'];
  for (const label of labels) {
    if (!(await page.locator('.library-item', { hasText: label }).count())) continue;
    await openModel(page, label);
    for (const view of ['iso', 'front', 'top']) {
      if (view !== 'iso') {
        await page.locator('#view-presets').click();
        await frames(page, 3);
      }
      await stageShot(page, join(out, `view-${label}-${view}.png`), '#model-canvas');
    }
  }
  record('console.views', consoleMessages.slice());
  await context.close();
}

async function breakpoints(browser) {
  const styles = {};
  for (const width of [1536, 1150, 900, 650]) {
    const firstFrame = [];
    const { context, page, consoleMessages } = await openViewer(browser, url, {
      width, height: 900, hideToast: true,
      route: async target => target.addInitScript(() => {
        requestAnimationFrame(() => {
          const canvas = document.querySelector('#model-canvas');
          window.__firstFrame = {
            canvas: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
            background: getComputedStyle(document.body).backgroundColor,
            sheets: document.styleSheets.length,
          };
        });
      }),
    });
    await waitIdle(page);
    firstFrame.push(await page.evaluate(() => window.__firstFrame));
    const canvasSize = await page.evaluate(() => {
      const canvas = document.querySelector('#model-canvas');
      return [canvas.clientWidth, canvas.clientHeight];
    });
    record(`breakpoint.${width}.firstFrame`, { first: firstFrame[0], settled: canvasSize });
    await pageShot(page, join(out, `breakpoint-${width}-load.png`));
    styles[`${width}-load`] = await computedStyles(page);
    await page.locator('#layout-side-by-side').click();
    await frames(page, 2);
    await pageShot(page, join(out, `breakpoint-${width}-side-by-side.png`));
    styles[`${width}-side-by-side`] = await computedStyles(page);
    await page.locator('#layout-wipe').click();
    await page.locator('#compare-toggle').click();
    await waitIdle(page);
    const canvas = page.locator('#model-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await frames(page, 2);
    await page.mouse.move(1, 1);
    await pageShot(page, join(out, `breakpoint-${width}-single-selection.png`));
    styles[`${width}-single-selection`] = await computedStyles(page);
    await page.locator('#review-tab').click();
    styles[`${width}-review-tab`] = await computedStyles(page);
    record(`console.breakpoint.${width}`, consoleMessages.slice());
    await context.close();
  }
  writeFileSync(join(out, 'computed-styles.json'), JSON.stringify(styles));
}

const browser = await launch();
try {
  if (only.includes('flows')) await flows(browser);
  if (only.includes('views')) await views(browser);
  if (only.includes('breakpoints')) await breakpoints(browser);
} finally {
  await browser.close();
  results.finishedAt = new Date();
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
