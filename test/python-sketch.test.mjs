import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-sketch.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFileSync } = await import("node:child_process");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// build123d 0.13 2D profiles (python/_b3d_sketch.py) as pure Python data.
// Every expected value below was produced by build123d 0.13.0 itself
// (tmp/w5b/c-sketch/oracle.py, `uv run --no-project --with build123d==0.13.0`,
// 2026-09-23) and frozen here: edges (start, end; circle/arc center, radius,
// midpoint), face normals, class names, areas and error types/messages.
// The profiles are checked without the Node host: the shim channel is a
// recorder that fails on any request other than a capability error.
// Placements use stand-ins that implement the `_wonky_rigid` protocol
// (Loc = build123d Pos * Rot with Rot(x, y, z) = Rx * Ry * Rz) and Plane-like
// origin/x_dir/z_dir objects. Python runs through `uv run`, never a bare python3.










const pythonDir = fileURLToPath(new URL('../python/', import.meta.url));

const DRIVER = String.raw`
import importlib.util, json, math, os, sys
root = sys.argv[1]
sys.path.insert(0, root)
import build123d as shim
calls = []
class Recorder:
    def request(self, op, **arguments):
        calls.append(op)
        if op == "unsupported":
            raise RuntimeError("UNSUPPORTED: " + arguments["message"])
        raise AssertionError("host call " + op)
shim._channel = Recorder()
m = sys.modules.get("_b3d_sketch")
if m is None:
    spec = importlib.util.spec_from_file_location("_b3d_sketch", os.path.join(root, "_b3d_sketch.py"))
    m = importlib.util.module_from_spec(spec)
    sys.modules["_b3d_sketch"] = m
    spec.loader.exec_module(m)
def rx(a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a)); return ((1, 0, 0), (0, c, -s), (0, s, c))
def ry(a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a)); return ((c, 0, s), (0, 1, 0), (-s, 0, c))
def rz(a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a)); return ((c, -s, 0), (s, c, 0), (0, 0, 1))
def mm(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))
class Loc:
    def __init__(self, pos=(0, 0, 0), rot=(0, 0, 0)):
        self.rows = mm(mm(rx(rot[0]), ry(rot[1])), rz(rot[2]))
        self.offset = tuple(float(v) for v in pos) + (0.0,) * (3 - len(pos))
    def _wonky_rigid(self):
        return self.rows, self.offset
class Pl:
    def __init__(self, origin, x_dir, z_dir):
        self.origin, self.x_dir, self.z_dir = origin, x_dir, z_dir
    def offset(self, d):
        return Pl(tuple(o + d * z for o, z in zip(self.origin, self.z_dir)), self.x_dir, self.z_dir)
ns = {name: value for name, value in m.BUILD123D.items()}
ns.update(Align=shim.Align, Mode=shim.Mode, MIN=shim.Align.MIN, CENTER=shim.Align.CENTER, MAX=shim.Align.MAX,
          Loc=Loc, Pl=Pl, V=lambda *c: tuple(c), XY=Pl((0, 0, 0), (1, 0, 0), (0, 0, 1)),
          XZ=Pl((0, 0, 0), (1, 0, 0), (0, -1, 0)), YZ=Pl((0, 0, 0), (0, 1, 0), (1, 0, 0)))
for qualname, value in m.CLASS_ATTRIBUTES.items():
    owner, attribute = qualname.split(".")
    setattr(ns[owner], attribute, value)
results = {}
for name, expression in json.loads(sys.stdin.read()):
    try:
        got = eval(expression, ns)
    except Exception as error:
        results[name] = {"error": type(error).__name__, "message": str(error)}
        continue
    if not isinstance(got, m._Profile):
        results[name] = {"value": repr(got)}
        continue
    faces = got._wonky_faces() if hasattr(type(got), "_wonky_faces") else []
    results[name] = {"type": type(got).__name__, "area": got.area, "faces": faces, "edges": got._wonky_edges(),
                     "vertices": got._wonky_vertices()}
results["__calls__"] = calls
print(json.dumps(results))
`;

function run(cases) {
  const output = execFileSync('uv', ['run', '--no-project', '--quiet', 'python', '-B', '-c', DRIVER, pythonDir], {
    input: JSON.stringify(cases), encoding: 'utf8', timeout: 120000,
  });
  const results = JSON.parse(output);
  const calls = results.__calls__;
  delete results.__calls__;
  return { results, calls };
}

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
const nearPoint = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]));

function sameEdge(got, want) {
  const [geom, start, end, center, radius, mid] = want;
  if ((got.geom === 'LINE' ? 'L' : 'C') !== geom) return false;
  const ends = (nearPoint(got.start, start) && nearPoint(got.end, end)) || (nearPoint(got.start, end) && nearPoint(got.end, start));
  if (!ends) return false;
  return geom === 'L' || (nearPoint(got.center, center) && near(got.radius, radius) && nearPoint(got.mid, mid));
}

