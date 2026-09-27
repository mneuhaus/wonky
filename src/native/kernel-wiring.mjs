// Where every kernel entry sits in loadKernel()'s namespace, derived from the
// source that defines it: the body of loadJsKernel() in src/kernel.mjs. The
// native build routes each op by this wiring and records it in its build key;
// the loader re-derives it on every open, so rewiring a namespace (e.g.
// planarBoolean -> another .bend module) makes the build stale instead of
// letting the old module answer under the new name.
//
// The parser is strict: loadJsKernel() may only consist of the statements it
// has today (registerBendImports, `const X = await loadBend(new URL('../kernel/<m>.bend',
// import.meta.url))`, one `return { ...root, field, name: X, ... }`). Anything
// else throws; the build refuses and the loader reports the build as stale.
//
// Naming follows the Bend JS target (src/bend-loader.mjs): a wired module's
// own defs by name, and the defs of each module it imports directly under
// '<import path relative to the module, without .bend>.<def>' (topology.bend
// imports ./geometry.bend, hence kernel['geometry.frame']).
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const WIRING_SOURCE = 'src/kernel.mjs';

export class KernelWiringError extends Error {
  constructor(message) { super(`${WIRING_SOURCE}: ${message}`); this.name = 'KernelWiringError'; }
}
const fail = message => { throw new KernelWiringError(message); };

const LOAD = /^const (\w+) = await loadBend\(new URL\('\.\.\/kernel\/([\w./-]+\.bend)', import\.meta\.url\)\);$/;
const FIXED = new Set(['loaded ??= (async () => {', 'await registerBendImports();', '})();', 'return loaded;']);

// { root: 'topology.bend', fields: { analytic: 'analytic.bend', ... } } (paths
// relative to kernel/, fields in the order of the returned object).
export function parseKernelWiring(text) {
  const start = text.indexOf('\nexport function loadJsKernel() {\n');
  if (start < 0) fail('no `export function loadJsKernel() {`');
  const modules = new Map();
  let body = null, closed = false;
  for (const raw of text.slice(start + 1).split('\n').slice(1)) {
    if (raw === '}') { closed = true; break; }
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || FIXED.has(line)) continue;
    let m;
    if ((m = LOAD.exec(line))) {
      if (modules.has(m[1])) fail(`loadJsKernel() binds ${m[1]} twice`);
      modules.set(m[1], m[2]);
    } else if ((m = /^return \{(.*)\};$/.exec(line))) {
      if (body !== null) fail('loadJsKernel() returns two objects');
      body = m[1];
    } else fail(`unrecognised statement in loadJsKernel(): '${line}'`);
  }
  if (!closed) fail('loadJsKernel() has no closing brace at column 0');
  if (body === null) fail('loadJsKernel() returns no object literal');
  const moduleOf = name => modules.get(name) ?? fail(`loadJsKernel() returns ${name}, which is not a loadBend() binding`);
  let root = null;
  const fields = {};
  body.split(',').map(part => part.trim()).filter(Boolean).forEach((part, i) => {
    let m;
    if ((m = /^\.\.\.(\w+)$/.exec(part))) {
      // A spread after a field would shadow it; only a leading spread keeps today's semantics.
      if (i !== 0 || root !== null) fail('the root module must be the single, leading spread of the returned object');
      root = moduleOf(m[1]);
    } else if ((m = /^(\w+)(?:\s*:\s*(\w+))?$/.exec(part))) {
      if (Object.hasOwn(fields, m[1])) fail(`field ${m[1]} is returned twice`);
      fields[m[1]] = moduleOf(m[2] ?? m[1]);
    } else fail(`unrecognised member '${part}' in the object loadJsKernel() returns`);
  });
  if (root === null) fail('the returned object spreads no root module');
  return { root, fields };
}

export function kernelWiring(root) {
  let text;
  try { text = readFileSync(join(root, WIRING_SOURCE), 'utf8'); }
  catch (error) { fail(`cannot read: ${error.message}`); }
  return parseKernelWiring(text);
}

// Human-readable differences between two wirings (empty when equal).
export function wiringChanges(before, after) {
  const changes = [];
  if (before?.root !== after.root) changes.push(`root spread ${before?.root ?? '-'} -> ${after.root}`);
  const names = new Set([...Object.keys(before?.fields ?? {}), ...Object.keys(after.fields)]);
  for (const name of names) {
    const a = before?.fields?.[name], b = after.fields[name];
    if (a !== b) changes.push(`loadKernel().${name}: ${a ? `kernel/${a}` : 'absent'} -> ${b ? `kernel/${b}` : 'absent'}`);
  }
  const order = Object.keys(before?.fields ?? {}).join(','), now = Object.keys(after.fields).join(',');
  if (!changes.length && order !== now) changes.push('field order of the returned object');
  return changes;
}

// Direct imports of a kernel module and the key prefix the JS target gives
// their defs ('geometry' for ./geometry.bend, '../real' for ../real.bend).
export function directImports(root, module) {
  const file = join(root, 'kernel', module);
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    const m = /^import\s+(\S+\.bend)\s+as\s+\w+\s*(?:#.*)?$/.exec(line);
    if (m) {
      const target = relative(join(root, 'kernel'), join(dirname(file), m[1]));
      out.push({ module: target, prefix: relative(dirname(file), join(dirname(file), m[1])).replace(/\.bend$/, '') });
    } else if (line !== '' && !line.startsWith('#') && !line.startsWith('import')) break;
  }
  return out;
}

// The loadKernel() slot of a kernel entry ('kernel/<module>:<def>'):
// { namespace, key } (namespace null = the root), or null when loadKernel()
// does not expose it. Order: the root module's own defs, a field wired to the
// module, then the root module's direct imports. Two fields wired to the same
// module are ambiguous and refused.
export function placementOf(entry, wiring, root) {
  const m = /^kernel\/(.+\.bend):(\w+)$/.exec(entry);
  if (!m) throw new Error(`not a kernel entry: ${entry}`);
  const [, module, def] = m;
  if (module === wiring.root) return { namespace: null, key: def };
  const fields = Object.entries(wiring.fields).filter(([, target]) => target === module).map(([name]) => name);
  if (fields.length > 1) fail(`kernel/${module} is wired to ${fields.map(f => `loadKernel().${f}`).join(' and ')}; the native routing needs one slot per entry`);
  if (fields.length === 1) return { namespace: fields[0], key: def };
  const reexport = directImports(root, wiring.root).find(i => i.module === module);
  if (reexport) return { namespace: null, key: `${reexport.prefix}.${def}` };
  return null;
}
