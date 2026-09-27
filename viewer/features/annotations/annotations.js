// Review annotations: comments and view-bound drawings, their cards, undo,
// restore of their view (harness: restoreAnnotation, annotationAt, tool,
// annotationPoint). Package: reviews-context. Markup tools are one-shot and
// lockable (tools.js, spec D8); every change calls ctx.review.touch, and the
// reviews feature decides whether the review is dirty (D9).
import { clamp, clone, escape } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { short } from '../../core/format.js';
import { referencePoints, selectedRecords } from '../../core/scene-records.js';
import { comparisonLayout } from '../../render/panes.js';
import { ARROWHEAD, createAnnotationGeometry } from './annotation-geometry.js';
import { createTools, MARKUP_TOOLS, TOOL_BUTTONS } from './tools.js';

export const id = 'annotations';
export const legacy = true;

const DIVIDER = '<span class="rail-divider"></span>';
const UNDO = '<button id="undo-annotation" class="tool" title="Remove last annotation (⌘Z)"'
  + ' aria-label="Remove last annotation" disabled data-icon="undo"></button>';
const HIDDEN = '<div id="hidden-annotations" class="hidden-annotations" hidden><span'
  + ' data-icon="comment"></span><button id="restore-annotation-view"></button></div>';
const HINT = '<span id="interaction-hint">Drag to orbit <span>·</span> Scroll to zoom'
  + ' <span>·</span> Shift-drag to pan</span>';
const LIST = '<div class="annotation-heading"><h2>Annotations <span id="annotation-total">0</span>'
  + '</h2><button id="add-comment" class="icon-button" title="Add a comment to the model"'
  + ' aria-label="Add a comment" data-icon="plus"></button></div><div id="annotation-list"'
  + ' class="annotation-list"></div>';
const TITLES = { comment: 'Comment', arrow: 'Arrow', box: 'Area', pen: 'Sketch' };

