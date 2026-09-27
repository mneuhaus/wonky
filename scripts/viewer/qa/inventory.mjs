#!/usr/bin/env node
// Differential walk of docs/viewer/feature-inventory.md rows in the browser.
// Every check records an observation (texts, attributes, clipboard, DOM
// snapshot hashes, screenshots). Run it against two viewers (for example the
// pre-foundation copy and the current code) and compare the JSON outputs
// with --compare; screenshots are compared with compare-shots.mjs.
//
//   node scripts/viewer/qa/inventory.mjs --url http://127.0.0.1:4351/viewer/ --out DIR
//   node scripts/viewer/qa/inventory.mjs --compare A/inventory.json B/inventory.json
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { frames, launch, openViewer, waitIdle } from './browser.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

if (args.includes('--compare')) {
  const index = args.indexOf('--compare');
  const [a, b] = [args[index + 1], args[index + 2]]
    .map(path => JSON.parse(readFileSync(path, 'utf8')));
  let differences = 0;
  for (const key of new Set([...Object.keys(a.checks), ...Object.keys(b.checks)])) {
    const same = isDeepStrictEqual(a.checks[key], b.checks[key]);
    if (!same) differences++;
    const detail = same ? '' : `\n  A ${JSON.stringify(a.checks[key])}`
      + `\n  B ${JSON.stringify(b.checks[key])}`;
    console.log(`${same ? 'same' : 'DIFF'} ${key}${detail}`);
  }
  console.log(`${differences} difference(s)`);
  process.exit(differences ? 1 : 0);
}

const url = option('--url', 'http://127.0.0.1:4350/viewer/');
const out = resolve(option('--out', 'out/viewer/foundation/inventory'));
mkdirSync(out, { recursive: true });
const checks = {};
const record = (key, value) => {
  checks[key] = value;
  console.log(`${key}: ${JSON.stringify(value).slice(0, 150)}`);
};
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
// Records the hash and keeps the normalized markup next to it for diffing.
const dom = async (page, name) => {
  const markup = await domSnapshot(page);
  writeFileSync(join(out, `dom-${name}.html`), markup.replace(/></g, '>\n<') + '\n');
  return hash(markup);
};

// Normalized DOM: no data-slot/data-order attributes, no whitespace-only text,
// no volatile review ids, so pre- and post-foundation markup compare exactly.
const domSnapshot = page => page.evaluate(() => {
  const clone = document.body.cloneNode(true);
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ALL);
  const remove = [];
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.COMMENT_NODE) remove.push(node);
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) remove.push(node);
    if (node.nodeType === Node.ELEMENT_NODE) {
      node.removeAttribute('data-slot');
      node.removeAttribute('data-order');
      if (node.tagName === 'STYLE') remove.push(node);
    }
  }
  for (const node of remove) node.remove();
  return clone.innerHTML.replace(/WKR-[A-F0-9]{10}/g, 'WKR-<id>');
});

async function session(browser, options = {}) {
  const opened = await openViewer(browser, options.url ?? url, { hideToast: true, ...options });
  await opened.context.grantPermissions(['clipboard-read', 'clipboard-write'],
    { origin: new URL(url).origin });
  opened.requests = [];
  opened.page.on('request', request => opened.requests.push(new URL(request.url()).host));
  await waitIdle(opened.page);
  return opened;
}
const text = (page, selector) => page.locator(selector).first().textContent();
const attribute = (page, selector, name) => page.locator(selector).first().getAttribute(name);
const clipboard = page => page.evaluate(() => navigator.clipboard.readText());
const shot = async (page, name) => {
  await page.mouse.move(1, 1);
  await frames(page, 2);
  await page.locator('#stage').screenshot({ path: join(out, `inv-${name}.png`) });
};
const heading = page => page.evaluate(() => document
  .querySelector('#selection-content .selection-heading h2, #selection-content .empty-inspector h2')
  ?.textContent ?? '');

async function openSingle(page, label) {
  await page.locator('#compare-toggle').click();
  await waitIdle(page);
  await page.locator('.library-item', { hasText: label }).first().click();
  await waitIdle(page);
}
async function canvasBox(page) {
  return page.locator('#model-canvas').boundingBox();
}
// A point on the nearest large face of the bracket at the default camera.
async function faceTarget(page) {
  const box = await canvasBox(page);
  return { x: box.x + box.width * 0.42, y: box.y + box.height * 0.62 };
}

