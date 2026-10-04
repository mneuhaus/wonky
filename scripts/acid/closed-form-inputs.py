"""Discover local Python imports without importing geometry/oracle dependencies."""
import ast
import json
from pathlib import Path
import sys

root, entry = (Path(p).resolve() for p in sys.argv[1:])
seen = set()

def visit(file):
    file = file.resolve()
    if file in seen:
        return
    seen.add(file)
    for node in ast.walk(ast.parse(file.read_bytes(), filename=str(file))):
        names = []
        bases = [file.parent, root]
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = file.parent
                for _ in range(node.level - 1):
                    base = base.parent
                bases = [base]
            names = [node.module or ""] + [".".join(filter(None, [node.module, a.name])) for a in node.names]
        for name in names:
            for base in bases:
                target = base.joinpath(*name.split("."))
                for candidate in [target.with_suffix(".py"), target / "__init__.py"]:
                    if candidate.is_file() and candidate.resolve().is_relative_to(root):
                        # Package initializers can import additional repository modules.
                        for parent in candidate.parents:
                            if parent == root:
                                break
                            init = parent / "__init__.py"
                            if init.is_file():
                                visit(init)
                        visit(candidate)

visit(entry)
print(json.dumps({"python": sys.version, "files": sorted(str(p.relative_to(root)) for p in seen)}))
