#!/usr/bin/env node
// Text contrast and size audit of the viewer (help-a11y, spec section 4):
// every visible text must reach 4.5:1 against its background and be at least
// 11 CSS px, in the light and in the dark theme.
//
//   node scripts/viewer/qa/contrast.mjs [--url http://127.0.0.1:43NN/viewer/ | --port 43NN]
//     [--themes light,dark] [--states overview,selection,...] [--out DIR] [--json FILE]
//   node scripts/viewer/qa/contrast.mjs --static [--root viewer]
//
// Browser mode opens the viewer with Playwright (scripts/viewer/qa/browser.mjs),
// or first starts a private viewer on --port (4320-4399) with the QA fixtures.
// For each theme it sets <html data-theme> (not persisted) and walks the UI
// states below (overview, selection, review tab, checks tab, source drawer,
// parts tab, compare mode, section panel, print check panel, help, settings;
// a state whose feature is missing is skipped with the reason); in each state
// it measures every rendered text node, input value and placeholder:
//   foreground  computed color (SVG text: fill), alpha times ancestor opacity
//   background  the element's and its ancestors' backgrounds, composited from
//               the first opaque one; gradients count with their worst stop
//   size        computed font-size in CSS px
// Colors are read back through a 1 x 1 canvas, so any CSS color syntax works
// (light-dark(), color-mix(), color(srgb ...)). Disabled controls are exempt
// (WCAG 1.4.3) and listed separately. Text whose background chain reaches
// the viewport stage is measured against the stage and marked `over viewport`:
// the model can be behind it. While a modal dialog is open only the dialog is
// measured (the page behind it is inert).
//
// Static mode lists, per CSS file and line, font sizes below 11 px and
// literal colors (colors outside styles/tokens.css should be tokens).
//
// Exit code 1 when any text fails.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export const MIN_RATIO = 4.5;
export const MIN_SIZE_PX = 11;
const DEFAULT_STATES = ['overview', 'selection', 'review', 'checks', 'drawer', 'parts',
  'compare', 'section', 'print', 'help', 'settings'];

// ---- Pure colour math (also used by the tests) ----

const channel = value => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g)
  + 0.0722 * channel(b);
