#!/bin/sh
# buildPython needs an executable, not a shell command; keep all Python via uv.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
exec uv run --no-project --python "$ROOT/out/build123d-performance/reference-venv/bin/python" python "$@"
