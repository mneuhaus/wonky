#!/bin/sh
# Headed twins for header-less fragments whose headed version is not on disk in
# the corpus (cluster fs-headerless-include, docs/corpus/cluster-fs-headerless-include.md).
# Each twin is produced by the project's own splice rule, on copies, into
# tmp/corpus/headerless/generated/. The corpus (~/Workspace/cad) is only read.
#
#   r20/{datums,probe}.fs      cad-project-041/single-step-r20 tools/build_fs.py
#                              (header + std imports + generated constants +
#                              fs/common/*.fs + module), run on a copy of tools/,
#                              fs/ and params/ via `uv run --no-project`. The
#                              corpus has no build/studios output.
#   r11-superseded-sliding-stop/interface-r11.fs
#                              machine-interface-r11/build_parts.py rule
#                              `header + geometry-body.fs`, with the header of the
#                              current machine-interface-r11/interface-r11.fs and
#                              the superseded body (its own headed version was
#                              overwritten in place).
#
# Usage: sh scripts/corpus/fragments-generate.sh   (then node scripts/corpus/fragments.mjs --stub)
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
CAD=${WONKY_CORPUS_ROOT:-$HOME/Workspace/cad}
OUT=$REPO/tmp/corpus/headerless/generated
mkdir -p "$OUT"

# --- single-step-r20 studios
R20=$CAD/cad-project-041/single-step-r20
SRC=$REPO/tmp/corpus/headerless/r20-src
rm -rf "$SRC" "$OUT/r20"
mkdir -p "$SRC"
cp -R "$R20/tools" "$R20/fs" "$R20/params" "$SRC/"
rm -rf "$SRC/tools/__pycache__"
(cd "$SRC" && uv run --no-project --quiet python -B tools/build_fs.py --allow-placeholders --out "$OUT/r20")

# --- machine-interface-r11 superseded sliding stop (build_parts.py: header + geometry-body.fs)
R11=$CAD/cad-project-014/machine-interface-r11
mkdir -p "$OUT/r11-superseded-sliding-stop"
node -e '
const fs = require("fs");
const [twin, body, out, current] = process.argv.slice(1);
const t = fs.readFileSync(twin, "utf8"), c = fs.readFileSync(current, "utf8");
const at = t.indexOf(c);
if (at < 0 || at + c.length !== t.length) throw new Error("interface-r11.fs is not header + geometry-body.fs");
fs.writeFileSync(out, t.slice(0, at) + fs.readFileSync(body, "utf8"));
' "$R11/interface-r11.fs" "$R11/superseded-sliding-stop/geometry-body.fs" "$OUT/r11-superseded-sliding-stop/interface-r11.fs" "$R11/geometry-body.fs"
ls -l "$OUT"/*/*.fs
