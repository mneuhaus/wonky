#!/usr/bin/env node
// wonky-view: the live viewer for .fs/.py sources and the review workspace for
// .brep.json models (docs/viewer/live-server.md).
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReviewServer } from '../src/review-server.mjs';
import { normalizeModelingPolicy } from '../src/modeling-policy.mjs';
import { languageOf } from '../src/viewer/live/session.mjs';
import { killAllWorkers } from '../src/viewer/live/pool.mjs';
import { portRange } from '../src/viewer/live/port.mjs';
import { createTerminal } from '../src/viewer/live/terminal.mjs';
import { isWorkspaceInput, readWorkspaceFile } from '../src/viewer/workspace/load.mjs';
import { studioWorkspace } from '../src/viewer/workspace/studios.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: node bin/wonky-view.mjs <part.fs|part.py|reference.step|model.brep.json>... [options]
       node bin/wonky-view.mjs <project.view.json|build/studios/manifest.json> [viewer options]

Opens the wonky review viewer (http://127.0.0.1:<port>/viewer/). Live sources
are watched and rebuilt on save in warm background workers (one build per
source, two at a time): .fs with its modules.json and module files, .py with
every project file the last build imported; .step/.stp as approximate reference
meshes with source uncertainty. The browser keeps the camera, shows
the last good model with its trust state (building, failed at file:line:col,
cancelled) and never shows an incomplete model as current. The newest save runs
at once on a warm worker when one is idle. A superseded build keeps its warm
worker until a warm replacement is idle, at most until it has run 1.5 times as
long as the source's last build. When every warm worker still runs a superseded
build (a burst of saves of builds that take longer than a worker start), the
newest save takes whichever is ready first: a worker that finishes its stale
build, or a fresh one ("(cold worker)"). Stale builds never block a new save: a
save that needs a worker takes the slot of a stale build, and Cancel stops the
running build after 250 ms. A page reload or a server restart keeps the tab on
the source it showed.
.brep.json models are shown as saved; rebuild them and use "Refresh workspace".
The terminal prints one line per build.

A workspace file (*.view.json, schema wonky.view-workspace/1) serves several
models and assemblies from one process, each model with its own feature,
params, modules manifest and transform (docs/viewer/workspace.md). A CAD
project's build/studios/manifest.json (schema r20/studio-build/v1) works too:
one model per module plus the assembly "all". Build and output flags are
refused next to a workspace input; they belong in the file.

Examples:
  node bin/wonky-view.mjs part.fs
  node bin/wonky-view.mjs workspaces/r20-single-step.view.json --port 4396 --no-open
  node bin/wonky-view.mjs ~/Workspace/cad/…/build/studios/manifest.json --print-workspace
  node bin/wonky-view.mjs part.fs --param 'thickness=8 * millimeter' --out tmp/part
  node bin/wonky-view.mjs before.brep.json after.brep.json --port 4391 --no-open
  node bin/wonky-view.mjs part.fs --json --no-open > events.ndjson

Build (same meaning as bin/wonky.mjs; applied to every live source):
  --feature <name>            Select an exported feature/function
  --param 'name=expression'   FeatureScript parameter; repeat for more
  --modules <manifest.json>   Frozen input modules (default: sibling modules.json)
  --max-steps <count>         Interpreter budget
  --curved-contacts <mode>    strict (default) or tolerated-regularized
  --contact-cap-mm <number>   Required explicit cap for tolerated-regularized
  --python <executable>       Python for .py sources (default: scripts/viewer/uv-python,
                              i.e. uv run; never python3 directly)
  --timeout-ms <count>        Python execution timeout (default: 30000); 2 s later a
                              hung interpreter is killed with its worker (kind timeout)
  --max-requests <count>      Python bridge request budget (default: 20000)
Outputs (one live source):
  --out <prefix>              Write the current good revision like bin/wonky.mjs; a
                              failed build leaves the files untouched
  --format all|step|print     Formats for --out (default: all; .py: step)
  --deviation-mm <number>     Print-mesh chord deviation (default: 0.02)
Viewer:
  --port <n>                  Pin the port (busy: exit 1); default: derived from the
                              first input's path in 4400-4499, next free on collision
  --reviews <dir>             Reviews, archived revisions, settings (default: reviews/)
  --json                      Print build events as NDJSON on stdout (nothing else)
  --open / --no-open          Open a browser tab (default: live sources on a TTY; a
                              tab that reconnects after a restart is reused)
  --print-workspace           Print the workspace a .json input describes (for a
                              studio manifest: a workspace file to start from) and exit
  --help, -h                  Show this help

Environment:
  WONKY_VIEW_PORT_RANGE=a-b   Port range for the derived port (default 4400-4499)
  WONKY_VIEW_OPENER=<cmd>     Command that opens the URL (default: the OS opener)

Terminal: one line per build ("r2 ok 0.21 s · 1 body · 8 faces (8 logical) · 50×40×12 mm
recorded", "r3 FAILED input part.fs:31:9 …" with the call chain and "showing last
good r2", "r4 cancelled"). Ctrl-C stops the server and every worker. Agents can read
GET /api/selection and /api/events, or run with --json.

In the browser press ? for every key binding (W compare with previous, L follow
live, X section, G plate, K wall thickness, Shift-click to measure). Guide
(German): docs/viewer-ui.md; reference: docs/viewer/*.md.`;

function parseArguments(args) {
  const options = {
    inputs: [], parameters: Object.create(null), format: undefined, json: false, open: undefined,
    buildFlags: [],
  };
  const BUILD_FLAGS = new Set(['--feature', '--param', '--modules', '--max-steps',
    '--curved-contacts', '--contact-cap-mm', '--python', '--timeout-ms', '--max-requests', '--out',
    '--format', '--deviation-mm']);
  const value = (index, flag) => {
    if (args[index + 1] === undefined || args[index + 1].startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return args[index + 1];
  };
  const number = (index, flag, test = Number.isFinite) => {
    const parsed = Number(value(index, flag));
    if (!test(parsed)) throw new Error(`${flag} expects a number`);
    return parsed;
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (BUILD_FLAGS.has(arg)) options.buildFlags.push(arg);
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--print-workspace') options.printWorkspace = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--open') options.open = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--port') options.port = number(index++, arg, Number.isInteger);
    else if (arg === '--reviews') options.reviews = resolve(value(index++, arg));
    else if (arg === '--feature') options.feature = value(index++, arg);
    else if (arg === '--modules') options.modules = resolve(value(index++, arg));
    else if (arg === '--max-steps') options.maxSteps = number(index++, arg, Number.isSafeInteger);
    else if (arg === '--curved-contacts') options.curvedContacts = value(index++, arg);
    else if (arg === '--contact-cap-mm') options.contactCapMm = number(index++, arg);
    else if (arg === '--python') options.python = value(index++, arg);
    else if (arg === '--timeout-ms') options.timeoutMs = number(index++, arg, Number.isSafeInteger);
    else if (arg === '--max-requests') {
      options.maxRequests = number(index++, arg, Number.isSafeInteger);
    } else if (arg === '--out') options.out = value(index++, arg);
    else if (arg === '--format') {
      options.format = value(index++, arg);
      if (!['all', 'step', 'print'].includes(options.format)) {
        throw new Error('--format expects all, step or print');
      }
    } else if (arg === '--deviation-mm') {
      options.deviationMm = number(index++, arg, candidate => candidate > 0);
    } else if (arg === '--param') {
      const parameter = value(index++, arg);
      const split = parameter.indexOf('=');
      if (split <= 0 || split === parameter.length - 1) {
        throw new Error('--param expects name=FeatureScript-expression');
      }
      const name = parameter.slice(0, split);
      if (Object.hasOwn(options.parameters, name)) throw new Error(`Duplicate parameter '${name}'`);
      options.parameters[name] = parameter.slice(split + 1);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      options.inputs.push(resolve(arg));
    }
  }
  return options;
}

// A workspace input (a .json that is not .brep.json) must be the only input;
// every build and output flag belongs in the file.
function workspaceInput(options) {
  const workspaces = options.inputs.filter(isWorkspaceInput);
  if (!workspaces.length) {
    if (options.printWorkspace) {
      throw new Error('--print-workspace needs a workspace or studio manifest input');
    }
    return null;
  }
  if (options.inputs.length > 1) {
    throw new Error('A workspace file must be the only input; list the other models in it');
  }
  if (options.buildFlags.length) {
    throw new Error(`${options.buildFlags[0]} is not allowed next to a workspace file; set it per`
      + ' model in the file (docs/viewer/workspace.md)');
  }
  return workspaces[0];
}

const home = homedir();
const tilde = value => (typeof value === 'string' && value.startsWith(home + '/')
  ? `~${value.slice(home.length)}` : value);

async function printWorkspace(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (json?.schema === 'r20/studio-build/v1') {
    const adapted = studioWorkspace(json, { manifestPath: realpathSync(path) });
    for (const model of adapted.models) model.source = tilde(model.source);
    await readWorkspaceFile(path);
    return adapted;
  }
  return readWorkspaceFile(path);
}

function plan(options) {
  if (!options.inputs.length) throw new Error('Pass at least one model or source');
  const modelPaths = [];
  const sources = [];
  for (const input of options.inputs) {
    const language = languageOf(input);
    if (language === 'brep') modelPaths.push(input);
    else if (language) sources.push({ path: input, language });
    else throw new Error(`Unsupported input ${input}: pass .fs, .py, .step, .stp or .brep.json files`);
  }
  if (options.port !== undefined && (options.port < 0 || options.port > 65535)) {
    throw new Error('Invalid viewer port');
  }
  if (options.out && sources.length !== 1) throw new Error('--out needs exactly one live source');
  if (options.contactCapMm !== undefined && options.curvedContacts !== 'tolerated-regularized') {
    throw new Error('--contact-cap-mm requires --curved-contacts tolerated-regularized');
  }
  const modelingPolicy = normalizeModelingPolicy({
    curvedContacts: options.curvedContacts ?? 'strict',
    ...(options.contactCapMm !== undefined ? { contactCapMm: options.contactCapMm } : {}),
  });
  const python = sources.some(source => source.language === 'python');
  const format = options.format
    ?? (sources[0]?.language === 'python' ? 'step' : 'all');
  return {
    modelPaths,
    sources,
    build: {
      feature: options.feature,
      parameters: options.parameters,
      moduleManifest: options.modules,
      maxSteps: options.maxSteps,
      modelingPolicy: { ...modelingPolicy },
      python: python ? options.python ?? resolve(root, 'scripts/viewer/uv-python') : undefined,
      timeoutMs: options.timeoutMs,
      maxRequests: options.maxRequests,
    },
    out: options.out
      ? { prefix: resolve(options.out), format, deviationMm: options.deviationMm ?? 0.02 }
      : null,
  };
}

// Ctrl-C: close() ends the streams, kills every worker group and writes the
// tab-reuse marker. A second signal, or a close() still busy after 3 s (an
// in-flight request), exits at once; the exit hook kills the groups anyway.
let review;
let stopping = false;
async function stop(code) {
  if (stopping) {
    killAllWorkers();
    process.exit(code);
  }
  stopping = true;
  const deadline = new Promise(done => setTimeout(done, 3000));
  try {
    await Promise.race([review?.close(), deadline]);
  } finally {
    killAllWorkers();
    process.exit(code);
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const workspaceFile = workspaceInput(options);
  if (options.printWorkspace) {
    process.stdout.write(`${JSON.stringify(await printWorkspace(workspaceFile), null, 2)}\n`);
    process.exit(0);
  }
  const workspace = workspaceFile ? await readWorkspaceFile(workspaceFile) : null;
  if (options.port !== undefined && (options.port < 0 || options.port > 65535)) {
    throw new Error('Invalid viewer port');
  }
  const { modelPaths, sources, build, out } = workspace
    ? { modelPaths: [], sources: [], build: {}, out: null } : plan(options);
  const terminal = createTerminal({ json: options.json });
  const live = workspace ? workspace.models.some(model => !model.static) : sources.length > 0;
  const open = options.open ?? (live && Boolean(process.stdout.isTTY));
  process.on('uncaughtException', error => {
    killAllWorkers();
    process.stderr.write(`wonky-view: ${error.stack ?? error.message}\n`);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(0));
  review = await createReviewServer({
    modelPaths,
    sources,
    build,
    out,
    ...(workspace ? { workspace } : {}),
    ...(options.port !== undefined
      ? { port: options.port }
      : { derivePortFrom: realpathSync(options.inputs[0]), portRange: portRange() }),
    ...(options.reviews ? { reviewDirectory: options.reviews } : {}),
    open,
    terminal,
  });
} catch (error) {
  killAllWorkers();
  process.stderr.write(`wonky-view: ${error.message}\n`);
  process.exitCode = 1;
}
