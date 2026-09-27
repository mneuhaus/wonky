// WPy subset checker. A WPy program is a Python 3 program that stays inside a
// hermetic, deterministic subset (Starlark-like). This pass decides membership
// statically and reports every violation with its span, a rule name and a
// rewrite hint. It never executes anything.
//
// Rule classes:
//   reject     - not WPy; the file must be rewritten (hint says how)
//   planned    - not in WPy v0 but designed for v1 (builders, numpy-lite ...)
//   tolerated  - accepted with a changed meaning that is stated (main-block IO)
//   note       - accepted; reported because it affects graph submission

import { walk } from './parse.mjs';

// Modules a WPy file may import. `build123d` is accepted as an alias for the
// wonky vocabulary so unmodified algebra-mode files keep working.
export const ALLOWED_MODULES = new Set(['wonky', 'build123d', 'math', 'typing', '__future__']);
// Host-IO modules that are tolerated only inside `if __name__ == "__main__":`.
const MAIN_IO_MODULES = new Set(['os', 'sys', 'pathlib', 'json', 'argparse', 'time']);
const DYNAMIC_BUILTINS = new Set(['eval', 'exec', 'compile', 'open', '__import__', 'getattr', 'setattr', 'delattr',
  'globals', 'locals', 'vars', 'input', 'breakpoint', 'id', 'hash', 'memoryview', 'object', 'type', 'super', 'iter', 'next']);
const HINTS = {
  class: 'use functions returning dicts or tuples; WPy has no user classes',
  decorator: 'call the wrapped function explicitly; decorators are not part of WPy v0',
  import: 'WPy is hermetic: only wonky/build123d names and math are importable',
  numpy: 'use math and list comprehensions (a numpy-lite vector module is planned)',
  builder: 'use algebra mode (a + b, a - b, Pos(...) * shape); builder contexts are planned for WPy v1',
  generator: 'return a list instead of yielding',
  dynamic: 'dynamic evaluation, reflection and file IO are not available in WPy',
  dunder: 'double-underscore attributes are not available in WPy',
  global: 'return the new value instead of rebinding a module variable',
  starImport: 'import the names you use explicitly, or `from wonky import *`',
};

function isMainGuard(stmt) {
  const t = stmt.k === 'If' && stmt.test;
  if (!t || t.k !== 'Compare' || t.ops.length !== 1 || t.ops[0] !== '==') return false;
  const sides = [t.left, t.comparators[0]];
  return sides.some(s => s.k === 'Name' && s.id === '__name__') && sides.some(s => s.k === 'Const' && s.value === '__main__');
}

export function checkModule(ast, { localModules = new Set() } = {}) {
  const findings = [];
  const add = (severity, rule, node, message, hint = HINTS[rule]) => findings.push({ severity, rule, span: node.span, message, hint });
  const mainBlocks = new Set(ast.body.filter(isMainGuard));
  const visitStmt = (stmt, inMain) => {
    walk(stmt, (n, parent) => {
      switch (n.k) {
        case 'ClassDef': add('reject', 'class', n, `class ${n.name}`); break;
        case 'FunctionDef': if (n.decorators.length) add('reject', 'decorator', n, `decorated function ${n.name}`); break;
        case 'With': add('planned', 'builder', n, 'with-statement (builder mode or context manager)'); break;
        case 'Global': add('reject', 'global', n, `global ${n.names.join(', ')}`); break;
        case 'While': add('note', 'while', n, 'while loop runs under the step budget'); break;
        case 'Try': add('note', 'try', n, 'try/except: caught kernel failures are reported, capability errors are never caught'); break;
        case 'Import':
          for (const { name } of n.names) moduleRule(name, n, inMain);
          break;
        case 'ImportFrom':
          if (n.level) add('reject', 'import', n, 'relative import');
          else moduleRule(n.module, n, inMain);
          if (n.names === '*' && !['wonky', 'build123d', 'math'].includes(n.module)) add('reject', 'starImport', n, `from ${n.module} import *`);
          break;
        case 'Call':
          if (n.func.k === 'Name' && DYNAMIC_BUILTINS.has(n.func.id)) add(inMain && n.func.id === 'open' ? 'tolerated' : 'reject', 'dynamic', n, `${n.func.id}()`);
          break;
        case 'Attribute':
          if (/^__.*__$/.test(n.attr)) add('reject', 'dunder', n, `.${n.attr}`);
          break;
      }
    });
  };
  const moduleRule = (name, node, inMain) => {
    const root = name.split('.')[0];
    if (ALLOWED_MODULES.has(root)) return;
    if (inMain && MAIN_IO_MODULES.has(root)) { add('tolerated', 'mainIO', node, `import ${name} inside the main block`, 'main-block IO is not executed by wonky; export_* calls become named outputs'); return; }
    if (root === 'numpy') { add('planned', 'numpy', node, `import ${name}`); return; }
    if (localModules.has(root)) { add('planned', 'localModule', node, `import of the project module ${name}`, 'multi-file WPy projects (hash-pinned sibling modules) are planned for WPy v1'); return; }
    add('reject', 'import', node, `import ${name}`, root === 'cad_khana' ? 'cad_khana checks map to expect(...) and wonky check; the wrapper itself is not WPy'
      : root === 'OCP' ? 'direct OCCT calls cannot run on the Bend kernel' : HINTS.import);
  };
  for (const stmt of ast.body) visitStmt(stmt, mainBlocks.has(stmt));
  const rejected = findings.filter(f => f.severity === 'reject');
  const planned = findings.filter(f => f.severity === 'planned');
  return {
    findings,
    verdict: rejected.length ? 'reject' : planned.length ? 'planned' : 'accept',
    rules: Object.fromEntries([...new Set(findings.map(f => f.rule))].map(r => [r, findings.filter(f => f.rule === r).length])),
  };
}
