// Workspace tree (pure; docs/viewer/workspace.md, section 3). No DOM here:
// features/workspace/workspace.js holds the state and renders the strings.
//
//   tree     GET /api/workspace `tree` / SSE hello `tree`:
//            { name, file, implicit, open, models: [{ key, label, sourceId,
//              modelId, matrix, static }], assemblies: [{ key, label,
//              instances: [{ id, model, matrix }] }] }
//   node     { kind: 'model' | 'assembly', key }
//   current  Map key -> model id drawn for that workspace model (its newest
//            good one, or the displayed revision for the displayed model)
//   hidden   Set of hidden instance ids of the open assembly
import { escape } from '../../core/dom.js';
import { isIdentity } from '../../render/placement.js';
import { CHEVRON, EYE, EYE_OFF } from '../../core/icons.js';

const KIND = /^(model|assembly):([a-z0-9][a-z0-9-]{0,39})$/;

export function parseNode(text) {
  const match = typeof text === 'string' ? KIND.exec(text) : null;
  return match ? { kind: match[1], key: match[2] } : null;
}

export const nodeText = node => (node ? `${node.kind}:${node.key}` : '');

// The node if the tree has it, else null.
export function knownNode(tree, node) {
  if (!tree || !node) return null;
  const list = node.kind === 'model' ? tree.models : tree.assemblies;
  return list?.some(item => item.key === node.key) ? node : null;
}

export const modelOf = (tree, key) => tree?.models?.find(model => model.key === key) ?? null;

// Instances of a node: an assembly's instances, or the model at its own
// placement (instance id `model:<key>`).
export function nodeInstances(tree, node) {
  if (!knownNode(tree, node)) return [];
  if (node.kind === 'model') {
    const model = modelOf(tree, node.key);
    return [{ id: `model:${model.key}`, model: model.key, matrix: model.matrix }];
  }
  return tree.assemblies.find(assembly => assembly.key === node.key).instances;
}

// Pane members of a node: every visible instance whose model has a good
// revision. A model node at identity has none (the pane draws its model as
// before the workspace existed); an assembly always has its members.
export function nodeMembers(tree, node, { current = new Map(), hidden = new Set() } = {}) {
  if (!knownNode(tree, node)) return null;
  const instances = nodeInstances(tree, node);
  if (node.kind === 'model' && isIdentity(instances[0].matrix)) return null;
  return instances.filter(instance => !hidden.has(instance.id)).flatMap(instance => {
    const modelId = current.get(instance.model);
    return modelId ? [{ instance: instance.id, key: instance.model, modelId,
      matrix: instance.matrix }] : [];
  });
}

// The active model of a node (state.after): a model node's model; in an
// assembly the model of the primary selection, else the last active one,
// else the first visible member.
export function activeKey(tree, node, { selectionKey = null, lastKey = null, hidden = new Set(),
  current = new Map() } = {}) {
  if (!knownNode(tree, node)) return null;
  if (node.kind === 'model') return node.key;
  const visible = nodeInstances(tree, node).filter(instance => !hidden.has(instance.id))
    .map(instance => instance.model);
  if (selectionKey && visible.includes(selectionKey)) return selectionKey;
  if (lastKey && visible.includes(lastKey) && current.has(lastKey)) return lastKey;
  return visible.find(key => current.has(key)) ?? visible[0] ?? null;
}