// [name, Python expression (stand-in placements), frozen build123d 0.13.0 result]
const CASES = [
  ["Circle(2)", "Circle(2)",
   {"type":"Circle","area":12.566370614359169,"normals":[[0.0,0.0,1.0]],"edges":[["C",[2.0,0.0,0.0],[2.0,0.0,0.0],[0.0,0.0,0.0],2.0,[-2.0,0.0,0.0]]]}],
  ["Circle(2.5,align=MIN)", "Circle(2.5, align=MIN)",
   {"type":"Circle","area":19.634954084936204,"normals":[[0.0,0.0,1.0]],"edges":[["C",[5.0,2.5,0.0],[5.0,2.5,0.0],[2.5,2.5,0.0],2.5,[0.0,2.5,0.0]]]}],
  ["Pos(3,4)*Circle(1.5)", "Loc((3, 4)) * Circle(1.5)",
   {"type":"Circle","area":7.0685834705770345,"normals":[[0.0,0.0,1.0]],"edges":[["C",[4.5,4.0,0.0],[4.5,4.0,0.0],[3.0,4.0,0.0],1.5,[1.5,4.0,0.0]]]}],
  ["Plane.XZ*Circle(0.5)", "XZ * Circle(.5)",
   {"type":"Circle","area":0.7853981633974481,"normals":[[0.0,-1.0,0.0]],"edges":[["C",[0.5,0.0,0.0],[0.5,0.0,0.0],[0.0,0.0,0.0],0.5,[-0.5,0.0,0.0]]]}],
  ["Rectangle(4,2)", "Rectangle(4, 2)",
   {"type":"Rectangle","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-2.0,1.0,0.0],[-2.0,-1.0,0.0]],["L",[-2.0,-1.0,0.0],[2.0,-1.0,0.0]],["L",[2.0,-1.0,0.0],[2.0,1.0,0.0]],["L",[2.0,1.0,0.0],[-2.0,1.0,0.0]]]}],
  ["Rectangle(4,2,align=(MIN,CENTER))", "Rectangle(4, 2, align=(MIN, CENTER))",
   {"type":"Rectangle","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,1.0,0.0],[0.0,-1.0,0.0]],["L",[0.0,-1.0,0.0],[4.0,-1.0,0.0]],["L",[4.0,-1.0,0.0],[4.0,1.0,0.0]],["L",[4.0,1.0,0.0],[0.0,1.0,0.0]]]}],
  ["Rectangle(4,2,rotation=30)", "Rectangle(4, 2, rotation=30)",
   {"type":"Rectangle","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-2.232050808,-0.133974596,0.0],[-1.232050808,-1.866025404,0.0]],["L",[-1.232050808,-1.866025404,0.0],[2.232050808,0.133974596,0.0]],["L",[2.232050808,0.133974596,0.0],[1.232050808,1.866025404,0.0]],["L",[1.232050808,1.866025404,0.0],[-2.232050808,-0.133974596,0.0]]]}],
  ["Rectangle(4,2,rotation=30,align=MIN)", "Rectangle(4, 2, rotation=30, align=MIN)",
   {"type":"Rectangle","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-1.0,1.732050808,0.0],[0.0,0.0,0.0]],["L",[0.0,0.0,0.0],[3.464101615,2.0,0.0]],["L",[3.464101615,2.0,0.0],[2.464101615,3.732050808,0.0]],["L",[2.464101615,3.732050808,0.0],[-1.0,1.732050808,0.0]]]}],
  ["Plane.XZ*Rectangle(2,4)", "XZ * Rectangle(2, 4)",
   {"type":"Rectangle","area":8.0,"normals":[[0.0,-1.0,0.0]],"edges":[["L",[-1.0,0.0,2.0],[-1.0,0.0,-2.0]],["L",[-1.0,0.0,-2.0],[1.0,0.0,-2.0]],["L",[1.0,0.0,-2.0],[1.0,0.0,2.0]],["L",[1.0,0.0,2.0],[-1.0,0.0,2.0]]]}],
  ["Plane.YZ*Rectangle(2,4)", "YZ * Rectangle(2, 4)",
   {"type":"Rectangle","area":8.0,"normals":[[1.0,0.0,0.0]],"edges":[["L",[0.0,-1.0,2.0],[0.0,-1.0,-2.0]],["L",[0.0,-1.0,-2.0],[0.0,1.0,-2.0]],["L",[0.0,1.0,-2.0],[0.0,1.0,2.0]],["L",[0.0,1.0,2.0],[0.0,-1.0,2.0]]]}],
  ["Plane.XY.offset(1.5)*Rectangle(2,4)", "XY.offset(1.5) * Rectangle(2, 4)",
   {"type":"Rectangle","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-1.0,2.0,1.5],[-1.0,-2.0,1.5]],["L",[-1.0,-2.0,1.5],[1.0,-2.0,1.5]],["L",[1.0,-2.0,1.5],[1.0,2.0,1.5]],["L",[1.0,2.0,1.5],[-1.0,2.0,1.5]]]}],
  ["Location((1,2,3),(10,20,30))*Rectangle(2,4)", "Loc((1, 2, 3), (10, 20, 30)) * Rectangle(2, 4)",
   {"type":"Rectangle","area":8.0,"normals":[[0.342020143,-0.163175911,0.925416578]],"edges":[["L",[-0.753490302,3.102507747,3.842465684],[1.125894939,-0.190184032,2.567282574]],["L",[1.125894939,-0.190184032,2.567282574],[2.753490302,0.897492253,2.157534316]],["L",[2.753490302,0.897492253,2.157534316],[0.874105061,4.190184032,3.432717426]],["L",[0.874105061,4.190184032,3.432717426],[-0.753490302,3.102507747,3.842465684]]]}],
  ["Rot(0,0,90)*Rectangle(2,4)", "Loc((0, 0, 0), (0, 0, 90)) * Rectangle(2, 4)",
   {"type":"Rectangle","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-2.0,-1.0,0.0],[2.0,-1.0,0.0]],["L",[2.0,-1.0,0.0],[2.0,1.0,0.0]],["L",[2.0,1.0,0.0],[-2.0,1.0,0.0]],["L",[-2.0,1.0,0.0],[-2.0,-1.0,0.0]]]}],
  ["Plane(origin=(1,2,3),x_dir=(0,1,0),z_dir=(1,0,0))*Rectangle(2,4)", "Pl((1, 2, 3), (0, 1, 0), (1, 0, 0)) * Rectangle(2, 4)",
   {"type":"Rectangle","area":8.0,"normals":[[1.0,0.0,0.0]],"edges":[["L",[1.0,1.0,5.0],[1.0,1.0,1.0]],["L",[1.0,1.0,1.0],[1.0,3.0,1.0]],["L",[1.0,3.0,1.0],[1.0,3.0,5.0]],["L",[1.0,3.0,5.0],[1.0,1.0,5.0]]]}],
  ["RectangleRounded(10,6,1)", "RectangleRounded(10, 6, 1)",
   {"type":"RectangleRounded","area":59.14159265358978,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-5.0,2.0,0.0],[-5.0,-2.0,0.0]],["C",[-5.0,-2.0,0.0],[-4.0,-3.0,0.0],[-4.0,-2.0,0.0],1.0,[-4.707106781,-2.707106781,0.0]],["L",[-4.0,-3.0,0.0],[4.0,-3.0,0.0]],["C",[4.0,-3.0,0.0],[5.0,-2.0,0.0],[4.0,-2.0,0.0],1.0,[4.707106781,-2.707106781,0.0]],["L",[5.0,-2.0,0.0],[5.0,2.0,0.0]],["C",[5.0,2.0,0.0],[4.0,3.0,0.0],[4.0,2.0,0.0],1.0,[4.707106781,2.707106781,0.0]],["L",[4.0,3.0,0.0],[-4.0,3.0,0.0]],["C",[-4.0,3.0,0.0],[-5.0,2.0,0.0],[-4.0,2.0,0.0],1.0,[-4.707106781,2.707106781,0.0]]]}],
  ["RectangleRounded(10,6,2.99)", "RectangleRounded(10, 6, 2.99)",
   {"type":"RectangleRounded","area":52.325752482358105,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-5.0,0.01,0.0],[-5.0,-0.01,0.0]],["C",[-5.0,-0.01,0.0],[-2.01,-3.0,0.0],[-2.01,-0.01,0.0],2.99,[-4.124249276,-2.124249276,0.0]],["L",[-2.01,-3.0,0.0],[2.01,-3.0,0.0]],["C",[2.01,-3.0,0.0],[5.0,-0.01,0.0],[2.01,-0.01,0.0],2.99,[4.124249276,-2.124249276,0.0]],["L",[5.0,-0.01,0.0],[5.0,0.01,0.0]],["C",[5.0,0.01,0.0],[2.01,3.0,0.0],[2.01,0.01,0.0],2.99,[4.124249276,2.124249276,0.0]],["L",[2.01,3.0,0.0],[-2.01,3.0,0.0]],["C",[-2.01,3.0,0.0],[-5.0,0.01,0.0],[-2.01,0.01,0.0],2.99,[-4.124249276,2.124249276,0.0]]]}],
  ["RectangleRounded(10,6,3)", "RectangleRounded(10, 6, 3)",
   {"error":"ValueError","message":"width and height must be > 2*radius"}],
  ["RectangleRounded(6,10,3)", "RectangleRounded(6, 10, 3)",
   {"error":"ValueError","message":"width and height must be > 2*radius"}],
  ["RectangleRounded(30,20,2.2,align=MIN)", "RectangleRounded(30, 20, 2.2, align=MIN)",
   {"type":"RectangleRounded","area":595.8453084433745,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,17.8,0.0],[0.0,2.2,0.0]],["C",[0.0,2.2,0.0],[2.2,0.0,0.0],[2.2,2.2,0.0],2.2,[0.644365081,0.644365081,0.0]],["L",[2.2,0.0,0.0],[27.8,0.0,0.0]],["C",[27.8,0.0,0.0],[30.0,2.2,0.0],[27.8,2.2,0.0],2.2,[29.355634919,0.644365081,0.0]],["L",[30.0,2.2,0.0],[30.0,17.8,0.0]],["C",[30.0,17.8,0.0],[27.8,20.0,0.0],[27.8,17.8,0.0],2.2,[29.355634919,19.355634919,0.0]],["L",[27.8,20.0,0.0],[2.2,20.0,0.0]],["C",[2.2,20.0,0.0],[0.0,17.8,0.0],[2.2,17.8,0.0],2.2,[0.644365081,19.355634919,0.0]]]}],
  ["RectangleRounded(10,6,1,rotation=90)", "RectangleRounded(10, 6, 1, rotation=90)",
   {"type":"RectangleRounded","area":59.14159265358978,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-2.0,-5.0,0.0],[2.0,-5.0,0.0]],["C",[2.0,-5.0,0.0],[3.0,-4.0,0.0],[2.0,-4.0,0.0],1.0,[2.707106781,-4.707106781,0.0]],["L",[3.0,-4.0,0.0],[3.0,4.0,0.0]],["C",[3.0,4.0,0.0],[2.0,5.0,0.0],[2.0,4.0,0.0],1.0,[2.707106781,4.707106781,0.0]],["L",[2.0,5.0,0.0],[-2.0,5.0,0.0]],["C",[-2.0,5.0,0.0],[-3.0,4.0,0.0],[-2.0,4.0,0.0],1.0,[-2.707106781,4.707106781,0.0]],["L",[-3.0,4.0,0.0],[-3.0,-4.0,0.0]],["C",[-3.0,-4.0,0.0],[-2.0,-5.0,0.0],[-2.0,-4.0,0.0],1.0,[-2.707106781,-4.707106781,0.0]]]}],
  ["Pos(0,0,2)*RectangleRounded(10,6,1)", "Loc((0, 0, 2)) * RectangleRounded(10, 6, 1)",
   {"type":"RectangleRounded","area":59.14159265358978,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-5.0,2.0,2.0],[-5.0,-2.0,2.0]],["C",[-5.0,-2.0,2.0],[-4.0,-3.0,2.0],[-4.0,-2.0,2.0],1.0,[-4.707106781,-2.707106781,2.0]],["L",[-4.0,-3.0,2.0],[4.0,-3.0,2.0]],["C",[4.0,-3.0,2.0],[5.0,-2.0,2.0],[4.0,-2.0,2.0],1.0,[4.707106781,-2.707106781,2.0]],["L",[5.0,-2.0,2.0],[5.0,2.0,2.0]],["C",[5.0,2.0,2.0],[4.0,3.0,2.0],[4.0,2.0,2.0],1.0,[4.707106781,2.707106781,2.0]],["L",[4.0,3.0,2.0],[-4.0,3.0,2.0]],["C",[-4.0,3.0,2.0],[-5.0,2.0,2.0],[-4.0,2.0,2.0],1.0,[-4.707106781,2.707106781,2.0]]]}],
  ["Plane.XZ*RectangleRounded(10,6,1)", "XZ * RectangleRounded(10, 6, 1)",
   {"type":"RectangleRounded","area":59.14159265358978,"normals":[[0.0,-1.0,0.0]],"edges":[["L",[-5.0,0.0,2.0],[-5.0,0.0,-2.0]],["C",[-5.0,0.0,-2.0],[-4.0,0.0,-3.0],[-4.0,0.0,-2.0],1.0,[-4.707106781,0.0,-2.707106781]],["L",[-4.0,0.0,-3.0],[4.0,0.0,-3.0]],["C",[4.0,0.0,-3.0],[5.0,0.0,-2.0],[4.0,0.0,-2.0],1.0,[4.707106781,0.0,-2.707106781]],["L",[5.0,0.0,-2.0],[5.0,0.0,2.0]],["C",[5.0,0.0,2.0],[4.0,0.0,3.0],[4.0,0.0,2.0],1.0,[4.707106781,0.0,2.707106781]],["L",[4.0,0.0,3.0],[-4.0,0.0,3.0]],["C",[-4.0,0.0,3.0],[-5.0,0.0,2.0],[-4.0,0.0,2.0],1.0,[-4.707106781,0.0,2.707106781]]]}],
  ["Polygon((0,0),(4,0),(0,2))", "Polygon((0, 0), (4, 0), (0, 2))",
   {"type":"Polygon","area":3.9999999999999996,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[0.0,2.0,0.0]],["L",[0.0,2.0,0.0],[0.0,0.0,0.0]]]}],
  ["Polygon((0,0),(0,2),(4,0))CW", "Polygon((0, 0), (0, 2), (4, 0))",
   {"type":"Polygon","area":3.999999999999999,"normals":[[0.0,0.0,-1.0]],"edges":[["L",[0.0,0.0,0.0],[0.0,2.0,0.0]],["L",[0.0,2.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[0.0,0.0,0.0]]]}],
  ["Polygon(list,align=None)", "Polygon([(0, 0), (4, 0), (4, 1), (1, 3)], align=None)",
   {"type":"Polygon","area":7.5,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,1.0,0.0]],["L",[4.0,1.0,0.0],[1.0,3.0,0.0]],["L",[1.0,3.0,0.0],[0.0,0.0,0.0]]]}],
  ["Polygon(6pts,align=None)", "Polygon((-2.1, 0), (2.1, 0), (2.1, .6), (3.5, 2.2), (-3.5, 2.2), (-2.1, .6), align=None)",
   {"type":"Polygon","area":11.480000000000002,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-2.1,0.0,0.0],[2.1,0.0,0.0]],["L",[2.1,0.0,0.0],[2.1,0.6,0.0]],["L",[2.1,0.6,0.0],[3.5,2.2,0.0]],["L",[3.5,2.2,0.0],[-3.5,2.2,0.0]],["L",[-3.5,2.2,0.0],[-2.1,0.6,0.0]],["L",[-2.1,0.6,0.0],[-2.1,0.0,0.0]]]}],
  ["Polygon(4pts)", "Polygon((1, 1), (5, 1), (5, 3), (1, 3))",
   {"type":"Polygon","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[1.0,1.0,0.0],[5.0,1.0,0.0]],["L",[5.0,1.0,0.0],[5.0,3.0,0.0]],["L",[5.0,3.0,0.0],[1.0,3.0,0.0]],["L",[1.0,3.0,0.0],[1.0,1.0,0.0]]]}],
  ["Polygon(3pts,align=CENTER)", "Polygon((1, 1), (5, 1), (1, 4), align=CENTER)",
   {"type":"Polygon","area":6.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[-2.0,-1.5,0.0],[2.0,-1.5,0.0]],["L",[2.0,-1.5,0.0],[-2.0,1.5,0.0]],["L",[-2.0,1.5,0.0],[-2.0,-1.5,0.0]]]}],
  ["Polygon(4pts,align=(MIN,MAX))", "Polygon((1, 1), (5, 1), (5, 3), (1, 3), align=(MIN, MAX))",
   {"type":"Polygon","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,-2.0,0.0],[4.0,-2.0,0.0]],["L",[4.0,-2.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[0.0,0.0,0.0]],["L",[0.0,0.0,0.0],[0.0,-2.0,0.0]]]}],
  ["Polygon(4pts,rotation=45)", "Polygon((1, 1), (5, 1), (5, 3), (1, 3), rotation=45)",
   {"type":"Polygon","area":8.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,1.414213562,0.0],[2.828427125,4.242640687,0.0]],["L",[2.828427125,4.242640687,0.0],[1.414213562,5.656854249,0.0]],["L",[1.414213562,5.656854249,0.0],[-1.414213562,2.828427125,0.0]],["L",[-1.414213562,2.828427125,0.0],[0.0,1.414213562,0.0]]]}],
  ["Polygon(closing pt repeated)", "Polygon((0, 0), (4, 0), (0, 2), (0, 0))",
   {"type":"Polygon","area":3.9999999999999996,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[0.0,2.0,0.0]],["L",[0.0,2.0,0.0],[0.0,0.0,0.0]]]}],
  ["Plane.XZ*Polygon(CCW)", "XZ * Polygon((0, 0), (4, 0), (0, 2), align=None)",
   {"type":"Polygon","area":3.9999999999999996,"normals":[[0.0,-1.0,0.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[0.0,0.0,2.0]],["L",[0.0,0.0,2.0],[0.0,0.0,0.0]]]}],
  ["Plane.YZ*Polygon(CCW)", "YZ * Polygon((0, 0), (4, 0), (0, 2), align=None)",
   {"type":"Polygon","area":3.9999999999999996,"normals":[[1.0,0.0,0.0]],"edges":[["L",[0.0,0.0,0.0],[0.0,4.0,0.0]],["L",[0.0,4.0,0.0],[0.0,0.0,2.0]],["L",[0.0,0.0,2.0],[0.0,0.0,0.0]]]}],
  ["Plane.XZ*Polygon(CW)", "XZ * Polygon((0, 0), (0, 2), (4, 0), align=None)",
   {"type":"Polygon","area":3.999999999999999,"normals":[[0.0,1.0,0.0]],"edges":[["L",[0.0,0.0,0.0],[0.0,0.0,2.0]],["L",[0.0,0.0,2.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[0.0,0.0,0.0]]]}],
  ["RegularPolygon(5,3)", "RegularPolygon(5, 3)",
   {"type":"RegularPolygon","area":32.47595264191644,"normals":[[0.0,0.0,1.0]],"edges":[["L",[5.0,0.0,0.0],[-2.5,4.330127019,0.0]],["L",[-2.5,4.330127019,0.0],[-2.5,-4.330127019,0.0]],["L",[-2.5,-4.330127019,0.0],[5.0,0.0,0.0]]]}],
  ["RegularPolygon(5,6,major_radius=True,rotation=0)", "RegularPolygon(5, 6, major_radius=True, rotation=0)",
   {"type":"RegularPolygon","area":64.95190528383289,"normals":[[0.0,0.0,1.0]],"edges":[["L",[5.0,0.0,0.0],[2.5,4.330127019,0.0]],["L",[2.5,4.330127019,0.0],[-2.5,4.330127019,0.0]],["L",[-2.5,4.330127019,0.0],[-5.0,0.0,0.0]],["L",[-5.0,0.0,0.0],[-2.5,-4.330127019,0.0]],["L",[-2.5,-4.330127019,0.0],[2.5,-4.330127019,0.0]],["L",[2.5,-4.330127019,0.0],[5.0,0.0,0.0]]]}],
  ["RegularPolygon(5,6,major_radius=False)", "RegularPolygon(5, 6, major_radius=False)",
   {"type":"RegularPolygon","area":86.60254037844385,"normals":[[0.0,0.0,1.0]],"edges":[["L",[5.773502692,0.0,0.0],[2.886751346,5.0,0.0]],["L",[2.886751346,5.0,0.0],[-2.886751346,5.0,0.0]],["L",[-2.886751346,5.0,0.0],[-5.773502692,0.0,0.0]],["L",[-5.773502692,0.0,0.0],[-2.886751346,-5.0,0.0]],["L",[-2.886751346,-5.0,0.0],[2.886751346,-5.0,0.0]],["L",[2.886751346,-5.0,0.0],[5.773502692,0.0,0.0]]]}],
  ["RegularPolygon(4,5,major_radius=True,rotation=30)", "RegularPolygon(4, 5, major_radius=True, rotation=30)",
   {"type":"RegularPolygon","area":38.042260651806146,"normals":[[0.0,0.0,1.0]],"edges":[["L",[3.464101615,2.0,0.0],[-0.831646763,3.912590403,0.0]],["L",[-0.831646763,3.912590403,0.0],[-3.978087581,0.418113853,0.0]],["L",[-3.978087581,0.418113853,0.0],[-1.626946572,-3.654181831,0.0]],["L",[-1.626946572,-3.654181831,0.0],[2.972579302,-2.676522425,0.0]],["L",[2.972579302,-2.676522425,0.0],[3.464101615,2.0,0.0]]]}],
  ["RegularPolygon(5,3,align=MIN)", "RegularPolygon(5, 3, align=(MIN, MIN))",
   {"type":"RegularPolygon","area":32.47595264191645,"normals":[[0.0,0.0,1.0]],"edges":[["L",[7.5,4.330127019,0.0],[0.0,8.660254038,0.0]],["L",[0.0,8.660254038,0.0],[0.0,0.0,0.0]],["L",[0.0,0.0,0.0],[7.5,4.330127019,0.0]]]}],
  ["RegularPolygon(5,2)", "RegularPolygon(5, 2)",
   {"error":"ValueError","message":"RegularPolygon must have at least three sides, not 2"}],
  ["make_face(Polyline(tri,close))", "make_face(Polyline((0, 0), (4, 0), (4, 3), close=True))",
   {"type":"Sketch","area":6.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,3.0,0.0]],["L",[4.0,3.0,0.0],[0.0,0.0,0.0]]]}],
  ["make_face(Polyline(triCW,close))", "make_face(Polyline((0, 0), (4, 3), (4, 0), close=True))",
   {"type":"Sketch","area":6.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[4.0,3.0,0.0],[0.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,3.0,0.0]],["L",[0.0,0.0,0.0],[4.0,0.0,0.0]]]}],
  ["make_face(Polyline(5pts,close))", "make_face(Polyline((0.0, -50), (3, -47), (3, -16), (-3, -16), (-3, -47), close=True))",
   {"type":"Sketch","area":195.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,-50.0,0.0],[3.0,-47.0,0.0]],["L",[3.0,-47.0,0.0],[3.0,-16.0,0.0]],["L",[3.0,-16.0,0.0],[-3.0,-16.0,0.0]],["L",[-3.0,-16.0,0.0],[-3.0,-47.0,0.0]],["L",[-3.0,-47.0,0.0],[0.0,-50.0,0.0]]]}],
  ["make_face(Plane.XZ*Polyline(CCW,close))", "make_face(XZ * Polyline((0, 0), (4, 0), (4, 3), close=True))",
   {"type":"Sketch","area":6.000000000000002,"normals":[[0.0,-1.0,0.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,0.0,3.0]],["L",[4.0,0.0,3.0],[0.0,0.0,0.0]]]}],
  ["make_face(Plane.XZ*Polyline(CW,close))", "make_face(XZ * Polyline((0, 0), (4, 3), (4, 0), close=True))",
   {"type":"Sketch","area":6.0,"normals":[[0.0,1.0,0.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,3.0]],["L",[4.0,0.0,3.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[0.0,0.0,0.0]]]}],
  ["make_face(Plane.YZ*Polyline(CCW,close))", "make_face(YZ * Polyline((0, 0), (4, 0), (4, 3), close=True))",
   {"type":"Sketch","area":6.000000000000001,"normals":[[1.0,0.0,0.0]],"edges":[["L",[0.0,0.0,0.0],[0.0,4.0,0.0]],["L",[0.0,4.0,0.0],[0.0,4.0,3.0]],["L",[0.0,4.0,3.0],[0.0,0.0,0.0]]]}],
  ["make_face(Plane.YZ*Polyline(CW,close))", "make_face(YZ * Polyline((0, 0), (4, 3), (4, 0), close=True))",
   {"type":"Sketch","area":5.999999999999999,"normals":[[-1.0,0.0,0.0]],"edges":[["L",[0.0,0.0,0.0],[0.0,4.0,3.0]],["L",[0.0,4.0,3.0],[0.0,4.0,0.0]],["L",[0.0,4.0,0.0],[0.0,0.0,0.0]]]}],
  ["make_face(Plane.XY.offset(2)*Polyline(CW,close))", "make_face(XY.offset(2) * Polyline((0, 0), (4, 3), (4, 0), close=True))",
   {"type":"Sketch","area":6.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[4.0,3.0,2.0],[0.0,0.0,2.0]],["L",[4.0,0.0,2.0],[4.0,3.0,2.0]],["L",[0.0,0.0,2.0],[4.0,0.0,2.0]]]}],
  ["Pos(1,0)*make_face(Polyline(tri,close))", "Loc((1, 0)) * make_face(Polyline((0, 0), (4, 0), (4, 3), close=True))",
   {"type":"Sketch","area":6.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[1.0,0.0,0.0],[5.0,0.0,0.0]],["L",[5.0,0.0,0.0],[5.0,3.0,0.0]],["L",[5.0,3.0,0.0],[1.0,0.0,0.0]]]}],
  ["make_face(Polyline(closed by repeat))", "make_face(Polyline((0, 0), (4, 0), (4, 3), (0, 0), close=True))",
   {"type":"Sketch","area":6.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,3.0,0.0]],["L",[4.0,3.0,0.0],[0.0,0.0,0.0]]]}],
  ["make_face(Polyline(open))", "make_face(Polyline((0, 0), (4, 0), (4, 3)))",
   {"error":"ValueError","message":"Face can only be created with closed wires"}],
  ["Polyline(tri,close)", "Polyline((0, 0), (4, 0), (4, 3), close=True)",
   {"type":"Polyline","area":0.0,"normals":[],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,3.0,0.0]],["L",[4.0,3.0,0.0],[0.0,0.0,0.0]]]}],
  ["Face(Wire.make_polygon(3D YZ,close))", "Face(Wire.make_polygon([V(2, 0, 0), V(2, 3, 0), V(2, 3, 1), V(2, 0, 2)], close=True))",
   {"type":"Face","area":4.500000000000001,"normals":[[1.0,0.0,0.0]],"edges":[["L",[2.0,0.0,0.0],[2.0,3.0,0.0]],["L",[2.0,3.0,0.0],[2.0,3.0,1.0]],["L",[2.0,3.0,1.0],[2.0,0.0,2.0]],["L",[2.0,0.0,2.0],[2.0,0.0,0.0]]]}],
  ["Face(Wire.make_polygon(3D YZ CW,close))", "Face(Wire.make_polygon([V(2, 0, 0), V(2, 0, 2), V(2, 3, 1), V(2, 3, 0)], close=True))",
   {"type":"Face","area":4.499999999999999,"normals":[[-1.0,0.0,0.0]],"edges":[["L",[2.0,0.0,0.0],[2.0,0.0,2.0]],["L",[2.0,0.0,2.0],[2.0,3.0,1.0]],["L",[2.0,3.0,1.0],[2.0,3.0,0.0]],["L",[2.0,3.0,0.0],[2.0,0.0,0.0]]]}],
  ["Face(Wire.make_polygon(tuples,close))", "Face(Wire.make_polygon([(0, 0), (4, 0), (4, 3)], close=True))",
   {"type":"Face","area":6.0,"normals":[[0.0,0.0,1.0]],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,3.0,0.0]],["L",[4.0,3.0,0.0],[0.0,0.0,0.0]]]}],
  ["Wire.make_polygon(close)", "Wire.make_polygon([(0, 0, 0), (4, 0, 0), (4, 3, 0)], close=True)",
   {"type":"Wire","area":0.0,"normals":[],"edges":[["L",[0.0,0.0,0.0],[4.0,0.0,0.0]],["L",[4.0,0.0,0.0],[4.0,3.0,0.0]],["L",[4.0,3.0,0.0],[0.0,0.0,0.0]]]}],
  ["Plane(o,x,z)*Face(Wire.make_polygon)", "Pl((1, 2, 3), (0, -1, 0), (1, 0, 0)) * Face(Wire.make_polygon([(0, 0), (4, 0), (4, 3)], close=True))",
   {"type":"Face","area":6.0,"normals":[[1.0,0.0,0.0]],"edges":[["L",[1.0,2.0,3.0],[1.0,-2.0,3.0]],["L",[1.0,-2.0,3.0],[1.0,-2.0,0.0]],["L",[1.0,-2.0,0.0],[1.0,2.0,3.0]]]}],
];