export function contrastRatio(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
// Source-over of [r, g, b, alpha 0..1] onto an opaque [r, g, b].
export const blend = ([r, g, b, alpha], base) => [r, g, b]
  .map((value, index) => value * alpha + base[index] * (1 - alpha));

// ---- Static scan ----

const walk = directory => readdirSync(directory).flatMap(name => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const COLOR = /#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|\b(white|black)\b/gi;

export function staticScan(directory = join(root, 'viewer')) {
  const findings = [];
  for (const path of walk(directory).filter(file => file.endsWith('.css'))) {
    const file = relative(root, path);
    const tokens = file.endsWith('styles/tokens.css');
    readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      const code = line.replace(/\/\*.*?\*\//g, '');
      const size = /font-size:\s*([0-9.]+)px/.exec(code);
      if (size && Number(size[1]) < MIN_SIZE_PX) {
        findings.push({ file, line: index + 1, kind: 'size', value: `${size[1]}px` });
      }
      const property = /^\s*([a-z-]+)\s*:/.exec(code)?.[1];
      if (!tokens && property && !property.startsWith('--')) {
        for (const match of code.slice(code.indexOf(':') + 1).matchAll(COLOR)) {
          findings.push({ file, line: index + 1, kind: 'literal', property, value: match[0] });
        }
      }
    });
  }
  return findings;
}

// ---- Browser audit (runs in the page) ----

function auditPage({ minRatio, minSize }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const rgba = css => {
    if (!cache.has(css)) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000';
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      cache.set(css, [r, g, b, a / 255]);
    }
    return cache.get(css);
  };
  const lin = value => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const mix = ([r, g, b, alpha], base) => [r, g, b]
    .map((value, index) => value * alpha + base[index] * (1 - alpha));
  const COLOR_TOKEN = /(?:rgba?|color|oklch|oklab|lab|lch|hsla?)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
  const stage = document.querySelector('#stage');

  // Candidate opaque backgrounds (several for gradients) plus the layers above.
  function backgrounds(element) {
    const layers = [];
    let opacity = 1;
    let viewport = false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node === stage) viewport = true;
      const image = style.backgroundImage;
      if (image && image !== 'none' && /gradient/.test(image)) {
        const stops = (image.match(COLOR_TOKEN) ?? []).map(rgba);
        if (stops.length) return { bases: stops, layers, opacity, viewport };
      }
      const color = rgba(style.backgroundColor);
      if (color[3] >= 0.999) return { bases: [color], layers, opacity, viewport };
      if (color[3] > 0) layers.unshift(color);
      if (node !== element) opacity *= Number(style.opacity);
    }
    // Nothing opaque up to <html>: the browser canvas is white.
    return { bases: [[255, 255, 255, 1]], layers, opacity, viewport };
  }

  const shortPath = element => {
    const parts = [];
    for (let node = element; node && node !== document.body && parts.length < 4;
      node = node.parentElement) {
      const classes = [...node.classList].slice(0, 2).map(name => `.${name}`).join('');
      parts.unshift(`${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}${classes}`);
      if (node.id) break;
    }
    return parts.join(' > ');
  };
  const rendered = element => {
    if (!element.isConnected) return false;
    if (element.closest('[hidden]')) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (style.clipPath === 'inset(50%)') return false;
    return element.checkVisibility ? element.checkVisibility({ checkOpacity: true }) : true;
  };
  const exempt = element => !!element.closest('button:disabled,input:disabled,select:disabled,'
    + 'textarea:disabled,fieldset:disabled,[aria-disabled="true"]');

  function measure(element, text, { placeholder = false } = {}) {
    const style = getComputedStyle(element, placeholder ? '::placeholder' : null);
    const svg = element instanceof SVGElement;
    const fg = rgba(svg ? style.fill : style.color);
    const { bases, layers, opacity, viewport } = backgrounds(element);
    let worst = Infinity;
    let worstPair = null;
    for (const base of bases) {
      let under = base.slice(0, 3);
      for (const layer of layers) under = mix(layer, under);
      const ink = mix([fg[0], fg[1], fg[2], fg[3] * opacity * Number(style.opacity || 1)], under);
      const value = ratio(ink, under);
      if (value < worst) {
        worst = value;
        worstPair = { fg: ink.map(Math.round), bg: under.map(Math.round) };
      }
    }
    const size = parseFloat(style.fontSize);
    return {
      text: text.slice(0, 60), path: shortPath(element), ratio: Math.round(worst * 100) / 100,
      size, ...worstPair, viewport, placeholder, exempt: exempt(element),
      contrastOk: worst >= minRatio - 0.005, sizeOk: size >= minSize - 0.01,
    };
  }

  const results = [];
  const seen = new Set();
  // An open modal dialog is the only content: the page behind it is inert.
  const scope = document.querySelector('dialog:modal') ?? document.body;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue.replace(/\s+/g, ' ').trim();
    const element = node.parentElement;
    if (!text || !element || seen.has(element)) continue;
    if (element.closest('script,style,template,option,optgroup')) continue;
    seen.add(element);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || !rendered(element)) continue;
    results.push(measure(element, text));
  }
  for (const field of scope.querySelectorAll('input,select,textarea')) {
    if (!rendered(field) || ['checkbox', 'radio', 'range', 'color', 'hidden', 'file']
      .includes(field.type)) continue;
    const value = field.tagName === 'SELECT' ? field.selectedOptions[0]?.textContent ?? ''
      : field.value;
    if (value.trim()) results.push(measure(field, value.trim()));
    else if (field.placeholder) {
      results.push(measure(field, field.placeholder, { placeholder: true }));
    }
  }
  return results;
}

// ---- UI states ----

