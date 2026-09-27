#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { build } from '../src/index.mjs';
import { toStep, toStl } from '../src/exporters.mjs';
import { toHtml } from '../src/preview.mjs';
import { FeatureScriptError, UnsupportedFeatureError } from '../src/errors.mjs';
import { normalizeModelingPolicy } from '../src/modeling-policy.mjs';
import { serializeModel } from '../src/construction-history.mjs';
import { writeRefusalDump, writeFallbackDiagnostics } from '../src/diagnostics.mjs';
import { isRustBody, measureRustBody, rustModelKernel } from '../src/native/rust-host.mjs';

const help = `wonky-kernel — FeatureScript → B-rep

Usage: node bin/wonky.mjs <model.fs> [options]

  --out <prefix>              Output prefix (default: out/<source-name>);
                              with --format r20-check a directory (default: out/<source-name>.r20)
  --feature <name>            Select an exported feature/function
  --param 'name=expression'   FeatureScript parameter; repeat for more
  --modules <manifest.json>   Frozen input modules (default: sibling modules.json)
  --max-steps <count>         Interpreter budget (default: 20,000,000)
  --curved-contacts <mode>    strict (default) or tolerated-regularized
  --contact-cap-mm <number>   Required explicit cap for tolerated-regularized
  --boolean <policy>          hybrid-last (default: exact arms, then hybrid Boolean) or exact-only
  --format all|step|stl|html|print|r20-check
                             all attempts B-rep JSON, STEP, STL and HTML; unsupported
                             optional Rust exports are skipped with diagnostics
                             print writes an STL and a tessellation manifest;
                             r20-check writes <key>.stl per part (binary, mm, world, Z up) and
                             tessellate-manifest.json (r20/tessellate-manifest/v1) into --out,
                             keyed by the first token of each part's NAME. It fails closed:
                             any refusal retires the directory's earlier STLs and manifest and
                             writes error.json {class, message, file, line, column[, operation, dump]} instead
  --deviation-mm <number>    STL tessellation chord deviation (default: 0.02); alias --deviation
  --check                    Build and validate without writing exports
  --json                     Exactly one wonky-cli/v1 JSON object on stdout;
                             problem diagnostics go to stderr
  --help                     Show this help

Exit codes: 0 success (including optional skips), 2 modeling refusal,
            3 explicitly requested format unavailable, 1 other error.
Example: WONKY_BACKEND=rust node bin/wonky.mjs examples/box.fs --json
`;

const startedAt = performance.now();
const args = process.argv.slice(2);
const json = args.includes('--json');
let sourcePath, out, format = 'all', check = false, modelForDiagnostics, buildStarted, exportStarted;
let feature, moduleManifest, maxSteps, curvedContacts, contactCapMm, booleanArms, deviationMm = 0.02;
const params = Object.create(null);
const report = {
  schema: 'wonky-cli/v1', status: 'ok', backend: { selected: process.env.WONKY_BACKEND ?? 'js' },
  source: { file: null, language: 'FeatureScript', version: null }, feature: null,
  params, bodies: [], outputs: [], skipped: [], refusals: [],
  timingsMs: { build: null, export: null, total: null },
};
const elapsed = start => Number((performance.now() - start).toFixed(3));
const singleLine = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const r20Directory = () => resolve(out ?? `out/${basename(sourcePath, extname(sourcePath))}.r20`);

