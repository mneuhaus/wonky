#!/usr/bin/env node
// Motion sampling: node bin/wonky-motion.mjs <spec.json> [--json] [--gif out.gif]
// (docs/simulation.md). Exit codes: 0 done, 1 error or refused spec,
// 2 done but some pose or pair was refused (never reported as clear).
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const help = `wonky-motion: sample a motion spec over a built Rust Part Studio

Usage: node bin/wonky-motion.mjs <spec.json> [options]

  --json            Print the report (wonky-motion-report/v1) as one JSON object.
  --gif <file>      Write one frame per pose (colliding bodies highlighted, pose
                    value printed) with the viewer's renderer, headless.
  --help            This text.

Poses are SAMPLES: the report says "not continuous collision detection" and names
the largest sample step. Exit 0 = done, 1 = error/refused spec, 2 = a pose or pair
was refused (undecided is never clear).`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || !args.length) { console.log(help); process.exit(args.length ? 0 : 1); }
const json = args.includes('--json');
let specPath = null, gifPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--gif') gifPath = args[++i];
  else if (args[i] === '--json') continue;
  else if (args[i].startsWith('--')) { console.error(`wonky-motion: unknown option ${args[i]}`); process.exit(1); }
  else if (specPath === null) specPath = args[i];
  else { console.error('wonky-motion: exactly one spec file'); process.exit(1); }
}
if (!specPath || gifPath === undefined || (args.includes('--gif') && !gifPath)) { console.error('wonky-motion: a spec file (and a path after --gif) is required'); process.exit(1); }
process.env.WONKY_BACKEND ??= 'rust';

try {
  const { build } = await import('../src/index.mjs');
  const { MotionRefusal, normalizeMotionSpec, runMotion } = await import('../src/motion.mjs');
  const text = await readFile(specPath, 'utf8');
  let spec;
  try { spec = JSON.parse(text); } catch (e) { throw new MotionRefusal('motion/spec-json', `${specPath}: ${e.message}`); }
  const normalized = normalizeMotionSpec(spec);
  const sourcePath = resolve(dirname(resolve(specPath)), normalized.model.source);
  const model = await build(await readFile(sourcePath, 'utf8'), { feature: normalized.model.feature, parameters: normalized.model.parameters, sourcePath });
  const { report, posed } = runMotion(model, spec, { specFile: resolve(specPath), specSha256: createHash('sha256').update(text).digest('hex') });
  if (gifPath) {
    const { writeMotionGif } = await import('../src/motion-gif.mjs');
    report.gif = await writeMotionGif(model, report, posed, resolve(gifPath));
  }
  if (json) console.log(JSON.stringify(report));
  else {
    console.log(report.statement);
    for (const pose of report.poses) {
      const values = Object.entries(pose.values).map(([id, v]) => `${id}=${v.value} ${v.unit}`).join(' ');
      console.log(`pose ${pose.index} (${values}): ${pose.summary.interference} interfere, ${pose.summary.abutment} abut, ${pose.summary.clear} clear, ${pose.summary.refused} refused`);
      for (const p of pose.pairs) if (p.kind !== 'clear') console.log(`  ${p.aName ?? p.a} x ${p.bName ?? p.b}: ${p.type ?? p.kind}${p.volumeMm3 ? ` volume ${p.volumeMm3} mm3` : ''}${p.refusal ? ` refusal: ${p.refusal}` : ''}`);
    }
    if (report.gif) console.log(`gif: ${report.gif.path} (${report.gif.frames} frames, ${report.gif.width}x${report.gif.height})`);
  }
  if (report.summary.posesWithRefusal) process.exitCode = 2;
} catch (error) {
  const code = error?.code ?? 'motion/error';
  if (json) console.log(JSON.stringify({ schema: 'wonky-motion-report/v1', status: 'error', error: { code, message: error?.message ?? String(error) } }));
  console.error(`wonky-motion: ${error?.message ?? error}`);
  process.exitCode = 1;
}