test('profiles equal build123d 0.13.0: edges, arcs, normals, class and analytic area, without a host call', () => {
  const { results, calls } = run(CASES.map(([name, expression]) => [name, expression]));
  assert.deepEqual(calls, [], 'no host request');
  for (const [name, , want] of CASES) {
    const got = results[name];
    if (want.error) {
      assert.deepEqual({ error: got.error, message: got.message }, want, name);
      continue;
    }
    assert.equal(got.error, undefined, `${name}: ${got.message}`);
    assert.equal(got.type, want.type, name);
    assert.ok(Math.abs(got.area - want.area) <= 1e-12 * Math.max(1, want.area), `${name}: area ${got.area} != ${want.area}`);
    assert.equal(got.edges.length, want.edges.length, `${name}: edge count`);
    const unmatched = [...got.edges];
    for (const edge of want.edges) {
      const index = unmatched.findIndex(candidate => sameEdge(candidate, edge));
      assert.notEqual(index, -1, `${name}: missing edge ${JSON.stringify(edge)} in ${JSON.stringify(got.edges)}`);
      unmatched.splice(index, 1);
    }
    const vertices = [...new Map(want.edges.flatMap(edge => [edge[1], edge[2]]).map(p => [p.join(), p])).values()];
    assert.equal(got.vertices.length, vertices.length, `${name}: vertex count`);
    for (const vertex of vertices) assert.ok(got.vertices.some(p => nearPoint(p, vertex)), `${name}: vertex ${vertex}`);
    assert.equal(got.faces.length, want.normals.length, `${name}: face count`);
    got.faces.forEach((face, i) => assert.ok(nearPoint(face.plane.normal, want.normals[i]), `${name}: normal ${face.plane.normal}`));
  }
});