function problem(error, code, requestedFormat = null) {
  const source = error?.diagnosticContext?.operation?.source;
  const location = {
    file: source?.file ?? (sourcePath ? resolve(sourcePath) : null),
    line: error?.line ?? error?.location?.line ?? source?.span?.line ?? null,
    column: error?.column ?? error?.location?.column ?? source?.span?.column ?? null,
  };
  const operation = error?.operation?.name ?? error?.builtin ?? error?.diagnosticContext?.operation?.name ??
    (requestedFormat ? `export:${requestedFormat}` : 'cli');
  const hint = code === 'EXPORT_UNAVAILABLE' ? 'Choose a supported format (for example --format step).'
    : code === 'fillet/trim-not-representable'
      ? 'Remove this fillet; this radius needs a trim the strict Rust backend cannot represent yet.'
      : /^fillet\/requires-(?:single-)?box$/.test(code)
        ? 'Use a single box as the fillet input; filleting this Boolean result is not supported yet.'
      : /rounded|fillet/i.test(error?.reason ?? '') && operation === 'opBoolean'
        ? 'Remove the fillets before this Boolean, or export the rounded operands separately.'
        : (code.startsWith('CAPABILITY_') || error?.reason) ? `Unsupported ${error?.reason ?? operation}; change this geometry or operation.`
        : code.startsWith('GEOMETRY_') ? 'Change the geometry at the indicated operation.'
          : error?.command ? `Rebuild with: ${error.command}`
            : /^BX_(LOAD|STALE)$/.test(code) && error?.message?.includes('build it with: ')
              ? `Build with: ${error.message.split('build it with: ').at(-1)}`
              : 'Check the input and the selected backend.';
  return { code, operation, feature: report.feature, location, hint, message: singleLine(error?.message ?? error),
    ...(requestedFormat ? { format: requestedFormat } : {}) };
}
function diagnostic(p) {
  console.error(`wonky: ${p.code} op=${p.operation} feature=${p.feature ?? '?'} location=${p.location.file ?? '?'}:${p.location.line ?? '?'}:${p.location.column ?? '?'} hint=${p.hint} message=${p.message}`);
}
function describeBody(body, model) {
  if (isRustBody(body)) {
    // WC0 bodies deliberately do not expose legacy .faces/.edges/.vertices:
    // use the kernel's own certified measurement and topology instead.
    const m = measureRustBody(rustModelKernel(model), body);
    return { id: body.id, name: body.name ?? null, geometry: body.geometry, exact: true,
      topology: Object.fromEntries(['faces', 'edges', 'vertices', 'loops', 'shells'].map(key => [key, m.topology[key]])),
      volumeMm3: m.volumeMm3, areaMm2: m.areaMm2, bboxMm: m.bboxMm,
      exactness: { volume: 'bounded', area: 'bounded', bbox: 'rounded' },
      volumeRelBound: m.volumeRelBound, areaRelBound: m.areaRelBound,
      closed: m.validity.closed, boundToConstruction: m.boundToConstruction };
  }
  const v = body.validation ?? {};
  return { id: body.id, name: body.name ?? null, geometry: body.geometry ?? 'polyhedron', exact: body.geometry !== 'mesh',
    topology: { faces: v.faces ?? body.faces.length, edges: v.edges ?? body.edges.length, vertices: v.vertices ?? body.vertices.length,
      loops: body.geometry === 'mesh' ? null : body.faces.reduce((sum, face) => sum + (face.loops?.length ?? 0), 0), shells: 1 + (body.voids?.length ?? 0) },
    volumeMm3: v.volumeMm3 ?? null, areaMm2: v.areaMm2 ?? null, bboxMm: v.boundsMm ?? null,
    exactness: { volume: v.volumeMm3 == null ? 'not-evaluated' : 'uncertified',
      area: v.areaMm2 == null ? 'not-evaluated' : 'uncertified',
      bbox: v.boundsMm == null ? 'not-evaluated' : 'uncertified' }, closed: v.closed ?? null };
}
function outputRecord(extension, path, rust, bytes) {
  return { format: extension, path, bytes,
    exact: (extension === 'step' || extension === 'brep.json' || (extension === 'stl' && !rust && format !== 'print')) && report.bodies.every(body => body.exact),
    ...(extension === 'stl' && (rust || format === 'print')
      ? { exact: false, approximation: 'tessellated mesh', deviationMm } : {}) };
}
async function atomicWrite(target, contents) {
  const temporary = `${target}.${process.pid}.tmp`;
  try { await writeFile(temporary, contents); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}

try {
  // Pick the output path early so even an argument refusal can reach the r20
  // error report. The main parser below still validates every option.
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--format') format = args[i + 1];
    else if (args[i] === '--out' && !args[i + 1].startsWith('--')) out = args[i + 1];
  }
  check = args.includes('--check');
  if ((!args.length || args.includes('--help') || args.includes('-h')) && !json) {
    console.log(help);
  } else {
    const value = (i, flag) => {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
      return args[i + 1];
    };
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--out') { out = value(i, arg); i++; }
      else if (arg === '--feature') { feature = value(i, arg); i++; }
      else if (arg === '--modules') { moduleManifest = value(i, arg); i++; }
      else if (arg === '--max-steps') { maxSteps = Number(value(i, arg)); i++; }
      else if (arg === '--curved-contacts') { curvedContacts = value(i, arg); i++; }
      else if (arg === '--contact-cap-mm') { contactCapMm = Number(value(i, arg)); i++; }
      else if (arg === '--boolean') { booleanArms = value(i, arg); i++; }
      else if (arg === '--deviation-mm' || arg === '--deviation') {
        deviationMm = Number(value(i, arg)); i++;
        if (!Number.isFinite(deviationMm) || deviationMm <= 0) throw new Error(`${arg} expects a finite positive number`);
      } else if (arg === '--format') {
        format = value(i, arg); i++;
        if (!['all', 'step', 'stl', 'html', 'print', 'r20-check'].includes(format)) throw new Error('--format expects all, step, stl, html, print or r20-check');
      } else if (arg === '--param') {
        const parameter = value(i, arg), split = parameter.indexOf('=');
        if (split <= 0 || split === parameter.length - 1) throw new Error('--param expects name=FeatureScript-expression');
        const name = parameter.slice(0, split);
        if (Object.hasOwn(params, name)) throw new Error(`Duplicate parameter '${name}'`);
        params[name] = parameter.slice(split + 1); i++;
      } else if (arg === '--check' || arg === '--json' || arg === '--help' || arg === '-h') { /* flag */ }
      else if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
      else if (!sourcePath) sourcePath = arg;
      else throw new Error('Pass one FeatureScript file at a time');
    }
    if (args.includes('--help') || args.includes('-h')) { report.help = help; }
    else {
      if (!sourcePath) throw new Error('A FeatureScript source file is required');
      report.source.file = resolve(sourcePath);
      report.feature = feature ?? null;
      if (contactCapMm !== undefined && curvedContacts !== 'tolerated-regularized') throw new Error('--contact-cap-mm requires --curved-contacts tolerated-regularized');
      const modelingPolicy = normalizeModelingPolicy({ curvedContacts: curvedContacts ?? 'strict',
        ...(contactCapMm !== undefined ? { contactCapMm } : {}), ...(booleanArms !== undefined ? { boolean: booleanArms } : {}) });
      const source = await readFile(sourcePath, 'utf8');
      const siblingManifest = resolve(dirname(sourcePath), 'modules.json');
      moduleManifest ??= existsSync(siblingManifest) ? siblingManifest : undefined;
      buildStarted = performance.now();
      const model = await build(source, { feature, parameters: params, moduleManifest, maxSteps, sourcePath: resolve(sourcePath), modelingPolicy, diagnosticsDirectory: out ? resolve(out) : undefined });
      report.timingsMs.build = elapsed(buildStarted);
      modelForDiagnostics = model;
      report.backend = model.backend;
      report.source.version = model.source.version;
      report.feature = model.source.feature;
      report.bodies = model.bodies.map(body => describeBody(body, model));
      const rust = model.bodies.some(isRustBody);
      if (out && format !== 'r20-check') await writeFallbackDiagnostics(resolve(out), model.bodies);
      if (!json) for (const body of report.bodies) {
        const v = body.volumeMm3 === null ? 'volume not evaluated' : `${Number(body.volumeMm3.toFixed(6))} mm³`;
        // Keep the established JS output unchanged; Rust uses the measured WC0 topology.
        if (!rust) console.log(`${body.id}: ${body.topology.vertices} vertices · ${body.topology.edges} edges · ${body.topology.faces} faces · ${v} · closed topology`);
        else console.log(`${body.id}: ${body.topology.faces} faces · ${body.topology.edges} edges · ${body.topology.vertices} vertices · ${body.topology.loops} loops · ${body.topology.shells} shells · ${v} · ${Number(body.areaMm2.toFixed(6))} mm² · bbox ${JSON.stringify(body.bboxMm)} (exact geometry; bounded measurements)`);
      }
      exportStarted = performance.now();
      if (format === 'r20-check') {
        const { r20Export, writeR20Export } = await import('../src/r20-export.mjs');
        const { loadKernel } = await import('../src/kernel.mjs');
        const exported = r20Export(await loadKernel(), model, { deviationMm, sourcePath, source, feature, parameters: params, moduleManifest, startedAt });
        if (!check) for (const written of await writeR20Export(r20Directory(), exported)) {
          report.outputs.push(outputRecord(extname(written).slice(1), written, rust, (await stat(written)).size));
          if (!json) console.log(written);
        }
      } else if (!check) {
        const prefix = resolve(out ?? `out/${basename(sourcePath, extname(sourcePath))}`);
        const formats = [];
        if (format === 'all' || format === 'step') formats.push(['brep.json', () => serializeModel(model)], ['step', () => toStep(model, basename(prefix))]);
        if (format === 'all' || format === 'stl') formats.push(['stl', () => toStl(model, { deviationMm })]);
        if (format === 'all' || format === 'html') formats.push(['html', () => toHtml(model)]);
        if (format === 'print') {
          if (rust) {
            let mesh;
            const stl = () => mesh ??= toStl(model, { deviationMm });
            formats.push(['stl', stl], ['print.json', () => JSON.stringify({ schema: 'wonky.print-mesh/1', deviationMm,
              triangles: stl().readUInt32LE(80),
              bodies: model.bodies.map(body => ({ id: body.id,
                approximation: 'tessellated mesh', volumeMm3: body.validation?.volumeMm3 ?? null,
                volumeExactness: 'bounded' })) }, null, 2) + '\n']);
          } else {
            formats.push(['brep.json', () => serializeModel(model)], ['step', () => toStep(model, basename(prefix))]);
            const { toPrintStl } = await import('../src/print-mesh.mjs');
            const { loadKernel } = await import('../src/kernel.mjs');
            const kernel = await loadKernel();
            let printed, failure;
            const meshed = () => {
              if (failure) throw failure;
              try { return printed ??= toPrintStl(kernel, model, { deviationMm }); }
              catch (error) { failure = error; throw error; }
            };
            formats.push(['stl', () => meshed().stl], ['print.json', () => JSON.stringify(meshed().manifest, null, 2) + '\n']);
          }
        }
        await mkdir(dirname(prefix), { recursive: true });
        let meshWritten = false;
        for (const [extension, render] of formats) {
          if (extension === 'print.json' && !meshWritten) continue;
          let contents;
          try { contents = render(); }
          catch (error) {
            if (!(error instanceof UnsupportedFeatureError)) throw error;
            const p = problem(error, 'EXPORT_UNAVAILABLE', extension); diagnostic(p);
            // A prior run's artifact must not masquerade as this run's output.
            await rm(`${prefix}.${extension}`, { force: true });
            if (format === 'all' && rust) report.skipped.push(p);
            else { report.refusals.push(p); process.exitCode = json || rust ? 3 : 1; }
            continue;
          }
          const target = `${prefix}.${extension}`;
          await atomicWrite(target, contents);
          if (extension === 'stl') meshWritten = true;
          const output = outputRecord(extension, target, rust, Buffer.byteLength(contents));
          report.outputs.push(output);
          if (!json) console.log(!rust ? target : `${target} (${output.exact ? 'exact geometry' : output.approximation ?? 'metadata'}${output.deviationMm == null ? '' : `; deviation ${output.deviationMm} mm`})`);
        }
        if (report.refusals.length) report.status = 'partial';
      }
      report.timingsMs.export = elapsed(exportStarted);
    }
  }
} catch (error) {
  if (buildStarted !== undefined && report.timingsMs.build === null) report.timingsMs.build = elapsed(buildStarted);
  if (exportStarted !== undefined && report.timingsMs.export === null) report.timingsMs.export = elapsed(exportStarted);
  // An unlocated parser/argument error is an input error, not a kernel refusal.
  const requestedExport = !!modelForDiagnostics && format === 'r20-check' && error instanceof UnsupportedFeatureError;
  const refusal = !requestedExport && error instanceof FeatureScriptError &&
    (error instanceof UnsupportedFeatureError || !!error.operation || !!error.refusalCategory || !!error.operationUnderTest);
  const capability = error instanceof UnsupportedFeatureError;
  const category = error?.reason ?? error?.refusalCategory;
  const namedCode = typeof category === 'string' && /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(category)
    ? category : null;
  const code = requestedExport ? 'EXPORT_UNAVAILABLE' : namedCode ??
    (error?.refusalCategory ? 'GEOMETRY_REFUSAL' : capability ? 'CAPABILITY_UNAVAILABLE'
      : refusal ? 'GEOMETRY_REFUSAL' : (error?.code ?? 'CLI_ERROR'));
  report.source.file ??= sourcePath ? resolve(sourcePath) : null;
  report.feature ??= feature ?? error?.modelTrace?.operations?.findLast(op => op.feature?.name)?.feature.name ?? null;
  const p = problem(error, code, requestedExport ? format : null);
  report.refusals.push(p); report.status = requestedExport ? 'partial' : refusal ? 'refused' : 'error';
  process.exitCode = json || process.env.WONKY_BACKEND === 'rust' ? (requestedExport ? 3 : refusal ? 2 : 1) : 1;
  if (out || (format === 'r20-check' && sourcePath && !check)) {
    const directory = out ? resolve(out) : r20Directory();
    try {
      const { loadKernel } = await import('../src/kernel.mjs');
      await writeFallbackDiagnostics(directory, error.diagnosticContext?.bodies ?? modelForDiagnostics?.bodies ?? []);
      const dump = await writeRefusalDump(directory, error, await loadKernel(), { startedAt });
      if (dump) p.dump = resolve(directory, dump);
    } catch (diagnosticError) { p.diagnosticsError = singleLine(diagnosticError.message); }
  }
  if (format === 'r20-check' && !check && (out || sourcePath)) {
    try {
      const { writeR20Error } = await import('../src/r20-export.mjs');
      p.errorReport = await writeR20Error(r20Directory(), error, sourcePath);
    } catch (reportError) { p.errorReportError = singleLine(reportError.message); }
  }
  diagnostic(p);
} finally {
  report.timingsMs.total = elapsed(startedAt);
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
}
