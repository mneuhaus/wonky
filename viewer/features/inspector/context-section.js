// "LLM context" and "Print" inspector sections (spec 3.5 to 3.7). Package:
// reviews-context. The inspector appends them after every render.
//
// Browser: every copy action goes through ctx.app.copyContext (POST
// /api/context), which archives the named revisions first, so each copied
// wonky-inspect command resolves after the server stops:
//   Copy selected geometry | Copy model overview   (#copy-geometry)
//   Copy references (N)                            multi-selection
//   Copy LLM context                               visible model(s) + selection
// Print: Export for print (the revision) and, with a selection, its body.
//
// Legacy seam (VS): only the pre-rework section, whose button reads the
// entity detail or the overview directly.
import { escape } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { geometryAlias } from '../../core/scene-records.js';
import { bindReferenceCopy } from './identity-section.js';

const button = (id, label, iconName = 'copy') => `<button id="${id}" class="button secondary">`
  + `${icon(iconName)}${escape(label)}</button>`;

export function contextMarkup({ alias, count, legacy }) {
  const primary = button('copy-geometry', alias ? 'Copy selected geometry' : 'Copy model overview');
  if (legacy) {
    return `<h3>LLM context${alias ? ' · ' + escape(alias) : ''}</h3>${primary}`
      + '<p class="small muted inspector-note">'
      + `${alias ? 'Exact entity data, identity and source.'
        : 'Compact overview with references for on-demand geometry details.'}</p>`;
  }
  const references = count > 1 ? button('copy-references', `Copy references (${count})`) : '';
  return `<h3>LLM context${alias ? ' · ' + escape(alias) : ''}</h3><div class="context-actions">`
    + `${primary}${references}${button('copy-llm-context', 'Copy LLM context')}</div>`
    + '<p class="small muted inspector-note">LLM context covers the visible model and the'
    + ' selection with exact data. Each copy archives the revision first, so its wonky-inspect'
    + ' commands work after the viewer stops.</p>';
}

export function printMarkup({ bodyAlias }) {
  return '<h3>Print</h3><div class="context-actions">'
    + `${button('export-print', 'Export for print', 'cube')}`
    + `${bodyAlias ? button('export-print-body', `Export ${bodyAlias} for print`, 'cube') : ''}`
    + '</div><p class="small muted inspector-note">Downloads the print STL and its manifest.'
    + ' The STL approximates the exact B-rep within the chord deviation the manifest states;'
    + ' the archived snapshot stays authoritative.</p>';
}

function appendSection(ctx, className, markup) {
  const section = ctx.env.document.createElement('section');
  section.className = `inspector-section ${className}`;
  section.innerHTML = markup;
  ctx.dom.$('#selection-content').append(section);
}

function bindLegacy(ctx, scene, alias) {
  const { api } = ctx;
  ctx.dom.$('#copy-geometry').onclick = async () => {
    try {
      if (alias) {
        const detail = await api.json(`/api/models/${scene.id}/entities/${alias}`);
        await ctx.copyText(JSON.stringify(detail, null, 2), 'Selected geometry and source copied');
      } else {
        const text = await api.text(`/api/models/${scene.id}/summary?format=text&level=bodies`,
          { unavailable: 'Model overview is unavailable' });
        await ctx.copyText(text, 'Model overview copied');
      }
    } catch (error) {
      ctx.showError(error);
    }
  };
}

export function appendGeometryCopy(ctx, scene, reference) {
  const { dom: { $ }, state, app } = ctx;
  const alias = reference ? geometryAlias(scene, reference) : null;
  const count = state.selectionSet?.length ?? 0;
  appendSection(ctx, 'context-section', contextMarkup({ alias, count, legacy: ctx.legacy }));
  if (ctx.legacy) {
    bindLegacy(ctx, scene, alias);
    return;
  }
  const run = promise => promise.catch(ctx.showError);
  $('#copy-geometry').onclick = () => run(reference
    ? app.copyContext('geometry', { references: [reference] })
    : app.copyContext('overview', { visible: [scene.id] }));
  if (count > 1) $('#copy-references').onclick = () => run(app.copyContext('references'));
  $('#copy-llm-context').onclick = () => run(app.copyContext('llm'));
  bindReferenceCopy(ctx, reference);

  const bodyAlias = reference ? geometryAlias(scene, {
    modelId: reference.modelId, bodyId: reference.bodyId, entityType: 'body', entityIndex: 0,
  }) : null;
  appendSection(ctx, 'print-section', printMarkup({ bodyAlias }));
  $('#export-print').onclick = () => run(app.exportForPrint(scene.id));
  if (bodyAlias) {
    $('#export-print-body').onclick = () => run(app.exportForPrint(scene.id, reference.bodyId));
  }
}