test('acceptance facts: RectangleRounded area and radius check, RegularPolygon span', () => {
  const { results } = run([
    ['rr', 'RectangleRounded(10, 6, 1)'],
    ['rr3', 'RectangleRounded(10, 6, 3)'],
    ['hex', 'RegularPolygon(5, 3)'],
  ]);
  assert.ok(Math.abs(results.rr.area - 59.14159265358978) <= 1e-12 * 60);
  assert.deepEqual(results.rr3, { error: 'ValueError', message: 'width and height must be > 2*radius' });
  const xs = results.hex.vertices.map(p => p[0]);
  assert.ok(near(Math.min(...xs), -2.5) && near(Math.max(...xs), 5));
});

test('profiles hand the host extrude_profile fragments: polygon, circle and exact line-arc loops', () => {
  const { results, calls } = run([
    ['rr', 'RectangleRounded(10, 6, 1)'],
    ['circle', 'XZ * Circle(0.5)'],
    ['cw', 'Polygon((0, 0), (0, 2), (4, 0))'],
    ['face', 'make_face(XZ * Polyline((0, 0), (4, 3), (4, 0), close=True))'],
    ['empty', 'Sketch()'],
  ]);
  assert.deepEqual(calls, []);
  const [rr] = results.rr.faces;
  assert.equal(rr.profile.kind, 'line-arc');
  assert.deepEqual(rr.profile.entities.map(entity => entity.type), ['line', 'arc', 'line', 'arc', 'line', 'arc', 'line', 'arc']);
  assert.deepEqual(rr.profile.entities[1], { type: 'arc', start: [-5, -2], mid: [-4 - Math.SQRT1_2, -2 - Math.SQRT1_2], end: [-4, -3] });
  assert.deepEqual(rr.plane, { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] });
  assert.deepEqual(results.circle.faces, [{ profile: { kind: 'circle', center: [0, 0], radius: 0.5 },
    plane: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] } }]);
  // A clockwise Polygon faces -Z (build123d extrudes it downwards); the loop is counter-clockwise about that normal.
  assert.deepEqual(results.cw.faces, [{ profile: { kind: 'polygon', points: [[0, 0], [0, -2], [4, 0]] },
    plane: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, -1] } }]);
  assert.ok(nearPoint(results.face.faces[0].plane.normal, [0, 1, 0]));
  assert.deepEqual(results.empty.faces, []);
  assert.equal(results.empty.area, 0);
});

