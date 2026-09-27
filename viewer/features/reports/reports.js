// Check reports in the drawer (harness: openReport). Frozen after the foundation.
import { escape } from '../../core/dom.js';
import { number, reportStatus } from '../../core/format.js';

export const id = 'reports';
export const legacy = true;

const metric = (value, label) => `<div class="report-metric"><strong>${value}</strong>`
  + `<span>${label}</span></div>`;
const IMAGE_LABELS = { before: 'Before', after: 'After', diff: 'Changed pixels' };
const capitalized = text => text[0].toUpperCase() + text.slice(1);

function stagesMarkup(data) {
  const target = data.target;
  const passed = data.references?.filter(row => row.status === 'passed').length ?? 0;
  return '<div class="report-metrics">'
    + metric(`${target.completedStages} / ${target.expectedStages}`, 'Build stages complete')
    + metric(`${passed} / ${data.references?.length ?? 0}`, 'Reference models passed')
    + metric(`${target.runtimeOperations?.completed ?? '—'}`, 'Operations completed')
    + '</div>';
}

function stageRow(row) {
  const tone = row.status === 'completed' ? '' : row.status === 'failed' ? 'failed' : 'unknown';
  return '<div class="check-row"><span class="check-name">'
    + `${escape(row.name.replace(/^build/, ''))}</span><span class="status-badge ${tone}">`
    + `${escape(row.status.replaceAll('-', ' '))}</span></div>`;
}

function imageMarkup(row, key) {
  const url = row.images[key]?.url;
  if (!url) return '';
  return `<figure><a href="${escape(url)}" target="_blank" rel="noopener">`
    + `<img src="${escape(url)}" alt="${escape(row.name)} · ${key}" loading="lazy"></a>`
    + `<figcaption>${IMAGE_LABELS[key]}</figcaption></figure>`;
}

function viewRow(row) {
  const images = row.images
    ? `<div class="render-images">${['before', 'after', 'diff']
      .map(key => imageMarkup(row, key)).join('')}</div>`
    : '';
  return `<div class="check-row"><span class="check-name">${escape(row.name)}</span>`
    + `<span>${number(row.changedFraction * 100)}% changed pixels</span></div>${images}`;
}

export function reportMarkup(data) {
  const summary = reportStatus(data);
  let content = `<div class="report-summary"><span class="status-badge ${summary.className}">`
    + `${summary.label}</span><span class="small muted">`
    + `${escape(data.scope ?? data.evidenceBasis ?? '')}</span></div>`;
  const target = data.target;
  if (target?.expectedStages) content += stagesMarkup(data);
  if (target?.error) {
    const line = target.error.line
      ? `<br><span class="small">Source line ${target.error.line}:${target.error.column}</span>`
      : '';
    content += `<p class="report-error">${escape(target.error.message)}${line}</p>`;
  }
  if (target?.stages) content += target.stages.map(stageRow).join('');
  if (data.volumesMm3) {
    const volumes = ['added', 'removed', 'common']
      .map(key => metric(number(data.volumesMm3[key]), `${capitalized(key)} · mm³`)).join('');
    content += `<div class="report-metrics">${volumes}</div>`
      + `<p class="report-detail">Minimum distance: ${number(data.minimumDistanceMm)} mm · `
      + `${escape(data.relation ?? '')}</p>`;
  }
  if (Array.isArray(data.views)) content += data.views.map(viewRow).join('');
  if (data.limitations?.length) {
    content += `<p class="report-detail">${data.limitations.map(escape).join(' · ')}</p>`;
  }
  content += '<details class="report-disclosure"><summary>Full report and evidence</summary>'
    + `<pre class="report-json">${escape(JSON.stringify(data, null, 2))}</pre></details>`;
  return content;
}

export function setup(ctx) {
  const { state, api, drawer, dom: { $ } } = ctx;
  async function openReport(reportId) {
    const metadata = state.workspace.reports.find(report => report.id === reportId);
    const data = await drawer.open({
      title: metadata?.label ?? 'Check report', eyebrow: 'Check report',
      load: () => api.json(`/api/reports/${encodeURIComponent(reportId)}`),
    });
    if (!data) return;
    $('#report-content').innerHTML = reportMarkup(data);
  }
  return { api: { openReport }, legacy: { harness: { openReport } } };
}