const STATES = {
  async overview(page) {
    await page.evaluate(() => {
      window.wonkyViewer.select?.(null);
      window.wonkyViewer.app.panel?.('inspect');
    });
  },
  async selection(page) {
    await page.evaluate(() => {
      const viewer = window.wonkyViewer;
      const scene = viewer.state.scenes.get(viewer.state.after);
      const body = scene?.bodies?.[0];
      if (!body) return;
      viewer.select({ modelId: scene.id, bodyId: body.id, entityType: 'face', entityIndex: 0 });
      viewer.app.panel?.('inspect');
    });
  },
  async review(page) {
    await page.evaluate(() => window.wonkyViewer.app.panel?.('review'));
  },
  async checks(page) {
    await page.evaluate(() => {
      window.wonkyViewer.app.panel?.('inspect');
      document.querySelector('#checks-tab')?.click();
    });
  },
  async drawer(page) {
    await page.evaluate(() => document.querySelector('#models-tab')?.click());
    const opened = await page.evaluate(async () => {
      const viewer = window.wonkyViewer;
      const scene = viewer.state.scenes.get(viewer.state.after);
      const body = scene?.bodies?.[0];
      if (body) {
        viewer.select({ modelId: scene.id, bodyId: body.id, entityType: 'face', entityIndex: 0 });
      }
      const button = document.querySelector('#open-source');
      if (button) {
        button.click();
        return 'source';
      }
      return null;
    });
    return opened ? null : 'no source drawer available';
  },
  async parts(page) {
    const opened = await page.evaluate(() => {
      const tab = document.querySelector('#parts-tab');
      tab?.click();
      return !!tab;
    });
    return opened ? null : 'no Parts tab';
  },
  // Compare mode with another model as "before" (wipe layout, comparison bar).
  async compare(page) {
    const ready = await page.evaluate(async () => {
      const viewer = window.wonkyViewer;
      document.querySelector('#models-tab')?.click();
      const other = viewer.state.workspace.models.find(model => model.id !== viewer.state.after);
      if (!other) return false;
      viewer.state.before = other.id;
      viewer.state.compare = true;
      await viewer.loadSelectedModels(false);
      return true;
    });
    return ready ? null : 'only one model';
  },
  async section(page) {
    const opened = await page.evaluate(() => {
      const viewer = window.wonkyViewer;
      viewer.state.compare = false;
      if (!viewer.commands.has('section.toggle')) return false;
      viewer.commands.run('section.toggle');
      return true;
    });
    return opened ? null : 'no section feature';
  },
  async print(page) {
    const opened = await page.evaluate(() => {
      const viewer = window.wonkyViewer;
      if (viewer.commands.has('section.toggle')) viewer.commands.run('section.toggle');
      if (!viewer.commands.has('fdm.panel')) return false;
      viewer.commands.run('fdm.panel');
      return true;
    });
    return opened ? null : 'no print check feature';
  },
  async help(page) {
    await page.evaluate(() => {
      document.querySelector('#fdm-panel-toggle[aria-expanded="true"]')?.click();
      window.wonkyViewer.app.openHelp?.();
    });
  },
  async settings(page) {
    await page.evaluate(() => {
      window.wonkyViewer.app.closeHelp?.();
      window.wonkyViewer.app.openSettings?.();
    });
  },
};

const settle = page => page.evaluate(() => new Promise(done => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 120)));
}));

async function resetState(page) {
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    document.querySelector('#close-report')?.click();
  });
}

