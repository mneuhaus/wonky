#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: writes the frozen exact B-rep leaves
// of the case catalogue ({prim: 'brep'}) as STEP through the kernel's own
// serializer (src/exporters.mjs toStep; no geometry is changed), so that the
// OCCT oracle in scripts/bakeoff/reference.py can rebuild the exact CSG.
//
//   node scripts/bakeoff/brep-step.mjs      -> out/bakeoff/brep/<stem>-body<i>.step

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, ROOT } from './fixtures.mjs';
import { loadOperands } from './brep-tessellate.mjs';

export const BREP_STEP_DIR = path.join(ROOT, 'out/bakeoff/brep');

export function brepStepPath(source, body) {
  return path.join(BREP_STEP_DIR, `${path.basename(source).replace(/\.json(\.gz)?$/, '')}-body${body}.step`);
}

function leaves(node, out = []) {
  if (node.prim) out.push(node);
  else node.children.forEach((c) => leaves(c, out));
  return out;
}

async function main() {
  const { toStep } = await import('../../src/exporters.mjs');
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
  fs.mkdirSync(BREP_STEP_DIR, { recursive: true });
  const seen = new Set();
  for (const c of loadCases()) {
    for (const leaf of leaves(c.csg)) {
      if (leaf.prim !== 'brep') continue;
      const file = brepStepPath(leaf.params.source, leaf.params.body);
      if (seen.has(file)) continue;
      seen.add(file);
      const body = loadOperands(path.join(ROOT, leaf.params.source)).bodies[leaf.params.body].body;
      fs.writeFileSync(file, toStep({ bodies: [body], backend: { version } }, path.basename(file, '.step')));
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
}