test('2D Booleans, modes, sectors, degenerate outlines and other attributes are explicit capability errors', () => {
  const { results } = run([
    ['union', 'Circle(1) + Circle(2)'],
    ['difference', 'Rectangle(4, 2) - Circle(1)'],
    ['intersection', 'Circle(2) & Rectangle(1, 1)'],
    ['many', 'Sketch() + [Circle(1), Loc((5, 0)) * Circle(1)]'],
    ['face-union', 'Face(Wire.make_polygon([(0, 0), (1, 0), (0, 1)])) + Circle(1)'],
    ['mode', 'Rectangle(2, 2, mode=Mode.SUBTRACT)'],
    ['sector', 'Circle(1, arc_size=180)'],
    ['bowtie', 'Polygon((0, 0), (3, 2), (3, 0), (0, 1))'],
    ['balanced-bowtie', 'Polygon((0, 0), (2, 2), (2, 0), (0, 2))'],
    ['collinear', 'Polygon((0, 0), (1, 0), (2, 0))'],
    ['faces', 'Circle(1).faces()'],
    ['class-attribute', 'Face.make_rect(1, 2)'],
    ['edges', 'make_face([Polyline((0, 0), (1, 0)), Polyline((1, 0), (0, 1), (0, 0))])'],
  ]);
  const planar = 'needs a planar region Boolean (union/difference/intersection of faces), which the Bend kernel does not have';
  for (const name of ['union', 'difference', 'intersection', 'many']) {
    assert.equal(results[name].error, 'RuntimeError', name);
    assert.ok(results[name].message.startsWith('UNSUPPORTED: Sketch ') && results[name].message.includes(planar), results[name].message);
  }
  assert.match(results['face-union'].message, /^UNSUPPORTED: Face \+ .*planar region Boolean/);
  assert.match(results.mode.message, /^UNSUPPORTED: Rectangle\(mode=Mode\.SUBTRACT\) .*planar region Boolean/);
  assert.match(results.sector.message, /^UNSUPPORTED: Circle\(arc_size != 360\)/);
  assert.match(results.bowtie.message, /^UNSUPPORTED: Polygon outline intersects itself/);
  assert.match(results.collinear.message, /^UNSUPPORTED: Polygon has zero area/);
  assert.match(results['balanced-bowtie'].message, /^UNSUPPORTED: Polygon has zero area .*self-cancelling/);
  assert.match(results.faces.message, /^UNSUPPORTED: Circle\.faces is not implemented by the Python frontend/);
  assert.match(results['class-attribute'].message, /^UNSUPPORTED: Face\.make_rect is not implemented by the Python frontend/);
  assert.match(results.edges.message, /^UNSUPPORTED: make_face is implemented .* only for one closed polygon Wire/);
});

