#!/usr/bin/env node
// Inventory rows that inventory.mjs does not reach: the wide layout
// (RSP-01), display notes and warnings of every model (VP-04, VP-05, INS-02,
// INS-14), the empty workspace (VP-07, INS-01), focus outline (A11Y-02) and
// reduced motion (A11Y-03). Run against two viewers and compare the JSON
// with inventory.mjs --compare; screenshots with compare-shots.mjs.
//
//   node scripts/viewer/qa/inventory-extras.mjs --url http://127.0.0.1:4351/viewer/ --out DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { computedStyles, launch, openViewer, pageShot, waitIdle } from './browser.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option('--url', 'http://127.0.0.1:4350/viewer/');
const out = resolve(option('--out', 'out/viewer/foundation/inventory-extras'));
mkdirSync(out, { recursive: true });
const checks = {};
const record = (key, value) => {
  checks[key] = value;
  console.log(`${key}: ${JSON.stringify(value).slice(0, 150)}`);
};
const text = (page, selector) => page.locator(selector).first().textContent();

const browser = await launch();
try {
  {
    const { context, page } = await openViewer(browser, url, {
      width: 1700, height: 900, hideToast: true,
    });
    await waitIdle(page);
    record('RSP-01 wide styles', await computedStyles(page));
    await pageShot(page, join(out, 'rsp-01-1700-load.png'));
    await context.close();
  }

  {
    const { context, page } = await openViewer(browser, url, { hideToast: true });
    await waitIdle(page);
    await page.locator('#compare-toggle').click();
    await waitIdle(page);
    const labels = await page.locator('#library-content .library-item .item-title')
      .allTextContents();
    const notes = {};
    for (const [index, label] of labels.entries()) {
      await page.locator('#library-content .library-item').nth(index).click();
      await waitIdle(page);
      notes[label] = {
        summary: await text(page, '#model-summary'),
        note: await page.locator('#display-note').isVisible()
          ? await text(page, '#display-note') : null,
        warnings: await page.locator('#selection-content details').allTextContents(),
      };
    }
    record('VP-04 VP-05 INS-02 INS-14 display notes per model', notes);
    await context.close();
  }

  {
    // No fixture has boundary-only faces, so the scene response gets one
    // injected display warning (face index 1) and one display note.
    const { context, page } = await openViewer(browser, url, {
      hideToast: true,
      route: target => target.route(/\/api\/models\/[a-f0-9]{64}$/, async route => {
        const response = await route.fetch();
        const scene = await response.json();
        scene.bodies[0].faces[1].displayWarning = 'Injected: trimmed face not tessellated';
        scene.display = { ...scene.display, notes: ['Injected display note'] };
        await route.fulfill({ response, body: JSON.stringify(scene) });
      }),
    });
    await waitIdle(page);
    await page.locator('#compare-toggle').click();
    await page.locator('.library-item', { hasText: 'bracket' }).first().click();
    await waitIdle(page);
    const overview = await page.locator('#selection-content .display-note').allTextContents();
    // Select any face first; the Browse geometry select then reaches face 2.
    const box = await page.locator('#model-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.62);
    await page.locator('#inspect-entity').selectOption('face:1');
    record('VP-04 INS-14 boundary-only face', [
      await text(page, '#display-note'), overview,
      await page.locator('#selection-content').textContent()
        .then(content => content.includes('Injected: trimmed face not tessellated')),
    ]);
    await pageShot(page, join(out, 'vp-04-boundary-only.png'));
    await context.close();
  }

  {
    const { context, page } = await openViewer(browser, url, {
      hideToast: true,
      route: target => target.route('**/api/workspace', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: [], reports: [], feedback: [] }),
      })),
    });
    await page.waitForFunction(() => !document.querySelector('#viewport-message').hidden);
    record('VP-07 INS-01 empty workspace', [
      await text(page, '#viewport-message-title'), await text(page, '#viewport-message-body'),
      await page.locator('#selection-content h2').first().textContent(),
      await text(page, '#library-content'), await page.locator('#compare-toggle').isDisabled(),
    ]);
    await pageShot(page, join(out, 'vp-07-empty-workspace.png'));
    await context.close();
  }

  {
    const { context, page } = await openViewer(browser, url);
    await waitIdle(page);
    await page.locator('body').click({ position: { x: 5, y: 890 } });
    await page.keyboard.press('Tab');
    record('A11Y-02 focus outline', await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return [element.tagName, element.className, style.outlineStyle, style.outlineWidth,
        style.outlineColor, style.outlineOffset];
    }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    record('A11Y-03 reduced motion', await page.evaluate(() => [...document
      .querySelectorAll('.button, .icon-button, .tool')].slice(0, 6)
      .map(element => getComputedStyle(element).transitionDuration)));
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(join(out, 'inventory.json'), JSON.stringify({ url, checks }, null, 2) + '\n');
