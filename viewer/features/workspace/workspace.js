// Workspace nodes (docs/viewer/workspace.md, section 3): one viewer for a
// project's models and assemblies.
//
// The server's tree (SSE hello `tree`, GET /api/workspace `tree`) lists the
// workspace models and assemblies. This feature keeps the open node
// (`model:<key>` or `assembly:<key>`, in the URL hash `#node=` and in
// sessionStorage) and gives the single pane its members
// (panes.setMembers): an assembly draws every visible instance at its
// placement, each following its own live source, except that the displayed
// model (state.after) draws its displayed revision (Follow off, an older
// revision picked); a model node at identity draws its model exactly as a
// plain viewer does. state.after stays the active model (inspector, parts
// details, measure, thickness): the model node's model, or in an assembly the
// model of the primary selection, else the last active, else the first
// visible member.
// A node whose model has no good revision yet (never built, or every build
// failed) shows no model: state.after is null on purpose, the live status
// names that model's source (app.workspaceEmptyNode), and its first good
// revision opens it (fix round 1: the previous model stayed on screen).
//
// Switching nodes never refits or resets the camera (one world camera for
// the shared frame); F fits the open node's visible members. Compare needs
// a model: turning it on in an assembly opens the active model first.
// The tree renders at the top of the Parts tab (parts.js calls
// app.workspaceTreeMarkup()); an implicit workspace (plain CLI inputs) has
// no tree and changes nothing.
import {
  activeKey, knownNode, modelOf, nodeInstances, nodeMembers, nodeText, parseNode, treeMarkup,
  trustOf, visibilityAfter,
} from './tree.js';
import { placeBox } from '../../render/placement.js';

export const id = 'workspace';
export const legacy = false;

const NODE_KEY = 'wonky.workspace.node';
const HIDDEN_KEY = 'wonky.workspace.hidden';

