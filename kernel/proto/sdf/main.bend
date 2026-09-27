import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ../mesh-io.bend as MIO
import ./field.bend as F
import ./setup.bend as S
import ./octree.bend as O
import ./contour.bend as C

# Bake-off prototype "sdf": the analytic CSG tree as an implicit field
# (field.bend), an interval-pruned sparse octree with Manifold-DC cells
# (octree.bend), octree dual contouring with face tags (contour.bend).
# Input: the <case>.csg.job (tree, primitives, face table; no meshes).
#
# THE OUTPUT IS AN APPROXIMATION with a stated tolerance, never exact
# geometry: every vertex lies within `tol` (1 % of the case deviation) of every
# analytic carrier of its surface cycle, and the achieved deviation of the
# triangles from their tagged carriers (corners and sampled edge midpoints and
# centroids) is measured in Bend and printed after `end`:
#   sdf h_nm <fine cell> levels <octree depth> fine <cells> coarse <cells>
#       verts <n> tris <n> devc_nm <corner dev> devs_nm <sampled dev>
#       tries <n> tol_nm <vertex tolerance> dev_nm <case deviation>
# A mesh is returned only if devs <= deviation, no vertex failed, no triangle
# folds and no dual edge lacks a vertex; otherwise the grid is refined (up to
# two halvings) and then the case is refused with the reason. Tangent or
# touching contact (two carriers with opposite normals at a vertex) is always
# refused: its regularised result is not a 2-manifold.

type Res is Data:
  RSolved{mesh: M.Mesh, info: String, rope: C.Rope, vol6: R.Real}
  RUnresolved{reason: String}

type Env is Data:
  Env{tape: F.Tape, x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32, dev: F32, tsize: U32}

type Trial is Data:
  TDone{res: Res}
  TRetry{h: F32, reason: String}

# Smallest D with h * 2^D >= span, and h * 2^D.
type Lv is Data:
  Lv{d: U32, size: F32}

type Verdict is Data:
  VOk{}
  VContact{}
  VBad{why: String}

def nm(+x: F32) -> String:
  U32.show(F32.to_u32((x * 1000000.0 : F32)))

def empty_res(+why: String) -> Res:
  RSolved{M.empty_mesh(), "sdf empty " ++ why, C.RNil{}, R.from_f32(0.0)}

def levels(n: Nat, done: Bool, +h: F32, +span: F32, +d: U32, +size: F32) -> Lv:
  match n:
    case 0n:
      Lv{d, size}
    case 1n+k:
      match done:
        case True{}:
          Lv{d, size}
        case False{}:
          +s2 = (size * 2.0 : F32)
          levels(k, Bool.not((s2 < span : F32)), h, span, (d + 1 : U32), s2)

# A coordinate in micrometres, signed.
def um_s(+x: F32) -> String:
  Bool.pick(String, (x < 0.0 : F32), "-", "") ++ U32.show(F32.to_u32((F.absf(x) * 1000.0 : F32)))

def vp_s(p: O.VP) -> String:
  O.VP{x, y, z} = p
  um_s(x) ++ "," ++ um_s(y) ++ "," ++ um_s(z)

# A volume given as six times itself, printed in mm^3 with three decimals.
def vol_s(+v6: F32) -> String:
  +v = F.absf((v6 / 6.0 : F32))
  +w = F32.floor(v)
  +f = F32.to_u32(((v - w) * 1000.0 : F32))
  Bool.pick(String, (v6 < 0.0 : F32), "-", "") ++ U32.show(F32.to_u32(w)) ++ "." ++ Bool.pick(String, (f < 100 : U32), Bool.pick(String, (f < 10 : U32), "00", "0"), "") ++ U32.show(f)

def u(+s: String, +v: U32) -> String:
  " " ++ s ++ " " ++ U32.show(v)

def info(+h: F32, +d: U32, st: O.St, +nt: U32, +devc: F32, +devs: F32, +folds: U32, +gaps: U32, +merged: U32, +tries: U32, +tol: F32, +dev: F32) -> String:
  O.St{v, fa, ct, fi, co, why, fp, fcode, ax} = st
  "sdf h_nm " ++ nm(h) ++ u("levels", d) ++ u("fine", fi) ++ u("coarse", co) ++ u("verts", v) ++ u("tris", nt) ++ " devc_nm " ++ nm(devc) ++ " devs_nm " ++ nm(devs) ++ u("approx", ax) ++ u("fails", fa) ++ u("why", why) ++ u("contacts", ct) ++ u("folds", folds) ++ u("gaps", gaps) ++ u("merged", merged) ++ u("first_code", fcode) ++ " first_at " ++ vp_s(fp) ++ u("tries", tries) ++ " tol_nm " ++ nm(tol) ++ " dev_nm " ++ nm(dev)