const browser = await launch();
try {
  {
    const { context, page, requests, consoleMessages } = await session(browser);
    record('UI-01 brand link', await attribute(page, 'a.brand', 'href'));
    record('UI-02 workspace status', await text(page, '#workspace-status'));
    record('UI-04 save disabled at load', await page.locator('#save-review').isDisabled());
    record('UI-05 copy review disabled before save',
      await page.locator('#copy-review').isDisabled());
    record('UI-08 icons',
      await page.evaluate(() => document.querySelectorAll('[data-icon] svg').length));
    record('DOM load', await dom(page, 'load'));
    record('CMP-02 default pair', [await page.locator('#before-model').inputValue(),
      await page.locator('#after-model').inputValue()].map(value => value.slice(0, 8)));
    record('CMP-03 compare on', await attribute(page, '#compare-toggle', 'aria-pressed'));
    record('CMP-10 comparison bar',
      [await text(page, '#before-short'), await text(page, '#after-short')]);
    record('VP-06 title and summary',
      [await text(page, '#model-title'), await text(page, '#model-summary')]);
    record('VP-08 unit pills', await page.locator('.units-pill, .unit-label').allTextContents());
    record('A11Y-01 landmarks', await page.evaluate(() => [...document.querySelectorAll(
      '[aria-label], [role]')].map(element => `${element.tagName}:${element.getAttribute('role')
      ?? ''}:${element.getAttribute('aria-label') ?? ''}`)));
    await page.locator('#checks-tab').click();
    record('LIB-01 checks tab', [await attribute(page, '#checks-tab', 'aria-selected'),
      await attribute(page, '#library-search', 'placeholder'),
      await page.locator('#library-content .library-item').count()]);
    await page.locator('#checks-tab').focus();
    await page.keyboard.press('ArrowLeft');
    record('LIB-01 tab keys', [await attribute(page, '#models-tab', 'aria-selected'),
      await page.evaluate(() => document.activeElement.id)]);
    await page.keyboard.press('End');
    record('LIB-01 End', await attribute(page, '#checks-tab', 'aria-selected'));
    await page.keyboard.press('Home');
    await page.locator('#library-search').fill('brack');
    record('LIB-02 search', await page.locator('#library-content .library-item').allTextContents());
    await page.locator('#library-search').fill('zzz');
    record('LIB-07 no match', await text(page, '#library-content'));
    await page.locator('#library-search').fill('');
    await page.locator('#swap-models').click();
    await waitIdle(page);
    record('CMP-05 swap', [await page.locator('#before-model').inputValue(),
      await page.locator('#after-model').inputValue()].map(value => value.slice(0, 8)));
    await shot(page, 'cmp-05-swap');
    await page.locator('#swap-models').click();
    await waitIdle(page);
    await page.locator('#refresh').click();
    await waitIdle(page);
    await page.waitForFunction(() => document.querySelector('#toast').textContent);
    record('LIB-05 refresh toast', await text(page, '#toast'));
    await page.locator('#compare-toggle').click();
    await waitIdle(page);
    record('CMP-04 compare off', [await attribute(page, '#compare-toggle', 'aria-pressed'),
      await page.locator('#before-model').isDisabled(),
      await page.locator('#swap-models').isDisabled(),
      await page.locator('#comparison-bar').isHidden(), await text(page, '#after-label'),
      await attribute(page, '#stage', 'data-layout')]);
    await page.locator('.library-item', { hasText: 'bracket' }).first().click();
    await waitIdle(page);
    record('LIB-03 model click', [await text(page, '#model-title'),
      await page.locator('.library-item.selected .item-badge').textContent(),
      await page.evaluate(() => document.activeElement.tagName)]);
    record('DOM single bracket', await dom(page, 'single-bracket'));
    record('network hosts', [...new Set(requests)]);
    record('console load', consoleMessages.slice());
    await context.close();
  }

  {
    const { context, page } = await session(browser);
    await openSingle(page, 'bracket');
    const box = await canvasBox(page);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(center.x + 80, center.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await shot(page, 'nav-02-pan');
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -300);
    await frames(page, 3);
    await shot(page, 'nav-03-zoom');
    await page.locator('#model-canvas').focus();
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowUp']) await page.keyboard.press(key);
    await shot(page, 'nav-04-arrows');
    await page.keyboard.press('f');
    await shot(page, 'nav-05-fit');
    const toasts = [];
    for (let i = 0; i < 4; i++) {
      await page.locator('#view-presets').click();
      toasts.push(await text(page, '#toast'));
    }
    record('NAV-06 preset toasts', toasts);
    await shot(page, 'nav-06-iso-again');
    record('NAV-08 context menu', await page.evaluate(() => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.querySelector('#model-canvas').dispatchEvent(event);
      return event.defaultPrevented;
    }));
    await page.keyboard.press('e');
    record('Keyboard E', await attribute(page, '#toggle-edges', 'aria-pressed'));
    await shot(page, 'kbd-e-edges-off');
    await page.keyboard.press('e');
    record('SEL-01 modes', await page.locator('#selection-mode option').allTextContents());
    const face = await faceTarget(page);
    await page.mouse.click(face.x, face.y);
    await frames(page, 2);
    record('SEL-05 click select', await heading(page));
    record('INS-04 properties', await page.locator('#selection-content dl.properties').first()
      .textContent());
    record('INS-09 source', [
      await page.locator('#selection-content .source-path').first().textContent(),
      await page.locator('#selection-content .source-code-line').count()]);
    record('INS-12 history', await page
      .locator('#selection-content details.source-history > summary').allTextContents());
    record('INS-15 reference block', await page.locator('#selection-content .inspector-section')
      .filter({ hasText: 'Reference' }).last().textContent());
    record('DOM face selected', await dom(page, 'face-selected'));
    await page.locator('#copy-selection').click();
    const reference = JSON.parse(await clipboard(page));
    record('INS-07 copy reference', {
      keys: Object.keys(reference), alias: reference.alias, type: reference.entityType,
    });
    await page.locator('#copy-source').click();
    record('INS-10 copy source', Object.keys(JSON.parse(await clipboard(page))));
    await page.locator('#copy-geometry').click();
    await page.waitForTimeout(300);
    const geometry = JSON.parse(await clipboard(page));
    record('INS-16 copy selected geometry', Object.keys(geometry).sort());
    await page.locator('#inspect-entity').selectOption('edge:0');
    record('INS-08 browse geometry', await heading(page));
    await page.locator('#checks-tab').click();
    await page.locator('[data-report]').first().click();
    await page.waitForFunction(() => document.querySelector('#report-content .report-summary'));
    record('DRW-01 report', await page.locator('#report-content .report-summary').textContent());
    await page.keyboard.press('c');
    await page.keyboard.press('Escape');
    record('SEL-08 escape', [await heading(page), await page.locator('#report-drawer').isHidden(),
      await attribute(page, '.tool[data-tool="select"]', 'aria-pressed')]);
    record('INS-02 overview', await page.locator('#selection-content .inspector-section').first()
      .textContent());
    await page.locator('#copy-geometry').click();
    await page.waitForTimeout(300);
    record('INS-16 copy overview', (await clipboard(page)).split('\n').slice(0, 2));
    await page.locator('.body-row').first().click();
    record('INS-03 body row', await heading(page));
    await page.locator('#comment-selection').click();
    record('INS-06 comment on selection', [await attribute(page, '#review-tab', 'aria-selected'),
      await text(page, '#annotation-total'),
      await text(page, '#annotation-list .annotation-target')]);
    await context.close();
  }

  {
    const { context, page } = await session(browser);
    await openSingle(page, 'bracket');
    await page.locator('#review-tab').click();
    await page.locator('#add-comment').click();
    record('ANN-03 add comment without selection', [await text(page, '#toast'),
      await attribute(page, '.tool[data-tool="comment"]', 'aria-pressed')]);
    await page.keyboard.press('Escape');
    const box = await canvasBox(page);
    await page.keyboard.press('a');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 260, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press('r');
    await page.mouse.click(box.x + 400, box.y + 300);
    record('ANN-04 click without drag creates nothing', await text(page, '#annotation-total'));
    await page.keyboard.press('v');
    await page.locator('#review-title').fill('Inventory review');
    record('REV-01 title marks dirty', await text(page, '#save-state'));
    await page.locator('#model-canvas').focus();
    await page.keyboard.press('ControlOrMeta+s');
    await page.waitForFunction(() => /Saved/
      .test(document.querySelector('#save-state').textContent));
    record('Keyboard Mod+S', (await text(page, '#save-state')).replace(/WKR-\w+/, 'WKR-<id>'));
    record('UI-05 copy review enabled', await page.locator('#copy-review').isEnabled());
    await page.locator('#copy-review').click();
    record('UI-05 copy review', (await clipboard(page)).replace(/WKR-\w+/g, 'WKR-<id>')
      .replace(/:\d{4}\//g, ':<port>/').split('\n')
      .map(line => line.replace(/\/.*reviews/, '<r>')));
    await page.locator('#copy-context').click();
    await page.waitForTimeout(300);
    record('REV-06 copy LLM context',
      (await clipboard(page)).split('\n')[0].replace(/WKR-\w+/, 'WKR'));
    record('LIB-06 saved list', await page.locator('#saved-reviews .saved-item').allTextContents());
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 60, center.y, { steps: 5 });
    await page.mouse.up();
    record('NAV-07 camera marks dirty', await text(page, '#save-state'));
    record('ANN-05 hidden chip', [await page.locator('#hidden-annotations').isVisible(),
      await text(page, '#restore-annotation-view')]);
    await page.locator('#restore-annotation-view').click();
    await frames(page, 2);
    record('ANN-05 restored', await page.locator('#hidden-annotations').isVisible());
    await shot(page, 'ann-05-restored');
    await page.locator('#model-canvas').focus();
    await page.keyboard.press('ControlOrMeta+z');
    record('ANN-08 undo', [await text(page, '#annotation-total'),
      await page.locator('#undo-annotation').isDisabled()]);
    record('DOM review tab', await dom(page, 'review-tab'));
    await context.close();
  }

  {
    const failing = async (pattern, status, body) => session(browser, {
      route: target => target.route(pattern, route => (route.request().method() === 'POST'
        || pattern.includes('models') || pattern.includes('workspace')
        ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
        : route.continue())),
    }).catch(error => ({ error }));
    const workspace = await openViewer(browser, url, {
      hideToast: true,
      route: target => target.route('**/api/workspace', route => route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":"Injected workspace failure"}',
      })),
    });
    await workspace.page.waitForFunction(() => !document.querySelector('#viewport-message')?.hidden
      && /unavailable/.test(document.querySelector('#viewport-message-title')?.textContent));
    record('VP-07 workspace unavailable', [await text(workspace.page, '#viewport-message-title'),
      await text(workspace.page, '#viewport-message-body'),
      await workspace.page.locator('#viewport-retry').isVisible(),
      await text(workspace.page, '#global-error')]);
    await workspace.context.close();
    const saving = await failing('**/api/feedback', 400, { error: 'Injected save failure' });
    await openSingle(saving.page, 'bracket');
    await saving.page.locator('#save-review').click();
    await saving.page.waitForFunction(() => !document.querySelector('#global-error').hidden);
    record('UI-07 global error', [await text(saving.page, '#global-error'),
      await attribute(saving.page, '#global-error', 'role')]);
    await saving.context.close();
    const model = await openViewer(browser, url, {
      hideToast: true,
      route: target => target.route(/\/api\/models\/[a-f0-9]{64}$/, route => route.fulfill({
        status: 500, contentType: 'application/json', body: '{"error":"Injected model failure"}',
      })),
    });
    // A failing scene at startup is reported as a workspace failure (today's behavior).
    await model.page.waitForFunction(() => !document.querySelector('#viewport-message').hidden);
    record('VP-07 startup model failure', [await text(model.page, '#viewport-message-title'),
      await text(model.page, '#viewport-message-body'),
      await model.page.locator('#viewport-retry').isVisible()]);
    await model.context.close();
    const later = await session(browser);
    await later.page.route(/\/api\/models\/[a-f0-9]{64}$/, route => route.fulfill({
      status: 500, contentType: 'application/json', body: '{"error":"Injected model failure"}',
    }));
    await later.page.locator('#compare-toggle').click();
    await later.page.locator('.library-item', { hasText: 'conical-spacer' }).first().click();
    await later.page.waitForFunction(() => /could not be opened/
      .test(document.querySelector('#viewport-message-title')?.textContent ?? ''));
    record('VP-07 model could not be opened', [await text(later.page, '#viewport-message-title'),
      await text(later.page, '#viewport-message-body'),
      await later.page.locator('#viewport-retry').isVisible()]);
    await later.context.close();
    const lost = await session(browser);
    await lost.page.evaluate(() => document.querySelector('#model-canvas').getContext('webgl')
      .getExtension('WEBGL_lose_context').loseContext());
    await lost.page.waitForFunction(() => /interrupted/
      .test(document.querySelector('#viewport-message-title').textContent));
    record('VP-07 context lost', [await text(lost.page, '#viewport-message-title'),
      await text(lost.page, '#viewport-message-body')]);
    await lost.context.close();
  }
} finally {
  await browser.close();
}

{
  const noWebgl = await launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  try {
    const { page, context } = await openViewer(noWebgl, url, { hideToast: true });
    await page.waitForFunction(() => /version/.test(document.querySelector('#workspace-status')
      ?.textContent ?? '') && !document.querySelector('#viewport-message').hidden
      && /unavailable/.test(document.querySelector('#viewport-message-title').textContent));
    record('VP-07 no WebGL', [await text(page, '#viewport-message-title'),
      await text(page, '#viewport-message-body'),
      await page.locator('.library-item').count()]);
    await context.close();
  } finally {
    await noWebgl.close();
  }
}

writeFileSync(join(out, 'inventory.json'), JSON.stringify({ url, checks }, null, 2) + '\n');