test('exact build123d behaviour without a Boolean: empty sketches, None summands, errors of the real API', () => {
  const { results, calls } = run([
    ['empty-plus-one', 'Sketch() + Circle(1)'],
    ['empty-plus-list', 'Sketch() + [RectangleRounded(10, 6, 1)]'],
    ['plus-none', 'Circle(1) + None'],
    ['bool', '(bool(Sketch()), bool(Circle(1)), len(Rectangle(1, 1)))'],
    ['same', '(lambda c: (c == __import__("copy").copy(c), c == Circle(1), c == Loc((1, 0)) * c, len({c, c})))(Circle(1))'],
    ['open', 'make_face(Polyline((0, 0), (4, 0), (4, 3)))'],
    ['nonplanar', 'Face(Wire.make_polygon([(0, 0, 0), (1, 0, 0), (1, 1, 1), (0, 1, 0)]))'],
    ['sides', 'RegularPolygon(5, 3.5)'],
    ['kwarg', 'Circle(1, rotation=3)'],
    ['one-point', 'Polyline((0, 0))'],
  ]);
  assert.deepEqual(calls, []);
  assert.equal(results['empty-plus-one'].type, 'Sketch');
  assert.ok(near(results['empty-plus-one'].area, Math.PI, 1e-12));
  assert.ok(near(results['empty-plus-list'].area, 59.14159265358978, 1e-12));
  assert.equal(results['plus-none'].type, 'Circle');
  assert.equal(results.bool.value, '(False, True, 1)');
  assert.equal(results.same.value, '(True, False, False, 1)', 'Shape.__eq__ is is_same()');
  assert.deepEqual(results.open, { error: 'ValueError', message: 'Face can only be created with closed wires' });
  assert.deepEqual(results.nonplanar, { error: 'ValueError', message: 'Cannot build face(s): wires not planar' });
  assert.deepEqual(results.sides, { error: 'TypeError', message: "'float' object cannot be interpreted as an integer" });
  assert.deepEqual(results.kwarg, { error: 'TypeError', message: "Circle.__init__() got an unexpected keyword argument 'rotation'" });
  assert.deepEqual(results['one-point'], { error: 'ValueError', message: 'Polyline requires two or more pts' });
});

