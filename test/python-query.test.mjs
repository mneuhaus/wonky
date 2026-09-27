import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-query.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// build123d 0.13 queries and selectors in the shim (python/_b3d_query.py) on
// top of the host queries 'bounds' and 'edges' (src/python.mjs): bounding_box,
// is_valid, solids, edges() as a ShapeList, filter_by/group_by/sort_by, GroupBy
// and Edge.center/length/radius/geom_type. Expected values were
// produced by build123d 0.13.0 itself (`uv run --no-project --with
// build123d==0.13.0 python -B tmp/w5b/g-query/compact_oracle.py` and
// oracle_misc.py, 2026-09-23), rounded to 12 significant digits and frozen
// here; floats compare within 1e-9 relative.
//
// Two properties build123d takes from OpenCascade's topology traversal, which
// Bend does not reproduce (docs/python-frontend.md): the order of edges() and
// each edge's direction. Selections that depend on them are capability errors
// (test/python-unify.test.mjs); here edges and group contents compare as
// multisets, and the tangent column the oracle recorded is not compared
// (tangent_at is direction-dependent and refused). Group ORDER, group keys and
// sort keys compare exactly.
// Python runs through `uv run`, never a bare python3.








const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-query-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));
const build = source => buildPython(source, { python, timeoutMs: 120000 });
const output = model => JSON.parse(model.execution.stdout.split('\n').find(line => line.startsWith('JSON')).slice(4));

