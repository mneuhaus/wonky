#!/usr/bin/env node
// Static public report website. No external assets, runtime JS or benchmark runs.
// node scripts/reports/site/context-data.mjs && node scripts/reports/site/build.mjs
// After first uploads: node scripts/reports/site/urls.mjs
// Then: node scripts/reports/site/build.mjs --urls out/site/data/urls.json
// Re-upload every page after resolving the complete URL map. Default stays local.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import {
  REPO, readJson, page, section, p, ul, esc, inline, badge, source, tiles,
  card, grid, callout, table, details, image, barChart, beforeAfter, fmt, assertPublicSafe,
} from '../lib.mjs';

const OUT = join(REPO, 'out/site');
const DATA = 'out/site/data';
const LIMIT = 512 * 1024; // Documented postplan limit, stricter than the brief's 3 MB.
if (!['history', 'roadmap', 'performance', 'models', 'context'].every(key => existsSync(join(REPO, DATA, key + '.json')))) {
  if (process.argv.length > 2) throw new Error('Frozen public site: URL remapping requires the local-only historical input set');
  const pages = ['index', 'cad-acid'].map(key => ({key, html: readFileSync(join(REPO, 'site', key + '.html'), 'utf8')}));
  // Validate all pages before writing any output; missing private terms fail closed.
  for (const page of pages) assertPublicSafe(page.html);
  mkdirSync(OUT, {recursive: true});
  mkdirSync(join(OUT, 'data'), {recursive: true});
  for (const {key, html} of pages) writeFileSync(join(OUT, key + '.html'), html);
  writeFileSync(join(OUT, 'data/build.json'), JSON.stringify({schema:'wonky/site/build/v1', mode:'frozen-public', navigation:pages.map(({key})=>({key})), pages:pages.map(({key,html})=>({path:'out/site/'+key+'.html',bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex')}))}, null, 2)+'\n');
  console.log('Built 2 frozen public pages; unpublished historical inputs omitted.');
  process.exit(0);
}
const H = readJson(`${DATA}/history.json`);
const R = readJson(`${DATA}/roadmap.json`);
const P = readJson(`${DATA}/performance.json`);
const M = readJson(`${DATA}/models.json`);
const C = readJson(`${DATA}/context.json`);
if (H.head !== R.head || H.head !== C.head) throw new Error('Context, history and roadmap revisions differ; regenerate data first');
// Validate before embedding: only the supplied gallery directory is an asset source.
for (const m of M.models) for (const file of Object.values(m.images).filter(Boolean)) {
  if (isAbsolute(file) || !file.startsWith('out/site/img/') || relative(join(OUT, 'img'), resolve(REPO, file)).startsWith('..') || !existsSync(resolve(REPO, file))) throw new Error(`Invalid gallery asset for ${m.id}`);
}
const src = key => `${DATA}/${key}.json`;
const dateLabel = value => value.slice(0, 10).split('-').reverse().join('.');
const shortDate = value => value.slice(5, 10).split('-').reverse().join('.') + '.';
const short = revision => revision?.slice(0, 7) ?? 'nicht zugeordnet';
const statuses = { done: 'abgeschlossen', in_flight: 'in Arbeit', open: 'offen' };
const areaLabel = key => H.methodology.areas[key]?.label ?? key;
const packageCounts = R.summary.statusCounts;
const r20 = R.r20.summary;
const sourceById = new Map(P.sources.map(s => [s.id, s]));
const perfSrc = entries => [...new Set([src('performance'), ...(entries ?? []).map(s => {
  const found = sourceById.get(s.id);
  if (!found) throw new Error(`Unknown performance source: ${s.id}`);
  return `${found.path ?? found.command ?? `performance.json#/sources/${s.id}`}${s.pointer ? `#${s.pointer}` : ''}`;
})])];
const scientific = n => n === null || n === undefined ? 'offen' : n === 0 ? '0' : Math.abs(n) < .0001 ? n.toExponential(2).replace('.', ',') : fmt.num(n, 6).replace(/,?0+$/, '');
const volume = n => n === null || n === undefined ? 'offen' : fmt.num(n, 6);
const ratio = n => n == null ? 'offen' : `${fmt.num(n, 2)}×`;
const measured = (label, value, note, from) => ({ label, value, note, kind: 'gemessen', src: from });
const derived = [];
function derive(id, value, calculation, from) {
  derived.push({ id, value, calculation, sources: [from].flat() });
  return value;
}

const CSS = `
.site-nav{display:flex;flex-wrap:wrap;align-items:center;gap:0;border:1.5px solid var(--rule-strong);margin:0 0 22px;background:var(--surface-2)}
.site-nav a{padding:12px 13px;text-decoration:none;color:var(--ink-2);font-size:14px;white-space:nowrap}
.site-nav .brand{font:700 24px/1 var(--font-display);letter-spacing:-.03em;margin-right:auto;color:var(--ink);padding-right:24px}
.site-nav a[aria-current=page]{background:var(--accent-wash);color:var(--ink);box-shadow:inset 0 -3px var(--accent);font-weight:650}
.site-nav a:hover{text-decoration:underline;text-underline-offset:5px}
.skip{position:absolute;left:-10000px;top:0}.skip:focus{left:12px;z-index:5;background:var(--surface);padding:12px}
.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:26px;align-items:center;margin-bottom:28px}
.hero .thesis{font:700 clamp(28px,4vw,40px)/1.1 var(--font-display);max-width:19ch;margin-bottom:18px}
.hero .img{margin:0}.hero .img img{width:100%}.hero p{color:var(--ink-2)}
.ledger-link{display:block;padding:14px 16px;border:1px solid var(--rule);text-decoration:none;color:var(--ink)}
.ledger-link:hover{border-color:var(--accent);background:var(--accent-wash)}
.ledger-link strong{display:block;margin-bottom:5px}.ledger-link span{font-size:14px;color:var(--ink-2)}
.timeline{list-style:none;padding:0;margin:0}.timeline>li{display:grid;grid-template-columns:125px 1fr;gap:20px;margin:0;padding:0 0 26px}
.timeline .stamp{font:12px/1.7 var(--font-mono);color:var(--ink-2)}
.timeline .entry{border-left:2px solid var(--rule);padding-left:20px;position:relative}
.timeline .entry:before{content:'';position:absolute;left:-5px;top:5px;width:8px;height:8px;background:var(--accent);box-shadow:0 0 0 3px var(--surface)}
.timeline p{font-size:14px}.timeline .src{font-size:12px}
.chart-scroll{overflow-x:auto;max-width:100%}.chart-scroll-note{display:none}.plot{display:block;width:100%;min-width:860px;font-family:var(--font-body)}
@media(max-width:900px){.chart-scroll-note{display:block;font-size:12px;color:var(--ink-2);margin:0 0 8px}}
.plot .trace{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.plot .dot{stroke:var(--surface);stroke-width:2}
.plot .crosshair{stroke:var(--ink-2);stroke-width:1;opacity:0}.plot .point:hover .crosshair,.plot .point:focus .crosshair{opacity:.5}
.plot .point:focus{outline:none}.plot .point:focus .dot{stroke:var(--ink);stroke-width:2}
.plot .tooltip{opacity:0;pointer-events:none}.plot .point:hover .tooltip,.plot .point:focus .tooltip{opacity:1}
.plot .tooltip rect{fill:var(--surface);stroke:var(--rule)}
.plot text{fill:var(--ink);font-size:12px}.plot .axis-label{fill:var(--ink-2);font-size:11px}
.plot .s1{stroke:var(--s1)}.plot .s2{stroke:var(--s2)}.plot .s3{stroke:var(--s3)}
.chart-key{display:flex;flex-wrap:wrap;gap:10px 18px;list-style:none;padding:0;margin:0 0 14px;font-size:13px}
.chart-key li{display:flex;gap:6px;align-items:center}.key-mark{width:18px;height:10px;display:inline-block;background:var(--s1)}
.key-mark.mesh{background:var(--s2)}.key-mark.third{background:var(--s3)}.key-mark.old{background:var(--n)}
.key-mark.done{background:var(--good)}.key-mark.work{background:var(--warn-line)}.key-mark.open{background:var(--n)}.key-mark.refused{background:var(--fail)}
.status{display:inline-flex;align-items:center;gap:6px;font:600 11px/1.4 var(--font-body);color:var(--ink-2);border:1px solid var(--rule);padding:4px 7px}
.status:before{content:'';width:9px;height:9px;background:var(--s1)}.status.mesh:before{background:var(--s2)}
.status.refused:before{background:none;border:1.5px solid var(--fail);border-radius:50%}.status.stale:before{background:var(--n)}
.model{border:1px solid var(--rule);padding:16px;margin-bottom:24px;break-inside:avoid;scroll-margin-top:12px}
.model-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.model-head .eyebrow{font:11px var(--font-mono);color:var(--ink-2);margin-bottom:5px}.model-head h3{margin:0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pair .img{margin-bottom:14px}.pair .img img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#eef1f3}.pair .src{display:none}
.pair figcaption{font:12px var(--font-mono)}.missing-model{display:flex;flex-direction:column;justify-content:center;padding:18px;aspect-ratio:4/3;border:1px dashed var(--rule-strong);margin-bottom:14px;color:var(--ink-2)}
.missing-model strong{display:block;color:var(--ink);margin-bottom:8px}.model-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:4px 0 12px}
.model-facts dt{font-size:11px;color:var(--ink-2)}.model-facts dd{margin:4px 0;font-size:13px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.model-note{font-size:13px;color:var(--ink-2)}
.jump{display:flex;flex-wrap:wrap;gap:8px 14px;padding:12px 0;margin-bottom:18px;border-bottom:1px solid var(--rule);font-size:14px}
.roadmap-packages td:nth-child(2){min-width:18rem}.roadmap-packages td:last-child{min-width:17rem}.plan-grid .card{box-shadow:none;border-radius:0;border-top:3px solid var(--rule)}
.colophon{line-height:1.6} .site-note{font-size:13px;color:var(--ink-2)} .tbl-scroll:focus-visible,.chart-scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media(max-width:700px){.site-nav .brand{width:100%;border-bottom:1px solid var(--rule);padding:12px}.site-nav a{padding:11px 10px;font-size:13px}.hero{grid-template-columns:1fr}.hero .thesis{max-width:none}.hero .img img{max-height:280px;object-fit:contain}.timeline>li{grid-template-columns:1fr;gap:6px}.timeline .stamp{padding-left:20px}.model-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.model-head{flex-direction:column}.model{padding:12px}.pair{gap:7px}.missing-model{padding:10px;font-size:12px}.pair figcaption{font-size:10px}}
@media(max-width:350px){.tiles{grid-template-columns:1fr}.model-facts{grid-template-columns:1fr}}
@media(forced-colors:active){.plot .trace{stroke:CanvasText}.plot .dot{fill:CanvasText}.status:before{border:1px solid CanvasText}.key-mark{border:1px solid CanvasText}}
@media print{.site-nav,.skip{display:none}.plot{min-width:0}.chart-scroll,.tbl-scroll{overflow:visible}.timeline .entry{break-inside:avoid}.model .src{display:block}.pair .src{display:none}.trace.s2{stroke-dasharray:6 4}.trace.s3{stroke-dasharray:2 4}}
`;

function plotFrame({ title, sub, svg, columns, rows, from, legend = '' }) {
  return `<figure class="chart"><figcaption><strong>${inline(title)}</strong><span>${inline(sub ?? '')}</span></figcaption>${legend}<p class="chart-scroll-note">Diagramm horizontal scrollen. Alle Werte stehen auch in der Tabelle.</p><div class="chart-scroll" tabindex="0" role="region" aria-label="${esc(title)}">${svg}</div>${details('Werte als Tabelle', table({ columns, rows }))}${source(from)}</figure>`;
}

function lineChart({ title, sub, labels, series, max, format = fmt.auto, from, step = true, tickLabels }) {
  const W = 860, Ht = 280, left = 56, right = 700, top = 32, bottom = 218;
  const observed = series.flatMap(s => s.values).filter(v => v != null);
  const ymax = max ?? Math.ceil(Math.max(...observed) / 400) * 400;
  const x = i => left + i / Math.max(1, labels.length - 1) * (right - left);
  const y = v => bottom - v / ymax * (bottom - top);
  const ticks = Array.from({ length: 5 }, (_, i) => ymax * i / 4);
  const axis = ticks.map(v => `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="axis"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end" class="axis-label">${esc(format(v))}</text>`).join('');
  const indices = tickLabels ?? [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])];
  const xticks = indices.map(i => `<text x="${x(i)}" y="${bottom + 26}" text-anchor="middle" class="axis-label">${esc(labels[i])}</text>`).join('');
  const traces = series.map((s, j) => {
    let path = '', previous = null;
    for (let i = 0; i < s.values.length; i++) {
      const v = s.values[i];
      if (v == null) { previous = null; continue; }
      path += previous === null ? `M${x(i)},${y(v)}` : step ? `H${x(i)}V${y(v)}` : `L${x(i)},${y(v)}`;
      previous = v;
    }
    const dash = j === 1 ? ' stroke-dasharray="7 4"' : j === 2 ? ' stroke-dasharray="2 4"' : '';
    const dots = s.values.map((v, i) => {
      if (v == null) return '';
      const label = `${labels[i]} · ${s.label}: ${format(v)}`;
      const tx = Math.max(left, Math.min(right - 260, x(i) - 120));
      return `<g class="point" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${bottom}" class="crosshair"/><circle cx="${x(i)}" cy="${y(v)}" r="12" fill="transparent"/><circle cx="${x(i)}" cy="${y(v)}" r="4" class="dot f-s${j + 1}"/><g class="tooltip"><rect x="${tx}" y="1" width="280" height="24" rx="3"/><text x="${tx + 8}" y="17">${esc(label)}</text></g></g>`;
    }).join('');
    const last = s.values.findLastIndex(v => v != null);
    return `<path d="${path}" class="trace s${j + 1}"${dash}/>${dots}<text x="${right + 12}" y="${y(s.values[last]) + 4}">${esc(`${s.endLabel ?? s.label} ${format(s.values[last])}`)}</text>`;
  }).join('');
  const legend = series.length > 1 ? `<ul class="chart-key">${series.map((s, j) => `<li><svg width="24" height="12" aria-hidden="true"><line x1="0" x2="24" y1="6" y2="6" stroke="var(--s${j + 1})" stroke-width="2" ${j === 1 ? 'stroke-dasharray="7 4"' : j === 2 ? 'stroke-dasharray="2 4"' : ''}/></svg>${esc(s.label)}</li>`).join('')}</ul>` : '';
  return plotFrame({ title, sub, legend, from,
    svg: `<svg class="plot" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(title)}">${axis}${xticks}${traces}</svg>`,
    columns: ['Stand', ...series.map(s => s.label)], rows: labels.map((label, i) => [label, ...series.map(s => format(s.values[i]))]),
  });
}

function countStacks({ title, sub, keys, rows, from }) {
  const max = Math.max(...rows.map(r => r.values.reduce((a, b) => a + b, 0)));
  const height = rows.length * 59 + 42;
  const barStart = 156, span = 480;
  const legend = `<ul class="chart-key">${keys.map(k => `<li><i class="key-mark ${k.cls ?? ''}" aria-hidden="true"></i>${esc(k.label)}</li>`).join('')}</ul>`;
  const ticks = [...new Set([0, Math.ceil(max / 2), max])].map(v => `<line x1="${barStart + span * v / max}" x2="${barStart + span * v / max}" y1="20" y2="${height - 23}" class="axis"/><text x="${barStart + span * v / max}" y="14" text-anchor="middle" class="axis-label">${v}</text>`).join('');
  const bars = rows.map((r, i) => {
    let offset = 0;
    const yy = 37 + i * 59;
    const marks = r.values.map((v, j) => {
      const xx = barStart + span * offset / max; offset += v;
      return v ? `<rect x="${xx}" y="${yy}" width="${Math.max(0, span * v / max - 2)}" height="18" rx="2" fill="${keys[j].fill}"><title>${esc(`${r.label}: ${keys[j].label} ${v}`)}</title></rect>` : '';
    }).join('');
    return `<text x="0" y="${yy - 7}">${esc(r.label)}</text>${marks}<text x="${barStart + span + 16}" y="${yy + 14}">${esc(r.values.map(v => fmt.num(v)).join(' / '))}</text><text x="${barStart}" y="${yy + 35}" class="axis-label">${esc(r.note ?? '')}</text>`;
  }).join('');
  return plotFrame({ title, sub, legend, from, svg: `<svg class="plot" viewBox="0 0 860 ${height}" role="img" aria-label="${esc(title)}">${ticks}${bars}</svg>`, columns: ['Bereich', ...keys.map(k => k.label), 'Einordnung'], rows: rows.map(r => [r.label, ...r.values.map(v => fmt.num(v)), r.note ?? '']) });
}

function r20Chart() {
  return countStacks({ title: 'R20 · gespeicherte Build-Belege je Modul', sub: 'Teile, nicht Module. Gleiche absolute Skala; rechts: exakt / Mesh / alter Stand / verweigert. Ohne Blends.',
    keys: [{ label: 'Exakt, aktueller Vergleichsstand', fill: 'var(--s1)' }, { label: 'Certified Mesh, aktueller Vergleichsstand', cls: 'mesh', fill: 'var(--s2)' }, { label: 'Älterer Quellstand', cls: 'old', fill: 'var(--n)' }, { label: 'Verweigert', cls: 'refused', fill: 'var(--fail)' }],
    rows: R.r20.modules.map(m => ({ label: m.module, values: m.snapshotStatus === 'stale_source' ? [0, 0, m.builtParts, 0] : [m.exactParts, m.certifiedMeshParts, 0, m.referenceParts - m.builtParts], note: m.snapshotStatus === 'stale_source' ? 'tray nicht als aktueller Erfolg gezählt' : m.buildStatus === 'refused' ? 'kein Build; Nahkontakt-Topologie offen' : `${m.matchingParts}/${m.comparableParts} Volumenintervalle getroffen` })),
    from: [src('roadmap') + '#/r20', ...R.r20.src],
  });
}
function roadmapChart() {
  return countStacks({ title: 'Roadmap-Pakete nach Arbeitsbereich', sub: 'Redaktionell aus Quellen eingeordnet, keine gemessene Fertigstellungsquote. Rechts: abgeschlossen / in Arbeit / offen.',
    keys: [{ label: 'Abgeschlossen', cls: 'done', fill: 'var(--good)' }, { label: 'In Arbeit', cls: 'work', fill: 'var(--warn-line)' }, { label: 'Offen', cls: 'open', fill: 'var(--n)' }],
    rows: R.lanes.map(l => ({ label: `${l.id} · ${l.title}`, values: ['done', 'in_flight', 'open'].map(s => derive(`roadmap.${l.id}.${s}`, R.packages.filter(p => p.lane === l.id && p.status === s).length, `count(packages where lane=${l.id} and status=${s})`, src('roadmap'))) })), from: [src('roadmap'), ...R.summary.src],
  });
}
function testsChart() {
  return lineChart({ title: 'Testdeklarationen im Git-Verlauf', sub: 'Statische Zählung pro Commit in topologischer Reihenfolge. Keine ausgeführten Tests und keine Passquote.',
    labels: H.commits.map(c => c.hash), series: [{ label: 'Deklarationen', endLabel: '', values: H.commits.map(c => c.testCases) }], from: [src('history') + '#/commits', ...H.methodology.src],
  });
}
const modelNames = { 'perf-comb-vertical-edges-r0.5': 'Kamm', 'perf-hole-grid-rims-0.42': 'Lochraster', 'pp-box-all-edges-r2': 'Box' };
function stepChart(target) {
  const series = P.stepwiseSeries.filter(s => s.target === target);
  return lineChart({ title: target === 'cpu1' ? 'Native Rechenzeit · Verbesserung über Commits' : 'JS-Nutzerzeit · Verbesserung über Commits',
    sub: target === 'cpu1' ? 'Normiert auf Baseline = 100 %. Niedriger ist besser. Absolute Millisekunden stehen direkt darunter.' : 'Baseline = 100 %. Nutzerzeit ist weder Wall-Time noch Kernel-Compute.',
    labels: series[0].points.map(pt => short(pt.revision)), max: 100, format: n => `${fmt.num(n)} %`,
    series: series.map(s => ({ label: modelNames[s.model] ?? s.model, values: s.points.map(pt => derive(`step.${s.id}.${short(pt.revision)}`, pt.measurement.value / s.points[0].measurement.value * 100, 'measurement / baseline measurement * 100', src('performance') + '#/stepwiseSeries')) })),
    from: perfSrc(series.flatMap(s => s.sources)), tickLabels: [0, 1],
  });
}

function overview() {
  const heroModel = M.models.find(m => m.id === 'r20-topplate') ?? M.models.find(m => m.kind === 'FeatureScript' && m.wonkyStatus === 'exact B-rep');
  const hero = `<div class="hero"><div><p class="thesis">Exakte Geometrie.<br>Offene Grenzen.</p>${p('wonky ist ein CAD-Kern in Bend. FeatureScript und build123d liefern die Modelleingabe, der Viewer macht Ergebnisse und Grenzen sichtbar. Reale Teile entstehen bereits, aber nicht jedes Ergebnis ist eine exakte B-rep.')}${source(src('context') + '#/architecture')}</div>${image(heroModel.images.wonky, { alt: `Wonky-Modell ${heroModel.name}`, caption: `${heroModel.name} · ${heroModel.wonkyStatus} · Galerie-Build ${short(heroModel.implementation.revision)}`, src: src('models') })}</div>`;
  return {
    title: 'Übersicht', lede: 'Ein Entwicklungsstand, kein pauschales Fertigversprechen. Was bereits trägt, was gemessen wurde und wo der Kern noch stoppt.',
    sections: [
      hero,
      section({ title: 'Stand des Kerns', id: 'stand' }, tiles([
        measured('R20-Module mit gespeichertem Build', `${r20.builtModules} / ${r20.totalModules}`, `${r20.currentSnapshotBuiltModules} davon mit aktuellem Vergleichsstand; tray ist älter.`, src('roadmap') + '#/r20/summary'),
        measured('Aktuell vergleichbare R20-Teile', `${r20.withinReferenceIntervalParts} / ${r20.comparableParts}`, 'Volumen im Referenzintervall. Kein vollständiger Geometrienachweis.', src('roadmap') + '#/r20/summary'),
        measured('Testdeklarationen', fmt.num(H.summary.testCases), 'Statisch gezählt. Nicht gleich bestandene Tests.', src('history') + '#/summary'),
        measured('Commits im Bericht', fmt.num(H.summary.commitCount), `${shortDate(H.summary.firstDate)} bis ${shortDate(H.summary.lastDate)} · Git-Historie, nicht Projektalter.`, src('history') + '#/summary'),
      ]), callout('offen', 'feed und durchgehend exakte R20-Modelle bleiben offen', p(`${r20.builtParts} gespeicherte Teile bestehen aus ${r20.exactParts} exakten B-reps und ${r20.certifiedMeshParts} Certified Meshes. Die ${r20.staleReferenceParts} tray-Teile zählen nicht als aktueller Vergleichserfolg. Eine benannte Ablehnung ist ehrlich, aber noch keine Fähigkeit.`), { src: src('roadmap') + '#/r20' })),
      section({ title: 'Ein Kern, zwei Frontends, ein Viewer', id: 'architektur' }, grid(C.architecture.map(a => card({ title: a.title, body: p(a.note), src: a.src })))),
      section({ title: 'R20 als reale Messlatte', id: 'r20' }, r20Chart(), p('Die Galerie zeigt separat erzeugte Modelle auf ihrem angegebenen Build-Stand. Ihre Bildpaare ersetzen nicht die gespeicherten Abnahmebelege dieser Übersicht.'), source(src('models'), src('roadmap'))),
      section({ title: 'Nächste Entscheidungen', id: 'naechstes' }, grid(
        card({ title: 'Fähigkeit vor Quote', body: p(`${packageCounts.done} Pakete abgeschlossen, ${packageCounts.in_flight} in Arbeit, ${packageCounts.open} offen. Das ist eine Bestandsaufnahme unterschiedlicher Paketgrößen, keine Prozentzahl für den gesamten Kern.`), src: src('roadmap') }),
        card({ title: 'Performance ist kein Einzelwert', body: p('Lazy Exact Forms senken Rechenarbeit in den belegten Fillet-Jobs. Die vollständige build123d-Pipeline bleibt im historischen API-Vergleich deutlich hinter OCCT. Beide Befunde gehören zusammen.'), src: src('performance') }),
      ), `<div class="grid">${[
        ['roadmap', 'Roadmap', 'Pakete, Abhängigkeiten und historische Zeitfenster.'],
        ['fortschritt', 'Fortschritt', 'Fähigkeiten und Grenzen entlang der Git-Historie.'],
        ['tests', 'Tests', 'Statische Zählung, Test-Lanes und Verifikationspraxis.'],
        ['performance', 'Performance', 'Messgrenzen, Vergleichswerte und belegte Schritte.'],
        ['modelle', 'Modelle', 'Referenz und wonky direkt nebeneinander.'],
      ].map(([key, title, note]) => `<a class="ledger-link" href="{{URL:${key}}}"><strong>${esc(title)}</strong><span>${esc(note)}</span></a>`).join('')}</div>`),
    ],
  };
}
function roadmap() {
  return { title: 'Roadmap', lede: 'Der vollständige Paketbestand aus der Roadmap, mit belegten Teilfortschritten. Termine bleiben historische Planung, keine neuen Zusagen.', sections: [
    section({ title: 'Pakete und Status', id: 'pakete' }, tiles([
      { label: 'Abgeschlossen', value: fmt.num(packageCounts.done), note: R.statusPolicy.done, kind: 'gemessen', src: src('roadmap') + '#/summary' },
      { label: 'In Arbeit', value: fmt.num(packageCounts.in_flight), note: R.statusPolicy.in_flight, kind: 'geschätzt', src: src('roadmap') + '#/summary' },
      { label: 'Offen', value: fmt.num(packageCounts.open), note: R.statusPolicy.open, kind: 'offen', src: src('roadmap') + '#/summary' },
    ]), p(R.statusPolicy.note), roadmapChart(), p('Die gezählten Pakete gehören zu A–H und TW. Separate Performance- und Orakel-Lanes gehören nicht in diesen Nenner.'), source(src('roadmap') + '#/unscheduled')),
    section({ title: 'Historische Etappen und R20-Ziel', id: 'termine' }, callout('geschätzt', 'Planungsstand, nicht aktualisierter Lieferplan', p(R.calendar[0].note), { src: [src('roadmap') + '#/calendar', ...R.calendar[0].src] }),
      `<div class="grid plan-grid">${[...R.calendar].sort((a, b) => a.start.localeCompare(b.start)).map(c => card({ title: c.title, eyebrow: c.start === c.end ? dateLabel(c.start) : `${dateLabel(c.start)} bis ${dateLabel(c.end)}`, kind: 'geschätzt', body: p(`Pakete: ${c.packageIds.join(', ')}. Status: ${statuses[c.status]}.`) + (c.target ? p(`Historischer Zielpunkt: ${dateLabel(c.target)}.`) : ''), src: [src('roadmap') + '#/calendar', ...c.src] })).join('')}</div>`,
      ul(R.unscheduled.map(u => `${u.title}: ${u.note}`)), source(src('roadmap') + '#/unscheduled')),
    section({ title: 'R20: heutige Belege und offene Stufen', id: 'r20' }, r20Chart(), ul(R.r20.limitations), source(src('roadmap') + '#/r20'),
      table({ columns: ['Blend-Modul', 'Gespeicherter Status', 'Grenze'], rows: R.r20.blends.map(b => [b.module, b.status === 'built' ? `Build vorhanden; ${b.parts} Teile, ${b.exactParts} exakt` : 'verweigert / offen', b.note]), src: [src('roadmap') + '#/r20/blends', ...R.r20.blends.flatMap(b => b.src)] }),
      callout('offen', 'feed', p(R.r20.feed.note), { src: R.r20.feed.src })),
    section({ title: 'Alle Arbeitspakete', id: 'alle-pakete' }, p('Status bezieht sich auf den vollständigen Paketumfang. Ein gelandeter Teilcommit schließt ein Paket nicht automatisch ab. Aufwand ist historisch geschätzt; leere Schätzung bedeutet nicht null Aufwand.'),
      R.lanes.map(l => details(`${l.id} · ${l.title} · ${l.packageIds.length} Pakete`, `<div class="roadmap-packages">${table({ columns: ['ID', 'Paket', 'Status / Commit', 'Aufwand', 'Abhängigkeiten', 'Beleg und Grenze'], rows: R.packages.filter(p => p.lane === l.id).map(p => [p.id, p.title, `${statuses[p.status]}${p.landedCommits?.length ? ` · ${p.landedCommits.join(', ')}` : ''}`, p.estimateDays == null ? 'nicht geschätzt' : `${fmt.num(p.estimateDays, 1)} Tage (geschätzt)`, p.dependsOn.length ? p.dependsOn.join(', ') : p.dependencyNote === '-' ? 'keine genannt' : p.dependencyNote, p.note]), src: [src('roadmap') + '#/packages', ...R.packages.filter(p => p.lane === l.id).flatMap(p => p.src)] })}</div>`, { open: l.id === 'E' })).join('')),
  ] };
}
function progress() {
  const countedAreas = Object.entries(H.methodology.areas).filter(([key]) => key !== 'tooling');
  return { title: 'Fortschritt', lede: 'Nicht nur mehr Code: nachvollziehbare Fähigkeiten, Entscheidungen und Grenzen entlang der gespeicherten Git-Historie.', sections: [
    section({ title: 'Aktivität und Testbestand', id: 'verlauf' }, barChart({ title: 'Commits pro Kalendertag', sub: 'Alle von main erreichbaren Commits; Datum aus der gespeicherten Committerzeit.', unit: 'Commits', data: H.daily.map(d => ({ label: dateLabel(d.date), value: d.commits, kind: 'gemessen' })), src: src('history') + '#/daily' }), testsChart()),
    section({ title: 'Feature-Meilensteine', id: 'meilensteine' }, p('Ein Commit belegt eine Änderung, nicht automatisch die vollständige Abnahme eines Themenbereichs. Frühe Arbeitsstände und Teilumfänge bleiben gekennzeichnet.'),
      `<ol class="timeline">${H.milestones.map(m => `<li><div class="stamp"><time datetime="${m.date}">${dateLabel(m.date)}</time><br><code>${m.commit}</code><br>${esc(areaLabel(m.area))}</div><div class="entry"><h3>${esc(m.title)}</h3>${p(m.note)}${source(m.src)}</div></li>`).join('')}</ol>`),
    section({ title: 'Dateiumfang, nicht Produktivität', id: 'umfang' }, table({ columns: ['Bereich', 'Dateien', 'Physische Textzeilen'], rows: countedAreas.map(([key, area]) => [area.label, fmt.num(H.summary.files[key]), fmt.num(H.summary.lines[key])]), src: [src('history') + '#/summary', ...H.summary.src] }), p(H.methodology.lines)),
    section({ title: 'Vollständiges Commitregister', id: 'commits' }, details(`${H.commits.length} Commits mit Testbestand`, table({ columns: ['Commit', 'Datum', 'Bereich', 'Änderung', 'Testdeklarationen'], rows: H.commits.map(c => [c.hash, dateLabel(c.date), areaLabel(c.area), c.subject, fmt.num(c.testCases)]), src: src('history') + '#/commits' })), p(H.methodology.classification)),
  ] };
}
function tests() {
  const t = C.tests;
  const growth = derive('tests.declarationGrowth', H.summary.testCases - H.commits[0].testCases, 'summary.testCases - commits[0].testCases', src('history'));
  return { title: 'Tests', lede: 'Zähler zeigen den Bestand. Vertrauen entsteht durch überprüfbare Ergebnisse, klare Ablehnungen und unabhängige Geometrievergleiche.', sections: [
    section({ title: 'Bestand im Zeitverlauf', id: 'bestand' }, tiles([
      measured('Statische Testdeklarationen', fmt.num(H.summary.testCases), `Vom ersten Commit mit ${fmt.num(H.commits[0].testCases)}: +${fmt.num(growth)} Deklarationen.`, src('history')),
      measured('Node-Testdateien', fmt.num(t.counts.files), 'Getrackte test/*.test.mjs am Berichtsstand.', src('context') + '#/tests'),
      { label: 'Aktuelle Gesamtabnahme', value: 'nicht ausgeführt', kind: 'offen', note: 'Website-Build prüft Darstellung, nicht den Kernel.', src: src('context') + '#/tests/verification' },
    ]), testsChart(), callout('entscheidung', 'Deklarationen sind keine bestandenen Testfälle', p(H.methodology.testCases), { src: src('history') + '#/methodology' }),
      table({ columns: ['Tagesstand', 'Commit', 'Deklarationen', 'Testdateien'], rows: H.daily.map(d => [dateLabel(d.date), d.commit, fmt.num(d.testCases), fmt.num(d.testFiles)]), src: src('history') + '#/daily' })),
    section({ title: 'Test-Lanes', id: 'lanes' }, barChart({ title: 'Dateien in fast und slow', sub: `Grenze: ${t.thresholdSeconds} Sekunden gespeicherte Warm-Cache-Zeit. Dateiauswahl, keine Passzahl.`, unit: 'Dateien', data: [{ label: 'fast', value: t.counts.fast }, { label: 'slow', value: t.counts.slow }], src: [src('context') + '#/tests', ...t.src] }), p(t.counting), p(`${t.counts.recorded} Dateien haben eine gespeicherte Zeit, ${t.counts.unrecorded} noch nicht. ${t.changedNote}`), source(src('context') + '#/tests'),
      table({ columns: ['Befehl', 'Zweck'], rows: t.commands.map(c => [c.command, ({ test: 'Bend prüfen und alle Node-Testdateien ausführen', 'test:fast': 'Schnelle Dateien, Fail-fast', 'test:changed': 'Heuristisch betroffene Dateien, Fail-fast', 'test:slow': 'Langsame Dateien', 'test:record': 'Alle Lane-Dateien ausführen und Zeiten aktualisieren', 'check:bend': 'Bend-Prüfung separat' })[c.name]]), src: t.commands.flatMap(c => c.src) }),
      details('Gespeicherte Zeit pro Datei', table({ columns: ['Datei', 'Lane', 'Warm-Cache-Zeit (s)'], rows: t.rows.map(r => [r.file, r.lane, r.seconds == null ? 'nicht erfasst' : fmt.num(r.seconds, 1)]), src: t.src }))),
    section({ title: 'So wird verifiziert', id: 'praxis' }, grid(t.verification.map(v => card({ title: v.title, body: p(v.note), src: v.src }))),
      callout('offen', 'Keine Prozentzahl für „Korrektheit“', p('Ein Volumenintervall, ein unverändertes Bild und ein bestandener Refusal-Test beantworten verschiedene Fragen. Diese Website addiert sie deshalb nicht zu einer Erfolgsquote.'), { src: [src('models') + '#/notes', src('roadmap') + '#/r20/limitations'] })),
  ] };
}
function condition(id) {
  const c = P.conditions[id];
  const metadata = [['Maschine', c.machine ?? 'nicht dokumentiert'], ['Ziel', c.target], ['Messgrenze', c.boundary], ['Last', c.load ?? 'nicht dokumentiert'], ['Thermik', c.thermal ?? 'nicht dokumentiert']];
  if (c.samples != null) metadata.push(['Stichproben', `${c.samples} nach ${c.warmups ?? 'nicht dokumentiert'} Warm-ups`]);
  if (c.loadBefore) metadata.push(['Load vor / nach', `${c.loadBefore.map(n => fmt.num(n, 2)).join(' / ')} → ${c.loadAfter.map(n => fmt.num(n, 2)).join(' / ')}`]);
  if (c.caution) metadata.push(['Grenze', c.caution]);
  return details('Messbedingungen und Grenzen', table({ columns: ['Eigenschaft', 'Dokumentation'], rows: metadata, src: perfSrc(c.sources) }), { open: id === 'fillet-judge' });
}
function performance() {
  const b = P.build123d, h = P.hardware;
  const nativeBeforeAfter = P.fillet.jobs.map(j => ({ label: modelNames[j.id] ?? j.id, before: j.nativeBefore.value, after: j.nativeAfter.value, kind: 'gemessen' }));
  const snapshot = P.snapshotSeries.rows.filter(r => r.target === 'cpu-18');
  return { title: 'Performance', lede: 'Schneller werden, ohne die Aussage der Messung zu wechseln. Commit-Schritte, API-Gesamtzeit und Kernel-Durchsatz sind getrennte Vergleiche.', sections: [
    section({ title: 'Belegter Verbesserungsschritt', id: 'commit-schritte' }, callout('gemessen', 'Lazy Exact Forms statt vorsorglicher Großrechnungen', p('Exakte Breiten- und Sehnenformen werden erst aufgebaut, wenn der Float-Filter nicht entscheidet. Die unabhängige Prüfung meldet bytegleiche Ausgaben; Fallback und Filtergrenzen bleiben erhalten.'), { src: perfSrc(P.stepwiseSeries[0].sources) }),
      p(P.stepwiseSeries[0].commitAttribution), p('Die Treppen verbinden ausschließlich die belegten Zustände. Keine zusätzlichen Messpunkte, keine zeitliche Interpolation und keine Übertragung auf die ganze Modellpipeline.'), source(src('performance') + '#/stepwiseSeries'),
      stepChart('cpu1'), beforeAfter({ title: 'Native cpu1 · absolute Rechenzeit', unit: 'ms', data: nativeBeforeAfter, labels: { before: short(P.fillet.baselineRevision), after: short(P.fillet.revision) }, better: 'lower', src: perfSrc(P.fillet.sources) }), stepChart('JS'), condition('fillet-judge'), ul(P.fillet.notes), source(src('performance') + '#/fillet/notes')),
    section({ title: 'build123d gegen OCCT', id: 'build123d' }, p(b.title), callout('entscheidung', 'Ein API-Vergleich, kein isoliertes Kernelrennen', p(P.conditions.build123d.boundary), { src: perfSrc(b.sources) }),
      table({ columns: ['Modell', 'wonky Build (ms)', 'OCCT Build (ms)', 'wonky / OCCT', 'Prüfstatus'], rows: b.models.map(m => [m.label, fmt.num(m.phases.wonky.build.value, 3), fmt.num(m.phases.reference.build.value, 3), ratio(m.wonkyToReference.value), 'Geometrie laut gespeichertem Lauf abgeglichen']), src: perfSrc(b.sources) }),
      p('Faktor > 1 heißt hier: wonky braucht länger. Die historische Messung nutzt Bend JS und unterschiedliche Prozess-/Validierungsarbeit. Sie ist weder ein aktueller fa7b77c-Lauf noch ein nativer Gesamtmodellvergleich.'), source(src('performance') + '#/build123d'), condition('build123d')),
    section({ title: 'Warmer Kern-Durchsatz auf M5 Pro', id: 'hardware' }, p('Unabhängige Operationen als Batch. Ohne Frontend, Hostvalidierung, Datentransport und Export. Diese Hardware-Snapshots haben keinen belegten Git-Commit.'), source(src('performance') + '#/hardware'),
      table({ columns: ['Aufgabe', 'Operationen / Batch', 'JS (ms)', 'cpu1 (ms)', 'cpu18 (ms)', 'Metal (ms)'], rows: h.rows.map(r => [r.label, fmt.num(r.operationsPerBatch), fmt.num(r.timings.js.value), fmt.num(r.timings['cpu-1'].value), fmt.num(r.timings['cpu-18'].value), fmt.num(r.timings.metal.value)]), src: perfSrc(h.sources) }), condition('hardware'),
      snapshot.length ? beforeAfter({ title: 'Aufgabenoptimierung · Snapshots ohne Commit-Zuordnung', sub: 'Native cpu18, vergleichbare Arbeitsmenge. Nicht an den Fillet-Commit-Verlauf anhängen.', unit: 'ms', data: snapshot.map(r => ({ label: `${r.workload} · ${r.tasks} Tasks × ${r.operationsPerTask}`, before: r.points[0].measurement.value, after: r.points[1].measurement.value, kind: 'gemessen' })), labels: { before: 'Vorher-Snapshot', after: 'Nachher-Snapshot' }, better: 'lower', src: perfSrc(snapshot.flatMap(r => r.sources)) }) : '',
      p(P.snapshotSeries.note), source(src('performance') + '#/snapshotSeries')),
    section({ title: 'Boolean-Bakeoff', id: 'boolean' }, table({ columns: ['Ansatz', 'Gemeinsame Fälle', 'JS (ms)', 'cpu1 (ms)', 'cpuN (ms)', 'Metal (ms)'], rows: P.bakeoff.approaches.map(a => [a.id, fmt.num(a.commonSetTotals.js.cohortSize), ...['js', 'cpu1', 'cpuN', 'metal'].map(t => a.commonSetTotals[t]?.value == null ? 'offen' : fmt.num(a.commonSetTotals[t].value, 1))]), src: perfSrc(P.bakeoff.sources) }),
      p('Summen fallweiser Mediane, keine Pipeline-Wall-Time. Die Lastbedingungen bleiben unterschiedlich. SDF ist toleranzgebunden, keine exakte CAD-Geometrie; eine schnelle Zahl schließt Korrektheitsgrenzen nicht.'), ul(P.bakeoff.notes), source(src('performance') + '#/bakeoff'),
      details('Lastbedingungen je Ansatz und Ziel', table({ columns: ['Bedingung', 'Messgrenze / Last'], rows: Object.entries(P.conditions).filter(([id]) => id.startsWith('bakeoff-')).map(([id, c]) => [id, [c.boundary, c.load].filter(Boolean).join(' ')]), src: src('performance') + '#/conditions' }))),
    section({ title: 'OpenSCAD: akzeptierte Teilserie', id: 'openscad' }, condition('openscad'),
      table({ columns: ['Modell', 'Referenz', 'Warme CLI-Zeit wonky / Referenz', 'Exaktes STEP'], rows: P.openscad.comparisons.map(c => [c.model, c.reference, ratio(c.wonkyToReference.value), c.wonkyToReference.value == null ? 'offen' : c.stepRefused ? 'verweigert; STL gültig' : 'laut gespeichertem Lauf ausgegeben']), src: perfSrc(P.openscad.sources) }),
      details('Akzeptierte und ausgeschlossene Samples', table({ columns: ['Job', 'Status', 'Warm (ms)', 'Samples akzeptiert', 'Samples ausgeschlossen', 'Kalt (ms)'], rows: P.openscad.rows.map(r => [r.id, r.status, r.warm?.value == null ? 'offen' : fmt.num(r.warm.value, 2), r.acceptedSampleCount?.value ?? 'offen', r.excludedSampleCount?.value ?? 'offen', r.cold?.value == null ? 'offen' : fmt.num(r.cold.value, 2)]), src: perfSrc(P.openscad.sources) })),
      ul(P.openscad.notes), source(src('performance') + '#/openscad/notes')),
    section({ title: 'Parallelismus und offene Messungen', id: 'offen' }, p(P.parallelism.title),
      table({ columns: ['Profil', 'Refine-Anteil', 'Surgery-Anteil', 'Listen / Inzidenz'], rows: P.parallelism.profiles.filter(r => r.groups.refine).map(r => [modelNames[r.id] ?? r.id, `${fmt.num(r.groups.refine.value, 1)} % (geschätzt)`, `${fmt.num(r.groups.surgery.value, 1)} % (geschätzt)`, `${fmt.num(r.groups.listGetAndIncidence.value, 1)} % (geschätzt)`]), src: src('performance') + '#/parallelism/profiles' }),
      p(P.parallelism.profiles[0].denominator), p('Sampling-Anteile sind geschätzt und keine schon realisierten Geschwindigkeitsgewinne.'), source(src('performance') + '#/parallelism'),
      grid(P.missing.map(m => card({ title: ({ 'quiet-mini': 'Reference benchmark host', 'native-build123d': 'Native Gesamtpipeline', 'openscad-complete': 'Vollständige OpenSCAD-Serie', 'long-commit-history': 'Längere Commit-Messreihe', 'fillet-environment': 'Judge-Messbedingungen' })[m.id] ?? m.id, kind: 'offen', body: p(m.text), src: perfSrc(m.sources) })))),
  ] };
}

function modelCard(m) {
  const mesh = m.wonkyStatus === 'certified mesh', refused = m.wonkyStatus === 'refused';
  const diff = m.wonkyVolumeMm3 == null ? null : derive(`model.${m.id}.deltaMm3`, m.wonkyVolumeMm3 - m.referenceVolumeMm3, 'wonkyVolumeMm3 - referenceVolumeMm3', src('models') + `#/models/${M.models.indexOf(m)}`);
  const percent = m.relativeDifference == null ? null : derive(`model.${m.id}.deltaPercent`, m.relativeDifference * 100, 'relativeDifference * 100', src('models') + `#/models/${M.models.indexOf(m)}`);
  const reference = image(m.images.reference, { alt: `${m.name}, Referenzmodell`, caption: `Referenz · ${m.referenceKind}` });
  const wonky = m.images.wonky ? image(m.images.wonky, { alt: `${m.name}, wonky ${m.wonkyStatus}`, caption: `wonky · Build ${short(m.implementation?.revision)}` }) : `<div class="missing-model"><strong>Kein wonky-Modell</strong><span>Verweigert: Topologie im Nahkontakt nicht entscheidbar. Kein Ersatz durch Referenzgeometrie.</span></div>`;
  const fields = [['Referenzvolumen', `${volume(m.referenceVolumeMm3)} mm³`], ['wonky-Volumen', refused ? 'offen' : `${volume(m.wonkyVolumeMm3)} mm³`], ['Differenz wonky − Referenz', diff == null ? 'offen' : `${scientific(diff)} mm³`], ['Relative Differenz', percent == null ? 'offen' : `${scientific(percent)} %`]];
  return `<article class="model" id="${esc(m.id)}"><header class="model-head"><div><div class="eyebrow">${esc(m.kind)} / ${esc(m.module)}</div><h3>${esc(m.name)}</h3></div><span class="status ${mesh ? 'mesh' : refused ? 'refused' : ''}">${esc(refused ? 'verweigert' : mesh ? 'Certified Mesh' : m.wonkyStatus === 'exact B-rep' ? 'Exakte B-rep' : m.wonkyStatus)}</span></header><div class="pair">${reference}${wonky}</div><dl class="model-facts">${fields.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="model-note">${esc(`Volumenbasis wonky: ${m.volumeBasis ?? 'kein Ergebnis'}.`)} ${m.referenceVolumeIntervalMm3 ? esc(`Referenzintervall: ${volume(m.referenceVolumeIntervalMm3[0])} bis ${volume(m.referenceVolumeIntervalMm3[1])} mm³.`) : 'Referenz: gespeichertes OCCT-Volumen.'}</p>${mesh ? `<p class="model-note">${esc(`Abweichung ${fmt.num(m.achievedDeviationMm ?? m.deviationMm, 3)} mm zu getaggten Trägerflächen. Keine Hausdorff-Garantie zum exakten Gesamtergebnis; kein exaktes STEP daraus ableiten.`)}</p>` : ''}${m.module === 'tray' ? '<p class="model-note">Galerie-Build separat vom älteren tray-Beleg in der Roadmap. Dieses Bildpaar aktualisiert nicht den dortigen Abnahmezähler.</p>' : ''}${refused ? details('Benannte Ablehnung', p(`${m.refusal?.class ?? 'refused'}: ${m.refusal?.message ?? 'kein Build'}`)) : ''}${source([src('models'), ...m.sources])}</article>`;
}
function galleryPage(models, index, pageCount) {
  const groups = [...new Set(models.map(m => m.kind === 'build123d' ? 'build123d' : m.module))];
  return { title: pageCount === 1 ? 'Modelle' : `Modelle · Blatt ${index + 1} / ${pageCount}`, lede: 'Referenz und wonky aus derselben Blickrichtung und im selben Maßstab. Formvergleich, Volumen und Ergebnisart gehören zusammen.', sections: [
    section({ title: 'Vergleichskorpus', id: 'korpus' }, tiles([
      measured('Modelle insgesamt', fmt.num(M.counts.total), `${M.counts.build123d} build123d-Fälle und ${M.counts.FeatureScript} R20-Teile.`, src('models') + '#/counts'),
      measured('Vollständige Bildpaare', fmt.num(M.counts.comparisonPairs), `${M.counts.referenceOnly} weitere Modelle nur mit Referenzbild.`, src('models') + '#/counts'),
      measured('Exakte B-reps', fmt.num(M.counts.statuses['exact B-rep'] ?? 0), 'Ergebnisart des Modells, nicht der triangulierten Anzeige.', src('models') + '#/counts'),
      measured('Certified Mesh', fmt.num(M.counts.statuses['certified mesh'] ?? 0), 'Toleranzgebunden und ausdrücklich nicht exakt.', src('models') + '#/counts'),
    ]), callout('entscheidung', 'Bilder sind keine Geometriezertifikate', p('Alle Darstellungen sind gerenderte STLs. Gleiche Silhouette und gleiches Volumen beweisen nicht geometrische Gleichheit. Die Galerie-Builds sind eine eigene Datenserie; historische Abnahmebelege und frühere Benchmarkläufe bleiben getrennt.'), { src: [src('models'), src('roadmap')] }),
      details('Darstellungs- und Vergleichsregeln', ul(M.notes) + p(`Renderer: ${M.renderer.width} × ${M.renderer.height} Pixel. Gemeinsame Kamera je Paar, keine nachträgliche individuelle Skalierung oder geometrische Reparatur.`) + source(src('models') + '#/renderer')),
      `<nav class="jump" aria-label="Modellgruppen">${groups.map(g => `<a href="#gruppe-${g}">${esc(g)}</a>`).join('')}</nav>`),
    ...groups.map(g => section({ title: g === 'build123d' ? 'build123d · Referenz OCCT' : `R20 · ${g}`, id: `gruppe-${g}` }, models.filter(m => (m.kind === 'build123d' ? 'build123d' : m.module) === g).map(modelCard).join(''))),
  ] };
}

const basePages = [{ key: 'index', label: 'Übersicht' }, { key: 'roadmap', label: 'Roadmap' }, { key: 'fortschritt', label: 'Fortschritt' }, { key: 'tests', label: 'Tests' }, { key: 'performance', label: 'Performance' }];
let pages = [...basePages, { key: 'modelle', label: 'Modelle' }];
function shell(key, content) {
  const nav = `<nav class="site-nav" aria-label="Hauptnavigation"><a class="brand" href="{{URL:index}}">wonky</a>${pages.map(p => `<a href="{{URL:${p.key}}}"${key === p.key ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`).join('')}</nav>`;
  const html = page({ ...content, kicker: 'wonky / Entwicklungsatlas', date: dateLabel(H.asOf), meta: [['Git-Berichtsstand', `${H.branch}@${H.head}`], ['Daten', 'Gespeicherte Belege; Messgrenzen je Abschnitt'], ['Blatt', pages.find(p => p.key === key).label]], footer: 'Statische Website aus repository-relativen Quellen. Gemessen = beobachtet oder aus Messwerten berechnet; geschätzt = Einordnung oder Planung; offen = nicht belegt. Kein JavaScript, keine externen Ressourcen.' });
  return html.replace('</style>', CSS + '\n</style>').replace('<main class="sheet">', `<a class="skip" href="#bericht">Zum Bericht</a><main class="sheet">${nav}<div id="bericht" tabindex="-1"></div>`)
    .replaceAll('<div class="tbl-scroll">', '<div class="tbl-scroll" tabindex="0" role="region" aria-label="Datentabelle">');
}

// Size by actual encoded images plus markup. Split before publication, never silently truncate.
let batches = [M.models];
const fullGallery = shell('modelle', galleryPage(M.models, 0, 1));
if (Buffer.byteLength(fullGallery) > LIMIT - 8 * 1024) {
  batches = [];
  let batch = [];
  for (const model of M.models) {
    const candidate = [...batch, model];
    if (batch.length && Buffer.byteLength(shell('modelle', galleryPage(candidate, 0, 1))) > LIMIT - 16 * 1024) { batches.push(batch); batch = [model]; }
    else batch = candidate;
  }
  if (batch.length) batches.push(batch);
  pages = [...basePages, ...batches.map((_, i) => ({ key: i ? `modelle-${i + 1}` : 'modelle', label: i ? `Modelle ${i + 1}` : 'Modelle' }))];
}
// Probing page size above must not multiply provenance records.
derived.length = 0;
const contents = { index: overview(), roadmap: roadmap(), fortschritt: progress(), tests: tests(), performance: performance() };
batches.forEach((models, i) => { contents[i ? `modelle-${i + 1}` : 'modelle'] = galleryPage(models, i, batches.length); });

const args = process.argv.slice(2);
if (args.length && (args[0] !== '--urls' || args.length !== 2)) throw new Error('Usage: build.mjs [--urls out/site/data/urls.json]');
let urls = {};
if (args.length) {
  urls = JSON.parse(readFileSync(resolve(REPO, args[1]), 'utf8'));
  for (const { key } of pages) if (!/^https:\/\/[a-z0-9]+\.postplan\.dev\/?$/.test(urls[key] ?? '')) throw new Error(`Missing or invalid public URL for ${key}`);
}
const output = [];
for (const { key } of pages) {
  let html = shell(key, contents[key]);
  html = html.replace(/\{\{URL:([a-z0-9-]+)\}\}/g, (_, target) => {
    if (!pages.some(p => p.key === target)) throw new Error(`Unknown page link ${target}`);
    return esc(urls[target]?.replace(/\/$/, '') ?? `${target}.html`);
  });
  assertPublicSafe(html);
  if (/<script\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:javascript:|file:)|\{\{URL:/i.test(html)) throw new Error(`Unsafe or unresolved HTML in ${key}`);
  if (Buffer.byteLength(html) > LIMIT) throw new Error(`${key} exceeds Postplan's 512 KiB limit; split its content`);
  output.push({ key, html, bytes: Buffer.byteLength(html) });
}
mkdirSync(OUT, { recursive: true });
for (const { key, html, bytes } of output) { writeFileSync(join(OUT, `${key}.html`), html); console.log(`${key}.html\t${bytes} bytes`); }
const manifest = {
  schema: 'wonky/site/build/v1', head: H.head, navigation: pages,
  mode: args.length ? 'public' : 'local',
  purpose: 'Reproduzierbare Quellen- und Rechenprovenienz der angeforderten Website; bei Regeneration ersetzen.',
  generator: 'scripts/reports/site/build.mjs',
  inputs: ['history', 'roadmap', 'performance', 'models', 'context'].map(key => ({ path: src(key), sha256: createHash('sha256').update(readFileSync(join(REPO, src(key)))).digest('hex') })),
  pages: output.map(({ key, html, bytes }) => ({ path: `out/site/${key}.html`, bytes, sha256: createHash('sha256').update(html).digest('hex'), sources: ['scripts/reports/site/build.mjs', 'scripts/reports/lib.mjs', ...['history', 'roadmap', 'performance', 'models', 'context'].map(src)] })),
  calculations: [...new Map(derived.map(d => [d.id, d])).values()],
  limits: { maximumPageBytes: LIMIT, source: 'scripts/reports/README.md:132-135' },
};
assertPublicSafe(JSON.stringify(manifest));
writeFileSync(join(OUT, 'data/build.json'), JSON.stringify(manifest, null, 2) + '\n');