const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-sketch-')));
const uvPython = join(workspace, 'uv-python');
writeFileSync(uvPython, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(uvPython, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));
const build = source => buildPython(source, { python: uvPython, timeoutMs: 120000 });

// The placement call shapes again, now through the frontend with the shim's
// real Plane, Location, Rot and Pos (python/_b3d_location.py).
const PLACED = [
  ['Pos(3,4)*Circle(1.5)', 'Pos(3, 4) * Circle(1.5)'],
  ['Plane.XZ*Circle(0.5)', 'Plane.XZ * Circle(0.5)'],
  ['Plane.XZ*Rectangle(2,4)', 'Plane.XZ * Rectangle(2, 4)'],
  ['Plane.YZ*Rectangle(2,4)', 'Plane.YZ * Rectangle(2, 4)'],
  ['Plane.XY.offset(1.5)*Rectangle(2,4)', 'Plane.XY.offset(1.5) * Rectangle(2, 4)'],
  ['Location((1,2,3),(10,20,30))*Rectangle(2,4)', 'Location((1, 2, 3), (10, 20, 30)) * Rectangle(2, 4)'],
  ['Rot(0,0,90)*Rectangle(2,4)', 'Rot(0, 0, 90) * Rectangle(2, 4)'],
  ['Plane(origin=(1,2,3),x_dir=(0,1,0),z_dir=(1,0,0))*Rectangle(2,4)', 'Plane(origin=(1, 2, 3), x_dir=(0, 1, 0), z_dir=(1, 0, 0)) * Rectangle(2, 4)'],
  ['Pos(0,0,2)*RectangleRounded(10,6,1)', 'Pos(0, 0, 2) * RectangleRounded(10, 6, 1)'],
  ['Plane.XZ*RectangleRounded(10,6,1)', 'Plane.XZ * RectangleRounded(10, 6, 1)'],
  ['Plane.XZ*Polygon(CCW)', 'Plane.XZ * Polygon((0, 0), (4, 0), (0, 2), align=None)'],
  ['Plane.YZ*Polygon(CCW)', 'Plane.YZ * Polygon((0, 0), (4, 0), (0, 2), align=None)'],
  ['Plane.XZ*Polygon(CW)', 'Plane.XZ * Polygon((0, 0), (0, 2), (4, 0), align=None)'],
  ['make_face(Plane.XZ*Polyline(CW,close))', 'make_face(Plane.XZ * Polyline((0, 0), (4, 3), (4, 0), close=True))'],
  ['make_face(Plane.YZ*Polyline(CW,close))', 'make_face(Plane.YZ * Polyline((0, 0), (4, 3), (4, 0), close=True))'],
  ['make_face(Plane.XY.offset(2)*Polyline(CW,close))', 'make_face(Plane.XY.offset(2) * Polyline((0, 0), (4, 3), (4, 0), close=True))'],
  ['Pos(1,0)*make_face(Polyline(tri,close))', 'Pos(1, 0) * make_face(Polyline((0, 0), (4, 0), (4, 3), close=True))'],
  ['Face(Wire.make_polygon(3D YZ,close))', 'Face(Wire.make_polygon([Vector(2, 0, 0), Vector(2, 3, 0), Vector(2, 3, 1), Vector(2, 0, 2)], close=True))'],
  ['Plane(o,x,z)*Face(Wire.make_polygon)', 'Plane(origin=(1, 2, 3), x_dir=(0, -1, 0), z_dir=(1, 0, 0)) * Face(Wire.make_polygon([(0, 0), (4, 0), (4, 3)], close=True))'],
];

