#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { buildPython } from '../src/python.mjs';
import { toStep, toStl } from '../src/exporters.mjs';
import { toHtml } from '../src/preview.mjs';
import { serializeModel } from '../src/construction-history.mjs';

const help = `wonky-kernel — Python Algebra → Bend → B-rep

Usage: node bin/wonky-python.mjs <model.py> [options]

  --out <prefix>          Output prefix (default: out/<source-name>)
  --python <executable>   Python executable (default: python3)
  --timeout-ms <count>    Python execution timeout (default: 30000)
  --max-requests <count>  Bridge request budget (default: 20000)
  --format step|all      STEP/B-rep, or also planar STL/HTML (default: step)
  --check                Build and validate without writing the --out files (the
                         model's own export_step()/export_stl() calls still write)
  --no-project-path      Do not put the model directory and project root on sys.path
  --khana-checks refuse|skip
                         cad_khana check()/inspect(): refuse with a capability error
                         (default), or record each call as NOT RUN in brep.json and
                         in this summary (the build is then not checked)
  --read-only <dir>      Refuse export_step()/export_stl() writes below <dir>; repeat
                         for more (the corpus root ~/Workspace/cad, and
                         WONKY_CORPUS_ROOT when set, is always read only)
  --help                 Show this help

Runs trusted local Python like "python model.py": the model directory and the
nearest pyproject.toml root are importable, and every imported project module is
recorded with its SHA-256. Installed packages are not importable.

The model result, first match wins: a module-level "result", a module-level
"assembly", or the shapes passed to show()/show_object()/export_step()/
export_stl() in call order. export_step()/export_stl() also write their file
at the call, from the Bend B-rep, at the path Python resolves (relative to the
working directory); paths outside the model's project directory (the nearest
pyproject.toml root, else the model directory) are refused. Each written file
is recorded with its SHA-256 in brep.json. --out writes the model.
Supported API and kernel limits: docs/python-frontend.md
`;

const at = location => (location?.line ? `${basename(location.file ?? sourcePath)}:${location.line}` : 'unknown location');
const writtenLine = file => `${file.kind}('${file.requested}') wrote ${file.path} (${file.format}, ${file.bytes} bytes, sha256 ${file.sha256}) ← ${file.bodyIds.join(', ')}`;
// Every cad_khana check that was not run, and a closing line that says the build is not checked.
function notRunLines(record) {
  if (!record || record.mode !== 'skip') return [];
  const lines = record.notRun.map(entry => `${entry.message} (${at(entry.location)}: ${entry.call.split('.').at(-1)}(${entry.arguments.join(', ')}))`);
  lines.push(record.notRun.length
    ? `--khana-checks=skip: ${record.notRun.length} cad_khana check/inspect call(s) NOT RUN; this build is not checked`
    : '--khana-checks=skip: no cad_khana check/inspect call was reached');
  return lines;
}

let sourcePath;
try {
  const args = process.argv.slice(2), options = { readOnlyRoots: [] };
  let out, format = 'step', check = false;
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
  const value = (i, flag) => {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
    return args[i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') { out = value(i, arg); i++; }
    else if (arg === '--python') { options.python = value(i, arg); i++; }
    else if (arg === '--timeout-ms') { options.timeoutMs = Number(value(i, arg)); i++; }
    else if (arg === '--max-requests') { options.maxRequests = Number(value(i, arg)); i++; }
    else if (arg === '--format') {
      format = value(i, arg); i++;
      if (!['step', 'all'].includes(format)) throw new Error('--format expects step or all');
    } else if (arg === '--check') check = true;
    else if (arg === '--no-project-path') options.projectPath = false;
    else if (arg === '--khana-checks' || arg.startsWith('--khana-checks=')) {
      const mode = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : value(i++, arg);
      if (!['refuse', 'skip'].includes(mode)) throw new Error('--khana-checks expects refuse or skip');
      options.khanaChecks = mode;
    } else if (arg === '--read-only') { options.readOnlyRoots.push(resolve(value(i, arg))); i++; }
    else if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    else if (!sourcePath) sourcePath = arg;
    else throw new Error('Pass one Python source file at a time');
  }
  if (!sourcePath) throw new Error('A Python source file is required');
  let model;
  try {
    model = await buildPython(await readFile(sourcePath, 'utf8'), { ...options, filename: resolve(sourcePath) });
  } catch (error) {
    // What the model wrote and skipped before it failed is still reported.
    for (const file of error.writtenFiles ?? []) console.log(writtenLine(file));
    for (const line of notRunLines(error.khanaChecks)) console.log(line);
    throw error;
  }
  process.stdout.write(model.execution.stdout);
  process.stderr.write(model.execution.stderr);
  for (const body of model.bodies) {
    const v = body.validation;
    console.log(`${body.id}${body.name ? ` "${body.name}"` : ''}: ${v.vertices} vertices · ${v.edges} edges · ${v.faces} faces · ${Number(v.volumeMm3.toFixed(6))} mm³ · closed topology`);
  }
  for (const file of model.source.writtenFiles ?? []) console.log(writtenLine(file));
  for (const output of model.source.outputs.filter(item => item.path !== undefined && !item.written)) {
    console.log(`${output.kind}('${output.path}') → ${output.bodyIds.join(', ')} (captured as '${output.name}', NOT written: the write failed)`);
  }
  for (const line of notRunLines(model.source.khanaChecks)) console.log(line);
  if (model.source.ignoredCaptures) {
    console.log(`${model.source.ignoredCaptures} show/export call(s) ignored: the module-level '${model.source.result}' is the result`);
  }
  if (!check) {
    const prefix = resolve(out ?? `out/${basename(sourcePath, extname(sourcePath))}`);
    const files = [['brep.json', serializeModel(model)], ['step', toStep(model, basename(prefix))]];
    if (format === 'all') files.push(['stl', toStl(model)], ['html', toHtml(model)]);
    await mkdir(dirname(prefix), { recursive: true });
    for (const [extension, contents] of files) {
      const target = `${prefix}.${extension}`, temporary = `${target}.${process.pid}.tmp`;
      try { await writeFile(temporary, contents); await rename(temporary, target); }
      finally { await rm(temporary, { force: true }); }
      console.log(target);
    }
  }
} catch (error) {
  console.error(typeof error.format === 'function' ? error.format(sourcePath) : `wonky-python: ${error.message}`);
  process.exitCode = 1;
}