def verdict.k(nc: Bool, nf: Bool, ng: Bool, nfo: Bool, okc: Bool, oks: Bool, +fails: U32, +gaps: U32, +folds: U32, +contacts: U32, +devs: F32, +why: U32) -> Verdict:
  match nc:
    case False{}:
      VContact{}
    case True{}:
      match nf:
        case False{}:
          VBad{U32.show(fails) ++ " surface cycles without a vertex on all their carriers inside the cell (reason bits " ++ U32.show(why) ++ ": 1 over three carriers, 2 residual, 4 outside cell, 8 field)"}
        case True{}:
          match ng:
            case False{}:
              VBad{U32.show(gaps) ++ " dual edges without a cell vertex"}
            case True{}:
              match nfo:
                case False{}:
                  VBad{U32.show(folds) ++ " folded triangles"}
                case True{}:
                  match okc:
                    case False{}:
                      VBad{"a vertex farther than the deviation from its tagged carrier"}
                    case True{}:
                      match oks:
                        case False{}:
                          VBad{"sampled chordal deviation " ++ nm(devs) ++ " nm above the case deviation"}
                        case True{}:
                          VOk{}

def verdict(st: O.St, out: C.Out, +dev: F32) -> Verdict:
  O.St{_, +fails, +contacts, _, _, +why, _, _, _} = st
  C.Out{_, _, +devc, +devs, +folds, +gaps, _} = out
  verdict.k(U32.is_eq(contacts, 0), U32.is_eq(fails, 0), U32.is_eq(gaps, 0), U32.is_eq(folds, 0), (devc < dev : F32), Bool.not((dev < devs : F32)), fails, gaps, folds, contacts, devs, why)

def mesh_of(o: O.Oct, r: C.Rope) -> M.Mesh:
  M.Mesh{C.collect(o, Nil{}), C.flatten(r, Nil{})}

def trial.v(v: Verdict, +o: O.Oct, +r: C.Rope, +line: String, +h: F32, +st: O.St, +v6: R.Real) -> Trial:
  match v:
    case VOk{}:
      TDone{RSolved{mesh_of(o, r), line ++ " vol_mm3 " ++ vol_s(R.approx(v6)), r, v6}}
    case VContact{}:
      O.St{_, _, +contacts, _, _, _, _, _, _} = st
      TDone{RUnresolved{"non-manifold contact: " ++ U32.show(contacts) ++ " surface cycles where two faces meet with opposite normals (tangent or touching contact; the regularised result is not a 2-manifold) [" ++ line ++ "]"}}
    case VBad{why}:
      TRetry{(h * 0.5 : F32), why ++ " [" ++ line ++ "]"}

def trial.w(+vd: Verdict, out: C.Out, +o: O.Oct, +h: F32, +d: U32, +st: O.St, +merged: U32, +tries: U32, +tol: F32, +dev: F32) -> Trial:
  C.Out{r, +nt, +devc, +devs, +folds, +gaps, +v6} = out
  trial.v(vd, o, r, info(h, d, st, nt, devc, devs, folds, gaps, merged, tries, tol, dev), h, st, v6)

def trial.m(p: O.Oct & U32, +st: O.St, +h: F32, +d: U32, +tries: U32, +tol: F32, +dev: F32) -> Trial:
  (+no, +merged) = p
  +out = C.cell_proc(U32.to_nat((d + 2 : U32)), no)
  trial.w(verdict(st, out, dev), out, no, h, d, st, merged, tries, tol, dev)

def trial.o(+o: O.Oct, +h: F32, +d: U32, +tries: U32, +tol: F32, +dev: F32) -> Trial:
  trial.m(C.merge_corners(C.number(o, 0), tol, (h * 0.1 : F32)), O.st_of(o), h, d, tries, tol, dev)

def trial.lv(lv: Lv, env: Env, +h: F32, +tries: U32) -> Trial:
  Lv{+d, +size} = lv
  Env{+tape, +x0, +y0, +z0, +x1, +y1, +z1, +dev, _} = env
  +cx = ((x0 + x1) * 0.5 : F32)
  +cy = ((y0 + y1) * 0.5 : F32)
  +cz = ((z0 + z1) * 0.5 : F32)
  +off = (h * 0.31830987 : F32)
  +ox = (cx - size * 0.5 + off : F32)
  +oy = (cy - size * 0.5 + off : F32)
  +oz = (cz - size * 0.5 + off : F32)
  +mag = (size + F.absf(cx) + F.absf(cy) + F.absf(cz) : F32)
  +eps = (mag * 0.000002 : F32)
  +tol = F32.max((dev * 0.01 : F32), (mag * 0.000001 : F32))
  +g = {O.Grid{ox, oy, oz, h, eps, 1.0, tol} : O.Grid}
  trial.o(O.build!(U32.to_nat((2 * d + 4 : U32)), O.CRaw{d, 0, 0, 0, size, tape}, tape, g), h, d, tries, tol, dev)

