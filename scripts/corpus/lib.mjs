// Shared paths and the failure classifier for the corpus runner.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORPUS_ROOT = process.env.WONKY_CORPUS_ROOT ?? join(homedir(), 'Workspace', 'cad');
export const FACTS_DIR = join(REPO, 'tmp/corpus/facts');
export const OUT_DIR = join(REPO, 'out/corpus');
export const TMP_DIR = join(REPO, 'tmp/corpus');
export const RUNS = join(OUT_DIR, 'runs.jsonl');
export const META = join(OUT_DIR, 'run-meta.jsonl');

// Status vocabulary (task contract):
//   ok | capability | kernel | frontend | crash | timeout
// `kind` refines the status; `errorClass` is the JS error class reported by
// the probe (the CLI prints only the formatted message).
const rules = [
  // --- runner-level
  [/Python execution exceeded \d+ ms/, 'timeout', 'python-timeout'],
  // --- frontend: parse (parser.mjs templates only; user regenError texts are handled before)
  [/^Expected 'FeatureScript', found/, 'frontend', 'parse-headerless-include'],
  [/^Expected '.*', found|^Unexpected |Unsupported expression|Unterminated|Invalid character/, 'frontend', 'parse'],
  // --- frontend: types/values (values.mjs checkType, conditions)
  [/^Expected [A-Z][A-Za-z]*$|^Expected a \dD Vector$/, 'frontend', 'type-check'],
  [/FeatureScript conditions must be boolean/, 'frontend', 'condition-not-boolean'],
  [/Incompatible units in expression/, 'frontend', 'units'],
  [/Feature precondition failed/, 'frontend', 'precondition'],
  // --- frontend: imports / modules
  [/Unresolved Onshape module/, 'frontend', 'import-unresolved-module'],
  [/^Import '.*' is not supported/, 'frontend', 'import-unsupported-std'],
  [/Expected standard-library import/, 'frontend', 'import-nonstandard'],
  [/Import onshape\/std\/geometry\.fs/, 'frontend', 'import-missing-std'],
  [/Frozen module/, 'frontend', 'import-frozen-module'],
  [/^ModuleNotFoundError|No module named/, 'frontend', 'python-import'],
  [/External geometry import/, 'capability', 'python-external-geometry-import'],
  // --- frontend: feature selection / entry
  [/Choose an exported feature with --feature/, 'frontend', 'no-entry-feature'],
  [/must bind its final Shape to 'result'|final 'result' must be a Bend Shape/, 'frontend', 'python-no-result'],
  // --- frontend: unknown names / builtins
  [/is not defined or not implemented by this prototype/, 'frontend', 'undefined-builtin'],
  [/^NameError/, 'frontend', 'python-name-error'],
  [/^SyntaxError|^IndentationError/, 'frontend', 'python-syntax'],
  // --- frontend: an unsupplied Query feature parameter (the user's pick in Onshape)
  [/is a UI selection \(Query\) with no value|Query 'uiSelection' is not implemented/, 'frontend', 'ui-selection-missing'],
  // --- capability (explicit)
  [/build123d\.[A-Za-z_]+.* is not implemented by the Python frontend|is not implemented by the Python frontend/, 'capability', 'python-api'],
  [/Execution limit exceeded/, 'capability', 'interpreter-step-budget'],
  [/no \.(step|stl|html|brep\.json) written/, 'capability', 'export-refused'],
];

export function classify({ errorClass, message, userThrow, completedOperations }) {
  const text = message ?? '';
  if (/InvalidTopology/.test(text)) return { status: 'kernel', kind: 'invalid-topology' };
  // A throw/regenError in the model's own code: before any modeling call it is
  // almost always a missing Part Studio input (the feature expects existing
  // parts or UI picks); after modeling calls it is a model check that the
  // wonky result did not satisfy.
  if (userThrow) return completedOperations > 0 ? { status: 'kernel', kind: 'model-check-failed' } : { status: 'frontend', kind: 'model-check-before-geometry' };
  for (const [re, status, kind] of rules) if (re.test(text)) return { status, kind };
  if (errorClass === 'UnsupportedFeatureError' || errorClass === 'NativeCapabilityError') return { status: 'capability', kind: 'unsupported' };
  if (/^(TypeError|RangeError|ReferenceError|SyntaxError|AssertionError)$/.test(errorClass ?? '')) return { status: 'crash', kind: `js-${errorClass}` };
  if (/Maximum call stack|heap out of memory|FATAL ERROR|Aborted|Segmentation/i.test(text)) return { status: 'crash', kind: 'runtime-abort' };
  if (/topology|not closed|Euler|self-intersect|non-manifold|analytic plane|degenerate|unresolved|validation failed/i.test(text)) return { status: 'kernel', kind: 'kernel' };
  if (errorClass === 'FeatureScriptError') return { status: 'frontend', kind: 'featurescript-error' };
  if (errorClass === 'PythonExecutionError') return { status: 'frontend', kind: 'python-error' };
  return { status: 'crash', kind: 'unclassified' };
}

// A normalized signature for clustering: numbers, quoted names and paths are
// replaced so that the same root cause lines up across files.
export function messagePattern(message = '') {
  return message
    .replace(/\/Users\/[^\s:'"]+/g, '<path>')
    .replace(/'[^']*'/g, "'…'")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/[0-9a-f]{24}/g, '<id>')
    .replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// Where a run's records go. Without a label: the baseline files above.
// With a label (standing benchmark): out/corpus/bench/<label>/.
export function runPaths(label = null) {
  if (!label) return { dir: OUT_DIR, runs: RUNS, meta: META, summary: join(OUT_DIR, 'summary.json') };
  if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new Error(`Invalid benchmark label '${label}'`);
  const dir = join(OUT_DIR, 'bench', label);
  return { dir, runs: join(dir, 'runs.jsonl'), meta: join(dir, 'run-meta.jsonl'), summary: join(dir, 'summary.json') };
}