// Hidden set after an instance action: toggle one, or isolate one (isolating
// the only visible instance again shows all).
export function visibilityAfter(action, instances, hidden, id) {
  const next = new Set(hidden);
  if (action === 'toggle') {
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  if (action === 'isolate') {
    const others = instances.filter(instance => instance.id !== id);
    const isolated = !next.has(id) && others.every(instance => next.has(instance.id));
    if (isolated) return new Set();
    return new Set(others.map(instance => instance.id));
  }
  if (action === 'show-all') return new Set();
  throw new Error(`Unknown instance action ${action}`);
}

// Trust text of a workspace model row from its live source entry
// (features/live trust model: { lastGood, attempt, failure }).
export function trustOf(source, { isStatic = false } = {}) {
  if (isStatic) return { tone: 'static', text: 'saved' };
  if (!source) return { tone: 'blue', text: 'starting' };
  const good = source.lastGood;
  const attempt = source.attempt;
  const running = attempt && ['queued', 'building'].includes(attempt.status);
  if (running) {
    return { tone: 'blue', text: good ? `r${good.revision} · r${attempt.revision} building`
      : `r${attempt.revision} building` };
  }
  if (attempt?.status === 'failed' && (!good || attempt.revision > good.revision)) {
    return { tone: 'amber', text: good ? `r${attempt.revision} fails · last good r${good.revision}`
      : `r${attempt.revision} fails` };
  }
  if (good) return { tone: 'green', text: `r${good.revision}` };
  return { tone: 'blue', text: 'waiting' };
}

const matches = (text, ...values) => !text || values.some(value => String(value ?? '')
  .toLowerCase().includes(text.toLowerCase()));

// Tree markup: assemblies (expandable to their instances), then models.
// rows: { node, expanded: Set of assembly keys, hidden, trust(key) -> {tone,
// text}, bodies(key) -> count | null, filter }
export function treeMarkup(tree, { node, expanded = new Set(), hidden = new Set(),
  trust = () => null, bodies = () => null, filter = '' } = {}) {
  if (!tree || tree.implicit) return '';
  const open = nodeText(node);
  const modelRow = (model, { instance = null, depth = 0 } = {}) => {
    const state = trust(model.key) ?? { tone: 'blue', text: '' };
    const count = bodies(model.key);
    const text = `model:${model.key}`;
    const isHidden = instance && hidden.has(instance.id);
    const verb = isHidden ? 'Show' : 'Hide';
    const eye = instance ? '<button class="ws-eye" type="button"'
      + ` data-ws-eye="${escape(instance.id)}" aria-pressed="${!isHidden}"`
      + ` title="${escape(`${verb} ${model.label} in this assembly`)}"`
      + ` aria-label="${escape(`${verb} ${model.label}`)}">${isHidden ? EYE_OFF : EYE}</button>`
      : '<span class="ws-eye-gap"></span>';
    const isolate = instance ? `<button class="ws-isolate" type="button"`
      + ` data-ws-isolate="${escape(instance.id)}" title="${escape(`Isolate ${model.label}`
      + ' (again: show all)')}" aria-label="${escape(`Isolate ${model.label}`)}">I</button>` : '';
    return `<li class="ws-row ws-model${open === text && !instance ? ' is-open' : ''}`
      + `${isHidden ? ' is-hidden' : ''}" data-depth="${depth}">${eye}`
      + `<button class="ws-name" type="button" data-ws-node="${escape(text)}"`
      + ` title="${escape(`Open ${model.label}${model.feature ? ` (${model.feature})` : ''}`)}">`
      + `<span class="ws-label">${escape(model.label)}</span>`
      + (Number.isInteger(count) ? `<span class="ws-count">${count}</span>` : '')
      + '</button>'
      + `<span class="ws-trust" data-tone="${escape(state.tone)}">${escape(state.text)}</span>`
      + `${isolate}</li>`;
  };
  const assemblies = tree.assemblies.filter(assembly => matches(filter, assembly.label)
    || assembly.instances.some(instance => matches(filter, modelOf(tree, instance.model)?.label)))
    .map(assembly => {
      const text = `assembly:${assembly.key}`;
      const isOpen = open === text;
      const unfolded = expanded.has(assembly.key) || isOpen;
      const shown = isOpen ? assembly.instances.filter(instance => !hidden.has(instance.id)).length
        : assembly.instances.length;
      const rows = unfolded ? assembly.instances.map(instance => modelRow(
        modelOf(tree, instance.model), { instance: isOpen ? instance : null, depth: 1 })).join('')
        : '';
      return `<li class="ws-row ws-assembly${isOpen ? ' is-open' : ''}" data-depth="0">`
        + `<button class="ws-fold" type="button" data-ws-fold="${escape(assembly.key)}"`
        + ` aria-expanded="${unfolded}" aria-label="${escape(`${unfolded ? 'Fold' : 'Unfold'}`
        + ` ${assembly.label}`)}">${CHEVRON}</button>`
        + `<button class="ws-name" type="button" data-ws-node="${escape(text)}"`
        + ` title="${escape(`Open the assembly ${assembly.label}`)}">`
        + '<span class="ws-kind">Assembly</span>'
        + `<span class="ws-label">${escape(assembly.label)}</span>`
        + `<span class="ws-count">${shown}/${assembly.instances.length}</span></button></li>`
        + (rows ? `<li class="ws-children"><ul>${rows}</ul></li>` : '');
    }).join('');
  const models = tree.models.filter(model => matches(filter, model.label, model.key))
    .map(model => modelRow(model)).join('');
  return `<section class="ws-tree" aria-label="${escape(tree.name ?? 'Workspace')}">`
    + `<h3 class="parts-heading"><span>${escape(tree.name ?? 'Workspace')}</span>`
    + `<span class="count">${tree.models.length}</span></h3>`
    + `<ul class="ws-list">${assemblies}`
    + (assemblies && models ? '<li class="ws-section">Models</li>' : '')
    + `${models}</ul></section>`;
}
