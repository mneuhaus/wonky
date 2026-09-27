#!/usr/bin/env node
// Foundation-only browser proofs:
//   - window.wonkyViewer.select([faceA, faceB]) highlights both faces
//   - a deliberately broken feature module (served with a syntax error)
//     shows "Feature <id> failed to load" and the rest of the app works
//   - first frame: every stylesheet applied and the canvas at its final size
//
//   node scripts/viewer/qa/foundation-extras.mjs --url http://127.0.0.1:4350/viewer/ \
//     --out out/viewer/foundation
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { frames, launch, openViewer, pageShot, stageShot, waitIdle } from './browser.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option('--url', 'http://127.0.0.1:4350/viewer/');
const out = resolve(option('--out', 'out/viewer/foundation'));
mkdirSync(out, { recursive: true });
const results = {};
const browser = await launch();

try {
  // Multi-selection highlight through the debug handle.
  {
    const { context, page, consoleMessages } = await openViewer(browser, url, { hideToast: true });
    await waitIdle(page);
    await page.locator('#compare-toggle').click();
    await waitIdle(page);
    await page.locator('.library-item', { hasText: 'bracket' }).first().click();
    await waitIdle(page);
    const references = await page.evaluate(() => {
      const viewer = window.wonkyViewer;
      const canvas = document.querySelector('#model-canvas');
      const picks = [[0.42, 0.62], [0.72, 0.58], [0.5, 0.4]].map(([x, y]) => viewer.pick(
        canvas.clientWidth * x, canvas.clientHeight * y, 'face'));
      const faces = picks.filter(Boolean);
      const unique = faces.filter((face, index) => faces.findIndex(other => other.entityIndex
        === face.entityIndex) === index).slice(0, 2);
      viewer.select(unique);
      return unique;
    });
    await frames(page, 3);
    results.multiSelect = {
      references,
      state: await page.evaluate(() => ({
        selection: window.wonkyViewer.state.selection,
        selectionSet: window.wonkyViewer.state.selectionSet,
        highlighted: window.wonkyViewer.renderer.highlights().selection,
      })),
    };
    await stageShot(page, join(out, 'f3-multi-select.png'));
    results.multiSelectConsole = consoleMessages.slice();
    await context.close();
  }

  // A broken feature module: the help feature is served with a syntax error.
  {
    const { context, page, consoleMessages } = await openViewer(browser, url, {
      hideToast: true,
      route: target => target.route('**/viewer/features/help/help.js', route => route.fulfill({
        status: 200, contentType: 'text/javascript', body: 'export const id = ;',
      })),
    });
    await waitIdle(page);
    results.brokenFeature = await page.evaluate(() => ({
      banner: document.querySelector('.viewport-banner')?.textContent ?? null,
      models: document.querySelectorAll('.library-item').length,
      title: document.querySelector('#model-title')?.textContent,
    }));
    await page.locator('#layout-side-by-side').click();
    results.brokenFeature.sideBySide = await page.locator('#stage').getAttribute('data-layout');
    await pageShot(page, join(out, 'f4-broken-feature.png'));
    results.brokenFeatureConsole = consoleMessages.slice();
    await context.close();
  }

  // First frame: stylesheets and canvas size before any feature markup.
  for (const width of [1536, 1150, 900, 650]) {
    const { context, page } = await openViewer(browser, url, {
      width, height: 900,
      route: target => target.addInitScript(() => {
        const sample = () => {
          const canvas = document.querySelector('#model-canvas');
          window.__firstFrame = {
            canvas: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
            sheets: document.styleSheets.length,
            bodyBackground: getComputedStyle(document.body).backgroundColor,
            workspaceGrid: getComputedStyle(document.querySelector('.workspace'))
              .gridTemplateColumns,
          };
        };
        document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(sample));
      }),
    });
    await waitIdle(page);
    results[`firstFrame${width}`] = {
      first: await page.evaluate(() => window.__firstFrame),
      settled: await page.evaluate(() => ({
        canvas: [document.querySelector('#model-canvas').clientWidth,
          document.querySelector('#model-canvas').clientHeight],
        sheets: document.styleSheets.length,
      })),
    };
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, 'foundation-extras.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