function storage(env) {
  try {
    return env.window?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function setup(ctx) {
  const { state, app, env, events, renderer, panes, store, cache } = ctx;
  const { $ } = ctx.dom;
  let tree = null;
  let node = null;
  let lastKey = null;
  let opening = null;
  // Key of the model the open node waits for while it shows no model.
  let emptyKey = null;
  const expanded = new Set();
  // Hidden instance ids per assembly key.
  const hidden = new Map();
  const stops = [];

  const active = () => !!tree && !tree.implicit;
  const hiddenOf = key => hidden.get(key) ?? new Set();
  const openHidden = () => (node?.kind === 'assembly' ? hiddenOf(node.key) : new Set());
  const sources = () => app.liveStatus?.().sources ?? [];
  const sourceOf = key => {
    const model = modelOf(tree, key);
    return model?.sourceId ? sources().find(source => source.id === model.sourceId) ?? null
      : null;
  };
  // Newest good model id of every workspace model.
  function current() {
    const map = new Map();
    for (const model of tree?.models ?? []) {
      const modelId = model.static ? model.modelId : sourceOf(model.key)?.lastGood?.modelId
        ?? model.modelId;
      if (modelId) map.set(model.key, modelId);
    }
    return map;
  }
  const keyOfModelId = modelId => {
    if (!modelId) return null;
    for (const [key, id] of current()) if (id === modelId) return key;
    const revision = app.liveRevision?.(modelId);
    return tree?.models.find(model => model.sourceId && model.sourceId === revision?.sourceId)
      ?.key ?? null;
  };
  // Model id drawn per workspace model: the newest good one, except that the
  // displayed model (state.after) replaces it for its own model. With Follow
  // off or an older revision picked, a placed member then draws the revision
  // the model bar and the inspector show, not the newest one (fix round 2).
  function shown() {
    const map = current();
    const key = keyOfModelId(state.after);
    if (key) map.set(key, state.after);
    return map;
  }

  // ---- Members ----
  function members() {
    if (!active() || !node || state.compare) return null;
    const list = nodeMembers(tree, node, { current: shown(), hidden: openHidden() });
    if (!list) return null;
    // Only members whose draw model is loaded; the others load and redraw.
    for (const member of list) {
      if (!renderer.model?.(member.modelId)) load(member.modelId);
    }
    return list.filter(member => renderer.model?.(member.modelId));
  }
  const loading = new Set();
  // A draw payload that failed is not requested again on every frame.
  const failed = new Set();
  function load(modelId) {
    if (loading.has(modelId) || failed.has(modelId) || !renderer.loadModel) {
      return Promise.resolve();
    }
    loading.add(modelId);
    return renderer.loadModel(modelId).catch(error => {
      failed.add(modelId);
      env.window?.console?.warn?.(`Workspace member ${modelId.slice(0, 12)} not loaded:`,
        error.message);
    }).finally(() => {
      loading.delete(modelId);
      app.scheduleDraw?.();
      app.renderParts?.();
    });
  }
  panes.setMembers?.(members);
  cache.pinSource?.('workspace', () => (members() ?? []).map(member => member.modelId));

  // ---- Node persistence (hash and session) ----
  function hashParams() {
    return new env.URLSearchParams(env.location?.hash?.slice(1) ?? '');
  }
  function remember() {
    try {
      storage(env)?.setItem(NODE_KEY, nodeText(node));
      storage(env)?.setItem(HIDDEN_KEY, JSON.stringify(Object.fromEntries([...hidden]
        .map(([key, set]) => [key, [...set]]))));
    } catch {
      // Not persisted.
    }
    if (!env.history?.replaceState || !env.location) return;
    const params = hashParams();
    params.set('node', nodeText(node));
    env.history.replaceState(null, '', `#${params.toString().replace(/%3A/g, ':')}`);
  }
  function restoredNode() {
    const fromHash = knownNode(tree, parseNode(hashParams().get('node')));
    if (fromHash) return fromHash;
    try {
      const saved = JSON.parse(storage(env)?.getItem(HIDDEN_KEY) ?? '{}');
      for (const [key, ids] of Object.entries(saved ?? {})) {
        if (Array.isArray(ids)) hidden.set(key, new Set(ids));
      }
      return knownNode(tree, parseNode(storage(env)?.getItem(NODE_KEY)));
    } catch {
      return null;
    }
  }

  // The active model changes without a reload (its draw model is loaded):
  // the model bar, inspector and parts follow.
  function activate(modelId) {
    state.after = modelId;
    app.syncControls?.();
    app.renderInspector?.();
    render();
  }

  // ---- Opening nodes ----
  function setAfter(modelId) {
    emptyKey = null;
    if (!modelId || state.after === modelId) return;
    app.openModel?.(modelId);
  }
  // The node's model has no good revision: no model instead of the previous
  // one (the camera stays; features/live shows this source's status).
  function showEmpty(key) {
    emptyKey = key;
    if (state.after !== null) {
      app.clearHover?.();
      app.select?.(null, false);
      state.compare = false;
      state.after = null;
      app.syncControls?.();
      app.renderInspector?.();
    }
    const label = modelOf(tree, key)?.label ?? key;
    ctx.viewportMessage?.(`${label}: no model yet`, 'It has no successful build yet. Its first'
      + ' good revision opens here; the live status shows the build or its failure.');
  }
  // The open node shows no model and waits for `key` (else null).
  const waitingNode = () => (active() && emptyKey && !state.after && node ? emptyKey : null);

  async function openNode(next, { initial = false } = {}) {
    if (!active() || !knownNode(tree, next)) return;
    node = next;
    remember();
    const ids = current();
    if (node.kind === 'assembly' && state.compare) state.compare = false;
    const key = activeKey(tree, node, { lastKey, hidden: openHidden(), current: ids });
    const run = opening = {};
    if (node.kind === 'assembly') {
      // Load every member first, so the first fit frames all of them.
      await Promise.all(nodeInstances(tree, node).map(instance => ids.get(instance.model))
        .filter(Boolean).map(modelId => (renderer.model?.(modelId) ? null : load(modelId))));
      if (opening !== run) return;
    }
    if (key) {
      lastKey = key;
      if (ids.get(key)) setAfter(ids.get(key));
      else showEmpty(key);
    }
    // A first open without a saved camera frames every member, once the
    // model loader's own fit policy has run.
    if (initial && node.kind === 'assembly') {
      await idle();
      if (opening === run && ['initial', 'policy'].includes(app.cameraProvenance?.())) app.fit?.();
    }
    render();
    app.scheduleDraw?.();
    if (initial) opened = true;
  }
  let opened = false;
  // Resolves when no model is loading (the loader sets state.loading).
  function idle() {
    return new Promise(done => {
      let stop = null;
      const check = () => {
        if (state.loading) return false;
        stop?.();
        env.setTimeout(done, 0);
        return true;
      };
      if (!check()) stop = store.subscribe(check);
    });
  }

  // ---- Instance visibility ----
  function applyInstances(action, instanceId) {
    if (node?.kind !== 'assembly') return;
    const instances = nodeInstances(tree, node);
    const next = visibilityAfter(action, instances, hiddenOf(node.key), instanceId);
    hidden.set(node.key, next);
    remember();
    // The active model follows the visible members.
    const key = activeKey(tree, node, { lastKey, hidden: next, current: current() });
    if (key && key !== keyOfModelId(state.after)) {
      lastKey = key;
      const modelId = current().get(key);
      if (!modelId) showEmpty(key);
      else if (state.after) activate(modelId);
      else setAfter(modelId);
    }
    render();
    app.scheduleDraw?.();
  }

  // ---- Rendering (inside the Parts tab) ----
  function bodiesOf(key) {
    const modelId = shown().get(key);
    return modelId ? app.partsDocument?.(modelId)?.bodies?.length
      ?? renderer.model?.(modelId)?.bodies?.length ?? null : null;
  }
  function markup() {
    if (!active()) return '';
    const filter = $('.library')?.getAttribute?.('data-library-view') === 'parts'
      ? $('#library-search')?.value?.trim() ?? '' : '';
    return treeMarkup(tree, {
      node, expanded, hidden: openHidden(), filter,
      trust: key => trustOf(sourceOf(key), { isStatic: modelOf(tree, key)?.static }),
      bodies: bodiesOf,
    });
  }
  const render = () => app.renderParts?.();

  function onClick(event) {
    const target = event.target?.closest?.('button');
    const data = target?.dataset;
    if (!data) return;
    if (data.wsNode) {
      const next = parseNode(data.wsNode);
      if (nodeText(next) === nodeText(node)) return;
      openNode(next).catch(ctx.showError);
    } else if (data.wsFold) {
      if (expanded.has(data.wsFold)) expanded.delete(data.wsFold);
      else expanded.add(data.wsFold);
      render();
    } else if (data.wsEye) applyInstances('toggle', data.wsEye);
    else if (data.wsIsolate) applyInstances('isolate', data.wsIsolate);
  }
  const panel = $('#parts-panel');
  panel?.addEventListener?.('click', onClick);

  // ---- Reactions ----
  function onTree(next) {
    if (!next) return;
    const first = !tree;
    tree = next;
    if (!active()) return;
    for (const assembly of tree.assemblies) expanded.add(assembly.key);
    if (first || !knownNode(tree, node)) {
      const start = restoredNode() ?? parseNode(tree.open);
      openNode(start, { initial: true }).catch(ctx.showError);
    } else render();
  }
  stops.push(events.on('hello', data => onTree(data?.tree)));
  // New revisions of other members: redraw with them (the active model is
  // followed by the live feature); a node that shows no model opens the first
  // good revision of its model (in an assembly: of any visible member).
  stops.push(events.on('revision', data => {
    if (!active() || !node) return;
    const key = tree.models.find(model => model.sourceId === data?.sourceId)?.key;
    if (!key) return;
    const waiting = waitingNode() && (node.kind === 'model' ? node.key === key
      : nodeInstances(tree, node).some(instance => instance.model === key
        && !openHidden().has(instance.id)));
    if (waiting && data.modelId) {
      lastKey = key;
      setAfter(data.modelId);
    }
    if (data.modelId && !renderer.model?.(data.modelId)) load(data.modelId);
    render();
    app.scheduleDraw?.();
  }));
  for (const name of ['build-queued', 'build-started', 'build-failed', 'build-cancelled']) {
    stops.push(events.on(name, () => {
      if (active()) render();
    }));
  }
  // The primary selection makes its model the active one in an assembly.
  stops.push(store.select(current => current.selection?.selectionSet?.[0]?.modelId ?? null,
    modelId => {
      if (!active() || node?.kind !== 'assembly' || !modelId || modelId === state.after) return;
      const key = keyOfModelId(modelId);
      const visible = (members() ?? []).some(member => member.modelId === modelId);
      if (!key || !visible) return;
      lastKey = key;
      activate(modelId);
    }));
  // Compare works on one model: turning it on in an assembly opens the
  // active model's node.
  stops.push(store.select(current => !!current.compare?.compare, on => {
    if (!on || !active() || node?.kind !== 'assembly' || !opened) return;
    const key = keyOfModelId(state.after);
    if (!key) return;
    node = { kind: 'model', key };
    remember();
    render();
    ctx.notify?.(`Compare works per model: opened ${modelOf(tree, key)?.label ?? key}`);
  }));
  $('#library-search')?.addEventListener?.('input', () => {
    if (active()) render();
  });
  // The stage title names the open assembly, or the model a node waits for
  // (compare.js names a shown model).
  ctx.onFrame(() => {
    if (!active() || state.compare) return;
    const waiting = waitingNode();
    if (waiting && node.kind === 'model') {
      const title = $('#model-title');
      const summary = $('#model-summary');
      const label = modelOf(tree, waiting)?.label ?? waiting;
      const text = `no model yet · ${trustOf(sourceOf(waiting)).text}`;
      if (title && title.textContent !== label) title.textContent = label;
      if (summary && summary.textContent !== text) summary.textContent = text;
      return;
    }
    if (node?.kind !== 'assembly') return;
    const assembly = tree.assemblies.find(item => item.key === node.key);
    const list = members() ?? [];
    const bodies = list.reduce((total, member) => total
      + (renderer.model?.(member.modelId)?.bodies.length ?? 0), 0);
    const activeLabel = modelOf(tree, keyOfModelId(state.after))?.label;
    const title = $('#model-title');
    const summary = $('#model-summary');
    const text = `${list.length} of ${assembly.instances.length} models · ${bodies} bodies`
      + (activeLabel ? ` · active: ${activeLabel}` : '');
    if (title && title.textContent !== assembly.label) title.textContent = assembly.label;
    if (summary && summary.textContent !== text) summary.textContent = text;
  });

  return {
    api: {
      workspaceTreeMarkup: markup,
      // True in a workspace file (not for plain CLI inputs): node switches
      // keep the camera (features/view/navigation.js).
      workspaceKeepsCamera: () => active() && opened,
      // Placed bounds of the open node's visible members (fit, F).
      workspaceBoxes: () => (members() ?? []).map(member => placeBox(member.matrix,
        renderer.bounds?.(member.modelId))).filter(Boolean),
      // Models shown in the pane: the members, else the displayed model.
      workspaceMemberIds: () => (members() ?? []).map(member => member.modelId),
      workspaceMembers: () => members() ?? [],
      workspaceNode: () => (node ? { ...node } : null),
      // The open node shows no model while its model has no good revision:
      // { key, sourceId } (features/live reports that source and does not
      // open another model), else null.
      workspaceEmptyNode() {
        const key = waitingNode();
        return key ? { key, sourceId: modelOf(tree, key)?.sourceId ?? null } : null;
      },
      workspaceTree: () => tree,
      openWorkspaceNode: text => openNode(parseNode(text)),
      setInstanceVisible(instanceId, visible) {
        const isHidden = hiddenOf(node?.key).has(instanceId);
        if (isHidden === !visible) return false;
        applyInstances('toggle', instanceId);
        return true;
      },
      isolateInstance: instanceId => applyInstances('isolate', instanceId),
    },
    dispose() {
      for (const stop of stops) stop?.();
      panes.setMembers?.(null);
      panel?.removeEventListener?.('click', onClick);
    },
  };
}