test('Plane, Location, Rot and Pos place profiles exactly like build123d 0.13.0 (real shim classes, frontend run)', async () => {
  const expected = Object.fromEntries(CASES.map(([name, , want]) => [name, want]));
  const table = PLACED.map(([name, expression]) => [name, expression, expected[name]]);
  const model = await build([
    'from build123d import *',
    'import json',
    `TABLE = json.loads(${JSON.stringify(JSON.stringify(table))})`,
    'near = lambda a, b: all(abs(x - y) <= 1e-9 for x, y in zip(a, b))',
    'def same(edge, want):',
    '    geom, start, end = want[:3]',
    '    if ("L" if edge["geom"] == "LINE" else "C") != geom: return False',
    '    if not ((near(edge["start"], start) and near(edge["end"], end)) or (near(edge["start"], end) and near(edge["end"], start))): return False',
    '    return geom == "L" or (near(edge["center"], want[3]) and abs(edge["radius"] - want[4]) <= 1e-9 and near(edge["mid"], want[5]))',
    'for name, expression, want in TABLE:',
    '    got = eval(expression)',
    '    assert type(got).__name__ == want["type"], (name, type(got).__name__)',
    '    assert abs(got.area - want["area"]) <= 1e-12 * max(1, want["area"]), (name, got.area)',
    '    edges = got._wonky_edges()',
    '    assert len(edges) == len(want["edges"]) and all(any(same(e, w) for e in edges) for w in want["edges"]), (name, edges)',
    '    normals = [face["plane"]["normal"] for face in got._wonky_faces()]',
    '    assert len(normals) == len(want["normals"]) and all(near(a, b) for a, b in zip(normals, want["normals"])), (name, normals)',
    'result = Box(1, 1, 1)',
  ].join('\n') + '\n');
  assert.equal(model.bodies.length, 1);
});

test('a 2D Boolean in a model is a host-latched capability error at its use site', async () => {
  await assert.rejects(build([
    'from build123d import *',
    'plate = RectangleRounded(20, 10, 2)',
    'try:',
    '    profile = plate - Pos(3, 0) * Circle(1)',
    'except Exception:',
    '    profile = plate  # catching cannot turn the refusal into a successful run',
    'result = Box(1, 1, 1)',
  ].join('\n') + '\n'), error => error instanceof UnsupportedFeatureError
    && /planar region Boolean/.test(error.message) && error.line === 4);
});

}