def trial(+env: Env, +h: F32, +tries: U32) -> Trial:
  Env{_, x0, y0, z0, x1, y1, z1, _, _} = env
  +span = (F32.max((x1 - x0 : F32), F32.max((y1 - y0 : F32), (z1 - z0 : F32))) + 4.0 * h : F32)
  trial.lv(levels(40n, Bool.not((h < span : F32)), h, span, 0, h), env, h, tries)

def attempt(n: Nat, t: Trial, +env: Env, +tries: U32) -> Res:
  match n:
    case 0n:
      match t:
        case TDone{r}:
          r
        case TRetry{_, why}:
          RUnresolved{why}
    case 1n+k:
      match t:
        case TDone{r}:
          r
        case TRetry{h, _}:
          attempt(k, trial(env, h, (tries + 1 : U32)), env, (tries + 1 : U32))

# Fine cell size: the curvature bound sqrt(r * dev) (triangle chords of about
# one cell stay within dev of a radius-r surface), capped at extent / 64 so
# that planar features are resolved.
def plan(+ext: F32, +rmin: F32, +dev: F32) -> F32:
  F32.min((ext / 64.0 : F32), F32.sqrt((rmin * dev : F32)))

def run_env(+env: Env, +rmin: F32) -> Res:
  Env{_, x0, y0, z0, x1, y1, z1, dev, _} = env
  +ext = F32.max((x1 - x0 : F32), F32.max((y1 - y0 : F32), (z1 - z0 : F32)))
  +h = plan(ext, rmin, dev)
  attempt(2n, trial(env, h, 1), env, 1)

def with_box(b: S.Box, tape: F.Tape, +dev: F32, +rmin: F32) -> Res:
  match b:
    case S.NoBox{}:
      empty_res("(bounding boxes of the CSG are disjoint)")
    case S.Box{x0, y0, z0, x1, y1, z1}:
      +t = tape
      run_env(Env{t, x0, y0, z0, x1, y1, z1, dev, F.size(t)}, rmin)

def with_tape(mt: Maybe<&2, F.Tape>, +box: S.Box, +dev: F32, +rmin: F32) -> Res:
  match mt:
    case None{}:
      RUnresolved{"malformed CSG (a leaf without faces or an unknown leaf index)"}
    case Some{t}:
      with_box(box, t, dev, rmin)

def box_scale(b: S.Box) -> F32:
  match b:
    case S.NoBox{}:
      1.0
    case S.Box{x0, y0, z0, x1, y1, z1}:
      F32.max(F32.max(F.absf(x0), F.absf(x1)), F32.max(F32.max(F.absf(y0), F.absf(y1)), F32.max(F.absf(z0), F.absf(z1))))

def go(+dev: F32, +tree: M.Csg, +ps: List<&2, M.Prim>, faces: List<&2, M.FaceTag>) -> Res:
  +box = S.csg_box(tree, ps)
  +tol = (box_scale(box) * 0.00001 + 0.000001 : F32)
  +rs = S.rows(faces)
  +lrs = S.canon_rows(rs, rs, tol)
  +leaves = S.leaf_tapes(ps, 0, lrs)
  +big = {1000000000.0 : F32}
  with_tape(S.csg_tape(tree, leaves), box, dev, F32.min(S.min_radius(rs, big), S.min_cone_radius(ps, big)))

def checked(c: S.Check, +dev: F32, +tree: M.Csg, +ps: List<&2, M.Prim>, faces: List<&2, M.FaceTag>) -> Res:
  match c:
    case S.Refuse{r}:
      RUnresolved{r}
    case S.Fine{}:
      go(dev, tree, ps, faces)

def solve_job(job: M.Job) -> Res:
  M.Job{_, dev, tree, +ps, faces, _} = job
  checked(S.check_all(ps), R.approx(dev), tree, ps, faces)

# --- bake-off contract --------------------------------------------------------

def parse(job: String) -> M.JobParse:
  MIO.parse_job(job)

def solve(p: M.JobParse) -> Res:
  match p:
    case M.Malformed{reason}:
      RUnresolved{"malformed-job " ++ reason}
    case M.Parsed{job}:
      solve_job(job)

def show(o: Res) -> String:
  match o:
    case RSolved{m, i, _, _}:
      MIO.put("ok\nmesh ", MIO.put_mesh_body(m, "end\n" ++ i ++ "\n"))
    case RUnresolved{reason}:
      MIO.put("unresolved ", MIO.put(reason, "\nend\n"))

def run(job: String) -> String:
  show(solve(parse(job)))