const TOLERANCE = 1e-9;
const close = (a, b) => {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (typeof b === 'number') return typeof a === 'number' && Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(b));
  return a === b;
};
const assertClose = (a, b, what) => assert.ok(close(a, b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
// Multiset equality under close(): every expected item matched by exactly one actual item.
const assertSameItems = (actual, expected, what) => {
  assert.equal(actual.length, expected.length, `${what}: count`);
  const rest = [...actual];
  for (const item of expected) {
    const i = rest.findIndex(candidate => close(candidate, item));
    assert.ok(i >= 0, `${what}: no match for ${JSON.stringify(item)} in ${JSON.stringify(rest)}`);
    rest.splice(i, 1);
  }
};

// The same Python summary ran under build123d 0.13.0 to produce EXPECTED.
const summary = `from build123d import *
import json
def V(v): return [float(x) for x in v]
def edge(e):
    circle = e.geom_type == GeomType.CIRCLE
    return [e.geom_type.name, V(e.center()), e.length, e.radius if circle else None,
            V(e.arc_center) if circle else None, V(e.center(CenterOf.MASS))]
def summary(s, box=True):
    es = s.edges()
    out = {"valid": s.is_valid, "solids": len(s.solids()), "edges": [edge(e) for e in es],
           "lines": len(es.filter_by(GeomType.LINE)), "circles": len(es.filter_by(GeomType.CIRCLE))}
    if box:
        bb = s.bounding_box()
        out["bbox"] = [V(bb.min), V(bb.max), V(bb.size), bb.diagonal, V(bb.center())]
    for name, axis in (("X", Axis.X), ("Y", Axis.Y), ("Z", Axis.Z)):
        out["filter" + name] = [V(e.center()) for e in es.filter_by(axis)]
        groups = es.group_by(axis)
        out["group" + name] = [[V(e.center()) for e in g] for g in groups]
        out["keys" + name] = [k for k, _ in groups.key_to_group_index]
    out["sortZ"] = [e.center().Z for e in es.sort_by(Axis.Z)]
    out["sortLength"] = [e.length for e in es.sort_by(SortBy.LENGTH)]
    return out
`;
const EXPECTED = {
  box: {"valid":true,"solids":1,"edges":[["LINE",[-1,-1.5,0],4,null,null,[-1,-1.5,0],[0,0,1]],["LINE",[-1,0,2],3,null,null,[-1,0,2],[0,1,0]],["LINE",[-1,1.5,0],4,null,null,[-1,1.5,0],[0,0,1]],["LINE",[-1,0,-2],3,null,null,[-1,0,-2],[0,1,0]],["LINE",[1,-1.5,0],4,null,null,[1,-1.5,0],[0,0,1]],["LINE",[1,0,2],3,null,null,[1,0,2],[0,1,0]],["LINE",[1,1.5,0],4,null,null,[1,1.5,0],[0,0,1]],["LINE",[1,0,-2],3,null,null,[1,0,-2],[0,1,0]],["LINE",[0,-1.5,-2],2,null,null,[0,-1.5,-2],[1,0,0]],["LINE",[0,-1.5,2],2,null,null,[0,-1.5,2],[1,0,0]],["LINE",[0,1.5,-2],2,null,null,[0,1.5,-2],[1,0,0]],["LINE",[0,1.5,2],2,null,null,[0,1.5,2],[1,0,0]]],"lines":12,"circles":0,"bbox":[[-1,-1.5,-2],[1,1.5,2],[2,3,4],5.38516480713,[0,0,0]],"filterX":[[0,-1.5,-2],[0,-1.5,2],[0,1.5,-2],[0,1.5,2]],"groupX":[[[-1,-1.5,0],[-1,0,2],[-1,1.5,0],[-1,0,-2]],[[0,-1.5,-2],[0,-1.5,2],[0,1.5,-2],[0,1.5,2]],[[1,-1.5,0],[1,0,2],[1,1.5,0],[1,0,-2]]],"keysX":[-1,0,1],"filterY":[[-1,0,2],[-1,0,-2],[1,0,2],[1,0,-2]],"groupY":[[[-1,-1.5,0],[1,-1.5,0],[0,-1.5,-2],[0,-1.5,2]],[[-1,0,2],[-1,0,-2],[1,0,2],[1,0,-2]],[[-1,1.5,0],[1,1.5,0],[0,1.5,-2],[0,1.5,2]]],"keysY":[-1.5,0,1.5],"filterZ":[[-1,-1.5,0],[-1,1.5,0],[1,-1.5,0],[1,1.5,0]],"groupZ":[[[-1,0,-2],[1,0,-2],[0,-1.5,-2],[0,1.5,-2]],[[-1,-1.5,0],[-1,1.5,0],[1,-1.5,0],[1,1.5,0]],[[-1,0,2],[1,0,2],[0,-1.5,2],[0,1.5,2]]],"keysZ":[-2,0,2],"sortZ":[-2,-2,-2,-2,0,0,0,0,2,2,2,2],"sortLength":[2,2,2,2,3,3,3,3,4,4,4,4]},
  cylinder: {"valid":true,"solids":1,"edges":[["CIRCLE",[-2,2.44929359829e-16,1.5],12.5663706144,2,[0,0,1.5],[9.44037531251e-15,-7.03591007831e-17,1.5],[1.22464679915e-16,1,0]],["LINE",[2,-4.89858719659e-16,0],3,null,null,[2,-4.89858719659e-16,0],[0,0,1]],["CIRCLE",[-2,2.44929359829e-16,-1.5],12.5663706144,2,[0,0,-1.5],[9.44037531251e-15,-7.03591007831e-17,-1.5],[1.22464679915e-16,1,0]]],"lines":1,"circles":2,"bbox":[[-2,-2,-1.5],[2,2,1.5],[4,4,3],6.40312423743,[0,0,0]],"filterX":[],"groupX":[[[-2,2.44929359829e-16,1.5],[-2,2.44929359829e-16,-1.5]],[[2,-4.89858719659e-16,0]]],"keysX":[-2,2],"filterY":[],"groupY":[[[-2,2.44929359829e-16,1.5],[2,-4.89858719659e-16,0],[-2,2.44929359829e-16,-1.5]]],"keysY":[0],"filterZ":[[2,-4.89858719659e-16,0]],"groupZ":[[[-2,2.44929359829e-16,-1.5]],[[2,-4.89858719659e-16,0]],[[-2,2.44929359829e-16,1.5]]],"keysZ":[-1.5,0,1.5],"sortZ":[-1.5,0,1.5],"sortLength":[3,12.5663706144,12.5663706144]},
  plate: {"valid":true,"solids":1,"edges":[["LINE",[-140,-87.5,7.5],15,null,null,[-140,-87.5,7.5],[0,0,1]],["LINE",[-140,0,15],175,null,null,[-140,0,15],[0,1,0]],["LINE",[-140,87.5,7.5],15,null,null,[-140,87.5,7.5],[0,0,1]],["LINE",[-140,0,0],175,null,null,[-140,0,0],[0,1,0]],["LINE",[0,-87.5,7.5],15,null,null,[0,-87.5,7.5],[0,0,1]],["LINE",[0,0,15],175,null,null,[0,0,15],[0,1,0]],["LINE",[0,87.5,7.5],15,null,null,[0,87.5,7.5],[0,0,1]],["LINE",[0,0,0],175,null,null,[0,0,0],[0,1,0]],["LINE",[-70,-87.5,0],140,null,null,[-70,-87.5,0],[1,0,0]],["LINE",[-70,-87.5,15],140,null,null,[-70,-87.5,15],[1,0,0]],["LINE",[-70,87.5,0],140,null,null,[-70,87.5,0],[1,0,0]],["LINE",[-70,87.5,15],140,null,null,[-70,87.5,15],[1,0,0]]],"lines":12,"circles":0,"bbox":[[-140,-87.5,0],[0,87.5,15],[140,175,15],224.610774452,[-70,0,7.5]],"filterX":[[-70,-87.5,0],[-70,-87.5,15],[-70,87.5,0],[-70,87.5,15]],"groupX":[[[-140,-87.5,7.5],[-140,0,15],[-140,87.5,7.5],[-140,0,0]],[[-70,-87.5,0],[-70,-87.5,15],[-70,87.5,0],[-70,87.5,15]],[[0,-87.5,7.5],[0,0,15],[0,87.5,7.5],[0,0,0]]],"keysX":[-140,-70,0],"filterY":[[-140,0,15],[-140,0,0],[0,0,15],[0,0,0]],"groupY":[[[-140,-87.5,7.5],[0,-87.5,7.5],[-70,-87.5,0],[-70,-87.5,15]],[[-140,0,15],[-140,0,0],[0,0,15],[0,0,0]],[[-140,87.5,7.5],[0,87.5,7.5],[-70,87.5,0],[-70,87.5,15]]],"keysY":[-87.5,0,87.5],"filterZ":[[-140,-87.5,7.5],[-140,87.5,7.5],[0,-87.5,7.5],[0,87.5,7.5]],"groupZ":[[[-140,0,0],[0,0,0],[-70,-87.5,0],[-70,87.5,0]],[[-140,-87.5,7.5],[-140,87.5,7.5],[0,-87.5,7.5],[0,87.5,7.5]],[[-140,0,15],[0,0,15],[-70,-87.5,15],[-70,87.5,15]]],"keysZ":[0,7.5,15],"sortZ":[0,0,0,0,7.5,7.5,7.5,7.5,15,15,15,15],"sortLength":[15,15,15,15,140,140,140,140,175,175,175,175]},
  rotatedCylinder: {"valid":true,"solids":1,"edges":[["CIRCLE",[-1,-2,5.66553889765e-16],6.28318530718,1,[0,-2,4.4408920985e-16],[4.72018765625e-15,-2,4.70759839865e-16],[1.22464679915e-16,2.22044604925e-16,1]],["LINE",[1,0,-2.44929359829e-16],4,null,null,[1,0,-2.44929359829e-16],[0,1,-2.22044604925e-16]],["CIRCLE",[-1,2,-3.21624529935e-16],6.28318530718,1,[0,2,-4.4408920985e-16],[4.72018765625e-15,2,-4.79268760242e-16],[1.22464679915e-16,2.22044604925e-16,1]]],"lines":1,"circles":2,"bbox":[[-1,-2,-1],[1,2,1],[2,4,2],4.89897948557,[0,0,0]],"filterX":[],"groupX":[[[-1,-2,5.66553889765e-16],[-1,2,-3.21624529935e-16]],[[1,0,-2.44929359829e-16]]],"keysX":[-1,1],"filterY":[[1,0,-2.44929359829e-16]],"groupY":[[[-1,-2,5.66553889765e-16]],[[1,0,-2.44929359829e-16]],[[-1,2,-3.21624529935e-16]]],"keysY":[-2,0,2],"filterZ":[],"groupZ":[[[-1,-2,5.66553889765e-16],[1,0,-2.44929359829e-16],[-1,2,-3.21624529935e-16]]],"keysZ":[0],"sortZ":[-3.21624529935e-16,-2.44929359829e-16,5.66553889765e-16],"sortLength":[4,6.28318530718,6.28318530718]},
  piercedBox: {"valid":true,"solids":1,"edges":[["LINE",[-5,-5,0],4,null,null,[-5,-5,0],[0,0,1]],["LINE",[-5,0,2],10,null,null,[-5,0,2],[0,1,0]],["LINE",[-5,5,0],4,null,null,[-5,5,0],[0,0,1]],["LINE",[-5,0,-2],10,null,null,[-5,0,-2],[0,1,0]],["LINE",[0,-5,-2],10,null,null,[0,-5,-2],[1,0,0]],["LINE",[5,-5,0],4,null,null,[5,-5,0],[0,0,1]],["LINE",[0,-5,2],10,null,null,[0,-5,2],[1,0,0]],["LINE",[0,5,2],10,null,null,[0,5,2],[1,0,0]],["LINE",[5,0,2],10,null,null,[5,0,2],[0,1,0]],["CIRCLE",[-2,2.44929359829e-16,2],12.5663706144,2,[0,0,2],[9.44037531251e-15,-7.03591007831e-17,2],[1.22464679915e-16,1,0]],["LINE",[0,5,-2],10,null,null,[0,5,-2],[1,0,0]],["LINE",[5,5,0],4,null,null,[5,5,0],[0,0,1]],["LINE",[5,0,-2],10,null,null,[5,0,-2],[0,1,0]],["CIRCLE",[-2,2.44929359829e-16,-2],12.5663706144,2,[0,0,-2],[9.44037531251e-15,-7.03591007831e-17,-2],[1.22464679915e-16,1,0]],["LINE",[2,-4.89858719659e-16,0],4,null,null,[2,-4.89858719659e-16,0],[0,0,1]]],"lines":13,"circles":2,"filterX":[[0,-5,-2],[0,-5,2],[0,5,2],[0,5,-2]],"groupX":[[[-5,-5,0],[-5,0,2],[-5,5,0],[-5,0,-2]],[[-2,2.44929359829e-16,2],[-2,2.44929359829e-16,-2]],[[0,-5,-2],[0,-5,2],[0,5,2],[0,5,-2]],[[2,-4.89858719659e-16,0]],[[5,-5,0],[5,0,2],[5,5,0],[5,0,-2]]],"keysX":[-5,-2,0,2,5],"filterY":[[-5,0,2],[-5,0,-2],[5,0,2],[5,0,-2]],"groupY":[[[-5,-5,0],[0,-5,-2],[5,-5,0],[0,-5,2]],[[-5,0,2],[-5,0,-2],[5,0,2],[-2,2.44929359829e-16,2],[5,0,-2],[-2,2.44929359829e-16,-2],[2,-4.89858719659e-16,0]],[[-5,5,0],[0,5,2],[0,5,-2],[5,5,0]]],"keysY":[-5,0,5],"filterZ":[[-5,-5,0],[-5,5,0],[5,-5,0],[5,5,0],[2,-4.89858719659e-16,0]],"groupZ":[[[-5,0,-2],[0,-5,-2],[0,5,-2],[5,0,-2],[-2,2.44929359829e-16,-2]],[[-5,-5,0],[-5,5,0],[5,-5,0],[5,5,0],[2,-4.89858719659e-16,0]],[[-5,0,2],[0,-5,2],[0,5,2],[5,0,2],[-2,2.44929359829e-16,2]]],"keysZ":[-2,0,2],"sortZ":[-2,-2,-2,-2,-2,0,0,0,0,0,2,2,2,2,2],"sortLength":[4,4,4,4,4,10,10,10,10,10,10,10,10,12.5663706144,12.5663706144]},
  twoBoxes: {"valid":true,"solids":2,"edges":[["LINE",[-0.5,-0.5,0],1,null,null,[-0.5,-0.5,0],[0,0,1]],["LINE",[-0.5,0,0.5],1,null,null,[-0.5,0,0.5],[0,1,0]],["LINE",[-0.5,0.5,0],1,null,null,[-0.5,0.5,0],[0,0,1]],["LINE",[-0.5,0,-0.5],1,null,null,[-0.5,0,-0.5],[0,1,0]],["LINE",[0.5,-0.5,0],1,null,null,[0.5,-0.5,0],[0,0,1]],["LINE",[0.5,0,0.5],1,null,null,[0.5,0,0.5],[0,1,0]],["LINE",[0.5,0.5,0],1,null,null,[0.5,0.5,0],[0,0,1]],["LINE",[0.5,0,-0.5],1,null,null,[0.5,0,-0.5],[0,1,0]],["LINE",[0,-0.5,-0.5],1,null,null,[0,-0.5,-0.5],[1,0,0]],["LINE",[0,-0.5,0.5],1,null,null,[0,-0.5,0.5],[1,0,0]],["LINE",[0,0.5,-0.5],1,null,null,[0,0.5,-0.5],[1,0,0]],["LINE",[0,0.5,0.5],1,null,null,[0,0.5,0.5],[1,0,0]],["LINE",[4.5,-1,0],3,null,null,[4.5,-1,0],[0,0,1]],["LINE",[4.5,0,1.5],2,null,null,[4.5,0,1.5],[0,1,0]],["LINE",[4.5,1,0],3,null,null,[4.5,1,0],[0,0,1]],["LINE",[4.5,0,-1.5],2,null,null,[4.5,0,-1.5],[0,1,0]],["LINE",[5.5,-1,0],3,null,null,[5.5,-1,0],[0,0,1]],["LINE",[5.5,0,1.5],2,null,null,[5.5,0,1.5],[0,1,0]],["LINE",[5.5,1,0],3,null,null,[5.5,1,0],[0,0,1]],["LINE",[5.5,0,-1.5],2,null,null,[5.5,0,-1.5],[0,1,0]],["LINE",[5,-1,-1.5],1,null,null,[5,-1,-1.5],[1,0,0]],["LINE",[5,-1,1.5],1,null,null,[5,-1,1.5],[1,0,0]],["LINE",[5,1,-1.5],1,null,null,[5,1,-1.5],[1,0,0]],["LINE",[5,1,1.5],1,null,null,[5,1,1.5],[1,0,0]]],"lines":24,"circles":0,"bbox":[[-0.5,-1,-1.5],[5.5,1,1.5],[6,2,3],7,[2.5,0,0]],"filterX":[[0,-0.5,-0.5],[0,-0.5,0.5],[0,0.5,-0.5],[0,0.5,0.5],[5,-1,-1.5],[5,-1,1.5],[5,1,-1.5],[5,1,1.5]],"groupX":[[[-0.5,-0.5,0],[-0.5,0,0.5],[-0.5,0.5,0],[-0.5,0,-0.5]],[[0,-0.5,-0.5],[0,-0.5,0.5],[0,0.5,-0.5],[0,0.5,0.5]],[[0.5,-0.5,0],[0.5,0,0.5],[0.5,0.5,0],[0.5,0,-0.5]],[[4.5,-1,0],[4.5,0,1.5],[4.5,1,0],[4.5,0,-1.5]],[[5,-1,-1.5],[5,-1,1.5],[5,1,-1.5],[5,1,1.5]],[[5.5,-1,0],[5.5,0,1.5],[5.5,1,0],[5.5,0,-1.5]]],"keysX":[-0.5,0,0.5,4.5,5,5.5],"filterY":[[-0.5,0,0.5],[-0.5,0,-0.5],[0.5,0,0.5],[0.5,0,-0.5],[4.5,0,1.5],[4.5,0,-1.5],[5.5,0,1.5],[5.5,0,-1.5]],"groupY":[[[4.5,-1,0],[5.5,-1,0],[5,-1,-1.5],[5,-1,1.5]],[[-0.5,-0.5,0],[0.5,-0.5,0],[0,-0.5,-0.5],[0,-0.5,0.5]],[[-0.5,0,0.5],[-0.5,0,-0.5],[0.5,0,0.5],[0.5,0,-0.5],[4.5,0,1.5],[4.5,0,-1.5],[5.5,0,1.5],[5.5,0,-1.5]],[[-0.5,0.5,0],[0.5,0.5,0],[0,0.5,-0.5],[0,0.5,0.5]],[[4.5,1,0],[5.5,1,0],[5,1,-1.5],[5,1,1.5]]],"keysY":[-1,-0.5,0,0.5,1],"filterZ":[[-0.5,-0.5,0],[-0.5,0.5,0],[0.5,-0.5,0],[0.5,0.5,0],[4.5,-1,0],[4.5,1,0],[5.5,-1,0],[5.5,1,0]],"groupZ":[[[4.5,0,-1.5],[5.5,0,-1.5],[5,-1,-1.5],[5,1,-1.5]],[[-0.5,0,-0.5],[0.5,0,-0.5],[0,-0.5,-0.5],[0,0.5,-0.5]],[[-0.5,-0.5,0],[-0.5,0.5,0],[0.5,-0.5,0],[0.5,0.5,0],[4.5,-1,0],[4.5,1,0],[5.5,-1,0],[5.5,1,0]],[[-0.5,0,0.5],[0.5,0,0.5],[0,-0.5,0.5],[0,0.5,0.5]],[[4.5,0,1.5],[5.5,0,1.5],[5,-1,1.5],[5,1,1.5]]],"keysZ":[-1.5,-0.5,0,0.5,1.5],"sortZ":[-1.5,-1.5,-1.5,-1.5,-0.5,-0.5,-0.5,-0.5,0,0,0,0,0,0,0,0,0.5,0.5,0.5,0.5,1.5,1.5,1.5,1.5],"sortLength":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2,3,3,3,3]},
  roundedPlate: {"valid":true,"solids":1,"edges":[["LINE",[-2.21410161514,-0.433012701892,4.5],3,null,null,[-2.21410161514,-0.433012701892,4.5],[0,0,1]],["LINE",[-2.71410161514,0.433012701892,4.5],3,null,null,[-2.71410161514,0.433012701892,4.5],[0,0,1]],["LINE",[-2.46410161514,8.881784197e-16,3],1,null,null,[-2.46410161514,8.881784197e-16,3],[0.5,-0.866025403784,0]],["LINE",[-2.46410161514,8.881784197e-16,6],1,null,null,[-2.46410161514,8.881784197e-16,6],[0.5,-0.866025403784,0]],["LINE",[0.517949192431,-1.16506350946,4.5],3,null,null,[0.517949192431,-1.16506350946,4.5],[0,0,1]],["CIRCLE",[-0.999688897774,-1.36486435447,3],3.14159265359,2,[-0.482050807569,0.566987298108,3],[-0.948088826045,-1.1722902651,3],[0.965925826289,-0.258819045103,0]],["CIRCLE",[-0.999688897774,-1.36486435447,6],3.14159265359,2,[-0.482050807569,0.566987298108,6],[-0.948088826045,-1.1722902651,6],[0.965925826289,-0.258819045103,0]],["LINE",[3.98205080757,0.834936490539,4.5],3,null,null,[3.98205080757,0.834936490539,4.5],[0,0,1]],["LINE",[2.25,-0.165063509461,3],4,null,null,[2.25,-0.165063509461,3],[0.866025403784,0.5,0]],["LINE",[2.25,-0.165063509461,6],4,null,null,[2.25,-0.165063509461,6],[0.866025403784,0.5,0]],["LINE",[4.71410161514,3.56698729811,4.5],3,null,null,[4.71410161514,3.56698729811,4.5],[0,0,1]],["CIRCLE",[4.91390246015,2.0493492079,3],3.14159265359,2,[2.98205080757,2.56698729811,3],[4.72132837078,2.10094927963,3],[0.258819045103,0.965925826289,0]],["CIRCLE",[4.91390246015,2.0493492079,6],3.14159265359,2,[2.98205080757,2.56698729811,6],[4.72132837078,2.10094927963,6],[0.258819045103,0.965925826289,0]],["LINE",[4.21410161514,4.43301270189,4.5],3,null,null,[4.21410161514,4.43301270189,4.5],[0,0,1]],["LINE",[4.46410161514,4,3],1,null,null,[4.46410161514,4,3],[0.5,-0.866025403784,0]],["LINE",[4.46410161514,4,6],1,null,null,[4.46410161514,4,6],[0.5,-0.866025403784,0]],["LINE",[1.48205080757,5.16506350946,4.5],3,null,null,[1.48205080757,5.16506350946,4.5],[0,0,1]],["CIRCLE",[2.99968889777,5.36486435447,3],3.14159265359,2,[2.48205080757,3.43301270189,3],[2.94808882604,5.1722902651,3],[0.965925826289,-0.258819045103,0]],["CIRCLE",[2.99968889777,5.36486435447,6],3.14159265359,2,[2.48205080757,3.43301270189,6],[2.94808882604,5.1722902651,6],[0.965925826289,-0.258819045103,0]],["LINE",[-1.98205080757,3.16506350946,4.5],3,null,null,[-1.98205080757,3.16506350946,4.5],[0,0,1]],["LINE",[-0.25,4.16506350946,3],4,null,null,[-0.25,4.16506350946,3],[0.866025403784,0.5,0]],["LINE",[-0.25,4.16506350946,6],4,null,null,[-0.25,4.16506350946,6],[0.866025403784,0.5,0]],["CIRCLE",[-2.91390246015,1.9506507921,3],3.14159265359,2,[-0.982050807569,1.43301270189,3],[-2.72132837078,1.89905072037,3],[0.258819045103,0.965925826289,0]],["CIRCLE",[-2.91390246015,1.9506507921,6],3.14159265359,2,[-0.982050807569,1.43301270189,6],[-2.72132837078,1.89905072037,6],[0.258819045103,0.965925826289,0]]],"lines":16,"circles":8,"filterX":[],"groupX":[[[-2.91390246015,1.9506507921,3],[-2.91390246015,1.9506507921,6]],[[-2.71410161514,0.433012701892,4.5]],[[-2.46410161514,8.881784197e-16,3],[-2.46410161514,8.881784197e-16,6]],[[-2.21410161514,-0.433012701892,4.5]],[[-1.98205080757,3.16506350946,4.5]],[[-0.999688897774,-1.36486435447,3],[-0.999688897774,-1.36486435447,6]],[[-0.25,4.16506350946,3],[-0.25,4.16506350946,6]],[[0.517949192431,-1.16506350946,4.5]],[[1.48205080757,5.16506350946,4.5]],[[2.25,-0.165063509461,3],[2.25,-0.165063509461,6]],[[2.99968889777,5.36486435447,3],[2.99968889777,5.36486435447,6]],[[3.98205080757,0.834936490539,4.5]],[[4.21410161514,4.43301270189,4.5]],[[4.46410161514,4,3],[4.46410161514,4,6]],[[4.71410161514,3.56698729811,4.5]],[[4.91390246015,2.0493492079,3],[4.91390246015,2.0493492079,6]]],"keysX":[-2.913902,-2.714102,-2.464102,-2.214102,-1.982051,-0.999689,-0.25,0.517949,1.482051,2.25,2.999689,3.982051,4.214102,4.464102,4.714102,4.913902],"filterY":[],"groupY":[[[-0.999688897774,-1.36486435447,3],[-0.999688897774,-1.36486435447,6]],[[0.517949192431,-1.16506350946,4.5]],[[-2.21410161514,-0.433012701892,4.5]],[[2.25,-0.165063509461,3],[2.25,-0.165063509461,6]],[[-2.46410161514,8.881784197e-16,3],[-2.46410161514,8.881784197e-16,6]],[[-2.71410161514,0.433012701892,4.5]],[[3.98205080757,0.834936490539,4.5]],[[-2.91390246015,1.9506507921,3],[-2.91390246015,1.9506507921,6]],[[4.91390246015,2.0493492079,3],[4.91390246015,2.0493492079,6]],[[-1.98205080757,3.16506350946,4.5]],[[4.71410161514,3.56698729811,4.5]],[[4.46410161514,4,3],[4.46410161514,4,6]],[[-0.25,4.16506350946,3],[-0.25,4.16506350946,6]],[[4.21410161514,4.43301270189,4.5]],[[1.48205080757,5.16506350946,4.5]],[[2.99968889777,5.36486435447,3],[2.99968889777,5.36486435447,6]]],"keysY":[-1.364864,-1.165064,-0.433013,-0.165064,0,0.433013,0.834936,1.950651,2.049349,3.165064,3.566987,4,4.165064,4.433013,5.165064,5.364864],"filterZ":[[-2.21410161514,-0.433012701892,4.5],[-2.71410161514,0.433012701892,4.5],[0.517949192431,-1.16506350946,4.5],[3.98205080757,0.834936490539,4.5],[4.71410161514,3.56698729811,4.5],[4.21410161514,4.43301270189,4.5],[1.48205080757,5.16506350946,4.5],[-1.98205080757,3.16506350946,4.5]],"groupZ":[[[-2.46410161514,8.881784197e-16,3],[-0.999688897774,-1.36486435447,3],[2.25,-0.165063509461,3],[4.91390246015,2.0493492079,3],[4.46410161514,4,3],[2.99968889777,5.36486435447,3],[-0.25,4.16506350946,3],[-2.91390246015,1.9506507921,3]],[[-2.21410161514,-0.433012701892,4.5],[-2.71410161514,0.433012701892,4.5],[0.517949192431,-1.16506350946,4.5],[3.98205080757,0.834936490539,4.5],[4.71410161514,3.56698729811,4.5],[4.21410161514,4.43301270189,4.5],[1.48205080757,5.16506350946,4.5],[-1.98205080757,3.16506350946,4.5]],[[-2.46410161514,8.881784197e-16,6],[-0.999688897774,-1.36486435447,6],[2.25,-0.165063509461,6],[4.91390246015,2.0493492079,6],[4.46410161514,4,6],[2.99968889777,5.36486435447,6],[-0.25,4.16506350946,6],[-2.91390246015,1.9506507921,6]]],"keysZ":[3,4.5,6],"sortZ":[3,3,3,3,3,3,3,3,4.5,4.5,4.5,4.5,4.5,4.5,4.5,4.5,6,6,6,6,6,6,6,6],"sortLength":[1,1,1,1,3,3,3,3,3,3,3,3,3.14159265359,3.14159265359,3.14159265359,3.14159265359,3.14159265359,3.14159265359,3.14159265359,3.14159265359,4,4,4,4]},
};

test('selectors on a box, a cylinder, plate.py\'s first body and more equal build123d 0.13', async () => {
  const got = output(await build(`${summary}
cases = {
  "box": (Box(2, 3, 4), True),
  "cylinder": (Cylinder(2, 3), True),
  "plate": (Pos(-70, 0, 7.5) * Box(140, 175, 15), True),
  "rotatedCylinder": (Rot(90, 0, 0) * Cylinder(1, 4), True),
  "piercedBox": (Box(10, 10, 4) - Cylinder(2, 10), False),
  "twoBoxes": (Box(1, 1, 1) + Pos(5, 0, 0) * Box(1, 2, 3), True),
  "roundedPlate": (Pos(1, 2, 3) * Rot(0, 0, 30) * extrude(RectangleRounded(8, 5, 2), 3), False),
}
print("JSON" + json.dumps({k: summary(s, b) for k, (s, b) in cases.items()}))
result = Box(1, 1, 1)
`));
  assert.deepEqual(Object.keys(got), Object.keys(EXPECTED));
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const actual = got[name];
    for (const key of ['valid', 'solids', 'lines', 'circles', 'keysX', 'keysY', 'keysZ', 'sortZ', 'sortLength', 'bbox']) {
      if (key in expected) assertClose(actual[key], expected[key], `${name}.${key}`);
    }
    // Column 7 of the frozen oracle rows is the unsigned tangent_at(0.5).
    assertSameItems(actual.edges, expected.edges.map(row => row.slice(0, 6)), `${name}.edges`);
    for (const axis of ['X', 'Y', 'Z']) {
      assertSameItems(actual[`filter${axis}`], expected[`filter${axis}`], `${name}.filter_by(Axis.${axis})`);
      const groups = actual[`group${axis}`];
      assert.equal(groups.length, expected[`group${axis}`].length, `${name}.group_by(Axis.${axis}) count`);
      groups.forEach((group, i) => assertSameItems(group, expected[`group${axis}`][i], `${name}.group_by(Axis.${axis})[${i}]`));
    }
  }
  // plate.py (cad-project-026) selects the two outer vertical corner edges of its first body.
  assertSameItems(got.plate.filterZ.filter(c => Math.abs(c[0] + 140) < 0.01), [[-140, -87.5, 7.5], [-140, 87.5, 7.5]], 'plate corners');
});

