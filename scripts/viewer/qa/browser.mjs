// Browser helpers for viewer QA (Playwright, loaded from outside the repo).
//
// Playwright is not a dependency of this repository. The helpers import
// playwright-core from $WONKY_PLAYWRIGHT, or from ~/.dev-browser/node_modules.
// Headless Chromium runs with --use-angle=metal --enable-gpu so WebGL works.
//
//   import { launch, openViewer, stageShot, diffImages } from './browser.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const defaultPlaywright = join(homedir(), '.dev-browser/node_modules/playwright-core/index.mjs');

export async function launch({
  playwright = process.env.WONKY_PLAYWRIGHT ?? defaultPlaywright,
  args = [],
} = {}) {
  const { chromium } = await import(playwright);
  return chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...args],
  });
}

export async function openViewer(browser, url, {
  width = 1536, height = 900, dpr = 1, hideToast = false, route,
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  const consoleMessages = [];
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => consoleMessages.push(`pageerror: ${error.message}`));
  if (route) await route(page);
  await page.goto(url);
  if (hideToast) await hideToasts(page);
  return { context, page, consoleMessages };
}

// Screenshot stabilizer: hides toasts and disables transitions so a shot
// never catches a 120 ms button fade half-way.
export async function hideToasts(page) {
  await page.addStyleTag({
    content: '#toast{visibility:hidden!important}'
      + '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
}

// Waits until the viewer finished loading its current models and drew frames.
export async function waitIdle(page, { timeout = 180000 } = {}) {
  await page.waitForFunction(() => {
    const message = document.querySelector('#viewport-message');
    const title = document.querySelector('#model-title')?.textContent;
    const status = document.querySelector('#workspace-status')?.textContent ?? '';
    return message?.hidden && title && title !== 'Model review' && /version/.test(status);
  }, null, { timeout });
  await frames(page, 3);
}

export const frames = (page, count = 2) => page.evaluate(count => new Promise(done => {
  const step = left => (left ? requestAnimationFrame(() => step(left - 1)) : done());
  step(count);
}), count);

export async function stageShot(page, path, selector = '#stage') {
  mkdirSync(dirname(path), { recursive: true });
  await page.mouse.move(1, 1);
  await frames(page, 2);
  await page.locator(selector).screenshot({ path });
  return path;
}

export async function pageShot(page, path) {
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
  return path;
}

// Pixel comparison inside the browser (no PNG decoder dependency).
// Returns counts of pixels whose max channel difference exceeds `threshold`.
export async function diffImages(page, pathA, pathB, { threshold = 0, diffPath } = {}) {
  const a = 'data:image/png;base64,' + readFileSync(pathA).toString('base64');
  const b = 'data:image/png;base64,' + readFileSync(pathB).toString('base64');
  const result = await page.evaluate(async ({ a, b, threshold, wantDiff }) => {
    const load = src => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    const [imageA, imageB] = await Promise.all([load(a), load(b)]);
    if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
      return {
        sameSize: false,
        sizeA: [imageA.width, imageA.height],
        sizeB: [imageB.width, imageB.height],
      };
    }
    const pixels = image => {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const dataA = pixels(imageA);
    const dataB = pixels(imageB);
    let differing = 0;
    let exact = 0;
    let maxDelta = 0;
    const diff = wantDiff ? new ImageData(imageA.width, imageA.height) : null;
    for (let i = 0; i < dataA.length; i += 4) {
      let delta = 0;
      for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(dataA[i + c] - dataB[i + c]));
      if (delta > 0) exact++;
      if (delta > threshold) differing++;
      maxDelta = Math.max(maxDelta, delta);
      if (diff) {
        const gray = (dataA[i] + dataA[i + 1] + dataA[i + 2]) / 12 + 170;
        diff.data.set(delta > threshold ? [255, 0, 0, 255] : [gray, gray, gray, 255], i);
      }
    }
    let diffImage = null;
    if (diff) {
      const canvas = new OffscreenCanvas(imageA.width, imageA.height);
      canvas.getContext('2d').putImageData(diff, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      diffImage = await new Promise(done => {
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result).split(',')[1]);
        reader.readAsDataURL(blob);
      });
    }
    const total = dataA.length / 4;
    return {
      sameSize: true,
      total,
      differing,
      exact,
      maxDelta,
      fraction: differing / total,
      diffImage,
    };
  }, { a, b, threshold, wantDiff: !!diffPath });
  if (diffPath && result.diffImage) {
    writeFileSync(diffPath, Buffer.from(result.diffImage, 'base64'));
  }
  delete result.diffImage;
  return result;
}

// Computed styles of every element, keyed by a stable DOM path, for
// cascade-preservation checks. Only properties that affect layout or paint.
export async function computedStyles(page) {
  return page.evaluate(() => {
    const properties = [
      'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
      'margin', 'padding', 'color', 'background-color', 'background-image', 'border',
      'border-radius', 'box-shadow', 'font-size', 'font-weight', 'line-height', 'gap',
      'grid-template-columns', 'flex-direction', 'transform', 'opacity', 'visibility',
      'overflow', 'z-index', 'cursor', 'white-space', 'text-align', 'max-width', 'min-height',
    ];
    const path = element => {
      const parts = [];
      const top = document.documentElement;
      for (let node = element; node && node !== top; node = node.parentElement) {
        const index = [...node.parentElement.children].indexOf(node);
        parts.unshift(`${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}:${index}`);
      }
      return parts.join('>');
    };
    const result = {};
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
      const style = getComputedStyle(element);
      result[path(element)] = Object.fromEntries(properties.map(name => [
        name, style.getPropertyValue(name),
      ]));
    }
    return result;
  });
}

export function diffStyles(before, after) {
  const differences = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!before[key] || !after[key]) {
      differences.push({ element: key, missing: !before[key] ? 'before' : 'after' });
      continue;
    }
    for (const [property, value] of Object.entries(before[key])) {
      if (after[key][property] !== value) {
        differences.push({ element: key, property, before: value, after: after[key][property] });
      }
    }
  }
  return differences;
}