export function setup(ctx) {
  const { state, app, slots, commands, panes, env, dom: { $, $$ } } = ctx;
  const canvas = $('#model-canvas');
  for (const [tool, order, markup] of TOOL_BUTTONS) {
    slots.toolbar.tool({ id: `tool.${tool}`, order, html: markup });
  }
  slots.toolbar.tool({ id: 'rail.divider.navigation', order: 30, html: DIVIDER });
  slots.toolbar.tool({ id: 'rail.divider.markup', order: 80, html: DIVIDER });
  slots.toolbar.tool({ id: 'annotations.undo', order: 90, html: UNDO });
  slots.add('stage', { id: 'annotations.hidden', order: 60, html: HIDDEN });
  slots.statusBar.item({ id: 'annotations.hint', order: 10, html: HINT });
  slots.add('inspector.reviewPanel', { id: 'annotations.list', order: 20, html: LIST });

  const geometry = createAnnotationGeometry({ canvas });
  const touch = reason => ctx.review.touch(reason);

  function annotationAt(toolName, points, target) {
    return {
      tool: toolName, text: '', points, ...(target ? { target } : {}),
      camera: clone(state.camera), view: app.currentView(),
    };
  }

  function addAnnotation(annotation) {
    if (state.annotations.length >= 500) {
      ctx.notify('This review has reached 500 annotations. Save it and start another review.');
      return;
    }
    state.annotations.push(annotation);
    state.activeAnnotation = state.annotations.length - 1;
    touch('annotations.add');
    app.panel('review');
    app.renderAnnotations();
    app.scheduleDraw();
    if (annotation.tool === 'comment') {
      env.requestAnimationFrame(() => $('#annotation-list textarea')?.focus());
    }
  }

  const { tool, lock, activate } = createTools(ctx, { addAnnotation, annotationAt });

  function commentOnSelection() {
    const records = selectedRecords(state.scenes, state.selection);
    let point = [0.5, 0.5];
    if (state.selection) {
      const points = records ? referencePoints(records, state.selection)
        : ctx.renderer.entityPoints(state.selection);
      if (points.length) {
        const centroid = [0, 1, 2].map(axis => points.reduce((sum, value) => sum + value[axis], 0)
          / points.length);
        const pane = panes.viewPanes().find(item => item.modelId === state.selection.modelId);
        const screen = panes.project(centroid, pane);
        point = [clamp(screen.x / canvas.clientWidth, 0, 1),
          clamp(screen.y / canvas.clientHeight, 0, 1)];
      }
    }
    const target = state.selection ? clone(state.selection) : null;
    addAnnotation(annotationAt('comment', [point], target));
  }

  const card = (annotation, index) => {
    const active = index === state.activeAnnotation;
    const target = annotation.target;
    const text = active
      ? `<textarea data-text="${index}" rows="3" maxlength="10000" placeholder="Add a note…"`
        + ` aria-label="Annotation ${index + 1} note">${escape(annotation.text)}</textarea>`
      : `<p class="annotation-preview">${escape(annotation.text || 'No note added')}</p>`;
    const targetLabel = target
      ? `<span class="annotation-target">${escape(target.entityType === 'vertex' ? 'Point'
        : target.entityType)} ${target.entityIndex + 1} · ${escape(short(target.modelId))}</span>`
      : '<span class="annotation-target">View annotation</span>';
    return `<article class="annotation-card ${active ? 'active' : ''}" data-index="${index}">`
      + `<div class="annotation-card-head"><button class="annotation-jump" data-jump="${index}"`
      + ' title="Restore this annotation’s model and view"><span class="annotation-number">'
      + `${index + 1}</span><span class="annotation-title">${TITLES[annotation.tool]}</span>`
      + '</button>'
      + `<button class="icon-button" data-remove="${index}" title="Remove annotation"`
      + ` aria-label="Remove annotation ${index + 1}">${icon('trash')}</button></div>`
      + `${text}${targetLabel}</article>`;
  };

  function renderAnnotations() {
    const count = state.annotations.length;
    $('#annotation-count').textContent = count;
    $('#annotation-total').textContent = count;
    $('#undo-annotation').disabled = !count;
    if (!count) {
      $('#annotation-list').innerHTML = '<p class="annotation-empty">Make a point with a comment,'
        + ' arrow or sketch. Each mark remembers the view where you placed it.</p>';
      return;
    }
    $('#annotation-list').innerHTML = state.annotations.map(card).join('');
    $$('[data-text]').forEach(textarea => {
      textarea.oninput = () => {
        state.annotations[Number(textarea.dataset.text)].text = textarea.value;
        touch('annotations.text');
      };
    });
    $$('[data-remove]').forEach(element => {
      element.onclick = () => {
        state.annotations.splice(Number(element.dataset.remove), 1);
        state.activeAnnotation = Math.min(state.activeAnnotation, state.annotations.length - 1);
        touch('annotations.remove');
        app.renderAnnotations();
        app.scheduleDraw();
      };
    });
    $$('[data-jump]').forEach(element => {
      element.onclick = () => restoreAnnotation(Number(element.dataset.jump)).catch(ctx.showError);
    });
  }

  const navigation = ctx.requests.scope('navigation');
  async function restoreAnnotation(index) {
    const annotation = state.annotations[index];
    if (!annotation) return;
    app.clearHover();
    const request = navigation.next();
    try {
      if (annotation.view) {
        const { view } = annotation;
        Object.assign(state, {
          before: view.before, after: view.after, split: view.split, compare: view.compare,
          layout: comparisonLayout(view.layout),
        });
        await app.loadSelectedModels(false, request);
      }
      if (!navigation.isCurrent(request)) return;
      state.camera = clone(annotation.camera);
      state.activeAnnotation = index;
      if (annotation.target) app.select(annotation.target, false);
      app.panel('review');
      app.renderAnnotations();
      app.syncControls();
      app.scheduleDraw();
    } catch (error) {
      if (navigation.isCurrent(request)) throw error;
    }
  }

  function undo() {
    if (!state.annotations.length) return;
    state.annotations.pop();
    state.activeAnnotation = Math.min(state.activeAnnotation, state.annotations.length - 1);
    touch('annotations.undo');
    app.renderAnnotations();
    app.scheduleDraw();
  }

  for (const [name, , , key, label] of TOOL_BUTTONS) {
    commands.register({ id: `tool.${name}`, label, keys: [key], run: () => activate(name) });
    const element = commands.bind(`.tool[data-tool="${name}"]`, `tool.${name}`);
    if (element && MARKUP_TOOLS.includes(name)) element.ondblclick = () => lock(name);
  }
  commands.register({
    id: 'annotations.undo', label: 'Remove last annotation', keys: ['Mod+Z'], run: undo,
  });
  commands.register({
    id: 'annotations.restoreView', label: 'Restore annotation view',
    run: () => {
      const index = state.annotations.findIndex(annotation => !app.viewMatches(annotation));
      if (index >= 0) restoreAnnotation(index).catch(ctx.showError);
    },
  });
  commands.register({
    id: 'annotations.addComment', label: 'Add a comment',
    run: () => {
      if (state.selection) commentOnSelection();
      else {
        app.tool('comment');
        canvas.focus({ preventScroll: true });
        ctx.notify('Click the model to place your comment');
      }
    },
  });
  commands.bind('#undo-annotation', 'annotations.undo');
  commands.bind('#restore-annotation-view', 'annotations.restoreView');
  commands.bind('#add-comment', 'annotations.addComment');
  ctx.keyboard.onEscape(() => {
    state.pending = null;
    app.tool('select');
  }, 10);

  let hiddenCount = 0;
  ctx.overlay.layer({
    id: 'annotations',
    order: 10,
    render() {
      let content = ARROWHEAD;
      let hidden = 0;
      state.annotations.forEach((annotation, index) => {
        if (app.viewMatches(annotation)) content += geometry.drawingMarkup(annotation, index);
        else hidden++;
      });
      if (state.pending) content += geometry.drawingMarkup(state.pending, -1, true);
      hiddenCount = hidden;
      return content;
    },
    after() {
      const hidden = hiddenCount;
      $('#hidden-annotations').hidden = hidden === 0;
      $('#restore-annotation-view').textContent = `${hidden} ${hidden === 1
        ? 'annotation in another view' : 'annotations in other views'} · Restore`;
    },
  });

  return {
    api: {
      tool, lockTool: lock, addAnnotation, annotationAt, commentOnSelection, renderAnnotations,
      restoreAnnotation, annotationPoint: geometry.annotationPoint,
    },
    legacy: {
      harness: { restoreAnnotation, annotationAt, tool, annotationPoint: geometry.annotationPoint },
      state: ctx.fields('annotations', ['annotations', 'activeAnnotation', 'pending', 'tool',
        'toolLocked']),
    },
    defaults: {
      annotations: {
        annotations: [], activeAnnotation: -1, pending: null, tool: 'select', toolLocked: false,
      },
    },
  };
}