test('BoundBox, ShapeList operators, GroupBy and Edge queries behave like build123d 0.13', async () => {
  const got = output(await build(`from build123d import *
import json
b = Box(2, 3, 4)
es = b.edges()
out = {}
def error(f):
    try:
        f()
    except Exception as exc:
        return [type(exc).__name__, str(exc)]
# Picks that do not depend on OpenCascade's edge order: keys that separate the edges.
# (Stable multi-key sorts such as .sort_by(Axis.X).sort_by(Axis.Y)[0] pick among equal
# keys, which OpenCascade may order by rounding noise: refused since fix round 2.)
one = es.filter_by(Axis.Z).sort_by(Axis((0, 0, 0), (1, 2, 0)))[0]
srt = es.sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)
sep = es.sort_by(Axis((0, 0, 0), (1, 2, 4)))
out["one"] = [list(one.center()), [list(e.center()) for e in srt][:3]]
bb = b.bounding_box()
out["bbox"] = [repr(bb), type(bb).__name__, type(bb.min).__name__, bb.diagonal, bb.measure, list(bb.center())]
empty = Box(1, 1, 1) & Pos(5, 0, 0) * Box(1, 1, 1)
eb = empty.bounding_box()
out["empty"] = [repr(eb), eb.diagonal, list(eb.size), empty.is_valid, len(empty.solids()), len(empty.edges())]
pb = Part().bounding_box()
out["part"] = [repr(pb), Part().is_valid, len(Part().solids()), len(Part().edges())]
out["errors"] = [error(lambda: one.radius), error(lambda: one.arc_center),
                 error(lambda: es.sort_by(SortBy.RADIUS)), error(lambda: es.group_by(Axis.Z).group(1.0))]
g = es.group_by(Axis.Z)
out["group"] = [type(g).__name__, len(g), [len(x) for x in g], g.key_to_group_index, len(g.group(2.0)), len(g.group_for(one)),
                type(g[0]).__name__, [k for k, _ in es.group_by(Axis.Z, reverse=True).key_to_group_index]]
out["list"] = [type(es).__name__, type(es.sort_by(Axis.Z)[0:4]).__name__, len(es.sort_by(Axis.Z)[0:4]), sep.first == sep[0],
               sep.last == sep[-1], es == b.edges(), len(es + one), len(sep[:2] + sep[2:4]), len(es - es.filter_by(Axis.Z)), len(es & es.filter_by(Axis.Z)),
               len(es.filter_by(Axis.Z, reverse=True)), len(es | Axis.Z), len(es << Axis.Z), len(es >> Axis.X)]
out["order"] = [[e.center().X for e in (es > Axis.X)[0:4]], [e.center().X for e in (es < Axis.X)[0:4]],
                [e.center().Z for e in (es > Axis.Z)][:4]]
out["length"] = [[e.length for e in es.sort_by(SortBy.LENGTH)], [e.length for e in es.sort_by(SortBy.LENGTH, reverse=True)][:4],
                 [(k, len(x)) for (k, _), x in zip(es.group_by(SortBy.LENGTH).key_to_group_index, es.group_by(SortBy.LENGTH))]]
c = Cylinder(2, 3)
out["cylinder"] = [[e.radius for e in c.edges().filter_by(GeomType.CIRCLE).sort_by(SortBy.RADIUS)],
                   len(es.filter_by(lambda e: e.length > 2.5)), len(es.group_by(lambda e: e.length)),
                   len(es.filter_by(Axis((0, 0, 0), (0, 0, -1)))), [str(e.geom_type) for e in c.edges().sort_by(Axis.Z)]]
out["tolerance"] = [[len((Rot(a, 0, 0) * Box(1, 1, 1)).edges().filter_by(Axis.Z, **kw)) for a, kw in
                     ((0.000009, {}), (0.000011, {}), (0.000011, {"tolerance": 0.0000111}), (0.000011, {"tolerance": 0.0000109}))]]
pair = Box(1, 1, 1) + Pos(5, 0, 0) * Box(1, 2, 3)
out["solids"] = [sorted(round(s.volume, 9) for s in pair.solids()), [len(s.edges()) for s in pair.solids()], type(pair.solids()).__name__,
                 len(pair.solids().filter_by(Axis.Z))]
circle = c.edges().filter_by(GeomType.CIRCLE).sort_by(Axis.Z)[0]
out["edge"] = [list(one @ 0.5) == list(one.center()), list(circle.position_at(0)) == list(circle.start_point()),
               list(circle.position_at(1)) == list(circle.end_point()), list(circle @ 0.5) == list(circle.center()),
               list(circle.position_at(circle.length, PositionMode.LENGTH)) == list(circle.end_point()),
               one.is_closed, sorted(ed.is_closed for ed in c.edges()), len(one.edges()), list(circle.start_point())]
print("JSON" + json.dumps(out))
result = b
`));
  assert.deepEqual(got.one, [[-1, -1.5, 0], [[0, -1.5, -2], [-1, 0, -2], [1, 0, -2]]]);
  assert.deepEqual(got.bbox.slice(0, 3), ['bbox: -1.0 <= x <= 1.0, -1.5 <= y <= 1.5, -2.0 <= z <= 2.0', 'BoundBox', 'Vector']);
  assertClose(got.bbox.slice(3), [5.385164807134504, 24, [0, 0, 0]], 'bbox numbers');
  assert.deepEqual(got.empty, ['bbox: 0.0 <= x <= 0.0, 0.0 <= y <= 0.0, 0.0 <= z <= 0.0', 0, [0, 0, 0], true, 0, 0]);
  assert.deepEqual(got.part, ['bbox: 0.0 <= x <= 0.0, 0.0 <= y <= 0.0, 0.0 <= z <= 0.0', true, 0, 0]);
  assert.deepEqual(got.errors, [['ValueError', 'Shape could not be reduced to a circle'], ['ValueError', 'GeomType.LINE has no arc center'],
    ['ValueError', 'Shape could not be reduced to a circle'], ['KeyError', '1.0']]);
  assert.deepEqual(got.group, ['GroupBy', 3, [4, 4, 4], [[-2, 0], [0, 1], [2, 2]], 4, 4, 'ShapeList', [2, 0, -2]]);
  assert.deepEqual(got.list, ['ShapeList', 'ShapeList', 4, true, true, true, 13, 4, 8, 4, 8, 4, 4, 4]);
  assert.deepEqual(got.order, [[-1, -1, -1, -1], [1, 1, 1, 1], [-2, -2, -2, -2]]);
  assert.deepEqual(got.length, [[2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4], [4, 4, 4, 4], [[2, 4], [3, 4], [4, 4]]]);
  assert.deepEqual(got.cylinder, [[2, 2], 8, 3, 4, ['GeomType.CIRCLE', 'GeomType.LINE', 'GeomType.CIRCLE']]);
  assert.deepEqual(got.tolerance, [[4, 0, 4, 0]]);
  assert.deepEqual(got.solids, [[1, 6], [12, 12], 'ShapeList', 0]);
  assert.deepEqual(got.edge, [true, true, true, true, true, false, [false, true, true], 1, [2, 0, -1.5]]);
});

