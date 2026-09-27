// Node module-customization hook: serves the production modules named in
// ./patches.mjs with the prototype edits applied in memory. Nothing on disk
// changes. Every edit must match exactly once, or loading fails.
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import { patches } from './patches.mjs';

const repo = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.startsWith('file:')) return result;
  const rel = relative(repo, fileURLToPath(url)).split('\\').join('/');
  const edits = patches[rel];
  if (!edits) return result;
  let source = String(result.source);
  for (const [find, replace] of edits) {
    const count = source.split(find).length - 1;
    if (count !== 1) throw new Error(`fs-interpreter-semantics prototype: edit for ${rel} matches ${count} times: ${find.slice(0, 80)}`);
    source = source.replace(find, () => replace);
  }
  return { ...result, source, shortCircuit: true };
}
