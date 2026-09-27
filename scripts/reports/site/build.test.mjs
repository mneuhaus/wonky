import { missing } from '../../../test/helpers/public-tree.mjs';
import { privateTermPattern } from '../private-terms.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = join(root, 'out/site');
const builder = join(root, 'scripts/reports/site/build.mjs');
const requiredPages = ['index', 'roadmap', 'fortschritt', 'tests', 'performance', 'modelle'];
let pages = requiredPages;
const historicalSkip = missing(...['history', 'roadmap', 'performance', 'models', 'context'].map(key => 'out/site/data/' + key + '.json'));
const build = (...args) => execFileSync(process.execPath, ['--max-old-space-size=8192', builder, ...args], { encoding: 'utf8' });
const read = key => readFileSync(join(out, `${key}.html`), 'utf8');
const text = html => html.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:');
const tags = html => html.replace(/<[^>]*>/g, '').trim();

// Contract owner: generated public HTML, not implementation helpers.
// Regression: a component introduces remote assets, an empty legend, broken
// anchors or confidential text. Existing renderer tests cover PNGs, not pages.
// No test-only export or production hook is needed.
test('all pages are self-contained, linked and public-safe at the HTML boundary', { skip: historicalSkip }, () => {
  build();
  pages = JSON.parse(readFileSync(join(out, 'data/build.json'))).navigation.map(p => p.key);
  for (const key of requiredPages) assert.ok(pages.includes(key), `required page ${key}`);
  for (const key of pages) {
    const html = read(key), visible = text(html);
    assert.ok(!privateTermPattern()?.test(visible), `${key}: private term (local list)`);
    assert.ok(Buffer.byteLength(html) < 512 * 1024, `${key}: Postplan limit`);
    assert.match(html, /<html lang="de">/);
    assert.match(html, /<style>/);
    assert.doesNotMatch(visible, /<script\b|\son[a-z]+\s*=|javascript:|file:\/\/|\{\{URL:|\bundefined\b|\bNaN\b/i);
    assert.doesNotMatch(visible, /\/(?:Users|home)\/|\b[0-9a-f]{24}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    assert.doesNotMatch(visible, /(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S{8,}/i);
    const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav, `${key}: navigation exists`);
    for (const target of pages) assert.ok(nav.includes(`href="${target}.html"`), `${key} links to ${target}`);
    assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${key}: unique anchors`);
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (href.startsWith('#')) assert.ok(ids.includes(href.slice(1)), `${key}: ${href} resolves`);
      else assert.ok(pages.some(p => href === `${p}.html`), `${key}: local page link ${href}`);
    }
    for (const [, list] of html.matchAll(/<ul class="(?:legend|chart-key)">([\s\S]*?)<\/ul>/g)) {
      for (const [, item] of list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) assert.ok(tags(item), `${key}: series legend has a readable name`);
    }
    for (const [, asset] of html.matchAll(/<img[^>]*src="([^"]+)"/g)) {
      assert.ok(asset.startsWith('data:image/png;base64,'));
      assert.equal(Buffer.from(asset.split(',')[1], 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
  }
});

// Contract: rejected geometry must not be replaced by a reference image or 0.
// Regression: templating fallback reuses the wrong image or renders null as zero.
// PNG renderer tests cannot see this pairing/UI failure.
test('gallery preserves image pairing, refusals and semantic geometry status', { skip: historicalSkip }, () => {
  const data = JSON.parse(readFileSync(join(out, 'data/models.json')));
  const html = pages.filter(key => key.startsWith('modelle')).map(read).join('\n');
  assert.equal((html.match(/<article class="model"/g) ?? []).length, data.models.length);
  for (const model of data.models) {
    const article = html.match(new RegExp(`<article class="model" id="${model.id}">([\\s\\S]*?)<\\/article>`))?.[1];
    assert.ok(article, model.id);
    const assets = [...article.matchAll(/<img[^>]*src="data:image\/png;base64,([^"]+)"/g)].map(m => Buffer.from(m[1], 'base64'));
    assert.equal(assets.length, model.images.wonky ? 2 : 1);
    assert.deepEqual(assets[0], readFileSync(join(root, model.images.reference)));
    if (model.images.wonky) assert.deepEqual(assets[1], readFileSync(join(root, model.images.wonky)));
    else {
      assert.match(article, /Kein wonky-Modell/);
      assert.match(article, /<dt>wonky-Volumen<\/dt><dd>offen<\/dd>/);
      assert.match(article, /<dt>Relative Differenz<\/dt><dd>offen<\/dd>/);
    }
    if (model.wonkyStatus === 'certified mesh') assert.match(article, /Keine Hausdorff-Garantie/);
  }
});

// Contract: all-or-nothing local-to-public remapping, with no credential-bearing
// URLs and no mixed relative links. Regression: one omitted key or permissive URL
// parsing makes a published page unusable or leaks input; no other owner covers it.
test('public remapping is complete, rejects unsafe maps, and rebuilds deterministically', { skip: historicalSkip }, () => {
  const folder = mkdtempSync(join(out, 'data/url-contract-'));
  const mapPath = join(folder, 'urls.json');
  const baseline = pages.map(key => [key, read(key)]);
  try {
    const urls = Object.fromEntries(pages.map(key => [key, `https://sitecontract${key.replaceAll('-', '')}.postplan.dev`]));
    writeFileSync(mapPath, JSON.stringify(urls));
    build('--urls', mapPath);
    for (const key of pages) {
      const html = read(key);
      for (const target of pages) assert.ok(html.includes(`href="${urls[target]}"`));
      assert.doesNotMatch(html, /href="(?:index|roadmap|fortschritt|tests|performance|modelle)\.html"/);
    }
    const published = pages.map(key => read(key));
    for (const invalid of [{ ...urls, tests: undefined }, { ...urls, tests: 'https://sitecontracttests.postplan.dev/?token=public-secret-example' }]) {
      writeFileSync(mapPath, JSON.stringify(invalid));
      const result = spawnSync(process.execPath, [builder, '--urls', mapPath], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Missing or invalid public URL for tests/);
      assert.deepEqual(pages.map(key => read(key)), published, 'invalid map must not partially rewrite pages');
    }
  } finally {
    rmSync(folder, { recursive: true });
    build();
  }
  for (const [key, before] of baseline) assert.equal(read(key), before, `${key}: byte-identical local rebuild`);
});

// Owner: the public-tree CLI. Missing private gallery data must neither break
// the frozen-site build nor silently ignore requested publication remapping.
// The historical six-page tests cannot reach this dependency-absence branch.
test('public-tree site builds reviewed pages and refuses unsupported remapping', { skip: historicalSkip ? false : 'local-only fixture: this contract needs a tree without historical report inputs' }, () => {
  build();
  const manifest = JSON.parse(readFileSync(join(out, 'data/build.json'), 'utf8'));
  assert.equal(manifest.mode, 'frozen-public');
  assert.equal(manifest.navigation.length, 2);
  for (const key of ['index', 'cad-acid']) {
    assert.ok(existsSync(join(out, key + '.html')));
    const visible = text(read(key));
    assert.ok(!privateTermPattern()?.test(visible), `${key}: private term (local list)`);
    assert.equal(read(key), readFileSync(join(root, 'site', key + '.html'), 'utf8'));
  }
  const rejected = spawnSync(process.execPath, [builder, '--urls', 'nonexistent'], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Frozen public site: URL remapping requires/);
});