test('queries without an exact Bend evaluation are capability errors at their use site', async () => {
  const cases = [
    ['Box(1, 1, 1).bounding_box(optimal=False)', /optimal=False/],
    ['Box(1, 1, 1).edges(Select.LAST)', /Select\.LAST.*operation history/],
    ['Cylinder(1, 1).edges().filter_by(GeomType.LINE)[0].tangent_at((0, 0, 0))', /tangent_at\(point\)/],
    ['Box(1, 1, 1).edges().filter_by(Plane.XY)', /filter_by\(Plane\)/],
    ['Box(1, 1, 1).edges().vertices()', /ShapeList\.vertices/],
    ['Cylinder(1, 1).edges().filter_by(GeomType.LINE)[0].vertices()', /Edge\.vertices/],
    ['Cylinder(1, 1).edges().filter_by(GeomType.LINE)[0].center(CenterOf.BOUNDING_BOX)', /BOUNDING_BOX/],
    ['Box(1, 1, 1).edges().group_by(Convexity)', /Convexity.*adjacent/],
    ['extrude(RectangleRounded(10, 6, 1), 2).bounding_box()', /tight bounds/],
  ];
  await Promise.all(cases.map(async ([expression, message]) => {
    await assert.rejects(build(`from build123d import *\nx = ${expression}\nresult = Box(1, 1, 1)\n`), error => {
      assert.ok(error instanceof UnsupportedFeatureError, `${expression}: ${error.name}: ${error.message}`);
      assert.match(error.message, message, expression);
      assert.equal(error.line, 2, expression);
      return true;
    });
  }));
});

}
