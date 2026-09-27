#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createGeometryInspector, formatGeometrySummary, formatGeometryDetail, measureGeometrySummaryTokens } from '../src/geometry-summary.mjs';

const help = `wonky-inspect — revision-bound geometry overview and detail

Usage: node bin/wonky-inspect.mjs <model.brep.json> [options]

  --format text|json         Output format (default: text)
  --bodies-only              Omit face descriptors from the overview
  --detail <alias>           Exact selected entity data, e.g. B1.F2
  --lookup <alias>           Viewer target and authoritative identity reference
  --revision <modelId>       Required SHA-256 for --detail/--lookup
  --out <file>              Write the result to a file instead of stdout
  --tokens                  Measure raw/summary payloads with local tiktoken
  --tokenizer-python <path>  Python containing tiktoken (default: python3)
  --tokenizer-cache <path>   Directory with cached encoding assets
  --encoding <name>         Token encoding (default: o200k_base)
  --help                    Show help

No geometry is constructed. Missing measurements remain unknown.
Token measurement is optional, uses cached assets and reports JSON.
`;

try {
  const args = process.argv.slice(2), tokenizer = {};
  let path, format = 'text', detail, lookup, revision, out, tokens = false, bodiesOnly = false;
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
  const value = (i, flag) => {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
    return args[i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format') { format = value(i, arg); i++; }
    else if (arg === '--detail') { detail = value(i, arg); i++; }
    else if (arg === '--lookup') { lookup = value(i, arg); i++; }
    else if (arg === '--revision') { revision = value(i, arg); i++; }
    else if (arg === '--out') { out = value(i, arg); i++; }
    else if (arg === '--tokens') tokens = true;
    else if (arg === '--bodies-only') bodiesOnly = true;
    else if (arg === '--tokenizer-python') { tokenizer.python = value(i, arg); i++; }
    else if (arg === '--tokenizer-cache') { tokenizer.cacheDirectory = value(i, arg); i++; }
    else if (arg === '--encoding') { tokenizer.encoding = value(i, arg); i++; }
    else if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    else if (!path) path = arg;
    else throw new Error('Pass one B-rep model file');
  }
  if (!path) throw new Error('A B-rep model file is required');
  if (!['text', 'json'].includes(format)) throw new Error('--format expects text or json');
  if ([Boolean(detail), Boolean(lookup), tokens].filter(Boolean).length > 1) throw new Error('Choose one of --detail, --lookup or --tokens');
  if (bodiesOnly && (detail || lookup || tokens)) throw new Error('--bodies-only applies to the overview; token accounting already measures both overview levels');
  if ((detail || lookup) && !revision) throw new Error('--detail and --lookup require --revision from the matching overview');
  if (Object.keys(tokenizer).length && !tokens) throw new Error('Tokenizer options require --tokens');
  const bytes = await readFile(path), inspector = createGeometryInspector(JSON.parse(bytes), { modelBytes: bytes });
  if (revision && revision !== inspector.modelId) throw new Error('The requested model revision does not match this file');
  const reference = { modelId: revision, alias: detail ?? lookup };
  const result = tokens ? await measureGeometrySummaryTokens(inspector, tokenizer)
    : detail ? inspector.detail(reference) : lookup ? inspector.resolve(reference) : inspector.summary({ includeFaces: !bodiesOnly });
  const text = tokens || format === 'json' || lookup ? JSON.stringify(result, null, 2) + '\n'
    : detail ? formatGeometryDetail(result) : formatGeometrySummary(result);
  if (out) await writeFile(out, text); else process.stdout.write(text);
} catch (error) {
  console.error(`wonky-inspect: ${error.message}`);
  process.exitCode = 1;
}