export async function auditBrowser({ url, themes = ['light', 'dark'], states = DEFAULT_STATES,
  out = null } = {}) {
  const { launch, openViewer, waitIdle } = await import('./browser.mjs');
  const browser = await launch();
  const report = { url, themes: {}, skipped: [], console: [] };
  try {
    const { page, consoleMessages } = await openViewer(browser, url, { hideToast: true });
    await waitIdle(page);
    for (const theme of themes) {
      await page.evaluate(value => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const results = {};
      for (const state of states) {
        await resetState(page);
        const skipped = await STATES[state]?.(page);
        if (skipped || !STATES[state]) {
          report.skipped.push({ theme, state, reason: skipped ?? 'unknown state' });
          continue;
        }
        // Set the theme again: a state may have changed settings meanwhile.
        await page.evaluate(value => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await settle(page);
        results[state] = await page.evaluate(auditPage, {
          minRatio: MIN_RATIO, minSize: MIN_SIZE_PX,
        });
        if (out) {
          mkdirSync(out, { recursive: true });
          await page.screenshot({ path: join(out, `contrast-${theme}-${state}.png`) });
        }
      }
      report.themes[theme] = results;
    }
    await resetState(page);
    report.console = consoleMessages;
  } finally {
    await browser.close();
  }
  return report;
}

// Failures of a report: [{ theme, states, ...measurement }], one entry per
// theme, element path and text (the states it failed in are listed).
export function failures(report, { exempt = false } = {}) {
  const unique = new Map();
  for (const [theme, states] of Object.entries(report.themes)) {
    for (const [state, results] of Object.entries(states)) {
      for (const result of results) {
        if (result.exempt !== exempt || (result.contrastOk && result.sizeOk)) continue;
        const key = `${theme}|${result.path}|${result.text}|${result.placeholder}`;
        const entry = unique.get(key);
        if (entry && !entry.states.includes(state)) entry.states.push(state);
        if (entry) continue;
        unique.set(key, { theme, states: [state], ...result });
      }
    }
  }
  return [...unique.values()];
}

const formatFailure = item => `${item.theme.padEnd(5)} ${item.states.join(',')}: `
  + `${item.contrastOk ? '     ' : String(item.ratio).padStart(5)}:1 `
  + `${item.sizeOk ? '    ' : `${item.size}px`.padStart(4)} ${item.path}`
  + `${item.viewport ? ' (over viewport)' : ''}${item.placeholder ? ' (placeholder)' : ''}`
  + ` “${item.text}”`;

async function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  if (args.includes('--static')) {
    const findings = staticScan(resolve(root, option('--root') ?? 'viewer'));
    for (const item of findings) {
      console.log(`${item.file}:${item.line}: ${item.kind === 'size'
        ? `font-size ${item.value} (< ${MIN_SIZE_PX}px)` : `${item.property}: ${item.value}`}`);
    }
    const sizes = findings.filter(item => item.kind === 'size').length;
    console.log(`\n${sizes} font sizes below ${MIN_SIZE_PX} px, `
      + `${findings.length - sizes} literal colors outside tokens.css`);
    process.exitCode = sizes ? 1 : 0;
    return;
  }
  let url = option('--url');
  let viewer = null;
  if (!url) {
    const { startViewer } = await import('./serve.mjs');
    viewer = await startViewer({ port: Number(option('--port') ?? 4374) });
    url = viewer.viewerUrl;
  }
  try {
    const report = await auditBrowser({
      url,
      themes: (option('--themes') ?? 'light,dark').split(','),
      states: option('--states')?.split(',') ?? DEFAULT_STATES,
      out: option('--out') ? resolve(option('--out')) : null,
    });
    const failed = failures(report);
    const exempt = failures(report, { exempt: true });
    if (option('--json')) {
      mkdirSync(dirname(resolve(option('--json'))), { recursive: true });
      writeFileSync(resolve(option('--json')), JSON.stringify({ ...report, failed, exempt },
        null, 2) + '\n');
    }
    for (const [theme, states] of Object.entries(report.themes)) {
      const texts = Object.values(states).reduce((sum, list) => sum + list.length, 0);
      const bad = failed.filter(item => item.theme === theme);
      // Counts are unique texts (one element path and text), not per state.
      const contrast = bad.filter(item => !item.contrastOk).length;
      const size = bad.filter(item => !item.sizeOk).length;
      console.log(`${theme}: ${texts} texts in ${Object.keys(states).length} states, `
        + `${contrast} below ${MIN_RATIO}:1, ${size} below ${MIN_SIZE_PX} px`);
    }
    for (const item of failed) console.log(formatFailure(item));
    if (exempt.length) console.log(`(${exempt.length} disabled-control texts exempt)`);
    for (const item of report.skipped) {
      console.log(`skipped ${item.theme} ${item.state}: ${item.reason}`);
    }
    if (report.console.length) console.log('console:', report.console.join('\n'));
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    viewer?.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 2;
  });
}
